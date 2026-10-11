import type { PageServerLoad } from './$types';
import { NOTICE_PARAM, parseNotice } from '$lib/notices';
import { db } from '$lib/server/db';
import { requireUser } from '$lib/server/authGuards';
import { getDashboardTasting, getStartPageSummary } from '$lib/server/tastings';

// All of it is management data only (name, motto, date, phase, progress) –
// never aliases or bottle names. The next and the last tasting are the user's
// own, the only place the slug leaves the server. The summary of all tastings
// is admin-only: other users get no data for it at all, not just a hidden card.
// The notice (e.g. after a redirect from a missing page) is whitelisted like
// the login page's error codes – its text never comes from the URL.
export const load: PageServerLoad = ({ locals, url }) => {
	const user = requireUser(locals);
	const { next, last } = getDashboardTasting(db, user.id);
	return {
		nextTasting: next,
		lastTasting: last,
		tastingSummary: user.isAdmin ? getStartPageSummary(db) : null,
		notice: parseNotice(url.searchParams.get(NOTICE_PARAM))
	};
};
