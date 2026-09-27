import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { EMAIL_LENGTH } from '@dahamm/shared';

vi.mock('$lib/server/db', async () => {
	const Database = (await import('better-sqlite3')).default;
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
	const schema = await import('$lib/server/db/schema');
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
	return { db, schema };
});

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { db } from '$lib/server/db';
import { user, session } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { actions, load } from './+page.server';

const ADMIN = { id: 'admin-id', username: 'admin', isAdmin: true };

function makeEvent(form: Record<string, string>, currentUser: unknown = ADMIN): RequestEvent {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) fd.append(k, v);
	const request = new Request('http://localhost/admin', { method: 'POST', body: fd });
	return { request, locals: { user: currentUser, session: null } } as unknown as RequestEvent;
}

function loadEvent(currentUser: unknown) {
	return { locals: { user: currentUser, session: null } } as unknown as Parameters<typeof load>[0];
}

function insertUser(opts: {
	id?: string;
	email: string;
	username: string;
	isAdmin?: boolean;
	telegramUserId?: string | null;
}) {
	const id = opts.id ?? randomUUID();
	db.insert(user)
		.values({
			id,
			name: opts.username,
			email: opts.email,
			emailVerified: true,
			username: opts.username,
			isAdmin: opts.isAdmin ?? false,
			telegramUserId: opts.telegramUserId ?? null,
			createdAt: new Date(),
			updatedAt: new Date()
		})
		.run();
	return id;
}

beforeEach(() => {
	db.delete(session).run();
	db.delete(user).run();
	// The current admin always exists (bootstrap guarantees this in prod).
	insertUser({ id: ADMIN.id, email: 'admin@dahamm.de', username: 'admin', isAdmin: true });
});

describe('admin load', () => {
	it('throws 401 without a session', () => {
		expect(() => load(loadEvent(null))).toThrowError(expect.objectContaining({ status: 401 }));
	});

	it('throws 403 for a non-admin', () => {
		expect(() => load(loadEvent({ id: 'x', username: 'u', isAdmin: false }))).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	it('returns the users for an admin', () => {
		const result = load(loadEvent(ADMIN)) as { users: unknown[] };
		expect(result.users.length).toBe(1);
	});
});

describe('admin create', () => {
	it('creates a whitelisted user', async () => {
		const result = await actions.create(makeEvent({ email: 'new@dahamm.de', username: 'newbie' }));
		expect(result).toEqual({ action: 'create', created: true });
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.email === 'new@dahamm.de');
		expect(row).toMatchObject({ username: 'newbie', isAdmin: false, telegramUserId: null });
	});

	it('stores telegram id and admin flag when provided', async () => {
		await actions.create(
			makeEvent({
				email: 'tg@dahamm.de',
				username: 'tguser',
				telegramUserId: '12345',
				isAdmin: 'on'
			})
		);
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.email === 'tg@dahamm.de');
		expect(row).toMatchObject({ telegramUserId: '12345', isAdmin: true });
	});

	it('rejects an invalid email', async () => {
		const result = await actions.create(makeEvent({ email: 'nope', username: 'x' }));
		expect(result).toMatchObject({ status: 400, data: { fieldErrors: { email: 'invalid' } } });
	});

	it('accepts an email at exactly the maximum length', async () => {
		const email = `${'a'.repeat(EMAIL_LENGTH.max - '@dahamm.de'.length)}@dahamm.de`;
		expect(email.length).toBe(EMAIL_LENGTH.max);
		const result = await actions.create(makeEvent({ email, username: 'longmail' }));
		expect(result).toEqual({ action: 'create', created: true });
	});

	it('rejects an email longer than the shared maximum', async () => {
		const email = `${'a'.repeat(EMAIL_LENGTH.max - '@dahamm.de'.length + 1)}@dahamm.de`;
		expect(email.length).toBe(EMAIL_LENGTH.max + 1);
		const result = await actions.create(makeEvent({ email, username: 'toolongmail' }));
		expect(result).toMatchObject({ status: 400, data: { fieldErrors: { email: 'invalid' } } });
	});

	it('rejects an invalid username pattern', async () => {
		const result = await actions.create(makeEvent({ email: 'shortname@dahamm.de', username: 'a' }));
		expect(result).toMatchObject({ status: 400, data: { fieldErrors: { username: 'invalid' } } });
	});

	it('requires email and username', async () => {
		const result = await actions.create(makeEvent({ email: '', username: '' }));
		expect(result).toMatchObject({
			status: 400,
			data: { fieldErrors: { email: 'required', username: 'required' } }
		});
	});

	it('rejects a non-numeric telegram id', async () => {
		const result = await actions.create(
			makeEvent({ email: 'a@dahamm.de', username: 'aa', telegramUserId: 'abc' })
		);
		expect(result).toMatchObject({
			status: 400,
			data: { fieldErrors: { telegramUserId: 'invalid' } }
		});
	});

	it('returns 409 on a duplicate email', async () => {
		insertUser({ email: 'dupe@dahamm.de', username: 'dupe' });
		const result = await actions.create(makeEvent({ email: 'dupe@dahamm.de', username: 'other' }));
		expect(result).toMatchObject({ status: 409, data: { fieldErrors: { email: 'taken' } } });
	});

	it('returns 409 on a duplicate username', async () => {
		insertUser({ email: 'dupe-user@dahamm.de', username: 'dupeuser' });
		const result = await actions.create(
			makeEvent({ email: 'other@dahamm.de', username: 'dupeuser' })
		);
		expect(result).toMatchObject({ status: 409, data: { fieldErrors: { username: 'taken' } } });
	});

	it('returns 409 on a duplicate telegram id', async () => {
		insertUser({ email: 'tg1@dahamm.de', username: 'tg1', telegramUserId: '555' });
		const result = await actions.create(
			makeEvent({ email: 'tg2@dahamm.de', username: 'tg2', telegramUserId: '555' })
		);
		expect(result).toMatchObject({
			status: 409,
			data: { fieldErrors: { telegramUserId: 'taken' } }
		});
	});

	it('logs and returns 500 on an unexpected (non-UNIQUE) database error', async () => {
		const err = new Error('disk full');
		const insertSpy = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
			throw err;
		});

		const result = await actions.create(makeEvent({ email: 'x@dahamm.de', username: 'xx' }));
		expect(result).toMatchObject({
			status: 500,
			data: { action: 'create', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'admin create user failed');

		insertSpy.mockRestore();
	});
});

describe('admin update', () => {
	it('updates a user', async () => {
		const id = insertUser({ email: 'u@dahamm.de', username: 'u' });
		const result = await actions.update(
			makeEvent({ id, email: 'u2@dahamm.de', username: 'u2', telegramUserId: '999' })
		);
		expect(result).toMatchObject({ action: 'update', updated: true });
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.id === id);
		expect(row).toMatchObject({ email: 'u2@dahamm.de', username: 'u2', telegramUserId: '999' });
	});

	it('blocks an admin from demoting themselves', async () => {
		// isAdmin omitted => checkbox off, but self-demotion must be ignored.
		const result = await actions.update(
			makeEvent({ id: ADMIN.id, email: 'admin@dahamm.de', username: 'admin' })
		);
		expect(result).toMatchObject({ updated: true, selfDemoteBlocked: true });
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.id === ADMIN.id);
		expect(row?.isAdmin).toBe(true);
	});

	it('returns 404 for an unknown id', async () => {
		const result = await actions.update(
			makeEvent({ id: 'ghost', email: 'g@dahamm.de', username: 'ghost' })
		);
		expect(result).toMatchObject({
			status: 404,
			data: {
				userMessage:
					'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
			}
		});
	});

	it('returns 400 without an id', async () => {
		const result = await actions.update(makeEvent({ email: 'g@dahamm.de', username: 'g' }));
		expect(result).toMatchObject({
			status: 400,
			data: { userMessage: 'Eintrag konnte nicht verarbeitet werden.' }
		});
	});

	it('returns 409 when the new email collides', async () => {
		const id = insertUser({ email: 'one@dahamm.de', username: 'one' });
		insertUser({ email: 'two@dahamm.de', username: 'two' });
		const result = await actions.update(makeEvent({ id, email: 'two@dahamm.de', username: 'one' }));
		expect(result).toMatchObject({ status: 409, data: { fieldErrors: { email: 'taken' } } });
	});

	it('rejects an invalid email with a validation error', async () => {
		const id = insertUser({ email: 'v@dahamm.de', username: 'v' });
		const result = await actions.update(makeEvent({ id, email: 'nope', username: 'v' }));
		expect(result).toMatchObject({
			status: 400,
			data: { action: 'update', fieldErrors: { email: 'invalid' } }
		});
	});

	it('logs and returns 500 on an unexpected (non-UNIQUE) database error', async () => {
		const id = insertUser({ email: 'e@dahamm.de', username: 'e' });
		const err = new Error('disk full');
		const updateSpy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
			throw err;
		});

		const result = await actions.update(makeEvent({ id, email: 'e2@dahamm.de', username: 'e2' }));
		expect(result).toMatchObject({
			status: 500,
			data: { action: 'update', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'admin update user failed');

		updateSpy.mockRestore();
	});
});

describe('admin delete', () => {
	it('deletes a user and cascades their sessions', async () => {
		const id = insertUser({ email: 'gone@dahamm.de', username: 'gone' });
		db.insert(session)
			.values({
				id: 'sess-1',
				expiresAt: new Date(Date.now() + 1000),
				token: 'tok-1',
				createdAt: new Date(),
				updatedAt: new Date(),
				userId: id
			})
			.run();

		const result = await actions.delete(makeEvent({ id }));
		expect(result).toEqual({ action: 'delete', deleted: true });
		expect(
			db
				.select()
				.from(user)
				.all()
				.find((u) => u.id === id)
		).toBeUndefined();
		// Forced logout: the session is gone too.
		expect(db.select().from(session).all().length).toBe(0);
	});

	it('refuses to delete the current admin (self)', async () => {
		const result = await actions.delete(makeEvent({ id: ADMIN.id }));
		expect(result).toMatchObject({
			status: 400,
			data: { userMessage: 'Du kannst deinen eigenen Eintrag nicht löschen.' }
		});
		expect(
			db
				.select()
				.from(user)
				.all()
				.find((u) => u.id === ADMIN.id)
		).toBeDefined();
	});

	it('returns 404 for an unknown id', async () => {
		const result = await actions.delete(makeEvent({ id: 'ghost' }));
		expect(result).toMatchObject({
			status: 404,
			data: {
				userMessage:
					'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
			}
		});
	});

	it('returns 400 without an id', async () => {
		const result = await actions.delete(makeEvent({}));
		expect(result).toMatchObject({
			status: 400,
			data: { userMessage: 'Eintrag konnte nicht verarbeitet werden.' }
		});
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const id = insertUser({ email: 'boom@dahamm.de', username: 'boom' });
		const err = new Error('disk full');
		const deleteSpy = vi.spyOn(db, 'delete').mockImplementationOnce(() => {
			throw err;
		});

		const result = await actions.delete(makeEvent({ id }));
		expect(result).toMatchObject({
			status: 500,
			data: { action: 'delete', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'admin delete user failed');

		deleteSpy.mockRestore();
	});
});

describe('admin guards on actions', () => {
	it('rejects create from a non-admin', async () => {
		await expect(
			actions.create(
				makeEvent({ email: 'x@dahamm.de', username: 'x' }, { id: 'u', isAdmin: false })
			)
		).rejects.toMatchObject({ status: 403 });
	});
});
