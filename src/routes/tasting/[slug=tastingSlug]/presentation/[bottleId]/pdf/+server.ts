import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/authGuards';
import { db } from '$lib/server/db';
import { logger } from '$lib/server/logger';
import { presentationPdfResponse } from '$lib/server/tastingMedia';
import { findParticipant, getPresentationForParticipant } from '$lib/server/tastings';

// The presentation as PDF, fetched by the viewer (../view) after its mount.
// Access like the download next door: during entry, for another tasting's
// bottle, without a viewable presentation or for someone who doesn't take
// part always the same 404 – no redirect, the viewer only reads the bytes.
// An office file not converted yet (Gotenberg was down, imported history) is
// converted on this first request.
export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireUser(locals);
	const participant = findParticipant(db, params.slug, user.id);
	const presentation = participant
		? getPresentationForParticipant(db, participant, params.bottleId)
		: null;
	if (!presentation) error(404, 'Not found');

	let response: Response | null;
	try {
		response = await presentationPdfResponse(presentation.file);
	} catch (err: unknown) {
		// Gotenberg missing, down or failing: the viewer shows its error state
		// with the download instead. Nothing internal leaves the server.
		logger.error({ err, file: presentation.file }, 'presentation pdf unavailable');
		error(503, 'Unavailable');
	}
	if (!response) error(404, 'Not found');
	return response;
};
