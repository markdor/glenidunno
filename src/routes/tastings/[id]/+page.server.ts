import type { Actions, PageServerLoad } from './$types';
import { db } from '$lib/server/db';
import { redirectNotFound, requireUser } from '$lib/server/authGuards';
import { shareActions } from '$lib/server/shareActions';
import { getTastingHistoryDetail } from '$lib/server/tastings';

// A revealed tasting for every user, presentations only for its participants,
// the share link only for the user's own bottles (see getTastingHistoryDetail).
// An unknown tasting and one that isn't revealed yet end in the same redirect
// as every other missing page.
export const load: PageServerLoad = ({ locals, params }) => {
	const user = requireUser(locals);
	const detail = getTastingHistoryDetail(db, params.id, user.id);
	if (!detail) redirectNotFound();
	return { detail };
};

// The share button of the user's own bottles.
export const actions: Actions = { ...shareActions };
