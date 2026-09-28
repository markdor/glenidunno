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
import {
	createTasting,
	findParticipantByToken,
	revealEarly,
	saveBottle
} from '$lib/server/tastings';
import { GET } from './+server';

const ADMIN = { id: 'admin-id', username: 'admin', isAdmin: true };
const ENTRY = new Date('2026-10-20T10:00:00Z');
const deckBytes = new Uint8Array([9, 8, 7]);

let mediaDir: string;
let tastingId: string;
let bottleId: string;

function download(user: unknown, id = bottleId) {
	return GET({
		params: { id: tastingId, bottleId: id },
		locals: { user, session: null }
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
	tastingId = created.id;
	const result = saveBottle(
		db,
		findParticipantByToken(db, created.tokens[0].token)!,
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

describe('presentation download for the admin', () => {
	it('throws 401 without a session and 403 for a non-admin', async () => {
		await expect(download(null)).rejects.toMatchObject({ status: 401 });
		await expect(download({ id: 'u', isAdmin: false })).rejects.toMatchObject({ status: 403 });
	});

	it('is a 404 before the reveal – the admin is blind as well', async () => {
		await expect(download(ADMIN)).rejects.toMatchObject({ status: 404 });
	});

	it('serves the file after the reveal', async () => {
		revealEarly(db, tastingId);
		const response = await download(ADMIN);
		expect(response.headers.get('content-type')).toBe('application/octet-stream');
		expect(new Uint8Array(await response.arrayBuffer())).toEqual(deckBytes);
	});

	it('answers an unknown bottle with 404', async () => {
		revealEarly(db, tastingId);
		await expect(download(ADMIN, 'unknown-bottle')).rejects.toMatchObject({ status: 404 });
	});
});
