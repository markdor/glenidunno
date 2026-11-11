import { randomBytes } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { SHARE_TOKEN_BYTES } from '$lib/validation';
import type * as Schema from './db/schema';
import { tasting, tastingBottle, tastingBottleShare, tastingParticipant } from './db/schema';
import { getTastingPhase } from './tastingPhase';

// Writing side of the public share links (issue #58). What a link shows is
// decided by the projection in tastings.ts (getSharedBottle). The token is a
// secret: never log it.

type Db = BetterSQLite3Database<typeof Schema>;
/** The database or a transaction on it – both can run the same queries. */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * The user's own bottle: the participation it belongs to – the write limit is
 * kept per participant – or `null` for an unknown bottle and for anybody
 * else's. The owner comes from the login only, never from the form.
 */
export function findOwnBottle(
	db: Executor,
	bottleId: string,
	userId: string
): { participantId: string } | null {
	return (
		db
			.select({ participantId: tastingParticipant.id })
			.from(tastingBottle)
			.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
			.where(and(eq(tastingBottle.id, bottleId), eq(tastingParticipant.userId, userId)))
			.get() ?? null
	);
}

/**
 * Shares the user's own bottle of a revealed tasting and returns the link's
 * token – the existing one if the bottle is shared already (a second tab), so
 * a bottle never has two links. `null` for somebody else's bottle and before
 * the reveal: a link must never show a bottle the tasting hasn't revealed.
 * Owner and phase are checked in the same transaction as the insert.
 */
export function createShare(
	db: Db,
	bottleId: string,
	userId: string,
	now: Date = new Date()
): string | null {
	return db.transaction((tx) => {
		const row = tx
			.select({
				token: tastingBottleShare.token,
				tastingDate: tasting.tastingDate,
				orderOpenedAt: tasting.orderOpenedAt,
				revealedAt: tasting.revealedAt
			})
			.from(tastingBottle)
			.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
			.innerJoin(tasting, eq(tasting.id, tastingParticipant.tastingId))
			.leftJoin(tastingBottleShare, eq(tastingBottleShare.bottleId, tastingBottle.id))
			.where(and(eq(tastingBottle.id, bottleId), eq(tastingParticipant.userId, userId)))
			.get();
		if (!row || getTastingPhase(row.tastingDate, now, row) !== 'revealed') return null;
		if (row.token) return row.token;

		const token = randomBytes(SHARE_TOKEN_BYTES).toString('base64url');
		tx.insert(tastingBottleShare).values({ token, bottleId, createdAt: now }).run();
		return token;
	});
}

/**
 * Revokes the link of the user's own bottle. A bottle without a link counts as
 * revoked (a second tab); `false` only for somebody else's bottle.
 */
export function revokeShare(db: Db, bottleId: string, userId: string): boolean {
	return db.transaction((tx) => {
		if (!findOwnBottle(tx, bottleId, userId)) return false;
		tx.delete(tastingBottleShare).where(eq(tastingBottleShare.bottleId, bottleId)).run();
		return true;
	});
}

/** The admin revokes any link by its token. Returns whether there was one. */
export function revokeShareByToken(db: Executor, token: string): boolean {
	return db.delete(tastingBottleShare).where(eq(tastingBottleShare.token, token)).run().changes > 0;
}

/**
 * Revokes every link of the user's bottles – part of deactivating the user, in
 * the same transaction. Returns how many links there were.
 */
export function revokeSharesOfUser(db: Executor, userId: string): number {
	const ownBottles = db
		.select({ id: tastingBottle.id })
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.where(eq(tastingParticipant.userId, userId));
	return db.delete(tastingBottleShare).where(inArray(tastingBottleShare.bottleId, ownBottles)).run()
		.changes;
}
