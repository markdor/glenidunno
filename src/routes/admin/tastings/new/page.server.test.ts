import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { db } from '$lib/server/db';
import { tasting, tastingParticipant } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { hashTastingToken } from '$lib/server/tastingToken';
import { findParticipantByToken } from '$lib/server/tastings';
import { actions, load } from './+page.server';

const ADMIN = { id: 'admin-id', username: 'admin', isAdmin: true };
// 22:30 UTC on the 20th is already the 21st in Berlin.
const NOW = new Date('2026-10-20T22:30:00Z');

type ActionEvent = Parameters<typeof actions.create>[0];

function create(fields: Record<string, string | string[]>, user: unknown = ADMIN) {
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
		url: new URL('http://localhost:5173/admin/tastings/new'),
		locals: { user, session: null }
	} as unknown as ActionEvent);
}

const valid = {
	name: 'Herbst-Tasting',
	tastingDate: '2026-10-24',
	bottlesPerParticipant: '2',
	participant: ['Anna', 'Ben', 'Cem']
};

beforeEach(() => {
	vi.setSystemTime(NOW);
	db.delete(tasting).run();
	for (const k of Object.keys(mockEnv)) delete mockEnv[k];
	mockEnv.BASE_URL = 'https://glenidunno.test';
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('new tasting load', () => {
	function loadAs(user: unknown) {
		return load({ locals: { user, session: null } } as unknown as Parameters<typeof load>[0]);
	}

	it('throws 401 without a session and 403 for a non-admin', () => {
		expect(() => loadAs(null)).toThrowError(expect.objectContaining({ status: 401 }));
		expect(() => loadAs({ id: 'u', isAdmin: false })).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	it('returns today’s Berlin date for the date picker', () => {
		expect(loadAs(ADMIN)).toEqual({ today: '2026-10-21' });
	});
});

describe('create tasting', () => {
	it('creates the tasting and returns each link exactly once, based on BASE_URL', async () => {
		const result = (await create(valid)) as {
			created: { tastingId: string; links: Array<{ name: string; url: string }> };
		};

		expect(result).toMatchObject({ action: 'create', created: { tastingId: expect.any(String) } });
		const { links } = result.created;
		expect(links.map((l) => l.name)).toEqual(['Anna', 'Ben', 'Cem']);
		for (const link of links) {
			expect(link.url).toMatch(/^https:\/\/glenidunno\.test\/tasting\/[A-Za-z0-9_-]{32}$/);
		}

		// Only the hashes land in the DB, and each link opens its participant.
		const token = links[0].url.split('/').pop()!;
		expect(findParticipantByToken(db, token)?.name).toBe('Anna');
		const stored = db.select().from(tastingParticipant).all();
		expect(stored.map((p) => p.tokenHash)).toContain(hashTastingToken(token));
		expect(JSON.stringify(stored)).not.toContain(token);
		expect(db.select().from(tasting).get()).toMatchObject({
			name: 'Herbst-Tasting',
			tastingDate: '2026-10-24',
			bottlesPerParticipant: 2
		});
	});

	it('falls back to the request origin without BASE_URL', async () => {
		delete mockEnv.BASE_URL;
		const result = (await create(valid)) as { created: { links: Array<{ url: string }> } };
		expect(result.created.links[0].url).toMatch(/^http:\/\/localhost:5173\/tasting\//);
	});

	it('ignores empty participant fields', async () => {
		await create({ ...valid, participant: ['Anna', '  ', 'Ben', ''] });
		expect(
			db
				.select()
				.from(tastingParticipant)
				.all()
				.map((p) => p.name)
		).toEqual(['Anna', 'Ben']);
	});

	it('accepts today as the tasting date', async () => {
		expect(await create({ ...valid, tastingDate: '2026-10-21' })).toMatchObject({
			action: 'create'
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
		{ field: 'participant', value: ['', ''], code: 'required', errorField: 'participants' },
		{ field: 'participant', value: ['Anna'], code: 'invalid', errorField: 'participants' },
		{
			field: 'participant',
			value: Array.from({ length: 13 }, (_, i) => `P${i}`),
			code: 'invalid',
			errorField: 'participants'
		},
		{
			field: 'participant',
			value: ['Anna', 'x'.repeat(41)],
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

	it('echoes the raw values on a validation error', async () => {
		const result = await create({ ...valid, name: '', participant: ['Anna', ' Ben '] });
		expect(result).toMatchObject({
			data: { values: { name: '', tastingDate: '2026-10-24', participants: ['Anna', ' Ben '] } }
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
