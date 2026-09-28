import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('$lib/server/db', async () => {
	const Database = (await import('better-sqlite3')).default;
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { migrate } = await import('drizzle-orm/better-sqlite3/migrator');
	const schema = await import('$lib/server/db/schema');
	const sqlite = new Database(':memory:');
	sqlite.pragma('foreign_keys = ON');
	const db = drizzle(sqlite, { schema });
	migrate(db, { migrationsFolder: './drizzle' });
	return { db, schema };
});

import { db } from '$lib/server/db';
import { tasting } from '$lib/server/db/schema';
import { createTasting, findParticipantByToken, saveBottle } from '$lib/server/tastings';
import { load } from './+page.server';

type Arg = Parameters<typeof load>[0];

function loadAs(user: unknown) {
	return load({ locals: { user, session: null } } as unknown as Arg);
}

beforeEach(() => {
	// Saturday 24.10.2026, 10:00 in Berlin: the tasting is today, still in entry.
	vi.setSystemTime(new Date('2026-10-24T08:00:00Z'));
	db.delete(tasting).run();
	const { tokens } = createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		bottlesPerParticipant: 2,
		participantNames: ['Anna', 'Ben', 'Cem']
	});
	saveBottle(db, findParticipantByToken(db, tokens[0].token)!, 1, {
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
