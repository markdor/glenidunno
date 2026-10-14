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

import { db } from '$lib/server/db';
import { tasting, user } from '$lib/server/db/schema';
import { createTasting, findParticipant, saveBottle } from '$lib/server/tastings';
import type { TastingBottle } from '$lib/tasting';
import { load } from './+page.server';

function insertUsers(...usernames: string[]) {
	for (const username of usernames) {
		db.insert(user)
			.values({
				id: `u-${username}`,
				name: username,
				email: `${username.toLowerCase()}@example.com`,
				username,
				createdAt: new Date(),
				updatedAt: new Date()
			})
			.onConflictDoNothing()
			.run();
	}
}

const BEFORE = new Date('2026-10-10T08:00:00Z');

function bottle(alias: string, distillery: string): TastingBottle {
	return {
		alias,
		distillery,
		bottler: null,
		bottling: null,
		age: null,
		whiskybaseUrl: null,
		smoke: 5,
		cask: 2,
		abv: 46,
		value: 3
	};
}

/** A tasting of Anna and Ben with one bottle of Anna's, entered in time. */
function tastingWithBottle(tastingDate: string, alias: string, distillery: string) {
	const { slug } = createTasting(
		db,
		{ name: `Tasting ${tastingDate}`, tastingDate, participantUserIds: ['u-Anna', 'u-Ben'] },
		BEFORE
	);
	saveBottle(db, findParticipant(db, slug, 'u-Anna')!, 1, bottle(alias, distillery), BEFORE);
	return slug;
}

type Arg = Parameters<typeof load>[0];

// No `url` on purpose: the load must not read the query string.
function loadAs(currentUser: unknown) {
	return load({ locals: { user: currentUser, session: null } } as unknown as Arg) as {
		bottles: Array<{ alias: string; slug: string | null }> | null;
	};
}

let revealedSlug: string;

beforeEach(() => {
	db.delete(tasting).run();
	insertUsers('Anna', 'Ben', 'maxi');
	revealedSlug = tastingWithBottle('2026-10-17', 'Moor', 'Lagavulin');
	tastingWithBottle('2026-10-24', 'Nebel', 'Ardbeg');
	// Saturday 24.10.2026, 18:30 in Berlin: the order of the second tasting is
	// out, the first one has been revealed for a week.
	vi.setSystemTime(new Date('2026-10-24T16:30:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

/** Nothing of a tasting that isn't revealed – in the serialized data. */
function expectNoContent(result: unknown) {
	const serialized = JSON.stringify(result);
	expect(serialized).not.toContain('Nebel');
	expect(serialized).not.toContain('Ardbeg');
	expect(serialized).not.toContain('2026-10-24');
}

describe('history page load', () => {
	it('gives a participant the revealed tasting with its link', () => {
		const result = loadAs({ id: 'u-Anna', username: 'Anna', isAdmin: false });
		expect(result.bottles).toEqual([
			expect.objectContaining({ alias: 'Moor', slug: revealedSlug })
		]);
		expectNoContent(result);
	});

	it('gives everybody else the same bottles without the link', () => {
		const result = loadAs({ id: 'u-maxi', username: 'maxi', isAdmin: true });
		expect(result.bottles).toEqual([expect.objectContaining({ alias: 'Moor', slug: null })]);
		expect(JSON.stringify(result)).not.toContain(revealedSlug);
		expectNoContent(result);
	});

	it('returns no bottles while nothing is revealed', () => {
		vi.setSystemTime(new Date('2026-10-17T08:00:00Z'));
		expect(loadAs({ id: 'u-Anna', username: 'Anna', isAdmin: false })).toEqual({ bottles: null });
	});

	it('refuses requests without a user', () => {
		expect(() => loadAs(null)).toThrow(expect.objectContaining({ status: 401 }));
	});
});
