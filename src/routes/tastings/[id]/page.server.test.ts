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

/** Every missing page gets exactly this response. */
const NOT_FOUND_REDIRECT = { status: 303, location: '/?notice=not-found' };

const ANNA = { id: 'u-Anna', username: 'Anna', isAdmin: false };
const MAXI = { id: 'u-maxi', username: 'maxi', isAdmin: true };

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
		{ name: `Tasting ${tastingDate}`, tastingDate, participantUserIds: ['u-Anna', 'u-Ben'] },
		BEFORE
	);
	saveBottle(
		db,
		findParticipant(db, created.slug, 'u-Anna')!,
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

function loadAs(currentUser: unknown, id: string) {
	return load({
		locals: { user: currentUser, session: null },
		params: { id }
	} as unknown as Arg) as { detail: { slug: string | null; bottles: Array<{ alias: string }> } };
}

let revealed: { id: string; slug: string };
let upcoming: { id: string; slug: string };

beforeEach(() => {
	db.delete(tasting).run();
	insertUsers('Anna', 'Ben', 'maxi');
	revealed = tastingWithBottle('2026-10-17', 'Moor', 'Lagavulin');
	upcoming = tastingWithBottle('2026-10-24', 'Nebel', 'Ardbeg');
	// Saturday 24.10.2026, 18:30 in Berlin: the order of the second tasting is
	// out, the first one has been revealed for a week.
	vi.setSystemTime(new Date('2026-10-24T16:30:00Z'));
});

afterEach(() => {
	vi.useRealTimers();
});

describe('tasting history detail load', () => {
	it('gives a participant the reveal with the slug for the presentations', () => {
		const { detail } = loadAs(ANNA, revealed.id);
		expect(detail).toMatchObject({
			tasting: { name: 'Tasting 2026-10-17', tastingDate: '2026-10-17' },
			slug: revealed.slug,
			archived: false,
			bottles: [{ alias: 'Moor', distillery: 'Lagavulin', broughtBy: 'Anna', position: 1 }]
		});
	});

	it('gives everybody else the same reveal without the slug', () => {
		const result = loadAs(MAXI, revealed.id);
		expect(result.detail.slug).toBeNull();
		expect(result.detail.bottles.map((b) => b.alias)).toEqual(['Moor']);
		expect(JSON.stringify(result)).not.toContain(revealed.slug);
	});

	it.each([
		{ label: 'a tasting not revealed yet', id: () => upcoming.id },
		{ label: 'an unknown tasting', id: () => 'unknown' }
	])('redirects to the dashboard for $label, also its participants', ({ id }) => {
		for (const currentUser of [ANNA, MAXI]) {
			expect(() => loadAs(currentUser, id())).toThrow(expect.objectContaining(NOT_FOUND_REDIRECT));
		}
	});

	it('refuses requests without a user', () => {
		expect(() => loadAs(null, revealed.id)).toThrow(expect.objectContaining({ status: 401 }));
	});
});
