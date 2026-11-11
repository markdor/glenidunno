import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { presentationPdfResponse } from '$lib/server/tastingMedia';
import { getSharedPresentation } from '$lib/server/tastings';

// The shared bottle's presentation as PDF, for the viewer of the public page
// (fetched after its mount) and its download – without a login, like the page.
// Only presentations the viewer can show; the original file is never shared.
// Everything else the same 404 as the page, conversion failures a 503 like
// the participant's PDF route. The token is never logged.
export const GET: RequestHandler = async ({ params }) => {
	const presentation = getSharedPresentation(db, params.token);
	if (!presentation) error(404, 'Not found');

	let response: Response | null;
	try {
		response = await presentationPdfResponse(presentation.file);
	} catch (err: unknown) {
		logger.error({ err, file: presentation.file }, 'shared presentation pdf unavailable');
		error(503, 'Unavailable');
	}
	if (!response) error(404, 'Not found');
	return response;
};
