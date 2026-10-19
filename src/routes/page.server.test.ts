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

function loadAs(currentUser: unknown, path = '/') {
	return load({
		locals: { user: currentUser, session: null },
		url: new URL(path, 'http://localhost')
	} as unknown as Arg);
}

let slug: string;

beforeEach(() => {
	// Saturday 24.10.2026, 10:00 in Berlin: the tasting is today, still in entry.
	vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
	db.delete(tasting).run();
	insertUsers('Anna', 'Ben', 'Cem');
	({ slug } = createTasting(db, {
		name: 'Herbst-Tasting',
		motto: 'Islay gegen den Rest',
		mottoDescription: 'Eine Flasche von Islay.',
		tastingDate: '2026-10-24',
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
			motto: 'Islay gegen den Rest',
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
	// Cards and summary show the motto heading only.
	expect(serialized).not.toContain('Eine Flasche von Islay.');
}

describe('start page load', () => {
	it('returns no tasting data for users without a participation', () => {
		const result = loadAs({ id: 'u', username: 'maxi', isAdmin: false });
		expect(result).toEqual({
			nextTasting: null,
			lastTasting: null,
			tastingSummary: null,
			notice: null
		});
		expect(JSON.stringify(result)).not.toContain('Herbst');
		expect(JSON.stringify(result)).not.toContain(slug);
	});

	it('gives a participant the own tasting as the next one, with the own progress only', () => {
		const result = loadAs({ id: 'u-Anna', username: 'Anna', isAdmin: false });
		expect(result).toEqual({
			nextTasting: {
				slug,
				name: 'Herbst-Tasting',
				motto: 'Islay gegen den Rest',
				tastingDate: '2026-10-24',
				phase: 'entry',
				isToday: true,
				progress: { entered: 1, total: 2 }
			},
			lastTasting: null,
			tastingSummary: null,
			notice: null
		});
		expectNoContent(result);
	});

	it('moves the tasting to the last one once it is revealed, still without content', () => {
		// Sunday 9:00 in Berlin.
		vi.setSystemTime(new Date('2026-10-25T08:00:00Z'));
		const result = loadAs({ id: 'u-Anna', username: 'Anna', isAdmin: false });
		expect(result).toEqual({
			nextTasting: null,
			lastTasting: {
				slug,
				name: 'Herbst-Tasting',
				motto: 'Islay gegen den Rest',
				tastingDate: '2026-10-24'
			},
			tastingSummary: null,
			notice: null
		});
		expectNoContent(result);
	});

	it('gives the admin a summary without any bottle content, but no cards without a participation', () => {
		const result = loadAs({ id: 'a', username: 'admin', isAdmin: true });
		// The summary carries the motto heading like the list of all tastings.
		expect(result).toEqual({
			nextTasting: null,
			lastTasting: null,
			tastingSummary: summary,
			notice: null
		});
		// The slug isn't derived from the list of all tastings.
		expect(JSON.stringify(result)).not.toContain(slug);
		expectNoContent(result);
	});

	it('gives a participating admin both the cards and the summary', () => {
		const result = loadAs({ id: 'u-Ben', username: 'Ben', isAdmin: true });
		expect(result).toEqual({
			nextTasting: expect.objectContaining({ slug, progress: { entered: 0, total: 2 } }),
			lastTasting: null,
			tastingSummary: summary,
			notice: null
		});
		expectNoContent(result);
	});

	it('refuses requests without a user', () => {
		expect(() => loadAs(null)).toThrow(expect.objectContaining({ status: 401 }));
	});
});

describe('start page notice', () => {
	const maxi = { id: 'u', username: 'maxi', isAdmin: false };

	it('passes through the not-found notice after a redirect', () => {
		expect(loadAs(maxi, '/?notice=not-found')).toMatchObject({ notice: 'not-found' });
	});

	it.each([
		'/?notice=forbidden',
		'/?notice=toString',
		'/?notice=Diese%20Seite',
		'/?error=not-found'
	])('drops anything not whitelisted (%s)', (path) => {
		expect(loadAs(maxi, path)).toMatchObject({ notice: null });
	});
});
