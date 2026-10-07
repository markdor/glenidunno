import { fail, redirect } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	TASTING_BOTTLES_PER_PARTICIPANT,
	TASTING_NAME_LENGTH,
	TASTING_PARTICIPANTS
} from '$lib/validation';
import { db } from '$lib/server/db';
import { requireAdmin } from '$lib/server/authGuards';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/server/errorMessages';
import { logger } from '$lib/server/logger';
import { getBerlinToday } from '$lib/server/tastingPhase';
import {
	createTasting,
	listSelectableUsers,
	TastingValidationError,
	validateTastingDate
} from '$lib/server/tastings';

export const load: PageServerLoad = ({ locals }) => {
	requireAdmin(locals);
	return {
		// The server decides what "today" is (Berlin date), not the client clock.
		today: getBerlinToday(new Date()),
		// Participants are picked from the active users; new people are added
		// on /admin first.
		users: listSelectableUsers(db)
	};
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

	// User ids of the ticked checkboxes; a tampered form may repeat one.
	const participantUserIds = [...new Set(values.participants.filter(Boolean))];
	if (participantUserIds.length === 0) fieldErrors.participants = 'required';
	else if (
		participantUserIds.length < TASTING_PARTICIPANTS.min ||
		participantUserIds.length > TASTING_PARTICIPANTS.max
	) {
		fieldErrors.participants = 'invalid';
	}

	return {
		input: { name, tastingDate: date.tastingDate, bottlesPerParticipant, participantUserIds },
		fieldErrors
	};
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
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

		let id: string;
		try {
			({ id } = createTasting(db, input));
		} catch (err: unknown) {
			if (err instanceof TastingValidationError) {
				return fail(422, { action: 'create', values, userMessage: err.userMessage });
			}
			logger.error({ err }, 'create tasting failed');
			return fail(500, { action: 'create', values, userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		redirect(303, `/admin/tastings/${id}`);
	}
};
