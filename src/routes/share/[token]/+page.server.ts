import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import type { SharedBottleView } from '$lib/tasting';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { hasReadyPdf } from '$lib/server/tastingMedia';
import { getSharedBottle, getSharedPresentation } from '$lib/server/tastings';

// A bottle's public share link (issue #58): reachable without a login (see
// guard.ts), the token is the only protection – never log it. A malformed,
// unknown or revoked token and a tasting that isn't revealed all end in the
// same 404 (+error.svelte next to this page), never in a redirect to /login.
// GET has no side effects and converts nothing – messengers fetch the link for
// previews; the viewer fetches the PDF after its mount (./pdf).
export const load: PageServerLoad = async ({ params }) => {
	let view: SharedBottleView | null;
	try {
		view = getSharedBottle(db, params.token);
	} catch (err: unknown) {
		// E.g. a bottle that doesn't fit its tasting's algorithm.
		logger.error({ err }, 'shared bottle load failed');
		error(500, UNEXPECTED_ERROR_MESSAGE);
	}
	if (!view) error(404, 'Not found');
	return { view: { ...view, presentation: view.presentation && (await pdfReady(params.token)) } };
};

// Only a PDF that is ready right now: a file gone from disk or an office file
// not converted (yet) leaves the presentation out silently – instead of a red
// viewer and a download link that ends in a 404.
async function pdfReady(token: string): Promise<boolean> {
	const presentation = getSharedPresentation(db, token);
	return presentation !== null && (await hasReadyPdf(presentation.file));
}
