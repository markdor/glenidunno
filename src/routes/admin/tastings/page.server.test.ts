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
import {
	createTasting,
	findParticipantByToken,
	saveBottle,
	type TastingListItem
} from '$lib/server/tastings';
import { load } from './+page.server';

const ADMIN = { id: 'admin-id', username: 'admin', isAdmin: true };

function loadAs(user: unknown) {
	return load({ locals: { user, session: null } } as unknown as Parameters<typeof load>[0]) as {
		tastings: TastingListItem[];
	};
}

beforeEach(() => {
	vi.setSystemTime(new Date('2026-10-20T10:00:00Z'));
	db.delete(tasting).run();
});

afterEach(() => {
	vi.useRealTimers();
});

describe('admin tastings list load', () => {
	it('throws 401 without a session', () => {
		expect(() => loadAs(null)).toThrowError(expect.objectContaining({ status: 401 }));
	});

	it('throws 403 for a non-admin', () => {
		expect(() => loadAs({ id: 'u', username: 'u', isAdmin: false })).toThrowError(
			expect.objectContaining({ status: 403 })
		);
	});

	it('lists management data only – no aliases, bottle names or tokens', () => {
		const { tokens } = createTasting(db, {
			name: 'Herbst-Tasting',
			tastingDate: '2026-10-24',
			bottlesPerParticipant: 2,
			participantNames: ['Anna', 'Ben']
		});
		const anna = findParticipantByToken(db, tokens[0].token)!;
		saveBottle(db, anna, 1, {
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

		const result = loadAs(ADMIN);
		expect(result.tastings).toEqual([
			{
				id: expect.any(String),
				name: 'Herbst-Tasting',
				tastingDate: '2026-10-24',
				phase: 'entry',
				progress: { entered: 1, total: 4 }
			}
		]);
		const serialized = JSON.stringify(result);
		for (const hidden of ['Nebel', 'Ardbeg', tokens[0].token]) {
			expect(serialized).not.toContain(hidden);
		}
	});
});
