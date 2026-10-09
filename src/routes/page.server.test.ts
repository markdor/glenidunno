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

/** Participants are users now. */
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

type Arg = Parameters<typeof load>[0];

function loadAs(currentUser: unknown) {
	return load({ locals: { user: currentUser, session: null } } as unknown as Arg);
}

beforeEach(() => {
	// Saturday 24.10.2026, 10:00 in Berlin: the tasting is today, still in entry.
	vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
	db.delete(tasting).run();
	insertUsers('Anna', 'Ben', 'Cem');
	const { slug } = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 2,
		participantUserIds: ['u-Anna', 'u-Ben', 'u-Cem']
	});
	saveBottle(db, findParticipant(db, slug, 'u-Anna')!, 1, {
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
	});
});

afterEach(() => {
	vi.useRealTimers();
});

describe('start page load', () => {
	it('returns no tasting data for non-admins', () => {
		const result = loadAs({ id: 'u', username: 'maxi', isAdmin: false });
		expect(result).toEqual({ tastingSummary: null });
		expect(JSON.stringify(result)).not.toContain('Herbst');
	});

	it('gives the admin a summary without any bottle content', () => {
		const result = loadAs({ id: 'a', username: 'admin', isAdmin: true });
		expect(result).toEqual({
			tastingSummary: {
				upcomingCount: 1,
				preview: [
					{
						id: expect.any(String),
						name: 'Herbst-Tasting',
						tastingDate: '2026-10-24',
						phase: 'entry',
						progress: { entered: 1, total: 6 },
						isToday: true
					}
				]
			}
		});
		expect(JSON.stringify(result)).not.toContain('Nebel');
		expect(JSON.stringify(result)).not.toContain('Ardbeg');
	});
});
