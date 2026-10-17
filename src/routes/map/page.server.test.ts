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
import { distillery, tasting, user } from '$lib/server/db/schema';
import { createTasting, findParticipant, saveBottle } from '$lib/server/tastings';
import type { TastingBottle } from '$lib/tasting';
import type { WorldMapData } from '$lib/worldMap';
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
function tastingWithBottle(tastingDate: string, alias: string, name: string) {
	const { slug } = createTasting(
		db,
		{ name: `Tasting ${tastingDate}`, tastingDate, participantUserIds: ['u-Anna', 'u-Ben'] },
		BEFORE
	);
	saveBottle(db, findParticipant(db, slug, 'u-Anna')!, 1, bottle(alias, name), BEFORE);
	return slug;
}

function facts(nameKey: string, country: string) {
	db.insert(distillery)
		.values({ nameKey, country, countryState: 'admin', updatedAt: BEFORE })
		.onConflictDoNothing()
		.run();
}

type Arg = Parameters<typeof load>[0];

function loadAs(currentUser: unknown) {
	return load({ locals: { user: currentUser, session: null } } as unknown as Arg) as {
		worldMap: WorldMapData | null;
	};
}

let revealedSlug: string;

beforeEach(() => {
	db.delete(tasting).run();
	insertUsers('Anna', 'Ben', 'maxi');
	revealedSlug = tastingWithBottle('2026-10-17', 'Moor', 'Kavalan');
	tastingWithBottle('2026-10-24', 'Nebel', 'Mackmyra');
	facts('kavalan', 'Taiwan');
	facts('mackmyra', 'Schweden');
	// Saturday 24.10.2026, 18:30 in Berlin: the order of the second tasting is
	// out, the first one has been revealed for a week.
	vi.setSystemTime(new Date('2026-10-24T16:30:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('world map page load', () => {
	it('gives everybody the countries of the revealed tasting only, without link or alias', () => {
		for (const viewer of [
			{ id: 'u-Anna', username: 'Anna', isAdmin: false },
			{ id: 'u-maxi', username: 'maxi', isAdmin: true }
		]) {
			const result = loadAs(viewer);
			expect(result.worldMap?.countries.map((c) => [c.code, c.bottles.length])).toEqual([
				['TW', 1]
			]);
			const serialized = JSON.stringify(result);
			for (const hidden of [revealedSlug, 'Moor', 'Nebel', 'Mackmyra', 'SE', '2026-10-24']) {
				expect(serialized).not.toContain(hidden);
			}
		}
	});

	it('returns no map while nothing is revealed', () => {
		vi.setSystemTime(new Date('2026-10-17T08:00:00Z'));
		expect(loadAs({ id: 'u-Anna', username: 'Anna', isAdmin: false })).toEqual({
			worldMap: null
		});
	});

	it('refuses requests without a user', () => {
		expect(() => loadAs(null)).toThrow(expect.objectContaining({ status: 401 }));
	});
});
