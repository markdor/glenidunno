import { fail, type RequestEvent } from '@sveltejs/kit';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import { requireUser } from './authGuards';
import { createShare, findOwnBottle, revokeShare } from './bottleShares';
import { db } from './db';
import { logger } from './logger';
import { consumeTastingWriteLimit } from './tastingWriteThrottle';

// The actions behind the share button (ShareButton.svelte), spread into every
// page that shows the user's own revealed bottles: the participant page, the
// tasting history's page and the bottle database. The bottle id comes from the
// form, its owner only from the login – somebody else's bottle and an unknown
// one get the same answer. They share the participant's write limit with
// saving and removing bottles.

export const NOT_SHAREABLE_MESSAGE = 'Diese Flasche kannst du nicht teilen.';
export const NOT_REVEALED_MESSAGE = 'Teilen ist erst nach der Auflösung möglich.';
export const SHARE_LIMIT_MESSAGE =
	'Zu viele Änderungen. Warte ein paar Minuten und versuch es dann erneut.';

type ShareAction = 'share' | 'unshare';

/**
 * The user's own bottle from the form plus a consumed write – or the failure
 * to return instead.
 */
async function ownBottleFrom(event: RequestEvent, action: ShareAction) {
	const user = requireUser(event.locals);
	const bottleId = (await event.request.formData()).get('bottleId');
	const own = typeof bottleId === 'string' ? findOwnBottle(db, bottleId, user.id) : null;
	if (typeof bottleId !== 'string' || !own) {
		return { failure: fail(404, { action, userMessage: NOT_SHAREABLE_MESSAGE }) } as const;
	}
	if (!consumeTastingWriteLimit(db, own.participantId)) {
		return { failure: fail(429, { action, userMessage: SHARE_LIMIT_MESSAGE }) } as const;
	}
	return { userId: user.id, bottleId } as const;
}

export const shareActions = {
	/** Creates the bottle's link – or keeps the existing one, see createShare. */
	share: async (event: RequestEvent) => {
		const own = await ownBottleFrom(event, 'share');
		if ('failure' in own) return own.failure;
		let token: string | null;
		try {
			token = createShare(db, own.bottleId, own.userId);
		} catch (err: unknown) {
			logger.error({ err }, 'share failed');
			return fail(500, { action: 'share', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		if (!token) return fail(422, { action: 'share', userMessage: NOT_REVEALED_MESSAGE });
		return { action: 'share', shared: true };
	},

	/** Revokes the bottle's link; a bottle without one counts as revoked. */
	unshare: async (event: RequestEvent) => {
		const own = await ownBottleFrom(event, 'unshare');
		if ('failure' in own) return own.failure;
		try {
			revokeShare(db, own.bottleId, own.userId);
		} catch (err: unknown) {
			logger.error({ err }, 'unshare failed');
			return fail(500, { action: 'unshare', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		return { action: 'unshare', revoked: true };
	}
};
