import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { getStartPageSummary } from '$lib/server/tastings';

// Tastings are admin-only: other users get no tasting data at all, not just
// a hidden card. The summary itself carries only management data (name, date,
// phase, progress) – never aliases or bottle names.
export const load: PageServerLoad = ({ locals }) => {
	if (!locals.user?.isAdmin) return { tastingSummary: null };
	return { tastingSummary: getStartPageSummary(db) };
};
