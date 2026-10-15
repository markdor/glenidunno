import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import * as schema from './db/schema';
import { runMigrations } from './db/migrate';
import { presentationPdfJob } from './presentationPdfJob';
import { StartupJobError, type StartupJobContext } from './startupJobs';
import { createTasting, findParticipant, saveBottle } from './tastings';

const ENTRY = new Date('2026-10-20T10:00:00Z');
const DECK = 'Tasting_2026-10-24_Nebel.pptx';
const SECOND_DECK = 'Tasting_2026-10-24_Moor.odp';
const ORIGINAL_PDF = 'Tasting_2026-10-24_Torf.pdf';

let db: ReturnType<typeof drizzle<typeof schema>>;
let mediaDir: string;
const cached = (file: string) => join(mediaDir, 'pdf-cache', `${file}.pdf`);

beforeAll(() => {
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	for (const [id, username] of [
		['u-anna', 'Anna'],
		['u-ben', 'Ben']
	]) {
		db.insert(schema.user)
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

/** A bottle of Anna's with a presentation stored under `file`. */
async function storeBottle(slug: string, slot: number, alias: string, file: string) {
	saveBottle(
		db,
		findParticipant(db, slug, 'u-anna')!,
		slot,
		{
			alias,
			distillery: 'Ardbeg',
			bottler: null,
			bottling: null,
			age: null,
			whiskybaseUrl: null,
			smoke: 5,
			cask: 2,
			abv: 46,
			value: 3
		},
		ENTRY
	);
	db.update(schema.tastingBottle)
		.set({ presentationFile: file, presentationName: `${alias}.original` })
		.where(eq(schema.tastingBottle.alias, alias))
		.run();
	await writeFile(join(mediaDir, file), `${alias} deck`);
}

beforeEach(async () => {
	mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
	mockEnv.MEDIA_PATH = mediaDir;
	mockEnv.GOTENBERG_URL = 'http://gotenberg.test';
	db.delete(schema.tasting).run();
	const { slug } = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		participantUserIds: ['u-anna', 'u-ben']
	});
	await storeBottle(slug, 1, 'Nebel', DECK);
	await storeBottle(slug, 2, 'Torf', ORIGINAL_PDF);
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	await rm(mediaDir, { recursive: true, force: true });
});

/** Gotenberg: healthy, converting every file to "%PDF <its content>". */
function gotenberg(failFor: string | null = null) {
	const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
		if (String(url).endsWith('/health')) return new Response('{"status":"up"}');
		const sent = (init?.body as FormData).get('files') as File;
		if (sent.name === failFor) return new Response('LibreOffice failed', { status: 500 });
		return new Response(`%PDF ${await sent.text()}`, {
			headers: { 'content-type': 'application/pdf' }
		});
	});
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

const conversions = (fetchMock: ReturnType<typeof gotenberg>) =>
	fetchMock.mock.calls.filter(([url]) => String(url).endsWith('/forms/libreoffice/convert')).length;

function context(trigger: StartupJobContext['trigger']) {
	return { trigger, progress: vi.fn() };
}

describe('presentationPdfJob', () => {
	it('converts the missing PDFs of office presentations after a deployment', async () => {
		const fetchMock = gotenberg();
		const ctx = context('startup');

		expect(await presentationPdfJob(db).run(ctx)).toBe('1 Präsentation umgewandelt.');

		expect(await readFile(cached(DECK), 'utf8')).toBe('%PDF Nebel deck');
		// The original PDF needs no conversion.
		expect(conversions(fetchMock)).toBe(1);
		expect(ctx.progress.mock.calls).toEqual([
			[0, 1],
			[1, 1]
		]);
	});

	it('leaves existing PDFs alone after a deployment, but converts all again by hand', async () => {
		await mkdir(join(mediaDir, 'pdf-cache'));
		await writeFile(cached(DECK), '%PDF old');
		const fetchMock = gotenberg();

		expect(await presentationPdfJob(db).run(context('startup'))).toBe(
			'Keine Präsentation umzuwandeln.'
		);
		expect(fetchMock).not.toHaveBeenCalled();

		expect(await presentationPdfJob(db).run(context('manual'))).toBe('1 Präsentation umgewandelt.');
		expect(await readFile(cached(DECK), 'utf8')).toBe('%PDF Nebel deck');
	});

	it('needs no Gotenberg while there is nothing to convert', async () => {
		db.update(schema.tastingBottle)
			.set({ presentationFile: null, presentationName: null })
			.where(eq(schema.tastingBottle.alias, 'Nebel'))
			.run();
		delete mockEnv.GOTENBERG_URL;

		expect(await presentationPdfJob(db).run(context('startup'))).toBe(
			'Keine Präsentation umzuwandeln.'
		);
	});

	it('fails without GOTENBERG_URL', async () => {
		delete mockEnv.GOTENBERG_URL;
		await expect(presentationPdfJob(db).run(context('startup'))).rejects.toEqual(
			new StartupJobError('GOTENBERG_URL is not set', 'GOTENBERG_URL ist nicht gesetzt.')
		);
	});

	it('waits for Gotenberg after a deployment and gives up if it never answers', async () => {
		vi.useFakeTimers();
		const fetchMock = vi.fn(async () => new Response('', { status: 503 }));
		vi.stubGlobal('fetch', fetchMock);

		const run = presentationPdfJob(db).run(context('startup'));
		const failed = expect(run).rejects.toMatchObject({
			userMessage: 'Gotenberg ist nicht erreichbar.'
		});
		// First real file access, then only timers are left to wait for.
		await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
		await vi.advanceTimersByTimeAsync(2 * 60_000);

		await failed;
		expect(fetchMock).toHaveBeenCalledTimes(24);
	});

	it('converts the others when one fails and reports how many failed', async () => {
		const { slug } = db.select().from(schema.tasting).get()!;
		await storeBottle(slug, 3, 'Moor', SECOND_DECK);
		gotenberg(DECK);
		const ctx = context('startup');

		await expect(presentationPdfJob(db).run(ctx)).rejects.toMatchObject({
			userMessage: '1 von 2 Präsentationen ließen sich nicht umwandeln, Details im Server-Log.'
		});

		expect(await readFile(cached(SECOND_DECK), 'utf8')).toBe('%PDF Moor deck');
		expect(ctx.progress).toHaveBeenLastCalledWith(2, 2);
	});
});
