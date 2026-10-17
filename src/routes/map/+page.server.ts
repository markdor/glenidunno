import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/authGuards';
import { getWorldMap } from '$lib/server/tastings';

// All revealed tastings for every user, like the statistics (see getWorldMap).
// Only counts and bottles: the geometry is a static asset the map loads after
// mounting, so neither this load nor __data.json carries it.
export const load: PageServerLoad = ({ locals }) => {
	const user = requireUser(locals);
	return { worldMap: getWorldMap(db, user.id) };
};
