import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import type { TastingBottle } from '$lib/tasting';
import {
	normalizeWhiskybaseUrl,
	TASTING_ABV,
	TASTING_AGE,
	TASTING_ALIAS_LENGTH,
	TASTING_BOTTLER_LENGTH,
	TASTING_BOTTLING_LENGTH,
	TASTING_DISTILLERY_LENGTH,
	TASTING_SCALE
} from '$lib/validation';
import { requireUser } from '$lib/server/authGuards';
import { db } from '$lib/server/db';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/server/errorMessages';
import { logger } from '$lib/server/logger';
import {
	applyFileChanges,
	checkPresentationUpload,
	stageUpload,
	type PendingUpload
} from '$lib/server/tastingMedia';
import { consumeTastingWriteLimit } from '$lib/server/tastingWriteThrottle';
import {
	findParticipant,
	getParticipantView,
	saveBottle,
	TastingValidationError,
	type Participant,
	type SaveBottleResult
} from '$lib/server/tastings';

// The participant page of a tasting (its presentation downloads live in
// presentation/[bottleId]/+server.ts). The participant always comes from the
// slug plus the logged-in user, never from form data. GET has no side effects
// – messengers and mail scanners fetch links for previews.

function participantOr404(locals: App.Locals, slug: string): Participant {
	const user = requireUser(locals);
	// Unknown slug and a user who doesn't take part – the admin included – end
	// in the very same 404.
	const participant = findParticipant(db, slug, user.id);
	if (!participant) error(404, 'Not found');
	return participant;
}

export const load: PageServerLoad = ({ locals, params }) => {
	const participant = participantOr404(locals, params.slug);
	return { view: getParticipantView(db, participant) };
};

/**
 * The only text fields the save action reads (besides slot, the
 * `presentation` file and the `removePresentation` checkbox).
 */
const BOTTLE_FIELDS = [
	'alias',
	'distillery',
	'bottler',
	'bottling',
	'age',
	'whiskybaseUrl',
	'smoke',
	'cask',
	'abv',
	'value'
] as const;

type RawBottle = Record<(typeof BOTTLE_FIELDS)[number], string>;

// One decimal place at most; trailing zeros (46.30) are fine, comma or dot.
const ABV_RE = /^\d{1,3}(?:\.\d0*)?$/;

function parseBottle(raw: RawBottle): {
	bottle: TastingBottle | null;
	fieldErrors: Record<string, string>;
} {
	const fieldErrors: Record<string, string> = {};

	function text(field: keyof RawBottle, max: number, required: boolean): string | null {
		const value = raw[field].trim();
		if (!value) {
			if (required) fieldErrors[field] = 'required';
			return null;
		}
		if (value.length > max) fieldErrors[field] = 'invalid';
		return value;
	}

	function integer(field: keyof RawBottle, min: number, max: number, required: boolean) {
		const value = raw[field].trim();
		if (!value) {
			if (required) fieldErrors[field] = 'required';
			return null;
		}
		const n = Number(value);
		if (!/^\d+$/.test(value) || n < min || n > max) fieldErrors[field] = 'invalid';
		return n;
	}

	const alias = text('alias', TASTING_ALIAS_LENGTH.max, true);
	const distillery = text('distillery', TASTING_DISTILLERY_LENGTH.max, true);
	const bottler = text('bottler', TASTING_BOTTLER_LENGTH.max, false);
	const bottling = text('bottling', TASTING_BOTTLING_LENGTH.max, false);
	const age = integer('age', TASTING_AGE.min, TASTING_AGE.max, false);
	const smoke = integer('smoke', TASTING_SCALE.min, TASTING_SCALE.max, true);
	const cask = integer('cask', TASTING_SCALE.min, TASTING_SCALE.max, true);
	const value = integer('value', TASTING_SCALE.min, TASTING_SCALE.max, true);

	const rawAbv = raw.abv.trim().replace(',', '.');
	const abv = Number(rawAbv);
	if (!rawAbv) fieldErrors.abv = 'required';
	else if (!ABV_RE.test(rawAbv) || abv < TASTING_ABV.min || abv > TASTING_ABV.max) {
		fieldErrors.abv = 'invalid';
	}

	// Server-side check via new URL(): only https links to whiskybase.com make
	// it into the reveal, no javascript: or foreign links.
	const rawUrl = raw.whiskybaseUrl.trim();
	const whiskybaseUrl = rawUrl ? normalizeWhiskybaseUrl(rawUrl) : null;
	if (rawUrl && !whiskybaseUrl) fieldErrors.whiskybaseUrl = 'invalid';

	if (Object.keys(fieldErrors).length > 0) return { bottle: null, fieldErrors };
	return {
		bottle: {
			alias: alias!,
			distillery: distillery!,
			bottler,
			bottling,
			age,
			whiskybaseUrl,
			smoke: smoke!,
			cask: cask!,
			abv,
			value: value!
		},
		fieldErrors
	};
}

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const holder = participantOr404(locals, params.slug);

		// Before the (possibly 30 MB) body is parsed at all.
		if (!consumeTastingWriteLimit(db, holder.id)) {
			return fail(429, {
				action: 'save',
				userMessage: 'Zu viele Speichervorgänge. Warte ein paar Minuten und versuch es dann erneut.'
			});
		}

		const form = await request.formData();
		const slot = Number(form.get('slot'));
		const values = Object.fromEntries(
			BOTTLE_FIELDS.map((field) => [field, String(form.get(field) ?? '')])
		) as RawBottle;
		const { bottle, fieldErrors } = parseBottle(values);
		const { upload, error: uploadError } = checkPresentationUpload(form.get('presentation'));
		if (uploadError) fieldErrors.presentation = uploadError;
		if (!bottle || uploadError) return fail(400, { action: 'save', slot, values, fieldErrors });

		// A new upload replaces the presentation, the checkbox removes it,
		// otherwise it stays as it is.
		let pending: PendingUpload | undefined;
		let result: SaveBottleResult;
		try {
			// The upload goes to a temporary file first (disk full shows up
			// before anything is saved). Phase, slot, alias uniqueness and the
			// file name (Tasting_<date>_<alias>) are settled in the upsert
			// transaction, the file moves to that name only afterwards.
			if (upload) pending = await stageUpload(upload);
			const presentation = pending ?? (form.get('removePresentation') === 'on' ? null : undefined);
			result = saveBottle(db, holder, slot, bottle, new Date(), presentation);
		} catch (err: unknown) {
			if (pending) await applyFileChanges([{ delete: pending.tempFile }]);
			if (err instanceof TastingValidationError) {
				// E.g. the page was left open past 18:00: the client reloads and
				// shows the pouring order instead of the form.
				logger.info({ reason: err.message }, 'tasting save rejected');
				return fail(422, { action: 'save', slot, userMessage: err.userMessage, reload: true });
			}
			logger.error({ err }, 'tasting save failed');
			return fail(500, { action: 'save', slot, userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		if (result.status === 'alias-taken') {
			if (pending) await applyFileChanges([{ delete: pending.tempFile }]);
			return fail(409, { action: 'save', slot, values, fieldErrors: { alias: 'taken' } });
		}
		await applyFileChanges(result.fileChanges);
		return { action: 'save', slot, saved: true };
	}
};
