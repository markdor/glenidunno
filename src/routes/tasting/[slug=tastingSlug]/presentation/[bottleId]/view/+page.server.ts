import type { PageServerLoad } from './$types';
import { isViewablePresentation } from '$lib/tasting';
import { redirectNotFound } from '$lib/server/authGuards';
import { db } from '$lib/server/db';
import { requireParticipant } from '$lib/server/tastingGuards';
import { getPresentationForParticipant } from '$lib/server/tastings';

// The presentation viewer: access like the download, but anything that isn't
// there ends in the dashboard redirect like every other missing page. Never
// converts – the links preload this load on hover (data-sveltekit-preload-data
// in app.html); the viewer fetches the PDF from ../pdf after its mount. No
// file name in `data`: the page needs none, and the original one may reveal
// the whisky before the reveal.
export const load: PageServerLoad = ({ locals, params, url }) => {
	const participant = requireParticipant(locals, params.slug);
	const presentation = getPresentationForParticipant(db, participant, params.bottleId);
	if (!presentation || !isViewablePresentation(presentation.file)) redirectNotFound();
	// The back link: the bottle database passes ?from=history, a tasting's page
	// in the tasting history (/tastings/[id]) ?from=tastings, everything else
	// returns to the participant page.
	switch (url.searchParams.get('from')) {
		case 'history':
			return { back: 'history' as const };
		case 'tastings':
			return { back: 'tastings' as const, tastingId: participant.tastingId };
		default:
			return { back: 'tasting' as const };
	}
};
