import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { eq } from 'drizzle-orm';
import type { TastingBottle } from '$lib/tasting';
import { SHARE_TOKEN_RE } from '$lib/validation';
import { runMigrations } from './db/migrate';
import * as schema from './db/schema';
import {
	createShare,
	findOwnBottle,
	revokeShare,
	revokeShareByToken,
	revokeSharesOfUser
} from './bottleShares';
import {
	createTasting,
	deleteTasting,
	findParticipant,
	openOrderEarly,
	revealEarly,
	saveBottle
} from './tastings';

let db: BetterSQLite3Database<typeof schema>;

// Tasting on Saturday 24.10.2026: the order from 18:00, the reveal on Sunday 9:00.
const ENTRY = new Date('2026-10-20T10:00:00Z');
const ORDER = new Date('2026-10-24T16:00:00Z');
const REVEALED = new Date('2026-10-25T08:00:00Z');

const BOTTLE: TastingBottle = {
	alias: 'Nebel',
	distillery: 'Ardbeg',
	bottler: null,
	bottling: null,
	age: null,
	whiskybaseUrl: null,
	smoke: 5,
	cask: 3,
	abv: 54.2,
	value: 4
};

function insertUser(id: string, username: string) {
	db.insert(schema.user)
		.values({
			id,
			name: username,
			email: `${username.toLowerCase()}@example.com`,
			username,
			createdAt: ENTRY,
			updatedAt: ENTRY
		})
		.run();
}

/** A tasting of Anna and Ben with one bottle each; returns the bottle ids. */
function setup() {
	const { id, slug } = createTasting(
		db,
		{ tastingDate: '2026-10-24', participantUserIds: ['u-anna', 'u-ben'] },
		ENTRY
	);
	const bottleOf = (userId: string, alias: string) => {
		const holder = findParticipant(db, slug, userId)!;
		saveBottle(db, holder, 1, { ...BOTTLE, alias }, ENTRY);
		return db
			.select({ id: schema.tastingBottle.id })
			.from(schema.tastingBottle)
			.where(eq(schema.tastingBottle.participantId, holder.id))
			.get()!.id;
	};
	return { id, anna: bottleOf('u-anna', 'Nebel'), ben: bottleOf('u-ben', 'Torf') };
}

function shareRows() {
	return db.select().from(schema.tastingBottleShare).all();
}

beforeEach(() => {
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	db = drizzle(sqlite, { schema });
	insertUser('u-anna', 'Anna');
	insertUser('u-ben', 'Ben');
});

describe('findOwnBottle', () => {
	it('finds the user’s own bottle with its participation, nobody else’s', () => {
		const { anna } = setup();
		expect(findOwnBottle(db, anna, 'u-anna')).toEqual({ participantId: expect.any(String) });
		expect(findOwnBottle(db, anna, 'u-ben')).toBeNull();
		expect(findOwnBottle(db, 'unknown', 'u-anna')).toBeNull();
	});
});

describe('createShare', () => {
	it('creates an unguessable token for the own bottle of a revealed tasting', () => {
		const { anna } = setup();
		const token = createShare(db, anna, 'u-anna', REVEALED);
		expect(token).toMatch(SHARE_TOKEN_RE);
		expect(shareRows()).toEqual([{ token, bottleId: anna, createdAt: REVEALED }]);
	});

	it('refuses before the reveal – also while the order is out', () => {
		const { anna } = setup();
		expect(createShare(db, anna, 'u-anna', ENTRY)).toBeNull();
		expect(createShare(db, anna, 'u-anna', ORDER)).toBeNull();
		expect(shareRows()).toEqual([]);
	});

	it('counts a reveal the admin brought forward', () => {
		const { id, anna } = setup();
		// The admin's buttons: the order first, then the reveal – before 18:00.
		expect(openOrderEarly(db, id, ENTRY)).toBe(true);
		expect(revealEarly(db, id, ENTRY)).toBe(true);
		expect(createShare(db, anna, 'u-anna', ENTRY)).toMatch(SHARE_TOKEN_RE);
	});

	it('refuses somebody else’s bottle and an unknown one', () => {
		const { anna } = setup();
		expect(createShare(db, anna, 'u-ben', REVEALED)).toBeNull();
		expect(createShare(db, 'unknown', 'u-anna', REVEALED)).toBeNull();
		expect(shareRows()).toEqual([]);
	});

	it('keeps the existing link instead of creating a second one', () => {
		const { anna } = setup();
		const first = createShare(db, anna, 'u-anna', REVEALED);
		expect(createShare(db, anna, 'u-anna', REVEALED)).toBe(first);
		expect(shareRows()).toHaveLength(1);
	});
});

describe('revokeShare', () => {
	it('deletes the own link, and sharing again creates a new token', () => {
		const { anna } = setup();
		const first = createShare(db, anna, 'u-anna', REVEALED);
		expect(revokeShare(db, anna, 'u-anna')).toBe(true);
		expect(shareRows()).toEqual([]);

		const second = createShare(db, anna, 'u-anna', REVEALED);
		expect(second).toMatch(SHARE_TOKEN_RE);
		expect(second).not.toBe(first);
	});

	it('counts a bottle without a link as revoked', () => {
		const { anna } = setup();
		expect(revokeShare(db, anna, 'u-anna')).toBe(true);
	});

	it('leaves somebody else’s link alone', () => {
		const { anna } = setup();
		createShare(db, anna, 'u-anna', REVEALED);
		expect(revokeShare(db, anna, 'u-ben')).toBe(false);
		expect(shareRows()).toHaveLength(1);
	});
});

describe('revokeShareByToken', () => {
	it('revokes any link by its token, once', () => {
		const { anna } = setup();
		const token = createShare(db, anna, 'u-anna', REVEALED)!;
		expect(revokeShareByToken(db, token)).toBe(true);
		expect(revokeShareByToken(db, token)).toBe(false);
		expect(shareRows()).toEqual([]);
	});
});

describe('revokeSharesOfUser', () => {
	it('revokes all links of the user’s bottles and nobody else’s', () => {
		const { anna, ben } = setup();
		createShare(db, anna, 'u-anna', REVEALED);
		const benToken = createShare(db, ben, 'u-ben', REVEALED);
		expect(revokeSharesOfUser(db, 'u-anna')).toBe(1);
		expect(shareRows().map((row) => row.token)).toEqual([benToken]);
	});
});

describe('share links and their tasting', () => {
	it('disappear with the tasting', () => {
		const { id, anna } = setup();
		createShare(db, anna, 'u-anna', REVEALED);
		deleteTasting(db, id);
		expect(shareRows()).toEqual([]);
	});

	it('reject a token of the wrong length', () => {
		const { anna } = setup();
		expect(() =>
			db
				.insert(schema.tastingBottleShare)
				.values({ token: 'short', bottleId: anna, createdAt: REVEALED })
				.run()
		).toThrow(/CHECK constraint failed/);
	});
});
