import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { presentationResponse } from '$lib/server/tastingMedia';
import { findParticipantByToken, getPresentationForParticipant } from '$lib/server/tastings';

// Public like the participant page (exact route ID in guard.ts): the token
// decides, locals.user is never read. Before the reveal, for another tasting's
// bottle, without presentation or with an unknown token: always the same 404.
export const GET: RequestHandler = async ({ params }) => {
	const holder = findParticipantByToken(db, params.token);
	const presentation = holder ? getPresentationForParticipant(db, holder, params.bottleId) : null;
	const response = presentation ? await presentationResponse(presentation) : null;
	if (!response) error(404, 'Not found');
	return response;
};
