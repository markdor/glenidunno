import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/authGuards';
import { getStatistics } from '$lib/server/tastings';

// All revealed tastings for every user, slug and download link only for the
// own ones (see getStatistics). Reads no query parameters on purpose: search,
// filters and sorting of the table run in the browser, so changing them
// doesn't run this load again.
export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { statistics: getStatistics(db, user.id) };
};
