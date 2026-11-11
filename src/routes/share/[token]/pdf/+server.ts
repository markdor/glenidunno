import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { readyPdfResponse } from '$lib/server/tastingMedia';
import { getSharedPresentation } from '$lib/server/tastings';

// The shared bottle's presentation as PDF, for the viewer of the public page
// (fetched after its mount) and its download – without a login, like the page.
// Only presentations the viewer can show; the original file is never shared.
// Only a PDF that is ready right now, never a conversion: the page links it
// only then (see its load), and nobody without a login starts LibreOffice.
// Everything else is the same 404 as the page, without a log entry. The token
// is never logged.
export const GET: RequestHandler = async ({ params }) => {
	const presentation = getSharedPresentation(db, params.token);
	const response = presentation && (await readyPdfResponse(presentation.file));
	if (!response) error(404, 'Not found');
	return response;
};
