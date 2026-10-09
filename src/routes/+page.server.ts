import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/authGuards';
import { getDashboardTasting, getStartPageSummary } from '$lib/server/tastings';

// Both carry management data only (name, date, phase, progress) – never
// aliases or bottle names. The hero is the user's own tasting, the only place
// the slug leaves the server. The summary of all tastings is admin-only: other
// users get no data for it at all, not just a hidden card.
export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return {
		heroTasting: getDashboardTasting(db, user.id),
		tastingSummary: user.isAdmin ? getStartPageSummary(db) : null
	};
};
