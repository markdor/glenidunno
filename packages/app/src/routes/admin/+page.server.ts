import { fail, type Actions, type ServerLoad } from '@sveltejs/kit';
import { asc, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { isValidEmail, USERNAME_RE } from '@dahamm/shared';
import { db } from '$lib/server/db';
import { user } from '$lib/server/db/schema';
import { requireAdmin } from '$lib/server/authGuards';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/server/errorMessages';
import { logger } from '$lib/server/logger';

export const load: ServerLoad = ({ locals }) => {
	requireAdmin(locals);
	const users = db
		.select({
			id: user.id,
			email: user.email,
			username: user.username,
			isAdmin: user.isAdmin,
			createdAt: user.createdAt
		})
		.from(user)
		.orderBy(asc(user.createdAt))
		.all();
	return { users };
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

		try {
			// session.userId has ON DELETE CASCADE, so all of the user's active
			// sessions die with the row → forced logout on their next request.
			const result = db.delete(user).where(eq(user.id, id)).run();
			if (result.changes === 0) {
				return fail(404, {
					action: 'delete',
					userMessage:
						'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
				});
			}
		} catch (err) {
			logger.error({ err }, 'admin delete user failed');
			return fail(500, { action: 'delete', userMessage: UNEXPECTED_ERROR_MESSAGE });
		}

		return { action: 'delete', deleted: true };
	}
};
