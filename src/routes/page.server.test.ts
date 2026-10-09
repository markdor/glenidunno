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

let slug: string;

beforeEach(() => {
	// Saturday 24.10.2026, 10:00 in Berlin: the tasting is today, still in entry.
	vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
	db.delete(tasting).run();
	insertUsers('Anna', 'Ben', 'Cem');
	({ slug } = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 2,
		participantUserIds: ['u-Anna', 'u-Ben', 'u-Cem']
	}));
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

const summary = {
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
};

function expectNoContent(result: unknown) {
	const serialized = JSON.stringify(result);
	expect(serialized).not.toContain('Nebel');
	expect(serialized).not.toContain('Ardbeg');
}

describe('start page load', () => {
	it('returns no tasting data for users without a participation', () => {
		const result = loadAs({ id: 'u', username: 'maxi', isAdmin: false });
		expect(result).toEqual({ heroTasting: null, tastingSummary: null });
		expect(JSON.stringify(result)).not.toContain('Herbst');
		expect(JSON.stringify(result)).not.toContain(slug);
	});

	it('gives a participant the own tasting as hero, with the own progress only', () => {
		const result = loadAs({ id: 'u-Anna', username: 'Anna', isAdmin: false });
		expect(result).toEqual({
			heroTasting: {
				slug,
				name: 'Herbst-Tasting',
				tastingDate: '2026-10-24',
				phase: 'entry',
				isToday: true,
				progress: { entered: 1, total: 2 }
			},
			tastingSummary: null
		});
		expectNoContent(result);
	});

	it('gives the admin a summary without any bottle content, but no hero without a participation', () => {
		const result = loadAs({ id: 'a', username: 'admin', isAdmin: true });
		expect(result).toEqual({ heroTasting: null, tastingSummary: summary });
		// The slug isn't derived from the list of all tastings.
		expect(JSON.stringify(result)).not.toContain(slug);
		expectNoContent(result);
	});

	it('gives a participating admin both the hero and the summary', () => {
		const result = loadAs({ id: 'u-Ben', username: 'Ben', isAdmin: true });
		expect(result).toEqual({
			heroTasting: expect.objectContaining({ slug, progress: { entered: 0, total: 2 } }),
			tastingSummary: summary
		});
		expectNoContent(result);
	});

	it('refuses requests without a user', () => {
		expect(() => loadAs(null)).toThrow(expect.objectContaining({ status: 401 }));
	});
});
