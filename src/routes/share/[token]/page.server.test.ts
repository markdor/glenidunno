import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import { tasting, tastingBottle, user } from '$lib/server/db/schema';
import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
import { createShare, revokeShareByToken } from '$lib/server/bottleShares';
import { logger } from '$lib/server/logger';
import { createTasting, findParticipant, saveBottle } from '$lib/server/tastings';
import { load } from './+page.server';

const ENTRY = new Date('2026-10-20T10:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

let token: string;
let bottleId: string;

type Arg = Parameters<typeof load>[0];

/** The load for anybody – the page needs no login. */
function loadFor(t: string) {
	return load({ params: { token: t }, locals: { user: null, session: null } } as unknown as Arg);
}

beforeEach(() => {
	db.delete(tasting).run();
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
			.onConflictDoNothing()
			.run();
	}
	const { slug } = createTasting(
		db,
		{ motto: 'Inselhüpfen', tastingDate: '2026-10-24', participantUserIds: ['u-anna', 'u-ben'] },
		ENTRY
	);
	const anna = findParticipant(db, slug, 'u-anna')!;
	saveBottle(
		db,
		anna,
		1,
		{
			alias: 'Nebel',
			distillery: 'Ardbeg',
			bottler: null,
			bottling: 'Uigeadail',
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
	token = createShare(db, bottleId, 'u-anna', REVEALED)!;
	vi.setSystemTime(REVEALED);
});

afterEach(() => {
	vi.useRealTimers();
	vi.clearAllMocks();
});

const notFound = expect.objectContaining({ status: 404 });

describe('shared bottle page load', () => {
	it('shows the bottle without a login – and without its bringer', () => {
		const result = loadFor(token);
		expect(result).toMatchObject({
			view: {
				tasting: { name: 'Inselhüpfen', subtitle: 'Tasting #1', tastingDate: '2026-10-24' },
				archived: false,
				algorithm: 'taste',
				position: 1,
				total: 1,
				bottle: { alias: 'Nebel', distillery: 'Ardbeg', bottling: 'Uigeadail' }
			}
		});
		// What the HTML and __data.json carry.
		const serialized = JSON.stringify(result);
		expect(serialized).not.toContain('Anna');
		expect(serialized).not.toContain(bottleId);
	});

	it('answers a malformed, unknown or revoked token with the same 404', () => {
		expect(() => loadFor('short')).toThrow(notFound);
		expect(() => loadFor('x'.repeat(43))).toThrow(notFound);
		revokeShareByToken(db, token);
		expect(() => loadFor(token)).toThrow(notFound);
	});

	it('logs an unexpected failure without the token and shows the error page', () => {
		// A bottle that doesn't fit its tasting's algorithm (not possible via the app).
		db.update(tastingBottle)
			.set({ smoke: null, cask: null, value: null })
			.where(eq(tastingBottle.id, bottleId))
			.run();
		expect(() => loadFor(token)).toThrow(
			expect.objectContaining({ status: 500, body: { message: UNEXPECTED_ERROR_MESSAGE } })
		);
		expect(logger.error).toHaveBeenCalledWith(expect.anything(), 'shared bottle load failed');
		expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(token);
	});
});
