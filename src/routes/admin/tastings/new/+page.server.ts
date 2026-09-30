import { fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import {
	TASTING_BOTTLES_PER_PARTICIPANT,
	TASTING_NAME_LENGTH,
	TASTING_PARTICIPANT_NAME_LENGTH,
	TASTING_PARTICIPANTS
} from '$lib/validation';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/authGuards';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/server/errorMessages';
import { logger } from '$lib/server/logger';
import { getBerlinToday } from '$lib/server/tastingPhase';
import { buildTastingLink } from '$lib/server/tastingToken';
import { createTasting, validateTastingDate } from '$lib/server/tastings';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	// The server decides what "today" is (Berlin date), not the client clock.
	return { today: getBerlinToday(new Date()) };
};

type Values = {
	name: string;
	tastingDate: string;
	bottlesPerParticipant: string;
	participants: string[];
};

function validate(values: Values, now: Date) {
	const fieldErrors: Record<string, string> = {};

	const name = values.name.trim();
	if (!name) fieldErrors.name = 'required';
	else if (name.length > TASTING_NAME_LENGTH.max) fieldErrors.name = 'invalid';

	const date = validateTastingDate(values.tastingDate, now);
	if (date.error) fieldErrors.tastingDate = date.error;

	const bottles = values.bottlesPerParticipant.trim();
	const bottlesPerParticipant = Number(bottles);
	if (
		!/^\d+$/.test(bottles) ||
		bottlesPerParticipant < TASTING_BOTTLES_PER_PARTICIPANT.min ||
		bottlesPerParticipant > TASTING_BOTTLES_PER_PARTICIPANT.max
	) {
		fieldErrors.bottlesPerParticipant = 'invalid';
	}

	// Empty participant fields are simply ignored.
	const participantNames = values.participants.map((p) => p.trim()).filter(Boolean);
	if (participantNames.length === 0) fieldErrors.participants = 'required';
	else if (
		participantNames.length < TASTING_PARTICIPANTS.min ||
		participantNames.length > TASTING_PARTICIPANTS.max ||
		participantNames.some((p) => p.length > TASTING_PARTICIPANT_NAME_LENGTH.max)
	) {
		fieldErrors.participants = 'invalid';
	}

	return {
		input: { name, tastingDate: date.tastingDate, bottlesPerParticipant, participantNames },
		fieldErrors
	};
}

export const actions: Actions = {
	create: async ({ request, locals, url }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const values: Values = {
			name: String(form.get('name') ?? ''),
			tastingDate: String(form.get('tastingDate') ?? ''),
			bottlesPerParticipant: String(form.get('bottlesPerParticipant') ?? ''),
			participants: form.getAll('participant').map(String)
		};

		const { input, fieldErrors } = validate(values, new Date());
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, { action: 'create', values, fieldErrors });
		}

		try {
			const { id, tokens } = createTasting(db, input);
			// BASE_URL is the app's single public origin (see CLAUDE.md).
			const baseUrl = env.BASE_URL || url.origin;
			// The plaintext links exist only in this response – they are shown once.
			return {
				action: 'create',
				created: {
					tastingId: id,
					links: tokens.map((t) => ({ name: t.name, url: buildTastingLink(baseUrl, t.token) }))
				}
			};
		} catch (err) {
			logger.error({ err }, 'create tasting failed');
			return fail(500, { action: 'create', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
	}
};
