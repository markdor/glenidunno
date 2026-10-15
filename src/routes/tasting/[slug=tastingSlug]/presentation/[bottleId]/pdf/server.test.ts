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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { tasting, tastingBottle, user } from '$lib/server/db/schema';
import { logger } from '$lib/server/logger';
import { applyFileChanges, stageUpload } from '$lib/server/tastingMedia';
import { createTasting, findParticipant, saveBottle, type Participant } from '$lib/server/tastings';
import { GET } from './+server';

const ENTRY = new Date('2026-10-20T10:00:00Z');
const ORDER = new Date('2026-10-24T17:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

// Anna brought both bottles, Ben tastes along, the admin only manages, Dora
// and Emil take part in another tasting.
const ANNA = 'u-anna';
const BEN = 'u-ben';
const ADMIN = 'u-admin';
const DORA = 'u-dora';
const EMIL = 'u-emil';

let mediaDir: string;
let slug: string;
// An original PDF ("Nebel") and a PowerPoint the viewer needs converted ("Torf").
let pdfBottle: string;
let deckBottle: string;

function pdf(userId: string | null, id: string, tastingSlug = slug) {
	return GET({
		params: { slug: tastingSlug, bottleId: id },
		locals: { user: userId ? { id: userId, isAdmin: userId === ADMIN } : null, session: null }
	} as unknown as Parameters<typeof GET>[0]);
}

// Saves one of Anna's bottles with a presentation, like the save action does.
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
		[BEN, 'Ben'],
		[ADMIN, 'Markus'],
		[DORA, 'Dora'],
		[EMIL, 'Emil']
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

beforeEach(async () => {
	mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
	mockEnv.MEDIA_PATH = mediaDir;
	delete mockEnv.GOTENBERG_URL;
	vi.setSystemTime(ENTRY);
	db.delete(tasting).run();
	slug = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		participantUserIds: [ANNA, BEN]
	}).slug;
	const anna = findParticipant(db, slug, ANNA)!;
	pdfBottle = await store(anna, 1, 'Nebel', new File(['%PDF-1.7 Ardbeg'], 'Ardbeg.pdf'));
	deckBottle = await store(anna, 2, 'Torf', new File(['deck'], 'Laphroaig.pptx'));
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.clearAllMocks();
	await rm(mediaDir, { recursive: true, force: true });
});

const notFound = expect.objectContaining({ status: 404, body: { message: 'Not found' } });

describe('presentation PDF for the viewer', () => {
	it('is a 404 during entry – for other participants and the owner alike', async () => {
		await expect(pdf(BEN, pdfBottle)).rejects.toEqual(notFound);
		await expect(pdf(ANNA, pdfBottle)).rejects.toEqual(notFound);
	});

	it('serves an original PDF from the order on, always under the stored name', async () => {
		for (const now of [ORDER, REVEALED]) {
			vi.setSystemTime(now);
			const response = await pdf(BEN, pdfBottle);

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
		}
	});

	it('converts an office file on its first view and serves the cache afterwards', async () => {
		mockEnv.GOTENBERG_URL = 'http://gotenberg.test';
		const gotenberg = vi.fn(
			async () => new Response('%PDF converted', { headers: { 'content-type': 'application/pdf' } })
		);
		vi.stubGlobal('fetch', gotenberg);
		vi.setSystemTime(ORDER);

		for (let view = 0; view < 2; view++) {
			const response = await pdf(BEN, deckBottle);
			const disposition = response.headers.get('content-disposition');
			expect(disposition).toContain('filename="Tasting_2026-10-24_Torf.pdf"');
			expect(disposition).not.toContain('Laphroaig');
			expect(await response.text()).toBe('%PDF converted');
		}
		expect(gotenberg).toHaveBeenCalledTimes(1);
	});

	it('answers 503 if an office file can not be converted – e.g. without Gotenberg', async () => {
		vi.setSystemTime(ORDER);
		await expect(pdf(BEN, deckBottle)).rejects.toEqual(expect.objectContaining({ status: 503 }));
		expect(logger.error).toHaveBeenCalledWith(
			expect.objectContaining({ file: 'Tasting_2026-10-24_Torf.pptx' }),
			'presentation pdf unavailable'
		);
	});

	it('answers non-participants, the admin, unknown slugs and bottles, other formats and missing files with the same 404', async () => {
		vi.setSystemTime(REVEALED);
		await expect(pdf(DORA, pdfBottle)).rejects.toEqual(notFound);
		await expect(pdf(ADMIN, pdfBottle)).rejects.toEqual(notFound);
		await expect(pdf(BEN, pdfBottle, 'fluffy-nothing')).rejects.toEqual(notFound);
		await expect(pdf(BEN, 'unknown-bottle')).rejects.toEqual(notFound);

		// Neither a PDF nor a format LibreOffice converts: download only.
		db.update(tastingBottle)
			.set({ presentationFile: 'Tasting_2026-10-24_Torf.zip' })
			.where(eq(tastingBottle.id, deckBottle))
			.run();
		await expect(pdf(BEN, deckBottle)).rejects.toEqual(notFound);

		await applyFileChanges([{ delete: 'Tasting_2026-10-24_Nebel.pdf' }]);
		await expect(pdf(BEN, pdfBottle)).rejects.toEqual(notFound);
	});

	it('does not hand out another tasting’s presentation', async () => {
		const other = createTasting(db, {
			name: 'Anderes',
			tastingDate: '2026-10-24',
			participantUserIds: [DORA, EMIL]
		});
		vi.setSystemTime(REVEALED);
		await expect(pdf(DORA, pdfBottle, other.slug)).rejects.toEqual(notFound);
	});

	it('requires a login', async () => {
		vi.setSystemTime(REVEALED);
		await expect(pdf(null, pdfBottle)).rejects.toMatchObject({ status: 401 });
	});
});
