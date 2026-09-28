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
import { db } from '$lib/server/db';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/server/errorMessages';
import { logger } from '$lib/server/logger';
import { consumeTastingWriteLimit } from '$lib/server/tastingWriteThrottle';
import {
	findParticipantByToken,
	getParticipantView,
	saveBottle,
	TastingValidationError,
	type TokenHolder
} from '$lib/server/tastings';

// The only anonymous route (see guard.ts). The token alone decides what is
// shown: locals.user is never read here, and the participant always comes
// from the token, never from form data. GET has no side effects – messengers
// and mail scanners fetch links for previews.

function holderOr404(token: string): TokenHolder {
	// Unknown, deleted and replaced tokens end in the very same 404.
	const holder = findParticipantByToken(db, token);
	if (!holder) error(404, 'Not found');
	return holder;
}

export const load: PageServerLoad = ({ params }) => {
	const holder = holderOr404(params.token);
	return { view: getParticipantView(db, holder) };
};

/** The only form fields the save action reads. */
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
	save: async ({ request, params }) => {
		const holder = holderOr404(params.token);
		const form = await request.formData();
		const slot = Number(form.get('slot'));

		if (!consumeTastingWriteLimit(db, holder.id)) {
			return fail(429, {
				action: 'save',
				slot,
				userMessage: 'Zu viele Speichervorgänge. Warte ein paar Minuten und versuch es dann erneut.'
			});
		}

		const values = Object.fromEntries(
			BOTTLE_FIELDS.map((field) => [field, String(form.get(field) ?? '')])
		) as RawBottle;
		const { bottle, fieldErrors } = parseBottle(values);
		if (!bottle) return fail(400, { action: 'save', slot, values, fieldErrors });

		let result: 'saved' | 'alias-taken';
		try {
			// Phase, slot and alias uniqueness are checked in the upsert transaction.
			result = saveBottle(db, holder, slot, bottle);
		} catch (err: unknown) {
			if (err instanceof TastingValidationError) {
				// E.g. the page was left open past 18:00: the client reloads and
				// shows the pouring order instead of the form.
				logger.info({ reason: err.message }, 'tasting save rejected');
				return fail(422, { action: 'save', slot, userMessage: err.userMessage, reload: true });
			}
			logger.error({ err }, 'tasting save failed');
			return fail(500, { action: 'save', slot, userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		if (result === 'alias-taken') {
			return fail(409, { action: 'save', slot, values, fieldErrors: { alias: 'taken' } });
		}
		return { action: 'save', slot, saved: true };
	}
};
