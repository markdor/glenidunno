import { error, fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/authGuards';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/server/errorMessages';
import { logger } from '$lib/server/logger';
import { getBerlinToday } from '$lib/server/tastingPhase';
import { buildTastingLink } from '$lib/server/tastingToken';
import {
	deleteTasting,
	getAdminTastingDetail,
	openOrderEarly,
	regenerateParticipantToken,
	revealEarly,
	TastingValidationError,
	updateTastingDate,
	validateTastingDate
} from '$lib/server/tastings';

const TASTING_NOT_FOUND =
	'Dieses Tasting wurde nicht gefunden – möglicherweise wurde es bereits gelöscht.';

function changePhase(action: 'openOrder' | 'reveal', change: () => boolean) {
	try {
		if (!change()) return fail(404, { action, userMessage: TASTING_NOT_FOUND });
	} catch (err: unknown) {
		if (err instanceof TastingValidationError) {
			return fail(422, { action, userMessage: err.userMessage });
		}
		logger.error({ err, action }, 'manual tasting phase change failed');
		return fail(500, { action, userMessage: UNEXPECTED_ERROR_MESSAGE });
	}
	return { action, phaseChanged: true };
}

export const load: PageServerLoad = ({ locals, params }) => {
	requireAdmin(locals);
	const now = new Date();
	// Phase-dependent projection: during entry only names and progress.
	const detail = getAdminTastingDetail(db, params.id, now);
	if (!detail) error(404, 'Not found');
	return { detail, today: getBerlinToday(now) };
};

export const actions: Actions = {
	updateDate: async ({ request, locals, params }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const rawDate = String(form.get('tastingDate') ?? '');

		const { tastingDate, error: dateError } = validateTastingDate(rawDate);
		if (dateError) {
			return fail(400, {
				action: 'updateDate',
				tastingDate: rawDate,
				fieldErrors: { tastingDate: dateError }
			});
		}

		try {
			if (!updateTastingDate(db, params.id, tastingDate)) {
				return fail(404, { action: 'updateDate', userMessage: TASTING_NOT_FOUND });
			}
		} catch (err: unknown) {
			if (err instanceof TastingValidationError) {
				return fail(422, { action: 'updateDate', userMessage: err.userMessage });
			}
			logger.error({ err }, 'update tasting date failed');
			return fail(500, { action: 'updateDate', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		return { action: 'updateDate', updated: true };
	},

	// "18-Uhr-Button" and "9-Uhr-Button": overrule the clock for all links.
	openOrder: async ({ locals, params }) => {
		requireAdmin(locals);
		return changePhase('openOrder', () => openOrderEarly(db, params.id));
	},

	reveal: async ({ locals, params }) => {
		requireAdmin(locals);
		return changePhase('reveal', () => revealEarly(db, params.id));
	},

	regenerate: async ({ request, locals, params, url }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const participantId = String(form.get('participantId') ?? '');

		try {
			// Only replaces the hash: the old link dies at once, the bottles stay.
			const issued = regenerateParticipantToken(db, params.id, participantId);
			if (!issued) {
				return fail(404, {
					action: 'regenerate',
					userMessage: 'Diese Person gehört nicht (mehr) zu diesem Tasting.'
				});
			}
			// The plaintext link exists only in this response – it is shown once.
			return {
				action: 'regenerate',
				regenerated: {
					participantId,
					link: {
						name: issued.name,
						url: buildTastingLink(env.BASE_URL || url.origin, issued.token)
					}
				}
			};
		} catch (err) {
			logger.error({ err }, 'regenerate tasting link failed');
			return fail(500, { action: 'regenerate', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
	},

	delete: async ({ locals, params }) => {
		requireAdmin(locals);
		let deleted: boolean;
		try {
			// Participants, bottles and throttle rows go with it (ON DELETE CASCADE).
			deleted = deleteTasting(db, params.id);
		} catch (err) {
			logger.error({ err }, 'delete tasting failed');
			return fail(500, { action: 'delete', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		if (!deleted) return fail(404, { action: 'delete', userMessage: TASTING_NOT_FOUND });
		redirect(303, '/admin/tastings');
	}
};
