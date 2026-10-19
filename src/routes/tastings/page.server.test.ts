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

/** A tasting of Anna and Ben with one bottle of Anna's, entered in time. */
function tastingWithBottle(tastingDate: string, alias: string, distillery: string) {
	const created = createTasting(
		db,
		{
			name: `Tasting ${tastingDate}`,
			motto: `Motto ${tastingDate}`,
			mottoDescription: `Erklärung ${tastingDate}`,
			tastingDate,
			participantUserIds: ['u-Anna', 'u-Ben']
		},
		BEFORE
	);
	const anna = findParticipant(db, created.slug, 'u-Anna')!;
	saveBottle(
		db,
		anna,
		1,
		{
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
		},
		BEFORE
	);
	return created;
}

type Arg = Parameters<typeof load>[0];

function loadAs(currentUser: unknown) {
	return load({ locals: { user: currentUser, session: null } } as unknown as Arg) as {
		tastings: Array<{ id: string; name: string }>;
	};
}

let revealed: { id: string; slug: string };

beforeEach(() => {
	db.delete(tasting).run();
	insertUsers('Anna', 'Ben', 'maxi');
	revealed = tastingWithBottle('2026-10-17', 'Moor', 'Lagavulin');
	tastingWithBottle('2026-10-24', 'Nebel', 'Ardbeg');
	// Saturday 24.10.2026, 18:30 in Berlin: the order of the second tasting is
	// out, the first one has been revealed for a week.
	vi.setSystemTime(new Date('2026-10-24T16:30:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('tasting history load', () => {
	it.each([
		{ label: 'a participant', currentUser: { id: 'u-Anna', username: 'Anna', isAdmin: false } },
		{ label: 'a non-participant', currentUser: { id: 'u-maxi', username: 'maxi', isAdmin: true } }
	])('lists the revealed tasting only, the same for $label', ({ currentUser }) => {
		const result = loadAs(currentUser);
		expect(result).toEqual({
			tastings: [
				{
					id: revealed.id,
					name: 'Tasting 2026-10-17',
					motto: 'Motto 2026-10-17',
					tastingDate: '2026-10-17',
					bottleCount: 1
				}
			]
		});
		const serialized = JSON.stringify(result);
		for (const hidden of ['2026-10-24', 'Moor', 'Erklärung', revealed.slug]) {
			expect(serialized).not.toContain(hidden);
		}
	});

	it('lists nothing while no tasting is revealed', () => {
		vi.setSystemTime(new Date('2026-10-17T08:00:00Z'));
		expect(loadAs({ id: 'u-Anna', username: 'Anna', isAdmin: false })).toEqual({ tastings: [] });
	});

	it('refuses requests without a user', () => {
		expect(() => loadAs(null)).toThrow(expect.objectContaining({ status: 401 }));
	});
});
