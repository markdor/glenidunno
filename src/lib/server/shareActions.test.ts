import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

vi.mock('$lib/server/db', async () => {
	const Database = (await import('better-sqlite3')).default;
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { runMigrations } = await import('$lib/server/db/migrate');
	const schema = await import('$lib/server/db/schema');
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	return { db: drizzle(sqlite, { schema }), schema, sqlite };
});
vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

import { eq } from 'drizzle-orm';
import * as dbModule from '$lib/server/db';
import {
	tasting,
	tastingBottle,
	tastingBottleShare,
	tastingWriteThrottle,
	user
} from '$lib/server/db/schema';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import { logger } from '$lib/server/logger';
import { createTasting, findParticipant, saveBottle } from '$lib/server/tastings';
import { TASTING_WRITE_LIMIT } from '$lib/server/tastingWriteThrottle';
import { SHARE_TOKEN_RE } from '$lib/validation';
import {
	NOT_REVEALED_MESSAGE,
	NOT_SHAREABLE_MESSAGE,
	SHARE_LIMIT_MESSAGE,
	shareActions
} from './shareActions';

const { db } = dbModule;
const { sqlite } = dbModule as unknown as { sqlite: import('better-sqlite3').Database };

const ENTRY = new Date('2026-10-20T10:00:00Z');
const ORDER = new Date('2026-10-24T16:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

const ANNA = { id: 'u-anna', username: 'Anna', isAdmin: false };
const BEN = { id: 'u-ben', username: 'Ben', isAdmin: false };

function insertUser(id: string, username: string) {
	db.insert(user)
		.values({
			id,
			name: username,
			email: `${username.toLowerCase()}@example.com`,
			username,
			createdAt: ENTRY,
			updatedAt: ENTRY
		})
		.onConflictDoNothing()
		.run();
}

let bottleId: string;
let participantId: string;

beforeEach(() => {
	db.delete(tasting).run();
	insertUser(ANNA.id, ANNA.username);
	insertUser(BEN.id, BEN.username);
	const { slug } = createTasting(
		db,
		{ tastingDate: '2026-10-24', participantUserIds: [ANNA.id, BEN.id] },
		ENTRY
	);
	const anna = findParticipant(db, slug, ANNA.id)!;
	participantId = anna.id;
	saveBottle(
		db,
		anna,
		1,
		{
			alias: 'Nebel',
			distillery: 'Ardbeg',
			bottler: null,
			bottling: null,
			age: null,
			whiskybaseUrl: null,
			smoke: 5,
			cask: 3,
			abv: 54.2,
			value: 4
		},
		ENTRY
	);
	bottleId = db
		.select({ id: tastingBottle.id })
		.from(tastingBottle)
		.where(eq(tastingBottle.participantId, anna.id))
		.get()!.id;
	vi.setSystemTime(REVEALED);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

function event(currentUser: unknown, fields: Record<string, string>): RequestEvent {
	const form = new FormData();
	for (const [name, value] of Object.entries(fields)) form.set(name, value);
	return {
		request: new Request('http://localhost/history?/share', { method: 'POST', body: form }),
		locals: { user: currentUser, session: null }
	} as unknown as RequestEvent;
}

function shares() {
	return db.select().from(tastingBottleShare).all();
}

describe('share action', () => {
	it('creates the link of the own bottle', async () => {
		expect(await shareActions.share(event(ANNA, { bottleId }))).toEqual({
			action: 'share',
			shared: true
		});
		expect(shares()).toEqual([
			expect.objectContaining({ bottleId, token: expect.stringMatching(SHARE_TOKEN_RE) })
		]);
	});

	it.each([
		{ label: 'somebody else’s bottle', fields: () => ({ bottleId }), currentUser: BEN },
		{ label: 'an unknown bottle', fields: () => ({ bottleId: 'unknown' }), currentUser: ANNA },
		{ label: 'no bottle', fields: () => ({}), currentUser: ANNA }
	])('answers $label with the same 404', async ({ fields, currentUser }) => {
		expect(await shareActions.share(event(currentUser, fields()))).toMatchObject({
			status: 404,
			data: { action: 'share', userMessage: NOT_SHAREABLE_MESSAGE }
		});
		expect(shares()).toEqual([]);
	});

	it('refuses before the reveal', async () => {
		vi.setSystemTime(ORDER);
		expect(await shareActions.share(event(ANNA, { bottleId }))).toMatchObject({
			status: 422,
			data: { action: 'share', userMessage: NOT_REVEALED_MESSAGE }
		});
		expect(shares()).toEqual([]);
	});

	it('shares the participant’s write limit', async () => {
		db.insert(tastingWriteThrottle)
			.values({ participantId, count: TASTING_WRITE_LIMIT.max, windowStart: REVEALED })
			.run();
		expect(await shareActions.share(event(ANNA, { bottleId }))).toMatchObject({
			status: 429,
			data: { action: 'share', userMessage: SHARE_LIMIT_MESSAGE }
		});
		expect(shares()).toEqual([]);
	});

	it('refuses requests without a user', async () => {
		await expect(shareActions.share(event(null, { bottleId }))).rejects.toMatchObject({
			status: 401
		});
	});

	it('logs an unexpected failure and answers generically', async () => {
		sqlite.exec('ALTER TABLE tasting_bottle_share RENAME TO tasting_bottle_share_gone');
		try {
			expect(await shareActions.share(event(ANNA, { bottleId }))).toMatchObject({
				status: 500,
				data: { action: 'share', userMessage: UNEXPECTED_ERROR_MESSAGE }
			});
			expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'share failed');
		} finally {
			sqlite.exec('ALTER TABLE tasting_bottle_share_gone RENAME TO tasting_bottle_share');
		}
	});
});

describe('unshare action', () => {
	it('revokes the link of the own bottle', async () => {
		await shareActions.share(event(ANNA, { bottleId }));
		expect(await shareActions.unshare(event(ANNA, { bottleId }))).toEqual({
			action: 'unshare',
			revoked: true
		});
		expect(shares()).toEqual([]);
	});

	it('leaves somebody else’s link alone', async () => {
		await shareActions.share(event(ANNA, { bottleId }));
		expect(await shareActions.unshare(event(BEN, { bottleId }))).toMatchObject({
			status: 404,
			data: { action: 'unshare', userMessage: NOT_SHAREABLE_MESSAGE }
		});
		expect(shares()).toHaveLength(1);
	});

	it('logs an unexpected failure and answers generically', async () => {
		sqlite.exec('ALTER TABLE tasting_bottle_share RENAME TO tasting_bottle_share_gone');
		try {
			expect(await shareActions.unshare(event(ANNA, { bottleId }))).toMatchObject({
				status: 500,
				data: { action: 'unshare', userMessage: UNEXPECTED_ERROR_MESSAGE }
			});
			expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'unshare failed');
		} finally {
			sqlite.exec('ALTER TABLE tasting_bottle_share_gone RENAME TO tasting_bottle_share');
		}
	});
});
