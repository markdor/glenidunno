import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import {
	checkDistilleryFacts,
	DISTILLERY_PROMPT_LENGTH,
	isValidEmail,
	TASTING_DISTILLERY_LENGTH,
	USERNAME_RE,
	type DistilleryFacts
} from '$lib/validation';
import { db } from '$lib/server/db';
import { session, tastingParticipant, user } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/authGuards';
import {
	getAdminDistilleries,
	getResearchRules,
	getTotalResearchCost,
	renameDistillery,
	resetResearchRules,
	saveResearchRules,
	updateDistilleryFacts,
	type RenameResult
} from '$lib/server/distilleries';
import { isDistilleryResearchRunning } from '$lib/server/distilleryResearchJob';
import {
	getVariantSuggestions,
	isVariantSearchRunning,
	rejectVariantSuggestion,
	searchDistilleryVariants,
	type VariantSearchResult
} from '$lib/server/distilleryVariantSearch';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import { logger } from '$lib/server/logger';
import { STARTUP_JOBS } from '$lib/server/startupJobList';
import { getStartupJobOverview, isStartupJobRunning, runStartupJob } from '$lib/server/startupJobs';
import { getTastingSummary } from '$lib/server/tastings';
import { STARTUP_JOBS_DEPENDENCY } from '$lib/startupJobs';

export const load: ServerLoad = ({ locals, depends }) => {
	requireAdmin(locals);
	depends(STARTUP_JOBS_DEPENDENCY);
	// Decides what "Löschen" does: users with a participation are deactivated
	// instead (see the delete action).
	const participants = new Set(
		db
			.selectDistinct({ userId: tastingParticipant.userId })
			.from(tastingParticipant)
			.all()
			.map((p) => p.userId)
	);
	const users = db
		.select({
			id: user.id,
			email: user.email,
			username: user.username,
			isAdmin: user.isAdmin,
			createdAt: user.createdAt,
			deactivatedAt: user.deactivatedAt
		})
		.from(user)
		.orderBy(asc(user.createdAt))
		.all()
		.map(({ deactivatedAt, ...u }) => ({
			...u,
			deactivated: deactivatedAt !== null,
			hasParticipation: participants.has(u.id)
		}));
	return {
		// Management data only, the admin tastes blind like everybody else.
		tastingSummary: getTastingSummary(db),
		users,
		startupJobs: getStartupJobOverview(db, STARTUP_JOBS),
		// Only distilleries of revealed tastings; the total includes all calls.
		distilleries: getAdminDistilleries(db),
		researchCostMicroUsd: getTotalResearchCost(db),
		researchPrompt: getResearchRules(db),
		variantSuggestions: getVariantSuggestions(db),
		// Polled like a running job: a search started before a reload keeps the button off.
		variantSearchRunning: isVariantSearchRunning()
	};
};

type Fields = { email: string; username: string };

function validate(
	rawEmail: string,
	rawUsername: string
): Fields & { fieldErrors: Record<string, string> } {
	const email = rawEmail.trim().toLowerCase();
	const username = rawUsername.trim();
	const fieldErrors: Record<string, string> = {};

	if (!email) fieldErrors.email = 'required';
	else if (!isValidEmail(email)) fieldErrors.email = 'invalid';

	if (!username) fieldErrors.username = 'required';
	else if (!USERNAME_RE.test(username)) fieldErrors.username = 'invalid';

	return { email, username, fieldErrors };
}

type DistilleryField = keyof DistilleryFacts;

// The admin's edit of a distillery row: empty means no value. The capacity
// may carry thousands separators ("2.400.000").
function parseDistilleryFacts(form: FormData): {
	facts: DistilleryFacts;
	fieldErrors: Partial<Record<DistilleryField, string>>;
} {
	const country = String(form.get('country') ?? '').trim();
	const region = String(form.get('region') ?? '').trim();
	const capacity = String(form.get('capacity') ?? '').replace(/[\s.]/g, '');
	const facts: DistilleryFacts = {
		country: country || null,
		region: region || null,
		capacity: capacity === '' ? null : /^\d+$/.test(capacity) ? Number(capacity) : NaN
	};
	return { facts, fieldErrors: checkDistilleryFacts(facts) };
}

const DISTILLERY_NOT_FOUND =
	'Diese Destillerie wurde nicht gefunden – sie kommt in keinem aufgelösten Tasting mehr vor.';

// Name and brand of a rename; the brand only with its checkbox. Empty means
// missing, the length is the bottle's (TASTING_DISTILLERY_LENGTH).
function parseRename(form: FormData): {
	name: string;
	prefix: string | null;
	fieldErrors: Partial<Record<'name' | 'prefix', string>>;
} {
	const name = String(form.get('name') ?? '').trim();
	const prefix = form.get('withPrefix') === 'on' ? String(form.get('prefix') ?? '').trim() : null;
	const fieldErrors: Partial<Record<'name' | 'prefix', string>> = {};
	if (!name) fieldErrors.name = 'required';
	else if (name.length > TASTING_DISTILLERY_LENGTH.max) fieldErrors.name = 'tooLong';
	if (prefix === '') fieldErrors.prefix = 'required';
	return { name, prefix, fieldErrors };
}

type DeleteOutcome = 'deleted' | 'deactivated' | 'not-found';

function uniqueColumn(message: string): 'email' | 'username' {
	return message.includes('username') ? 'username' : 'email';
}

export const actions: Actions = {
	create: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const rawEmail = String(form.get('email') ?? '');
		const rawUsername = String(form.get('username') ?? '');
		const isAdmin = form.get('isAdmin') === 'on';

		const { email, username, fieldErrors } = validate(rawEmail, rawUsername);
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, {
				action: 'create',
				email: rawEmail,
				username: rawUsername,
				fieldErrors
			});
		}

		try {
			const now = new Date();
			db.insert(user)
				.values({
					id: randomUUID(),
					name: username,
					email,
					emailVerified: true,
					username,
					isAdmin,
					createdAt: now,
					updatedAt: now
				})
				.run();
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('UNIQUE')) {
				return fail(409, {
					action: 'create',
					email: rawEmail,
					username: rawUsername,
					fieldErrors: { [uniqueColumn(message)]: 'taken' }
				});
			}
			logger.error({ err }, 'admin create user failed');
			return fail(500, { action: 'create', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		return { action: 'create', created: true };
	},

	update: async ({ request, locals }) => {
		const current = requireAdmin(locals);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		const rawEmail = String(form.get('email') ?? '');
		const rawUsername = String(form.get('username') ?? '');
		const isAdmin = form.get('isAdmin') === 'on';

		if (!id)
			return fail(400, {
				action: 'update',
				userMessage: 'Eintrag konnte nicht verarbeitet werden.'
			});

		const { email, username, fieldErrors } = validate(rawEmail, rawUsername);
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, {
				action: 'update',
				id,
				email: rawEmail,
				username: rawUsername,
				fieldErrors
			});
		}

		// Self-protection: an admin must not be able to demote themselves.
		const targetIsCurrent = id === current.id;
		const finalIsAdmin = targetIsCurrent ? true : isAdmin;

		try {
			const result = db
				.update(user)
				.set({
					email,
					username,
					name: username,
					isAdmin: finalIsAdmin,
					updatedAt: new Date()
				})
				.where(eq(user.id, id))
				.run();
			if (result.changes === 0) {
				return fail(404, {
					action: 'update',
					userMessage:
						'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
				});
			}
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if (message.includes('UNIQUE')) {
				return fail(409, {
					action: 'update',
					id,
					email: rawEmail,
					username: rawUsername,
					fieldErrors: { [uniqueColumn(message)]: 'taken' }
				});
			}
			logger.error({ err }, 'admin update user failed');
			return fail(500, { action: 'update', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		return { action: 'update', updated: true, selfDemoteBlocked: targetIsCurrent && !isAdmin };
	},

	delete: async ({ request, locals }) => {
		const current = requireAdmin(locals);
		const form = await request.formData();
		const id = String(form.get('id') ?? '');
		if (!id)
			return fail(400, {
				action: 'delete',
				userMessage: 'Eintrag konnte nicht verarbeitet werden.'
			});

		// Self-protection: an admin must not delete their own entry.
		if (id === current.id) {
			return fail(400, {
				action: 'delete',
				userMessage: 'Du kannst deinen eigenen Eintrag nicht löschen.'
			});
		}

		let outcome: DeleteOutcome;
		try {
			outcome = db.transaction((tx): DeleteOutcome => {
				const target = tx
					.select({ deactivatedAt: user.deactivatedAt })
					.from(user)
					.where(eq(user.id, id))
					.get();
				if (!target) return 'not-found';

				const participated = tx
					.select({ id: tastingParticipant.id })
					.from(tastingParticipant)
					.where(eq(tastingParticipant.userId, id))
					.limit(1)
					.get();
				if (!participated) {
					// session.userId has ON DELETE CASCADE, so all of the user's active
					// sessions die with the row → forced logout on their next request.
					tx.delete(user).where(eq(user.id, id)).run();
					return 'deleted';
				}

				// The participations must stay (ON DELETE restrict): their bottles
				// are part of the order and the reveal. Deactivated instead – the
				// sessions go now, the magic-link whitelist and the session hook
				// (sessionGuard.ts) keep the user from getting a new one. Email and
				// username stay taken. A second click keeps the first timestamp.
				const now = new Date();
				tx.update(user)
					.set({ deactivatedAt: target.deactivatedAt ?? now, updatedAt: now })
					.where(eq(user.id, id))
					.run();
				tx.delete(session).where(eq(session.userId, id)).run();
				return 'deactivated';
			});
		} catch (err) {
			logger.error({ err }, 'admin delete user failed');
			return fail(500, { action: 'delete', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		if (outcome === 'not-found') {
			return fail(404, {
				action: 'delete',
				userMessage:
					'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
			});
		}
		return outcome === 'deleted'
			? { action: 'delete', deleted: true }
			: { action: 'delete', deactivated: true };
	},

	// Runs a startup job again (see startupJobs.ts) – not awaited: the page
	// follows it live, the job may take minutes. An empty `limit` means all,
	// anything else has to be one of the job's batch sizes.
	restartJob: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const job = STARTUP_JOBS.find((j) => j.id === String(form.get('id') ?? ''));
		if (!job) {
			return fail(404, { action: 'restartJob', userMessage: 'Diesen Job gibt es nicht.' });
		}
		const rawLimit = String(form.get('limit') ?? '');
		const limit = rawLimit === '' ? undefined : Number(rawLimit);
		if (limit !== undefined && !job.batchSizes?.includes(limit)) {
			return fail(400, { action: 'restartJob', userMessage: 'Diese Anzahl gibt es nicht.' });
		}
		if (isStartupJobRunning(job.id)) {
			return fail(409, { action: 'restartJob', userMessage: 'Dieser Job läuft bereits.' });
		}
		void runStartupJob(db, job, 'manual', limit);
		return { action: 'restartJob', restarted: true };
	},

	// Values of one distillery: a set value counts as the admin's, a cleared
	// one as "not found" (see updateDistilleryFacts).
	updateDistillery: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const key = String(form.get('key') ?? '');
		const { facts, fieldErrors } = parseDistilleryFacts(form);
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, { action: 'updateDistillery', key, fieldErrors });
		}
		try {
			if (!updateDistilleryFacts(db, key, facts)) {
				return fail(404, { action: 'updateDistillery', userMessage: DISTILLERY_NOT_FOUND });
			}
		} catch (err) {
			logger.error({ err }, 'admin update distillery failed');
			return fail(500, { action: 'updateDistillery', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		return { action: 'updateDistillery', updated: true };
	},

	// Renames a distillery of the revealed tastings or merges it into another
	// one, with the values of the same form (see renameDistillery). Not during
	// a research run: its targets would point to a name that's gone.
	renameDistillery: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const key = String(form.get('key') ?? '');
		const { facts, fieldErrors: factErrors } = parseDistilleryFacts(form);
		const { name, prefix, fieldErrors: nameErrors } = parseRename(form);
		const fieldErrors = { ...factErrors, ...nameErrors };
		if (Object.keys(fieldErrors).length > 0) {
			return fail(400, { action: 'renameDistillery', key, fieldErrors });
		}
		if (isDistilleryResearchRunning()) {
			return fail(409, {
				action: 'renameDistillery',
				userMessage:
					'Gerade läuft die Destillerie-Recherche. Speichere bitte erneut, sobald sie fertig ist.'
			});
		}
		let result: RenameResult;
		try {
			result = renameDistillery(db, key, { name, prefix, facts });
		} catch (err) {
			logger.error({ err }, 'admin rename distillery failed');
			return fail(500, { action: 'renameDistillery', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		if (result.status === 'not-found') {
			return fail(404, { action: 'renameDistillery', userMessage: DISTILLERY_NOT_FOUND });
		}
		if (result.status === 'bottling-too-long') {
			return fail(400, {
				action: 'renameDistillery',
				key,
				fieldErrors: { prefix: 'bottlingTooLong' }
			});
		}
		return { action: 'renameDistillery', renamed: result.status, bottles: result.bottles };
	},

	// One call to Claude over all distilleries of the revealed tastings. Waits
	// for it; the page keeps the button off meanwhile.
	suggestVariants: async ({ locals }) => {
		requireAdmin(locals);
		let result: VariantSearchResult;
		try {
			result = await searchDistilleryVariants(db);
		} catch (err) {
			logger.error({ err }, 'admin variant search failed');
			return fail(500, { action: 'suggestVariants', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		switch (result.status) {
			case 'searched':
				return { action: 'suggestVariants', added: result.added };
			case 'running':
				return fail(409, {
					action: 'suggestVariants',
					userMessage: 'Die Suche nach Varianten läuft bereits.'
				});
			case 'no-key':
				return fail(503, {
					action: 'suggestVariants',
					userMessage: 'ANTHROPIC_API_KEY ist nicht gesetzt.'
				});
			case 'failed':
				return fail(502, {
					action: 'suggestVariants',
					userMessage: 'Die Suche nach Varianten ist fehlgeschlagen, Details im Server-Log.'
				});
		}
	},

	// A rejected pair is never suggested again.
	rejectVariant: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const id = Number(form.get('id'));
		try {
			if (!Number.isSafeInteger(id) || !rejectVariantSuggestion(db, id)) {
				return fail(404, {
					action: 'rejectVariant',
					userMessage: 'Diesen Vorschlag gibt es nicht mehr.'
				});
			}
		} catch (err) {
			logger.error({ err }, 'admin reject variant failed');
			return fail(500, { action: 'rejectVariant', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		return { action: 'rejectVariant', rejected: true };
	},

	// Only the rules of the research prompt; the default text removes the deviation.
	saveResearchPrompt: async ({ request, locals }) => {
		requireAdmin(locals);
		const form = await request.formData();
		const text = String(form.get('prompt') ?? '')
			.replaceAll('\r\n', '\n')
			.trim();
		if (!text) {
			return fail(400, { action: 'saveResearchPrompt', fieldErrors: { prompt: 'required' } });
		}
		if (text.length > DISTILLERY_PROMPT_LENGTH.max) {
			return fail(400, { action: 'saveResearchPrompt', fieldErrors: { prompt: 'tooLong' } });
		}
		try {
			saveResearchRules(db, text);
		} catch (err) {
			logger.error({ err }, 'admin save research prompt failed');
			return fail(500, { action: 'saveResearchPrompt', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		return { action: 'saveResearchPrompt', saved: true };
	},

	resetResearchPrompt: async ({ locals }) => {
		requireAdmin(locals);
		try {
			resetResearchRules(db);
		} catch (err) {
			logger.error({ err }, 'admin reset research prompt failed');
			return fail(500, { action: 'resetResearchPrompt', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}
		return { action: 'resetResearchPrompt', reset: true };
	}
};
