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
import { db } from '$lib/server/db';
import { tasting, tastingBottle, user } from '$lib/server/db/schema';
import { applyFileChanges, stageUpload } from '$lib/server/tastingMedia';
import { createTasting, findParticipant, saveBottle } from '$lib/server/tastings';
import { GET } from './+server';

const ENTRY = new Date('2026-10-20T10:00:00Z');
const ORDER = new Date('2026-10-24T17:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');
const deckBytes = new Uint8Array([1, 2, 3, 4]);

// Anna brought the bottle, Ben tastes along, the admin only manages, Dora and
// Emil take part in another tasting.
const ANNA = 'u-anna';
const BEN = 'u-ben';
const ADMIN = 'u-admin';
const DORA = 'u-dora';
const EMIL = 'u-emil';

let mediaDir: string;
let slug: string;
let bottleId: string;

function download(userId: string | null, id = bottleId, tastingSlug = slug) {
	return GET({
		params: { slug: tastingSlug, bottleId: id },
		locals: { user: userId ? { id: userId, isAdmin: userId === ADMIN } : null, session: null }
	} as unknown as Parameters<typeof GET>[0]);
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
	vi.setSystemTime(ENTRY);
	db.delete(tasting).run();
	slug = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 1,
		participantUserIds: [ANNA, BEN]
	}).slug;
	const result = saveBottle(
		db,
		findParticipant(db, slug, ANNA)!,
		1,
		{
			alias: 'Nebel',
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
		await stageUpload(new File([deckBytes], 'Ardbeg.pptx'))
	);
	if (result.status === 'saved') await applyFileChanges(result.fileChanges);
	bottleId = db.select().from(tastingBottle).get()!.id;
});

afterEach(async () => {
	vi.useRealTimers();
	await rm(mediaDir, { recursive: true, force: true });
});

const notFound = expect.objectContaining({ status: 404, body: { message: 'Not found' } });

describe('presentation download from the participant page', () => {
	it('is a 404 during entry – for other participants and the owner alike', async () => {
		await expect(download(BEN)).rejects.toEqual(notFound);
		await expect(download(ANNA)).rejects.toEqual(notFound);
	});

	it('serves the file from the order on, under the stored name until the reveal', async () => {
		vi.setSystemTime(ORDER);
		const response = await download(BEN);

		expect(response.status).toBe(200);
		const disposition = response.headers.get('content-disposition');
		expect(disposition).toContain('filename="Tasting_2026-10-24_Nebel.pptx"');
		expect(disposition).not.toContain('Ardbeg');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(deckBytes);
	});

	it('serves the file under its original name after the reveal', async () => {
		vi.setSystemTime(REVEALED);
		const response = await download(BEN);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-disposition')).toContain('filename="Ardbeg.pptx"');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(deckBytes);
	});

	it('answers non-participants, the admin, unknown slugs and bottles and missing files with the same 404', async () => {
		vi.setSystemTime(REVEALED);
		await expect(download(DORA)).rejects.toEqual(notFound);
		await expect(download(ADMIN)).rejects.toEqual(notFound);
		await expect(download(BEN, bottleId, 'fluffy-nothing')).rejects.toEqual(notFound);
		await expect(download(BEN, 'unknown-bottle')).rejects.toEqual(notFound);

		await applyFileChanges([{ delete: 'Tasting_2026-10-24_Nebel.pptx' }]);
		await expect(download(BEN)).rejects.toEqual(notFound);
	});

	it('does not hand out another tasting’s presentation', async () => {
		const other = createTasting(db, {
			name: 'Anderes',
			tastingDate: '2026-10-24',
			bottlesPerParticipant: 1,
			participantUserIds: [DORA, EMIL]
		});
		vi.setSystemTime(REVEALED);
		await expect(download(DORA, bottleId, other.slug)).rejects.toEqual(notFound);
	});

	it('requires a login', async () => {
		vi.setSystemTime(REVEALED);
		await expect(download(null)).rejects.toMatchObject({ status: 401 });
	});
});
