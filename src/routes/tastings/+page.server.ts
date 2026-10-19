import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/authGuards';
import { listTastingHistory } from '$lib/server/tastings';

// All revealed tastings for every user, like the bottle database and the
// statistics (see listTastingHistory).
export const load: PageServerLoad = ({ locals }) => {
	requireUser(locals);
	return { tastings: listTastingHistory(db) };
};
