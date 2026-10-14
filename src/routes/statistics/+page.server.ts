import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/authGuards';
import { getStatistics } from '$lib/server/tastings';

// All revealed tastings for every user, without slug or download link (see
// getStatistics): the bottle links lead to the history. The interval sliders
// of the histograms run in the browser, so changing them doesn't run this
// load again.
export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { statistics: getStatistics(db, user.id) };
};
