import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { parseBottleForm } from '$lib/server/bottleForm';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import { logger } from '$lib/server/logger';
import {
	applyFileChanges,
	checkPresentationUpload,
	stageUpload,
	type PendingUpload
} from '$lib/server/tastingMedia';
import { requireParticipant } from '$lib/server/tastingGuards';
import { consumeTastingWriteLimit } from '$lib/server/tastingWriteThrottle';
import type { FileChange } from '$lib/server/presentationFiles';
import {
	getParticipantView,
	removeBottle,
	saveBottle,
	TastingValidationError,
	WRONG_FIELDS_MESSAGE,
	type SaveBottleResult
} from '$lib/server/tastings';

// The participant page of a tasting (its presentation downloads and the
// viewer live under presentation/[bottleId]). The participant always comes
// from the slug plus the logged-in user (requireParticipant), never from form
// data. GET has no side effects – messengers and mail scanners fetch links
// for previews.

export const load: PageServerLoad = ({ locals, params }) => {
	const participant = requireParticipant(locals, params.slug);
	try {
		return { view: getParticipantView(db, participant) };
	} catch (err: unknown) {
		// E.g. archived bottles before the reveal: the error page instead of any
		// content. error() is an expected error, so SvelteKit doesn't log again.
		logger.error({ err, tastingId: participant.tastingId }, 'tasting page load failed');
		error(500, UNEXPECTED_ERROR_MESSAGE);
	}
};

// Save and remove share the participant's write limit.
const WRITE_LIMIT_MESSAGE =
	'Zu viele Speichervorgänge. Warte ein paar Minuten und versuch es dann erneut.';

export const actions: Actions = {
	save: async ({ request, locals, params }) => {
		const holder = requireParticipant(locals, params.slug);

		// Before the (possibly 30 MB) body is parsed at all.
		if (!consumeTastingWriteLimit(db, holder.id)) {
			return fail(429, { action: 'save', userMessage: WRITE_LIMIT_MESSAGE });
		}

		const form = await request.formData();
		const slot = Number(form.get('slot'));
		// Only the fields of the tasting's algorithm; the other one's mean an
		// outdated page – reloading shows the right form.
		const { bottle, values, fieldErrors, foreign } = parseBottleForm(form, holder.tastingAlgorithm);
		if (foreign) {
			logger.info({ tastingId: holder.tastingId }, 'tasting save rejected: foreign fields');
			return fail(422, { action: 'save', slot, userMessage: WRONG_FIELDS_MESSAGE, reload: true });
		}
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
	},

	// Removes a further bottle (slot 3–6). The bottle is found by participant
	// (slug + login) and slot only, never by an id from the form.
	remove: async ({ request, locals, params }) => {
		const holder = requireParticipant(locals, params.slug);

		// Before the body is parsed, like save.
		if (!consumeTastingWriteLimit(db, holder.id)) {
			return fail(429, { action: 'remove', userMessage: WRITE_LIMIT_MESSAGE });
		}

		const form = await request.formData();
		const slot = Number(form.get('slot'));
		let fileChanges: FileChange[];
		try {
			fileChanges = removeBottle(db, holder, slot);
		} catch (err: unknown) {
			if (err instanceof TastingValidationError) {
				logger.info({ reason: err.message }, 'tasting remove rejected');
				return fail(422, { action: 'remove', slot, userMessage: err.userMessage, reload: true });
			}
			logger.error({ err }, 'tasting remove failed');
			return fail(500, { action: 'remove', slot, userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		// Only after the commit: a refused request deletes nothing.
		await applyFileChanges(fileChanges);
		return { action: 'remove', slot, removed: true };
	}
};
