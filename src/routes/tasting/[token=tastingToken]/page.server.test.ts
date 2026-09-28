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

import { db } from '$lib/server/db';
import { tasting, tastingBottle, tastingWriteThrottle } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { TASTING_WRITE_LIMIT } from '$lib/server/tastingWriteThrottle';
import {
	createTasting,
	deleteTasting,
	regenerateParticipantToken,
	type ParticipantView
} from '$lib/server/tastings';
import { actions, load } from './+page.server';

// Tasting on Saturday 24.10.2026: entry until 16:00 UTC (18:00 CEST),
// reveal from Sunday 08:00 UTC (9:00 CET).
const ENTRY = new Date('2026-10-20T10:00:00Z');
const LAST_ENTRY_SECOND = new Date('2026-10-24T15:59:59Z');
const ORDER = new Date('2026-10-24T16:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

type LoadEvent = Parameters<typeof load>[0];
type ActionEvent = Parameters<typeof actions.save>[0];

let tastingId: string;
let annaToken: string;
let benToken: string;
let annaId: string;

function loadFor(token: string) {
	// locals.user is set on purpose: the public route must not care about it.
	return load({
		params: { token },
		locals: { user: { id: 'admin', isAdmin: true }, session: null }
	} as unknown as LoadEvent) as { view: ParticipantView };
}

function save(token: string, fields: Record<string, string>) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const request = new Request(`http://localhost/tasting/${token}?/save`, {
		method: 'POST',
		body: fd
	});
	return actions.save({
		request,
		params: { token },
		locals: { user: null, session: null }
	} as unknown as ActionEvent);
}

const validBottle = {
	slot: '1',
	alias: 'Nebel',
	distillery: 'Ardbeg',
	bottler: '',
	bottling: 'Uigeadail',
	age: '',
	whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1',
	smoke: '5',
	cask: '3',
	abv: '54,2',
	value: '4'
};

beforeEach(() => {
	vi.setSystemTime(ENTRY);
	db.delete(tasting).run();
	const created = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 2,
		participantNames: ['Anna', 'Ben']
	});
	tastingId = created.id;
	[annaToken, benToken] = created.tokens.map((t) => t.token);
	annaId = created.tokens[0].participantId;
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('tasting link load', () => {
	it('shows the holder their own bottles during entry, ignoring the session', async () => {
		await save(annaToken, validBottle);
		await save(benToken, { ...validBottle, alias: 'Blume', distillery: 'Glenkinchie' });

		const result = loadFor(annaToken);
		expect(result.view).toMatchObject({ phase: 'entry', participant: { name: 'Anna' } });
		const serialized = JSON.stringify(result);
		expect(serialized).toContain('Nebel');
		expect(serialized).not.toContain('Blume');
		expect(serialized).not.toContain('Glenkinchie');
	});

	it('shows only the numbered aliases from 18:00', async () => {
		await save(annaToken, validBottle);
		await save(benToken, { ...validBottle, alias: 'Blume', distillery: 'Glenkinchie', smoke: '0' });

		vi.setSystemTime(ORDER);
		const result = loadFor(annaToken);
		expect(result.view).toEqual({
			phase: 'order',
			tasting: { name: 'Herbst-Tasting', tastingDate: '2026-10-24' },
			order: [
				{ position: 1, alias: 'Blume' },
				{ position: 2, alias: 'Nebel' }
			]
		});
		const serialized = JSON.stringify(result);
		for (const hidden of ['Ardbeg', 'Glenkinchie', 'whiskybase', 'Anna', 'Ben', 'score']) {
			expect(serialized).not.toContain(hidden);
		}
	});

	it('reveals everything but the score breakdown from 9:00 on the next day', async () => {
		await save(annaToken, validBottle);

		vi.setSystemTime(REVEALED);
		const { view } = loadFor(benToken);
		expect(view.phase).toBe('revealed');
		expect(JSON.stringify(view)).not.toContain('breakdown');
		expect(view).toMatchObject({
			bottles: [
				{
					position: 1,
					alias: 'Nebel',
					distillery: 'Ardbeg',
					bottler: null,
					age: null,
					abv: 54.2,
					broughtBy: 'Anna',
					whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1'
				}
			]
		});
	});

	it('answers unknown, replaced and deleted tokens with the same 404', () => {
		const expected = expect.objectContaining({ status: 404, body: { message: 'Not found' } });
		expect(() => loadFor('x'.repeat(32))).toThrowError(expected);

		regenerateParticipantToken(db, tastingId, annaId);
		expect(() => loadFor(annaToken)).toThrowError(expected);

		deleteTasting(db, tastingId);
		expect(() => loadFor(benToken)).toThrowError(expected);
	});
});

describe('tasting link save', () => {
	it('saves into the holder’s own slot and updates it later', async () => {
		expect(await save(annaToken, validBottle)).toEqual({ action: 'save', slot: 1, saved: true });
		await save(annaToken, { ...validBottle, distillery: 'Laphroaig' });

		const rows = db.select().from(tastingBottle).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			participantId: annaId,
			distillery: 'Laphroaig',
			bottler: null,
			age: null,
			abv: 54.2
		});
	});

	it('takes the participant only from the token, never from the form', async () => {
		await save(annaToken, { ...validBottle, participantId: 'someone-else', participant_id: 'x' });
		expect(db.select().from(tastingBottle).get()?.participantId).toBe(annaId);
	});

	it('answers an unknown token with 404 and writes nothing', async () => {
		await expect(save('x'.repeat(32), validBottle)).rejects.toMatchObject({ status: 404 });
		expect(db.select().from(tastingBottle).all()).toEqual([]);
	});

	it('refuses to save from 18:00 on the tasting day and asks the client to reload', async () => {
		vi.setSystemTime(LAST_ENTRY_SECOND);
		expect(await save(annaToken, validBottle)).toMatchObject({ saved: true });

		vi.setSystemTime(ORDER);
		expect(await save(annaToken, { ...validBottle, distillery: 'Other' })).toMatchObject({
			status: 422,
			data: {
				action: 'save',
				reload: true,
				userMessage: 'Die Eingabe ist geschlossen, deine Änderung wurde nicht gespeichert.'
			}
		});
		expect(db.select().from(tastingBottle).get()?.distillery).toBe('Ardbeg');
	});

	it('rejects a slot beyond bottlesPerParticipant', async () => {
		expect(await save(annaToken, { ...validBottle, slot: '3' })).toMatchObject({
			status: 422,
			data: { userMessage: 'Diese Flasche gibt es in diesem Tasting nicht.' }
		});
	});

	it('rejects an alias that someone else already uses, ignoring case', async () => {
		await save(benToken, { ...validBottle, alias: 'Nebel' });
		expect(await save(annaToken, { ...validBottle, alias: 'NEBEL' })).toMatchObject({
			status: 409,
			data: { action: 'save', slot: 1, fieldErrors: { alias: 'taken' } }
		});
	});

	it('answers 429 once the write limit of the link is used up', async () => {
		for (let i = 0; i < TASTING_WRITE_LIMIT.max; i++) {
			expect(await save(annaToken, validBottle)).toMatchObject({ saved: true });
		}
		expect(await save(annaToken, validBottle)).toMatchObject({
			status: 429,
			data: { action: 'save', userMessage: expect.stringContaining('Zu viele') }
		});
		// Other links keep their own quota.
		expect(await save(benToken, { ...validBottle, alias: 'Blume' })).toMatchObject({ saved: true });
		expect(db.select().from(tastingWriteThrottle).all()).toHaveLength(2);
	});

	it.each([
		{ field: 'alias', value: '', code: 'required' },
		{ field: 'alias', value: 'x'.repeat(31), code: 'invalid' },
		{ field: 'distillery', value: '  ', code: 'required' },
		{ field: 'bottler', value: 'x'.repeat(61), code: 'invalid' },
		{ field: 'bottling', value: 'x'.repeat(81), code: 'invalid' },
		{ field: 'age', value: '0', code: 'invalid' },
		{ field: 'age', value: '81', code: 'invalid' },
		{ field: 'age', value: '12.5', code: 'invalid' },
		{ field: 'smoke', value: '6', code: 'invalid' },
		{ field: 'smoke', value: '', code: 'required' },
		{ field: 'cask', value: '-1', code: 'invalid' },
		{ field: 'value', value: 'viel', code: 'invalid' },
		{ field: 'abv', value: '', code: 'required' },
		{ field: 'abv', value: '34.9', code: 'invalid' },
		{ field: 'abv', value: '75.1', code: 'invalid' },
		{ field: 'abv', value: '46.35', code: 'invalid' },
		{ field: 'whiskybaseUrl', value: 'http://www.whiskybase.com/w/1', code: 'invalid' },
		{ field: 'whiskybaseUrl', value: 'https://evil.example/w/1', code: 'invalid' },
		{ field: 'whiskybaseUrl', value: 'javascript:alert(1)', code: 'invalid' }
	])('rejects $field = "$value" as $code', async ({ field, value, code }) => {
		expect(await save(annaToken, { ...validBottle, [field]: value })).toMatchObject({
			status: 400,
			data: { action: 'save', slot: 1, fieldErrors: { [field]: code } }
		});
		expect(db.select().from(tastingBottle).all()).toEqual([]);
	});

	it('accepts the limits and a dot as decimal separator with a trailing zero', async () => {
		const result = await save(annaToken, {
			...validBottle,
			alias: 'x'.repeat(30),
			age: '80',
			abv: '46.30',
			smoke: '0',
			whiskybaseUrl: ''
		});
		expect(result).toMatchObject({ saved: true });
		expect(db.select().from(tastingBottle).get()).toMatchObject({
			age: 80,
			abv: 46.3,
			smoke: 0,
			whiskybaseUrl: null
		});
	});

	it('echoes the raw values on a validation error', async () => {
		const result = await save(annaToken, { ...validBottle, abv: 'stark' });
		expect(result).toMatchObject({ data: { values: { alias: 'Nebel', abv: 'stark' } } });
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const err = new Error('disk full');
		const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
			throw err;
		});

		expect(await save(annaToken, validBottle)).toMatchObject({
			status: 500,
			data: { action: 'save', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'tasting save failed');
		spy.mockRestore();
	});
});
