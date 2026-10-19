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

// MEDIA_PATH points at a throwaway directory per test (see beforeEach).
const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));

// The research after "Jetzt auflösen" runs in the background and calls the API.
const research = vi.hoisted(() => ({ inBackground: vi.fn() }));
vi.mock('$lib/server/distilleryResearchJob', () => ({
	researchDistilleriesInBackground: research.inBackground
}));

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	tasting,
	tastingBottle,
	tastingParticipant,
	tastingWriteThrottle,
	user
} from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applyFileChanges, stageUpload } from '$lib/server/tastingMedia';
import { consumeTastingWriteLimit } from '$lib/server/tastingWriteThrottle';
import { createTasting, findParticipant, saveBottle, type Participant } from '$lib/server/tastings';
import type { TastingBottle } from '$lib/tasting';
import { actions, load } from './+page.server';

/** Every missing page and missing admin right gets exactly this response. */
const NOT_FOUND_REDIRECT = { status: 303, location: '/?notice=not-found' };

const ADMIN = { id: 'admin-id', username: 'admin', isAdmin: true };
const USER = { id: 'user-id', username: 'user', isAdmin: false };

// Tasting on Saturday 24.10.2026: entry until 16:00 UTC (18:00 CEST),
// reveal from Sunday 08:00 UTC (9:00 CET).
const ENTRY = new Date('2026-10-20T10:00:00Z');
const ORDER = new Date('2026-10-24T16:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

type LoadEvent = Parameters<typeof load>[0];
type ActionName = 'updateDate' | 'updateMotto' | 'openOrder' | 'reveal' | 'delete';

let tastingId: string;
let slug: string;
let anna: Participant;

function loadAs(user: unknown, id = tastingId) {
	return load({ params: { id }, locals: { user, session: null } } as unknown as LoadEvent) as {
		detail: Record<string, unknown> & { phase: string };
		today: string;
	};
}

function act(name: ActionName, fields: Record<string, string> = {}, user: unknown = ADMIN) {
	const fd = new FormData();
	for (const [k, v] of Object.entries(fields)) fd.append(k, v);
	const request = new Request(`http://localhost/admin/tastings/${tastingId}?/${name}`, {
		method: 'POST',
		body: fd
	});
	return actions[name]({
		request,
		params: { id: tastingId },
		url: new URL(`http://localhost/admin/tastings/${tastingId}`),
		locals: { user, session: null }
	} as unknown as Parameters<(typeof actions)[ActionName]>[0]);
}

const bottle: TastingBottle = {
	alias: 'Nebel',
	distillery: 'Ardbeg',
	bottler: null,
	bottling: 'Uigeadail',
	age: null,
	whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1',
	smoke: 5,
	cask: 3,
	abv: 54.2,
	value: 4
};

beforeAll(() => {
	for (const [id, username] of [
		['u-anna', 'Anna'],
		['u-ben', 'Ben']
	]) {
		db.insert(user)
			.values({
				id,
				name: username,
				email: `${username.toLowerCase()}@example.com`,
				username,
				createdAt: ENTRY,
				updatedAt: ENTRY
			})
			.run();
	}
});

beforeEach(() => {
	vi.setSystemTime(ENTRY);
	db.delete(tasting).run();
	db.update(user).set({ deactivatedAt: null }).run();
	const created = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		participantUserIds: ['u-anna', 'u-ben']
	});
	tastingId = created.id;
	slug = created.slug;
	anna = findParticipant(db, slug, 'u-anna')!;
	saveBottle(db, anna, 1, bottle);
	saveBottle(db, anna, 2, { ...bottle, alias: 'Blume', distillery: 'Glenkinchie', smoke: 0 });
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

describe('admin tasting detail – access', () => {
	it('throws 401 without a session and redirects a non-admin to the dashboard', () => {
		expect(() => loadAs(null)).toThrowError(expect.objectContaining({ status: 401 }));
		expect(() => loadAs(USER)).toThrowError(expect.objectContaining(NOT_FOUND_REDIRECT));
	});

	it('redirects an unknown tasting the same way as a non-admin', () => {
		expect(() => loadAs(ADMIN, 'nope')).toThrowError(expect.objectContaining(NOT_FOUND_REDIRECT));
	});

	it.each(['updateDate', 'updateMotto', 'openOrder', 'reveal', 'delete'] as const)(
		'rejects %s for anonymous users and non-admins',
		async (name) => {
			await expect(act(name, {}, null)).rejects.toMatchObject({ status: 401 });
			// location matters: a successful delete is a 303 as well.
			await expect(act(name, {}, USER)).rejects.toMatchObject(NOT_FOUND_REDIRECT);
			expect(db.select().from(tasting).all()).toHaveLength(1);
		}
	);
});

describe('admin tasting detail – projection per phase', () => {
	function serialized(result: unknown) {
		return JSON.stringify(result);
	}

	it('shows only participants and progress during entry', () => {
		const result = loadAs(ADMIN);
		expect(result.detail).toMatchObject({
			phase: 'entry',
			participants: [
				{ name: 'Anna', progress: { entered: 2, total: 2 } },
				{ name: 'Ben', progress: { entered: 0, total: 2 } }
			]
		});
		for (const hidden of ['Nebel', 'Blume', 'Ardbeg', 'Glenkinchie', 'whiskybase', 'score']) {
			expect(serialized(result)).not.toContain(hidden);
		}
		// No link either: participants reach the tasting themselves.
		expect(serialized(result)).not.toContain(slug);
		expect(serialized(result)).not.toContain('/tasting/');
	});

	it('returns the management data of the tasting, the motto included', () => {
		db.update(tasting)
			.set({ motto: 'Islay gegen den Rest', mottoDescription: 'Eine Flasche von Islay.' })
			.run();
		expect(loadAs(ADMIN).detail.tasting).toEqual({
			id: tastingId,
			name: 'Herbst-Tasting',
			motto: 'Islay gegen den Rest',
			mottoDescription: 'Eine Flasche von Islay.',
			tastingDate: '2026-10-24'
		});
	});

	it('marks deactivated participants', () => {
		db.update(user).set({ deactivatedAt: ENTRY }).where(eq(user.id, 'u-ben')).run();
		expect(loadAs(ADMIN).detail).toMatchObject({
			participants: [{ name: 'Anna' }, { name: 'Ben (inaktiv)' }]
		});
	});

	// The admin sees the content as a participant of the tasting, never here.
	it.each([
		{ phase: 'order', now: ORDER },
		{ phase: 'revealed', now: REVEALED }
	])('still shows no bottle content in phase $phase', ({ phase, now }) => {
		vi.setSystemTime(now);
		const result = loadAs(ADMIN);
		expect(result.detail.phase).toBe(phase);
		expect(Object.keys(result.detail).sort()).toEqual([
			'manual',
			'participants',
			'phase',
			'tasting'
		]);
		for (const hidden of ['Nebel', 'Blume', 'Ardbeg', 'Glenkinchie', 'whiskybase', 'score']) {
			expect(serialized(result)).not.toContain(hidden);
		}
		expect(serialized(result)).not.toContain(slug);
	});
});

// Saves Anna's bottle in `slot` with a presentation, like the save action does.
async function uploadPresentation(slot: number, content: TastingBottle) {
	const result = saveBottle(
		db,
		anna,
		slot,
		content,
		new Date(),
		await stageUpload(new File([new Uint8Array([1, 2, 3])], 'deck.pptx'))
	);
	if (result.status === 'saved') await applyFileChanges(result.fileChanges);
}

// A converted PDF of the presentation in the viewer's cache; returns the folder.
async function cachePdf(mediaDir: string, file: string) {
	const cache = join(mediaDir, 'pdf-cache');
	await mkdir(cache, { recursive: true });
	await writeFile(join(cache, `${file}.pdf`), '%PDF');
	return cache;
}

describe('updateDate', () => {
	it('moves the tasting during entry', async () => {
		expect(await act('updateDate', { tastingDate: '2026-11-07' })).toEqual({
			action: 'updateDate',
			updated: true
		});
		expect(db.select().from(tasting).get()?.tastingDate).toBe('2026-11-07');
	});

	it('renames the presentation files to the new date', async () => {
		const mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
		mockEnv.MEDIA_PATH = mediaDir;
		try {
			await uploadPresentation(1, bottle);
			expect(await readdir(mediaDir)).toEqual(['Tasting_2026-10-24_Nebel.pptx']);

			await act('updateDate', { tastingDate: '2026-11-07' });

			expect(await readdir(mediaDir)).toEqual(['Tasting_2026-11-07_Nebel.pptx']);
		} finally {
			await rm(mediaDir, { recursive: true, force: true });
		}
	});

	it('drops the converted PDFs of the renamed files', async () => {
		const mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
		mockEnv.MEDIA_PATH = mediaDir;
		try {
			await uploadPresentation(1, bottle);
			const cache = await cachePdf(mediaDir, 'Tasting_2026-10-24_Nebel.pptx');

			await act('updateDate', { tastingDate: '2026-11-07' });

			expect(await readdir(cache)).toEqual([]);
		} finally {
			await rm(mediaDir, { recursive: true, force: true });
		}
	});

	it.each([
		{ value: '', code: 'required' },
		{ value: '2026-02-30', code: 'invalid' },
		{ value: '2026-10-19', code: 'invalid' }
	])('rejects "$value" as $code', async ({ value, code }) => {
		expect(await act('updateDate', { tastingDate: value })).toMatchObject({
			status: 400,
			data: { action: 'updateDate', tastingDate: value, fieldErrors: { tastingDate: code } }
		});
	});

	it('refuses once the entry phase is over', async () => {
		vi.setSystemTime(ORDER);
		expect(await act('updateDate', { tastingDate: '2026-11-07' })).toMatchObject({
			status: 422,
			data: { userMessage: 'Das Datum lässt sich nur ändern, solange die Eingabe offen ist.' }
		});
		expect(db.select().from(tasting).get()?.tastingDate).toBe('2026-10-24');
	});

	it('answers 404 once the tasting is gone', async () => {
		db.delete(tasting).run();
		expect(await act('updateDate', { tastingDate: '2026-11-07' })).toMatchObject({
			status: 404,
			data: { userMessage: expect.stringContaining('nicht gefunden') }
		});
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const err = new Error('disk full');
		const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
			throw err;
		});
		expect(await act('updateDate', { tastingDate: '2026-11-07' })).toMatchObject({
			status: 500,
			data: { userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'update tasting date failed');
		spy.mockRestore();
	});
});

describe('updateMotto', () => {
	const NO_MOTTO = { motto: null, mottoDescription: null };
	const storedMotto = () => {
		const t = db.select().from(tasting).get();
		return { motto: t?.motto, mottoDescription: t?.mottoDescription };
	};
	const sent = { motto: '  Inselhüpfen ', mottoDescription: 'Eine Insel pro Flasche.\r\nDanke! ' };
	const stored = { motto: 'Inselhüpfen', mottoDescription: 'Eine Insel pro Flasche.\nDanke!' };

	it.each([
		{ phase: 'entry', now: ENTRY },
		{ phase: 'order', now: ORDER },
		{ phase: 'revealed', now: REVEALED }
	])('sets heading and description, normalized, in phase $phase', async ({ phase, now }) => {
		vi.setSystemTime(now);
		expect(loadAs(ADMIN).detail.phase).toBe(phase);

		expect(await act('updateMotto', sent)).toEqual({ action: 'updateMotto', updated: true });
		expect(storedMotto()).toEqual(stored);
	});

	it('changes the motto of an archived tasting too', async () => {
		// Archived bottles only come with the history import.
		db.update(tastingBottle)
			.set({ archived: true, smoke: null, cask: null, value: null })
			.where(eq(tastingBottle.participantId, anna.id))
			.run();
		vi.setSystemTime(REVEALED);

		expect(await act('updateMotto', sent)).toEqual({ action: 'updateMotto', updated: true });
		expect(storedMotto()).toEqual(stored);
	});

	it.each<{ label: string; fields: Record<string, string> }>([
		{ label: 'sent blank', fields: { motto: '   ', mottoDescription: ' \r\n ' } },
		{ label: 'left out', fields: {} }
	])('clears heading and description when $label', async ({ fields }) => {
		await act('updateMotto', sent);
		expect(await act('updateMotto', fields)).toEqual({ action: 'updateMotto', updated: true });
		expect(storedMotto()).toEqual(NO_MOTTO);
	});

	it('clears only the description when the heading stays', async () => {
		await act('updateMotto', sent);
		expect(await act('updateMotto', { motto: 'Inselhüpfen' })).toEqual({
			action: 'updateMotto',
			updated: true
		});
		expect(storedMotto()).toEqual({ motto: 'Inselhüpfen', mottoDescription: null });
	});

	it.each([
		{
			label: 'a heading that is too long',
			fields: { motto: 'x'.repeat(121), mottoDescription: '' },
			fieldErrors: { motto: 'invalid' }
		},
		{
			label: 'a description that is too long',
			fields: { motto: 'Sherry', mottoDescription: 'y'.repeat(1001) },
			fieldErrors: { mottoDescription: 'invalid' }
		},
		{
			label: 'a description without a heading',
			fields: { motto: ' ', mottoDescription: 'Nur Inseln.' },
			fieldErrors: { motto: 'required' }
		}
	])('rejects $label, keeps the stored motto and echoes the input', async (c) => {
		await act('updateMotto', sent);
		expect(await act('updateMotto', c.fields)).toEqual({
			status: 400,
			data: { action: 'updateMotto', ...c.fields, fieldErrors: c.fieldErrors }
		});
		expect(storedMotto()).toEqual(stored);
	});

	it('answers 404 once the tasting is gone', async () => {
		db.delete(tasting).run();
		expect(await act('updateMotto', { motto: 'Sherry' })).toMatchObject({
			status: 404,
			data: { action: 'updateMotto', userMessage: expect.stringContaining('nicht gefunden') }
		});
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const err = new Error('disk full');
		const spy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
			throw err;
		});
		expect(await act('updateMotto', { motto: 'Sherry' })).toMatchObject({
			status: 500,
			data: { action: 'updateMotto', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'update tasting motto failed');
		spy.mockRestore();
	});
});

describe('openOrder and reveal (18-Uhr and 9-Uhr buttons)', () => {
	it('opens the order ahead of time and records when', async () => {
		expect(await act('openOrder')).toEqual({ action: 'openOrder', phaseChanged: true });

		const result = loadAs(ADMIN);
		expect(result.detail).toMatchObject({
			phase: 'order',
			manual: { orderOpenedAt: expect.any(Date), revealedAt: null }
		});
	});

	it('reveals ahead of time once the order is out', async () => {
		await act('openOrder');
		research.inBackground.mockClear();
		expect(await act('reveal')).toEqual({ action: 'reveal', phaseChanged: true });
		// Its distilleries are released now: researched in the background, not awaited.
		expect(research.inBackground).toHaveBeenCalledExactlyOnceWith(db);
		expect(loadAs(ADMIN).detail).toMatchObject({
			phase: 'revealed',
			manual: { orderOpenedAt: expect.any(Date), revealedAt: expect.any(Date) }
		});
	});

	it('refuses to reveal while the entry is still open', async () => {
		research.inBackground.mockClear();
		expect(await act('reveal')).toMatchObject({
			status: 422,
			data: { action: 'reveal', userMessage: 'Gib zuerst die Reihenfolge frei.' }
		});
		expect(loadAs(ADMIN).detail).toMatchObject({ phase: 'entry', manual: { revealedAt: null } });
		expect(research.inBackground).not.toHaveBeenCalled();
	});

	it('starts no research when opening the order', async () => {
		research.inBackground.mockClear();
		await act('openOrder');
		expect(research.inBackground).not.toHaveBeenCalled();
	});

	it('refuses a button whose phase is already reached', async () => {
		vi.setSystemTime(ORDER);
		expect(await act('openOrder')).toMatchObject({
			status: 422,
			data: { action: 'openOrder', userMessage: 'Die Reihenfolge ist bereits freigegeben.' }
		});
		vi.setSystemTime(REVEALED);
		expect(await act('reveal')).toMatchObject({
			status: 422,
			data: { action: 'reveal', userMessage: 'Das Tasting ist bereits aufgelöst.' }
		});
	});

	it('answers 404 once the tasting is gone', async () => {
		db.delete(tasting).run();
		expect(await act('openOrder')).toMatchObject({ status: 404, data: { action: 'openOrder' } });
		expect(await act('reveal')).toMatchObject({ status: 404, data: { action: 'reveal' } });
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		vi.setSystemTime(ORDER);
		research.inBackground.mockClear();
		const err = new Error('disk full');
		const spy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
			throw err;
		});
		expect(await act('reveal')).toMatchObject({
			status: 500,
			data: { action: 'reveal', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith(
			{ err, action: 'reveal' },
			'manual tasting phase change failed'
		);
		expect(research.inBackground).not.toHaveBeenCalled();
		spy.mockRestore();
	});
});

describe('links', () => {
	it('offers no action to hand out or regenerate links', () => {
		expect(Object.keys(actions).sort()).toEqual([
			'delete',
			'openOrder',
			'reveal',
			'updateDate',
			'updateMotto'
		]);
	});
});

describe('delete', () => {
	it('deletes the tasting with all participants, bottles, throttle rows and files', async () => {
		const mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
		mockEnv.MEDIA_PATH = mediaDir;
		try {
			consumeTastingWriteLimit(db, anna.id);
			await uploadPresentation(1, bottle);

			await expect(act('delete')).rejects.toMatchObject({
				status: 303,
				location: '/admin/tastings'
			});
			expect(db.select().from(tasting).all()).toEqual([]);
			expect(db.select().from(tastingParticipant).all()).toEqual([]);
			expect(db.select().from(tastingBottle).all()).toEqual([]);
			expect(db.select().from(tastingWriteThrottle).all()).toEqual([]);
			expect(await readdir(mediaDir)).toEqual([]);
		} finally {
			await rm(mediaDir, { recursive: true, force: true });
		}
	});

	it('drops the converted PDFs of its presentations', async () => {
		const mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
		mockEnv.MEDIA_PATH = mediaDir;
		try {
			await uploadPresentation(1, bottle);
			const cache = await cachePdf(mediaDir, 'Tasting_2026-10-24_Nebel.pptx');

			await expect(act('delete')).rejects.toMatchObject({ status: 303 });

			expect(await readdir(cache)).toEqual([]);
		} finally {
			await rm(mediaDir, { recursive: true, force: true });
		}
	});

	it('answers 404 if the tasting is already gone', async () => {
		db.delete(tasting).run();
		expect(await act('delete')).toMatchObject({
			status: 404,
			data: { action: 'delete', userMessage: expect.stringContaining('nicht gefunden') }
		});
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const err = new Error('disk full');
		const spy = vi.spyOn(db, 'delete').mockImplementationOnce(() => {
			throw err;
		});
		expect(await act('delete')).toMatchObject({ status: 500 });
		expect(logger.error).toHaveBeenCalledWith({ err }, 'delete tasting failed');
		spy.mockRestore();
	});
});
