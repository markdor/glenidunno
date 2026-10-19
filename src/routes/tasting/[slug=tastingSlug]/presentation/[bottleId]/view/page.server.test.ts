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

import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { tasting, tastingBottle, user } from '$lib/server/db/schema';
import { applyFileChanges, stageUpload } from '$lib/server/tastingMedia';
import { createTasting, findParticipant, saveBottle } from '$lib/server/tastings';
import { load } from './+page.server';

/** Every missing page gets exactly this response. */
const NOT_FOUND_REDIRECT = expect.objectContaining({
	status: 303,
	location: '/?notice=not-found'
});

const ENTRY = new Date('2026-10-20T10:00:00Z');
const ORDER = new Date('2026-10-24T17:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

// Anna brought the bottle, Ben tastes along, the admin only manages, Dora
// has nothing to do with it.
const ANNA = 'u-anna';
const BEN = 'u-ben';
const ADMIN = 'u-admin';
const DORA = 'u-dora';

let mediaDir: string;
let slug: string;
let bottleId: string;

function view(userId: string | null, id = bottleId, tastingSlug = slug, search = '') {
	return load({
		params: { slug: tastingSlug, bottleId: id },
		locals: { user: userId ? { id: userId, isAdmin: userId === ADMIN } : null, session: null },
		url: new URL(`http://localhost/tasting/${tastingSlug}/presentation/${id}/view${search}`)
	} as unknown as Parameters<typeof load>[0]) as { back: string };
}

beforeAll(() => {
	for (const [id, username] of [
		[ANNA, 'Anna'],
		[BEN, 'Ben'],
		[ADMIN, 'Markus'],
		[DORA, 'Dora']
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
		await stageUpload(new File(['deck'], 'Ardbeg Uigeadail.pptx'))
	);
	if (result.status === 'saved') await applyFileChanges(result.fileChanges);
	bottleId = db.select().from(tastingBottle).get()!.id;
});

afterEach(async () => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	await rm(mediaDir, { recursive: true, force: true });
});

describe('presentation viewer load', () => {
	it('redirects during entry like every missing page – the owner as well', () => {
		expect(() => view(BEN)).toThrowError(NOT_FOUND_REDIRECT);
		expect(() => view(ANNA)).toThrowError(NOT_FOUND_REDIRECT);
	});

	it('redirects non-participants, the admin, unknown bottles and formats without viewer', () => {
		vi.setSystemTime(REVEALED);
		expect(() => view(DORA)).toThrowError(NOT_FOUND_REDIRECT);
		expect(() => view(ADMIN)).toThrowError(NOT_FOUND_REDIRECT);
		expect(() => view(BEN, bottleId, 'fluffy-nothing')).toThrowError(NOT_FOUND_REDIRECT);
		expect(() => view(BEN, 'unknown-bottle')).toThrowError(NOT_FOUND_REDIRECT);

		db.update(tastingBottle)
			.set({ presentationFile: 'Tasting_2026-10-24_Nebel.zip' })
			.where(eq(tastingBottle.id, bottleId))
			.run();
		expect(() => view(BEN)).toThrowError(NOT_FOUND_REDIRECT);
	});

	it('opens from the order on and returns no file name at all', () => {
		for (const now of [ORDER, REVEALED]) {
			vi.setSystemTime(now);
			const data = view(BEN);
			expect(data).toEqual({ back: 'tasting' });
			expect(JSON.stringify(data)).not.toMatch(/Ardbeg|Tasting_2026/);
		}
	});

	it('never converts – hovering the link preloads this load', () => {
		mockEnv.GOTENBERG_URL = 'http://gotenberg.test';
		const gotenberg = vi.fn();
		vi.stubGlobal('fetch', gotenberg);
		vi.setSystemTime(ORDER);

		view(BEN);

		expect(gotenberg).not.toHaveBeenCalled();
		expect(existsSync(join(mediaDir, 'pdf-cache'))).toBe(false);
	});

	it('goes back to the bottle database or the tasting history only when they asked for it', () => {
		vi.setSystemTime(REVEALED);
		expect(view(BEN, bottleId, slug, '?from=history')).toEqual({ back: 'history' });
		expect(view(BEN, bottleId, slug, '?from=tastings')).toEqual({
			back: 'tastings',
			tastingId: db.select().from(tasting).get()!.id
		});
		expect(view(BEN, bottleId, slug, '?from=https://example.com')).toEqual({ back: 'tasting' });
	});

	it('requires a login (behind the global guard as a second line)', () => {
		vi.setSystemTime(REVEALED);
		expect(() => view(null)).toThrowError(expect.objectContaining({ status: 401 }));
	});
});
