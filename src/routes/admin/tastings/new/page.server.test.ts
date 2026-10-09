import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
	const Database = (await import('better-sqlite3')).default;
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { runMigrations } = await import('$lib/server/db/migrate');
	const schema = await import('$lib/server/db/schema');
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	const db = drizzle(sqlite, { schema });
	return { db, schema };
});

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { eq } from 'drizzle-orm';
import { TASTING_SLUG_RE } from '$lib/validation';
import { db } from '$lib/server/db';
import { tasting, tastingParticipant, user } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { actions, load } from './+page.server';

const ADMIN = { id: 'admin-id', username: 'admin', isAdmin: true };
// 22:30 UTC on the 20th is already the 21st in Berlin.
const NOW = new Date('2026-10-20T22:30:00Z');

type ActionEvent = Parameters<typeof actions.create>[0];

function create(fields: Record<string, string | string[]>, currentUser: unknown = ADMIN) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) {
		for (const item of Array.isArray(v) ? v : [v]) fd.append(k, item);
	}
	const request = new Request('http://localhost/admin/tastings/new?/create', {
		method: 'POST',
		body: fd
	});
	return actions.create({
		request,
		locals: { user: currentUser, session: null }
	} as unknown as ActionEvent);
}

const valid = {
	name: 'Herbst-Tasting',
	tastingDate: '2026-10-24',
	bottlesPerParticipant: '2',
	participant: ['u-anna', 'u-ben', 'u-cem']
};

beforeAll(() => {
	for (const [id, username, deactivatedAt] of [
		['admin-id', 'admin', null],
		['u-anna', 'Anna', null],
		['u-ben', 'ben', null],
		['u-cem', 'Cem', null],
		['u-gone', 'Gone', NOW]
	] as const) {
		db.insert(user)
			.values({
				id,
				name: username,
				email: `${username.toLowerCase()}@example.com`,
				username,
				isAdmin: id === 'admin-id',
				deactivatedAt,
				createdAt: NOW,
				updatedAt: NOW
			})
			.run();
	}
});

beforeEach(() => {
	vi.setSystemTime(NOW);
	db.delete(tasting).run();
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('new tasting load', () => {
	function loadAs(currentUser: unknown) {
		return load({
			locals: { user: currentUser, session: null }
		} as unknown as Parameters<typeof load>[0]);
	}

	it('throws 401 without a session and 403 for a non-admin', () => {
		expect(() => loadAs(null)).toThrowError(expect.objectContaining({ status: 401 }));
		expect(() => loadAs({ id: 'u', isAdmin: false })).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	it('returns today’s Berlin date and the active users to pick from', () => {
		expect(loadAs(ADMIN)).toEqual({
			today: '2026-10-21',
			users: [
				{ id: 'admin-id', username: 'admin' },
				{ id: 'u-anna', username: 'Anna' },
				{ id: 'u-ben', username: 'ben' },
				{ id: 'u-cem', username: 'Cem' }
			]
		});
	});
});

describe('create tasting', () => {
	it('creates the tasting with the picked users and goes to its page', async () => {
		const redirect = await Promise.resolve(create(valid)).catch((e: unknown) => e);

		const created = db.select().from(tasting).get()!;
		expect(created).toMatchObject({
			name: 'Herbst-Tasting',
			tastingDate: '2026-10-24',
			bottlesPerParticipant: 2
		});
		expect(created.slug).toMatch(TASTING_SLUG_RE);
		expect(redirect).toMatchObject({ status: 303, location: `/admin/tastings/${created.id}` });
		expect(
			db
				.select({ userId: tastingParticipant.userId })
				.from(tastingParticipant)
				.where(eq(tastingParticipant.tastingId, created.id))
				.all()
				.map((p) => p.userId)
		).toEqual(['u-anna', 'u-ben', 'u-cem']);
	});

	it('adds a user sent twice only once', async () => {
		await expect(
			create({ ...valid, participant: ['u-anna', 'u-ben', 'u-anna'] })
		).rejects.toMatchObject({ status: 303 });
		expect(db.select().from(tastingParticipant).all()).toHaveLength(2);
	});

	it('accepts today as the tasting date', async () => {
		await expect(create({ ...valid, tastingDate: '2026-10-21' })).rejects.toMatchObject({
			status: 303
		});
	});

	it.each([
		{ field: 'name', value: '', code: 'required' },
		{ field: 'name', value: 'x'.repeat(61), code: 'invalid' },
		{ field: 'tastingDate', value: '', code: 'required' },
		{ field: 'tastingDate', value: '2026-02-30', code: 'invalid' },
		// Yesterday in Berlin.
		{ field: 'tastingDate', value: '2026-10-20', code: 'invalid' },
		{ field: 'bottlesPerParticipant', value: '0', code: 'invalid' },
		{ field: 'bottlesPerParticipant', value: '7', code: 'invalid' },
		{ field: 'bottlesPerParticipant', value: 'zwei', code: 'invalid' },
		{ field: 'participant', value: [], code: 'required', errorField: 'participants' },
		{ field: 'participant', value: ['u-anna'], code: 'invalid', errorField: 'participants' },
		// The same user twice is still only one participant.
		{
			field: 'participant',
			value: ['u-anna', 'u-anna'],
			code: 'invalid',
			errorField: 'participants'
		},
		{
			field: 'participant',
			value: Array.from({ length: 13 }, (_, i) => `u-${i}`),
			code: 'invalid',
			errorField: 'participants'
		}
	])('rejects $field = $value as $code', async ({ field, value, code, errorField }) => {
		const result = await create({ ...valid, [field]: value });
		expect(result).toMatchObject({
			status: 400,
			data: { action: 'create', fieldErrors: { [errorField ?? field]: code } }
		});
		expect(db.select().from(tasting).all()).toEqual([]);
	});

	it.each([
		{ label: 'a deactivated user', userId: 'u-gone' },
		{ label: 'an unknown user', userId: 'u-nobody' }
	])('refuses $label with the domain message and creates nothing', async ({ userId }) => {
		expect(await create({ ...valid, participant: ['u-anna', userId] })).toMatchObject({
			status: 422,
			data: {
				action: 'create',
				userMessage:
					'Mindestens eine ausgewählte Person ist nicht mehr aktiv. Lade die Seite neu und wähle erneut.',
				values: { participants: ['u-anna', userId] }
			}
		});
		expect(db.select().from(tasting).all()).toEqual([]);
	});

	it('echoes the raw values on a validation error', async () => {
		const result = await create({ ...valid, name: '', participant: ['u-anna', 'u-ben'] });
		expect(result).toMatchObject({
			data: { values: { name: '', tastingDate: '2026-10-24', participants: ['u-anna', 'u-ben'] } }
		});
	});

	it('rejects a non-admin before touching the form', async () => {
		await expect(create(valid, { id: 'u', isAdmin: false })).rejects.toMatchObject({
			status: 403
		});
		await expect(create(valid, null)).rejects.toMatchObject({ status: 401 });
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const err = new Error('disk full');
		const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
			throw err;
		});

		expect(await create(valid)).toMatchObject({
			status: 500,
			data: { action: 'create', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'create tasting failed');
		spy.mockRestore();
	});
});
