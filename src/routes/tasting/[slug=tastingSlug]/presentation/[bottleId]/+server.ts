import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireUser } from '$lib/server/authGuards';
import { db } from '$lib/server/db';
import { presentationResponse } from '$lib/server/tastingMedia';
import { findParticipant, getPresentationForParticipant } from '$lib/server/tastings';

// Like the participant page, the participant comes from the slug plus the
// logged-in user. During entry, for another tasting's bottle, without
// presentation or for someone who doesn't take part: always the same 404.
export const GET: RequestHandler = async ({ locals, params }) => {
	const user = requireUser(locals);
	const participant = findParticipant(db, params.slug, user.id);
	const presentation = participant
		? getPresentationForParticipant(db, participant, params.bottleId)
		: null;
	const response = presentation ? await presentationResponse(presentation) : null;
	if (!response) error(404, 'Not found');
	return response;
};
