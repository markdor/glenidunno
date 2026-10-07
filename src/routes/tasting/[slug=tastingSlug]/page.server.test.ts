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

// Uploads land in a throwaway directory, never in the repo's ./media.
const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TASTING_PRESENTATION_MAX_BYTES } from '$lib/validation';
import { db } from '$lib/server/db';
import { tasting, tastingBottle, tastingWriteThrottle, user } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { TASTING_WRITE_LIMIT } from '$lib/server/tastingWriteThrottle';
import {
	createTasting,
	deleteTasting,
	findParticipant,
	openOrderEarly,
	revealEarly,
	type ParticipantView
} from '$lib/server/tastings';
import { actions, load } from './+page.server';

// Tasting on Saturday 24.10.2026: entry until 16:00 UTC (18:00 CEST),
// reveal from Sunday 08:00 UTC (9:00 CET).
const ENTRY = new Date('2026-10-20T10:00:00Z');
const LAST_ENTRY_SECOND = new Date('2026-10-24T15:59:59Z');
const ORDER = new Date('2026-10-24T16:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

// User ids: Anna and Ben take part, the admin manages the tasting but doesn't
// taste along, Olga has nothing to do with it.
const ANNA = 'u-anna';
const BEN = 'u-ben';
const ADMIN = 'u-admin';
const OUTSIDER = 'u-olga';

type LoadEvent = Parameters<typeof load>[0];
type ActionEvent = Parameters<typeof actions.save>[0];

let tastingId: string;
let slug: string;
let annaId: string;

function locals(userId: string | null) {
	return {
		user: userId ? { id: userId, isAdmin: userId === ADMIN } : null,
		session: null
	};
}

function loadFor(userId: string | null, tastingSlug = slug) {
	return load({
		params: { slug: tastingSlug },
		locals: locals(userId)
	} as unknown as LoadEvent) as { view: ParticipantView };
}

function save(userId: string, fields: Record<string, string | File>, tastingSlug = slug) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const request = new Request(`http://localhost/tasting/${tastingSlug}?/save`, {
		method: 'POST',
		body: fd
	});
	return actions.save({
		request,
		params: { slug: tastingSlug },
		locals: locals(userId)
	} as unknown as ActionEvent);
}

beforeAll(() => {
	for (const [id, username] of [
		[ANNA, 'Anna'],
		[BEN, 'Ben'],
		[ADMIN, 'Markus'],
		[OUTSIDER, 'Olga']
	]) {
		db.insert(user)
			.values({
				id,
				name: username,
				email: `${username.toLowerCase()}@example.com`,
				username,
				isAdmin: id === ADMIN,
				createdAt: ENTRY,
				updatedAt: ENTRY
			})
			.run();
	}
});

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

let mediaDir: string;

beforeEach(async () => {
	mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
	mockEnv.MEDIA_PATH = mediaDir;
	vi.setSystemTime(ENTRY);
	db.delete(tasting).run();
	const created = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 2,
		participantUserIds: [ANNA, BEN]
	});
	tastingId = created.id;
	slug = created.slug;
	annaId = findParticipant(db, slug, ANNA)!.id;
});

afterEach(async () => {
	vi.useRealTimers();
	vi.clearAllMocks();
	await rm(mediaDir, { recursive: true, force: true });
});

describe('participant page load', () => {
	it('shows the logged-in participant their own bottles during entry', async () => {
		await save(ANNA, validBottle);
		await save(BEN, { ...validBottle, alias: 'Blume', distillery: 'Glenkinchie' });

		const result = loadFor(ANNA);
		expect(result.view).toMatchObject({ phase: 'entry', participant: { username: 'Anna' } });
		const serialized = JSON.stringify(result);
		expect(serialized).toContain('Nebel');
		expect(serialized).not.toContain('Blume');
		expect(serialized).not.toContain('Glenkinchie');
	});

	it('shows only the numbered aliases with their total score from 18:00', async () => {
		await save(ANNA, validBottle);
		await save(BEN, { ...validBottle, alias: 'Blume', distillery: 'Glenkinchie', smoke: '0' });

		vi.setSystemTime(ORDER);
		const result = loadFor(ANNA);
		expect(result.view).toEqual({
			phase: 'order',
			tasting: { name: 'Herbst-Tasting', tastingDate: '2026-10-24' },
			manual: { orderOpenedAt: null, revealedAt: null },
			order: [
				{ position: 1, alias: 'Blume', score: 38.6, presentation: null },
				{ position: 2, alias: 'Nebel', score: 78.6, presentation: null }
			]
		});
		const serialized = JSON.stringify(result);
		for (const hidden of [
			'Ardbeg',
			'Glenkinchie',
			'whiskybase',
			'Anna',
			'Ben',
			'breakdown',
			'smoke'
		]) {
			expect(serialized).not.toContain(hidden);
		}
	});

	it('follows the admin’s 18-Uhr button at once and tells when it was pressed', async () => {
		await save(ANNA, validBottle);
		const pressed = new Date('2026-10-21T15:32:00Z');
		vi.setSystemTime(pressed);
		openOrderEarly(db, tastingId);

		expect(loadFor(BEN).view).toMatchObject({
			phase: 'order',
			manual: { orderOpenedAt: pressed, revealedAt: null },
			order: [{ position: 1, alias: 'Nebel' }]
		});
		// Saving is locked on the server as well; the page is told to reload.
		expect(await save(ANNA, { ...validBottle, distillery: 'Other' })).toMatchObject({
			status: 422,
			data: { reload: true }
		});
	});

	it('follows the admin’s 9-Uhr button at once', async () => {
		await save(ANNA, validBottle);
		const orderPressed = new Date('2026-10-21T15:32:00Z');
		vi.setSystemTime(orderPressed);
		openOrderEarly(db, tastingId);
		const pressed = new Date('2026-10-21T15:40:00Z');
		vi.setSystemTime(pressed);
		revealEarly(db, tastingId);

		expect(loadFor(BEN).view).toMatchObject({
			phase: 'revealed',
			manual: { orderOpenedAt: orderPressed, revealedAt: pressed },
			bottles: [{ alias: 'Nebel', distillery: 'Ardbeg', broughtBy: 'Anna' }]
		});
	});

	it('reveals everything but the score breakdown from 9:00 on the next day', async () => {
		await save(ANNA, validBottle);

		vi.setSystemTime(REVEALED);
		const { view } = loadFor(BEN);
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

	it('answers an unknown slug, a non-participant, the admin and a deleted tasting with the same 404', () => {
		const expected = expect.objectContaining({ status: 404, body: { message: 'Not found' } });
		expect(() => loadFor(ANNA, 'fluffy-nothing')).toThrowError(expected);
		expect(() => loadFor(OUTSIDER)).toThrowError(expected);
		// The admin manages the tasting, but only participants see it.
		expect(() => loadFor(ADMIN)).toThrowError(expected);

		deleteTasting(db, tastingId);
		expect(() => loadFor(ANNA)).toThrowError(expected);
	});

	it('requires a login (behind the global guard as a second line)', () => {
		expect(() => loadFor(null)).toThrowError(expect.objectContaining({ status: 401 }));
	});
});

describe('participant page save', () => {
	it('saves into the participant’s own slot and updates it later', async () => {
		expect(await save(ANNA, validBottle)).toEqual({ action: 'save', slot: 1, saved: true });
		await save(ANNA, { ...validBottle, distillery: 'Laphroaig' });

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

	it('takes the participant only from slug and login, never from the form', async () => {
		const benId = findParticipant(db, slug, BEN)!.id;
		await save(ANNA, {
			...validBottle,
			participantId: benId,
			participant_id: benId,
			userId: BEN,
			user_id: BEN
		});
		expect(db.select().from(tastingBottle).get()?.participantId).toBe(annaId);
	});

	it.each([
		{ label: 'a user who doesn’t take part', userId: OUTSIDER, tastingSlug: undefined },
		{ label: 'the admin without participation', userId: ADMIN, tastingSlug: undefined },
		{ label: 'an unknown slug', userId: ANNA, tastingSlug: 'fluffy-nothing' }
	])('answers $label with 404 and writes nothing', async ({ userId, tastingSlug }) => {
		await expect(save(userId, validBottle, tastingSlug)).rejects.toMatchObject({ status: 404 });
		expect(db.select().from(tastingBottle).all()).toEqual([]);
	});

	it('refuses to save from 18:00 on the tasting day and asks the client to reload', async () => {
		vi.setSystemTime(LAST_ENTRY_SECOND);
		expect(await save(ANNA, validBottle)).toMatchObject({ saved: true });

		vi.setSystemTime(ORDER);
		expect(await save(ANNA, { ...validBottle, distillery: 'Other' })).toMatchObject({
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
		expect(await save(ANNA, { ...validBottle, slot: '3' })).toMatchObject({
			status: 422,
			data: { userMessage: 'Diese Flasche gibt es in diesem Tasting nicht.' }
		});
	});

	it('rejects an alias that someone else already uses, ignoring case', async () => {
		await save(BEN, { ...validBottle, alias: 'Nebel' });
		expect(await save(ANNA, { ...validBottle, alias: 'NEBEL' })).toMatchObject({
			status: 409,
			data: { action: 'save', slot: 1, fieldErrors: { alias: 'taken' } }
		});
	});

	it('answers 429 once the participant’s write limit is used up', async () => {
		for (let i = 0; i < TASTING_WRITE_LIMIT.max; i++) {
			expect(await save(ANNA, validBottle)).toMatchObject({ saved: true });
		}
		expect(await save(ANNA, validBottle)).toMatchObject({
			status: 429,
			data: { action: 'save', userMessage: expect.stringContaining('Zu viele') }
		});
		// Other participants keep their own quota.
		expect(await save(BEN, { ...validBottle, alias: 'Blume' })).toMatchObject({ saved: true });
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
		expect(await save(ANNA, { ...validBottle, [field]: value })).toMatchObject({
			status: 400,
			data: { action: 'save', slot: 1, fieldErrors: { [field]: code } }
		});
		expect(db.select().from(tastingBottle).all()).toEqual([]);
	});

	it('accepts the limits and a dot as decimal separator with a trailing zero', async () => {
		const result = await save(ANNA, {
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
		const result = await save(ANNA, { ...validBottle, abv: 'stark' });
		expect(result).toMatchObject({ data: { values: { alias: 'Nebel', abv: 'stark' } } });
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const err = new Error('disk full');
		const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
			throw err;
		});

		expect(await save(ANNA, validBottle)).toMatchObject({
			status: 500,
			data: { action: 'save', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'tasting save failed');
		spy.mockRestore();
	});
});

describe('participant page save with a presentation', () => {
	const deckBytes = new Uint8Array([0xd0, 0xcf, 0x11, 0xe0, 1, 2, 3]);
	const deck = (name = 'Ardbeg.pptx', bytes: Uint8Array<ArrayBuffer> = deckBytes) =>
		new File([bytes], name);
	const storedFiles = () => readdir(mediaDir);
	const bottleRow = () => db.select().from(tastingBottle).get()!;
	const content = async (file: string) => new Uint8Array(await readFile(join(mediaDir, file)));
	// validBottle uses the alias "Nebel", the tasting is on 24.10.2026.
	const DECK_FILE = 'Tasting_2026-10-24_Nebel.pptx';

	it('stores the upload byte for byte as Tasting_<date>_<alias>', async () => {
		expect(await save(ANNA, { ...validBottle, presentation: deck() })).toMatchObject({
			saved: true
		});

		expect(bottleRow()).toMatchObject({
			presentationFile: DECK_FILE,
			presentationName: 'Ardbeg.pptx'
		});
		expect(await storedFiles()).toEqual([DECK_FILE]);
		expect(await content(DECK_FILE)).toEqual(deckBytes);
		// The owner sees the name of the uploaded file during entry.
		expect(loadFor(ANNA).view).toMatchObject({
			bottles: [{ presentationName: 'Ardbeg.pptx' }]
		});
	});

	it('keeps the presentation when saving without a new file', async () => {
		await save(ANNA, { ...validBottle, presentation: deck() });
		const file = bottleRow().presentationFile;

		// An untouched file input arrives as an empty, nameless file.
		await save(ANNA, {
			...validBottle,
			distillery: 'Other',
			presentation: deck('', new Uint8Array())
		});

		expect(bottleRow()).toMatchObject({ distillery: 'Other', presentationFile: file });
		expect(await storedFiles()).toEqual([file]);
	});

	it('replaces the presentation and deletes the old file', async () => {
		await save(ANNA, { ...validBottle, presentation: deck() });
		await save(ANNA, { ...validBottle, presentation: deck('Neu.pdf') });

		expect(bottleRow()).toMatchObject({
			presentationFile: 'Tasting_2026-10-24_Nebel.pdf',
			presentationName: 'Neu.pdf'
		});
		expect(await storedFiles()).toEqual(['Tasting_2026-10-24_Nebel.pdf']);
	});

	it('overwrites the file on a re-upload under the same alias', async () => {
		await save(ANNA, { ...validBottle, presentation: deck() });
		const second = new Uint8Array([7, 7, 7]);
		await save(ANNA, { ...validBottle, presentation: deck('v2.pptx', second) });

		expect(await storedFiles()).toEqual([DECK_FILE]);
		expect(await content(DECK_FILE)).toEqual(second);
	});

	it('renames the file when the alias changes', async () => {
		await save(ANNA, { ...validBottle, presentation: deck() });
		await save(ANNA, { ...validBottle, alias: 'Blaue Stunde' });

		const renamed = 'Tasting_2026-10-24_Blaue_Stunde.pptx';
		expect(bottleRow().presentationFile).toBe(renamed);
		expect(await storedFiles()).toEqual([renamed]);
		expect(await content(renamed)).toEqual(deckBytes);
	});

	it('keeps the previous file intact when a re-upload is refused', async () => {
		await save(ANNA, { ...validBottle, presentation: deck() });
		await save(BEN, { ...validBottle, alias: 'Blume' });

		// Refused (alias taken) – the staged upload is discarded, the old file stays.
		expect(
			await save(ANNA, {
				...validBottle,
				alias: 'Blume',
				presentation: deck('v2.pptx', new Uint8Array([9]))
			})
		).toMatchObject({ status: 409 });

		expect(await storedFiles()).toEqual([DECK_FILE]);
		expect(await content(DECK_FILE)).toEqual(deckBytes);
	});

	it('removes the presentation on request', async () => {
		await save(ANNA, { ...validBottle, presentation: deck() });
		await save(ANNA, { ...validBottle, removePresentation: 'on' });

		expect(bottleRow()).toMatchObject({ presentationFile: null, presentationName: null });
		expect(await storedFiles()).toEqual([]);
	});

	it('rejects a file above 30 MB without storing anything', async () => {
		const tooLarge = deck('big.pptx', new Uint8Array(TASTING_PRESENTATION_MAX_BYTES + 1));
		expect(await save(ANNA, { ...validBottle, presentation: tooLarge })).toMatchObject({
			status: 400,
			data: { fieldErrors: { presentation: 'invalid' } }
		});
		expect(db.select().from(tastingBottle).all()).toEqual([]);
		expect(existsSync(mediaDir) ? await storedFiles() : []).toEqual([]);
	});

	it('discards the uploaded file when the alias is taken', async () => {
		await save(BEN, { ...validBottle, alias: 'Nebel' });
		expect(
			await save(ANNA, { ...validBottle, alias: 'nebel', presentation: deck() })
		).toMatchObject({ status: 409 });
		expect(await storedFiles()).toEqual([]);
	});

	it('discards the uploaded file when the entry is closed', async () => {
		vi.setSystemTime(ORDER);
		expect(await save(ANNA, { ...validBottle, presentation: deck() })).toMatchObject({
			status: 422
		});
		expect(await storedFiles()).toEqual([]);
	});

	it('does not even read the body once the write limit is used up', async () => {
		for (let i = 0; i < TASTING_WRITE_LIMIT.max; i++) await save(ANNA, validBottle);
		expect(await save(ANNA, { ...validBottle, presentation: deck() })).toMatchObject({
			status: 429
		});
		expect(await storedFiles()).toEqual([]);
	});

	it('reveals a link to the presentation with the other bottle data', async () => {
		await save(ANNA, { ...validBottle, presentation: deck() });

		vi.setSystemTime(ORDER);
		expect(JSON.stringify(loadFor(BEN))).not.toContain('Ardbeg.pptx');

		vi.setSystemTime(REVEALED);
		expect(loadFor(BEN).view).toMatchObject({
			bottles: [{ presentation: { bottleId: bottleRow().id, name: 'Ardbeg.pptx' } }]
		});
	});
});
