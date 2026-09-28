import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/authGuards';
import { presentationResponse } from '$lib/server/tastingMedia';
import { getPresentationForAdmin } from '$lib/server/tastings';

// The admin tastes along, so presentations are only downloadable after the
// reveal – before that it's a 404 like for any unknown bottle.
export const GET: RequestHandler = async ({ locals, params }) => {
	requireAdmin(locals);
	const presentation = getPresentationForAdmin(db, params.id, params.bottleId);
	const response = presentation ? await presentationResponse(presentation) : null;
	if (!response) error(404, 'Not found');
	return response;
};
