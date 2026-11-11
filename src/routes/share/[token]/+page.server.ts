import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { getSharedBottle } from '$lib/server/tastings';

// A bottle's public share link (issue #58): reachable without a login (see
// guard.ts), the token is the only protection – never log it. A malformed,
// unknown or revoked token and a tasting that isn't revealed all end in the
// same 404 (+error.svelte next to this page), never in a redirect to /login.
// GET has no side effects and converts nothing – messengers fetch the link for
// previews; the viewer fetches the PDF after its mount (./pdf).
export const load: PageServerLoad = ({ params }) => {
	let view;
	try {
		view = getSharedBottle(db, params.token);
	} catch (err: unknown) {
		// E.g. a bottle that doesn't fit its tasting's algorithm.
		logger.error({ err }, 'shared bottle load failed');
		error(500, UNEXPECTED_ERROR_MESSAGE);
	}
	if (!view) error(404, 'Not found');
	return { view };
};
