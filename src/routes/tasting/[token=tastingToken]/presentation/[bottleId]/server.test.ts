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

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { db } from '$lib/server/db';
import { tasting, tastingBottle } from '$lib/server/db/schema';
import { applyFileChanges, stageUpload } from '$lib/server/tastingMedia';
import { createTasting, findParticipantByToken, saveBottle } from '$lib/server/tastings';
import { GET } from './+server';

const ENTRY = new Date('2026-10-20T10:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');
const deckBytes = new Uint8Array([1, 2, 3, 4]);

let mediaDir: string;
let tokens: string[];
let bottleId: string;

function download(token: string, id = bottleId) {
	// locals.user is set on purpose: the public route must not care about it.
	return GET({
		params: { token, bottleId: id },
		locals: { user: { id: 'admin', isAdmin: true }, session: null }
	} as unknown as Parameters<typeof GET>[0]);
}

beforeEach(async () => {
	mediaDir = await mkdtemp(join(tmpdir(), 'glenidunno-media-'));
	mockEnv.MEDIA_PATH = mediaDir;
	vi.setSystemTime(ENTRY);
	db.delete(tasting).run();
	const created = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 1,
		participantNames: ['Anna', 'Ben']
	});
	tokens = created.tokens.map((t) => t.token);
	const result = saveBottle(
		db,
		findParticipantByToken(db, tokens[0])!,
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

describe('presentation download through a participant link', () => {
	it('is a 404 before the reveal – for other participants and the owner alike', async () => {
		await expect(download(tokens[1])).rejects.toEqual(notFound);
		await expect(download(tokens[0])).rejects.toEqual(notFound);
	});

	it('serves the file as an attachment after the reveal', async () => {
		vi.setSystemTime(REVEALED);
		const response = await download(tokens[1]);

		expect(response.status).toBe(200);
		expect(response.headers.get('content-disposition')).toContain('filename="Ardbeg.pptx"');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(deckBytes);
	});

	it('answers unknown tokens, unknown bottles and missing files with the same 404', async () => {
		vi.setSystemTime(REVEALED);
		await expect(download('x'.repeat(32))).rejects.toEqual(notFound);
		await expect(download(tokens[1], 'unknown-bottle')).rejects.toEqual(notFound);

		await applyFileChanges([{ delete: 'Tasting_2026-10-24_Nebel.pptx' }]);
		await expect(download(tokens[1])).rejects.toEqual(notFound);
	});

	it('does not hand out another tasting’s presentation', async () => {
		const other = createTasting(db, {
			name: 'Anderes',
			tastingDate: '2026-10-24',
			bottlesPerParticipant: 1,
			participantNames: ['Dora', 'Emil']
		});
		vi.setSystemTime(REVEALED);
		await expect(download(other.tokens[0].token)).rejects.toEqual(notFound);
	});
});
