import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/authGuards';
import { listTastings } from '$lib/server/tastings';

// requireAdmin in every load and action of /admin/tastings/*, never only in a
// layout: page loads run in parallel to layout loads, and actions aren't
// covered by any layout load at all.
export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return { tastings: listTastings(db) };
};
