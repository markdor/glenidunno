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

const mockEnv = vi.hoisted((): Record<string, string | undefined> => ({}));
vi.mock('$env/dynamic/private', () => ({ env: mockEnv }));
// Saving the PowerPoint would convert it in the background – a stray
// conversion would blur that the route itself never starts one.
vi.mock('$lib/server/presentationPdf', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/presentationPdf')>()),
	convertInBackground: vi.fn()
}));

import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { tasting, tastingBottle, user } from '$lib/server/db/schema';
import { createShare, revokeShareByToken } from '$lib/server/bottleShares';
import { logger } from '$lib/server/logger';
import { applyFileChanges, stageUpload } from '$lib/server/tastingMedia';
import { createTasting, findParticipant, saveBottle, type Participant } from '$lib/server/tastings';
import { GET } from './+server';

const ENTRY = new Date('2026-10-20T10:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');
const ANNA = 'u-anna';

let mediaDir: string;
// An original PDF ("Nebel") and a PowerPoint the viewer needs converted ("Torf").
let pdfToken: string;
let deckToken: string;
let deckBottle: string;

/** The PDF route for anybody – no login involved. */
function pdf(token: string) {
	return GET({
		params: { token },
		locals: { user: null, session: null }
	} as unknown as Parameters<typeof GET>[0]);
}

async function store(holder: Participant, slot: number, alias: string, upload: File) {
	const result = saveBottle(
		db,
		holder,
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
		ENTRY,
		await stageUpload(upload)
	);
	if (result.status === 'saved') await applyFileChanges(result.fileChanges);
	return db.select().from(tastingBottle).where(eq(tastingBottle.alias, alias)).get()!.id;
}

beforeAll(() => {
	for (const [id, username] of [
		[ANNA, 'Anna'],
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

beforeEach(async () => {
	mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
	mockEnv.MEDIA_PATH = mediaDir;
	delete mockEnv.GOTENBERG_URL;
	db.delete(tasting).run();
	const { slug } = createTasting(
		db,
		{ tastingDate: '2026-10-24', participantUserIds: [ANNA, 'u-ben'] },
		ENTRY
	);
	const anna = findParticipant(db, slug, ANNA)!;
	const pdfBottle = await store(anna, 1, 'Nebel', new File(['%PDF-1.7 Ardbeg'], 'Ardbeg.pdf'));
	deckBottle = await store(anna, 2, 'Torf', new File(['deck'], 'Laphroaig.pptx'));
	pdfToken = createShare(db, pdfBottle, ANNA, REVEALED)!;
	deckToken = createShare(db, deckBottle, ANNA, REVEALED)!;
	vi.setSystemTime(REVEALED);
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	await rm(mediaDir, { recursive: true, force: true });
});

const notFound = expect.objectContaining({ status: 404, body: { message: 'Not found' } });

describe('shared presentation PDF', () => {
	it('serves an original PDF without a login, as an attachment under the stored name', async () => {
		const response = await pdf(pdfToken);
		expect(response.status).toBe(200);
		expect(Object.fromEntries(response.headers)).toMatchObject({
			'content-type': 'application/pdf',
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		});
		const disposition = response.headers.get('content-disposition');
		expect(disposition).toContain('attachment; filename="Tasting_2026-10-24_Nebel.pdf"');
		expect(disposition).not.toContain('Ardbeg');
		expect(await response.text()).toBe('%PDF-1.7 Ardbeg');
	});

	it('serves an office file’s PDF from the cache, never the file itself', async () => {
		await mkdir(join(mediaDir, 'pdf-cache'), { recursive: true });
		await writeFile(
			join(mediaDir, 'pdf-cache', 'Tasting_2026-10-24_Torf.pptx.pdf'),
			'%PDF converted'
		);
		const response = await pdf(deckToken);
		expect(response.headers.get('content-disposition')).toContain('Tasting_2026-10-24_Torf.pdf');
		expect(await response.text()).toBe('%PDF converted');
	});

	it('never starts a conversion: 404 without a log entry while no PDF is ready', async () => {
		mockEnv.GOTENBERG_URL = 'http://gotenberg.test';
		const gotenberg = vi.fn();
		vi.stubGlobal('fetch', gotenberg);
		await expect(pdf(deckToken)).rejects.toEqual(notFound);
		expect(gotenberg).not.toHaveBeenCalled();
		expect(logger.warn).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('answers malformed, unknown and revoked tokens, other formats and missing files with the same 404', async () => {
		await expect(pdf('short')).rejects.toEqual(notFound);
		await expect(pdf('x'.repeat(43))).rejects.toEqual(notFound);

		db.update(tastingBottle)
			.set({ presentationFile: 'Tasting_2026-10-24_Torf.zip' })
			.where(eq(tastingBottle.id, deckBottle))
			.run();
		await expect(pdf(deckToken)).rejects.toEqual(notFound);

		await applyFileChanges([{ delete: 'Tasting_2026-10-24_Nebel.pdf' }]);
		await expect(pdf(pdfToken)).rejects.toEqual(notFound);

		revokeShareByToken(db, pdfToken);
		await expect(pdf(pdfToken)).rejects.toEqual(notFound);
	});
});
