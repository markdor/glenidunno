import type { PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { redirectNotFound, requireUser } from '$lib/server/authGuards';
import { getTastingHistoryDetail } from '$lib/server/tastings';

// A revealed tasting for every user, presentations only for its participants
// (see getTastingHistoryDetail). An unknown tasting and one that isn't
// revealed yet end in the same redirect as every other missing page.
export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const detail = getTastingHistoryDetail(db, params.id, user.id);
	if (!detail) redirectNotFound();
	return { detail };
};
