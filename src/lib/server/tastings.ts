import { randomUUID } from 'node:crypto';
import { and, asc, count, countDistinct, desc, eq, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type {
	OrderEntry,
	Progress,
	RevealedBottle,
	RevealedBottleWithBreakdown,
	TastingBottle,
	TastingPhase
} from '$lib/tasting';
import { isValidTastingDate } from '$lib/validation';
import type * as Schema from './db/schema';
import { tasting, tastingBottle, tastingParticipant } from './db/schema';
import { getBerlinToday, getTastingPhase } from './tastingPhase';
import { sortForPouring, type BottleScore } from './tastingScore';
import { generateTastingToken, hashTastingToken } from './tastingToken';

type Db = BetterSQLite3Database<typeof Schema>;

/**
 * A request that breaks a tasting rule (e.g. saving after 18:00). `message`
 * is for the log, `userMessage` is safe to show in the UI.
 */
export class TastingValidationError extends Error {
	constructor(
		message: string,
		public readonly userMessage: string
	) {
		super(message);
		this.name = 'TastingValidationError';
	}
}

/**
 * Field-level check of a tasting date shared by "create" and "change date":
 * a real calendar date that is not in the past (Berlin date). Returns the
 * trimmed date or the fieldErrors code.
 */
export function validateTastingDate(
	raw: string,
	now: Date = new Date()
): { tastingDate: string; error: 'required' | 'invalid' | null } {
	const tastingDate = raw.trim();
	if (!tastingDate) return { tastingDate, error: 'required' };
	if (!isValidTastingDate(tastingDate) || tastingDate < getBerlinToday(now)) {
		return { tastingDate, error: 'invalid' };
	}
	return { tastingDate, error: null };
}

type BottleRow = typeof tastingBottle.$inferSelect;

/** Maps a DB row to the domain bottle – drops ids, slot and timestamps. */
export function toDomain(row: BottleRow): TastingBottle {
	return {
		alias: row.alias,
		distillery: row.distillery,
		bottler: row.bottler,
		bottling: row.bottling,
		age: row.age,
		whiskybaseUrl: row.whiskybaseUrl,
		smoke: row.smoke,
		cask: row.cask,
		abv: row.abv,
		value: row.value
	};
}

// ── Phase-dependent projection ──────────────────────────────────────────────
// The single place that decides which bottle fields a load may return. Hiding
// data in the template is not enough: `data` is serialized into the HTML and
// __data.json in full. Fields are picked explicitly, never spread.

function toOrder(poured: ReadonlyArray<{ alias: string }>): OrderEntry[] {
	return poured.map((b, i) => ({ position: i + 1, alias: b.alias }));
}

function toReveal(poured: ReadonlyArray<TastingBottle & BottleScore & { broughtBy: string }>) {
	return poured.map((b, i): RevealedBottleWithBreakdown => ({
		position: i + 1,
		alias: b.alias,
		distillery: b.distillery,
		bottler: b.bottler,
		bottling: b.bottling,
		age: b.age,
		whiskybaseUrl: b.whiskybaseUrl,
		smoke: b.smoke,
		cask: b.cask,
		abv: b.abv,
		value: b.value,
		broughtBy: b.broughtBy,
		score: b.score,
		breakdown: b.breakdown
	}));
}

function withoutBreakdown(bottles: RevealedBottleWithBreakdown[]): RevealedBottle[] {
	return bottles.map(({ breakdown: _breakdown, ...bottle }) => bottle);
}

/** All bottles of a tasting with their participant, in pouring order. */
function pouredBottles(db: Db, tastingId: string) {
	const rows = db
		.select({ bottle: tastingBottle, broughtBy: tastingParticipant.name })
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.where(eq(tastingParticipant.tastingId, tastingId))
		.orderBy(asc(tastingBottle.id))
		.all();
	return sortForPouring(rows.map(({ bottle, broughtBy }) => ({ ...toDomain(bottle), broughtBy })));
}

// Participants in the order the admin entered them (created in one insert,
// so created_at alone can't tell them apart).
const participantOrder = [asc(tastingParticipant.createdAt), sql`${tastingParticipant}.rowid`];

// ── Admin ───────────────────────────────────────────────────────────────────

export type NewTasting = {
	name: string;
	tastingDate: string;
	bottlesPerParticipant: number;
	participantNames: string[];
};

/** Plaintext token of a participant – only ever part of an action response. */
export type IssuedToken = { participantId: string; name: string; token: string };

/** Creates the tasting and its participants. Only the token hashes are stored. */
export function createTasting(
	db: Db,
	input: NewTasting,
	now: Date = new Date()
): { id: string; tokens: IssuedToken[] } {
	const id = randomUUID();
	const tokens = input.participantNames.map((name) => ({
		participantId: randomUUID(),
		name,
		token: generateTastingToken()
	}));

	db.transaction((tx) => {
		tx.insert(tasting)
			.values({
				id,
				name: input.name,
				tastingDate: input.tastingDate,
				bottlesPerParticipant: input.bottlesPerParticipant,
				createdAt: now
			})
			.run();
		tx.insert(tastingParticipant)
			.values(
				tokens.map((t) => ({
					id: t.participantId,
					tastingId: id,
					name: t.name,
					tokenHash: hashTastingToken(t.token),
					createdAt: now
				}))
			)
			.run();
	});

	return { id, tokens };
}

export type TastingListItem = {
	id: string;
	name: string;
	tastingDate: string;
	phase: TastingPhase;
	progress: Progress;
};

/** Management data only: name, date, phase and entry progress. */
export function listTastings(db: Db, now: Date = new Date()): TastingListItem[] {
	const counts = new Map(
		db
			.select({
				tastingId: tastingParticipant.tastingId,
				participants: countDistinct(tastingParticipant.id),
				bottles: count(tastingBottle.id)
			})
			.from(tastingParticipant)
			.leftJoin(tastingBottle, eq(tastingBottle.participantId, tastingParticipant.id))
			.groupBy(tastingParticipant.tastingId)
			.all()
			.map((c) => [c.tastingId, c])
	);

	return db
		.select()
		.from(tasting)
		.orderBy(desc(tasting.tastingDate), desc(tasting.createdAt))
		.all()
		.map((t) => {
			const c = counts.get(t.id);
			return {
				id: t.id,
				name: t.name,
				tastingDate: t.tastingDate,
				phase: getTastingPhase(t.tastingDate, now),
				progress: {
					entered: c?.bottles ?? 0,
					total: (c?.participants ?? 0) * t.bottlesPerParticipant
				}
			};
		});
}

export type StartPageSummary = {
	upcomingCount: number;
	preview: Array<TastingListItem & { isToday: boolean }>;
};

const START_PAGE_PREVIEW_SIZE = 3;

/** Not yet revealed tastings for the admin's start page card, soonest first. */
export function getStartPageSummary(db: Db, now: Date = new Date()): StartPageSummary {
	const today = getBerlinToday(now);
	const upcoming = listTastings(db, now)
		.filter((t) => t.phase !== 'revealed')
		.reverse();
	return {
		upcomingCount: upcoming.length,
		preview: upcoming
			.slice(0, START_PAGE_PREVIEW_SIZE)
			.map((t) => ({ ...t, isToday: t.tastingDate === today }))
	};
}

export type AdminParticipant = { id: string; name: string; progress: Progress };

export type AdminTastingDetail = {
	tasting: { id: string; name: string; tastingDate: string; bottlesPerParticipant: number };
	participants: AdminParticipant[];
} & (
	| { phase: 'entry' }
	| { phase: 'order'; order: OrderEntry[] }
	| { phase: 'revealed'; bottles: RevealedBottleWithBreakdown[] }
);

/**
 * The admin tastes along, so they never see more content than the
 * participants – only management data on top (names, progress) and, after the
 * reveal, the score breakdown. `null` if the tasting doesn't exist.
 */
export function getAdminTastingDetail(
	db: Db,
	id: string,
	now: Date = new Date()
): AdminTastingDetail | null {
	const t = db.select().from(tasting).where(eq(tasting.id, id)).get();
	if (!t) return null;

	const participants = db
		.select({
			id: tastingParticipant.id,
			name: tastingParticipant.name,
			entered: count(tastingBottle.id)
		})
		.from(tastingParticipant)
		.leftJoin(tastingBottle, eq(tastingBottle.participantId, tastingParticipant.id))
		.where(eq(tastingParticipant.tastingId, id))
		.groupBy(tastingParticipant.id)
		.orderBy(...participantOrder)
		.all()
		.map((p) => ({
			id: p.id,
			name: p.name,
			progress: { entered: p.entered, total: t.bottlesPerParticipant }
		}));

	const base = {
		tasting: {
			id: t.id,
			name: t.name,
			tastingDate: t.tastingDate,
			bottlesPerParticipant: t.bottlesPerParticipant
		},
		participants
	};

	const phase = getTastingPhase(t.tastingDate, now);
	switch (phase) {
		case 'entry':
			return { ...base, phase };
		case 'order':
			return { ...base, phase, order: toOrder(pouredBottles(db, id)) };
		case 'revealed':
			return { ...base, phase, bottles: toReveal(pouredBottles(db, id)) };
	}
}

/**
 * Moves the tasting to another date – only while bottles can still be entered.
 * Returns false if the tasting doesn't exist.
 */
export function updateTastingDate(
	db: Db,
	id: string,
	tastingDate: string,
	now: Date = new Date()
): boolean {
	const t = db
		.select({ tastingDate: tasting.tastingDate })
		.from(tasting)
		.where(eq(tasting.id, id))
		.get();
	if (!t) return false;
	if (getTastingPhase(t.tastingDate, now) !== 'entry') {
		throw new TastingValidationError(
			`date change rejected: tasting ${id} is past the entry phase`,
			'Das Datum lässt sich nur bis 18 Uhr am Tasting-Tag ändern.'
		);
	}
	db.update(tasting).set({ tastingDate }).where(eq(tasting.id, id)).run();
	return true;
}

/**
 * Replaces the participant's token hash, so the old link stops working at
 * once. Bottles hang on the participant and are kept. `null` if the
 * participant doesn't belong to this tasting.
 */
export function regenerateParticipantToken(
	db: Db,
	tastingId: string,
	participantId: string
): IssuedToken | null {
	const token = generateTastingToken();
	const updated = db
		.update(tastingParticipant)
		.set({ tokenHash: hashTastingToken(token) })
		.where(
			and(eq(tastingParticipant.id, participantId), eq(tastingParticipant.tastingId, tastingId))
		)
		.returning({ name: tastingParticipant.name })
		.get();
	return updated ? { participantId, name: updated.name, token } : null;
}

/** Deletes the tasting; participants, bottles and throttle rows cascade. */
export function deleteTasting(db: Db, id: string): boolean {
	return db.delete(tasting).where(eq(tasting.id, id)).run().changes > 0;
}

// ── Participant link ────────────────────────────────────────────────────────

export type TokenHolder = {
	id: string;
	name: string;
	tastingId: string;
	tastingName: string;
	tastingDate: string;
	bottlesPerParticipant: number;
};

/**
 * One single query on the token hash: unknown, deleted and replaced tokens
 * all take the same path and end in the same `null`.
 */
export function findParticipantByToken(db: Db, token: string): TokenHolder | null {
	return (
		db
			.select({
				id: tastingParticipant.id,
				name: tastingParticipant.name,
				tastingId: tasting.id,
				tastingName: tasting.name,
				tastingDate: tasting.tastingDate,
				bottlesPerParticipant: tasting.bottlesPerParticipant
			})
			.from(tastingParticipant)
			.innerJoin(tasting, eq(tasting.id, tastingParticipant.tastingId))
			.where(eq(tastingParticipant.tokenHash, hashTastingToken(token)))
			.get() ?? null
	);
}

export type OwnBottle = TastingBottle & { slot: number };

export type ParticipantView =
	| {
			phase: 'entry';
			tasting: { name: string; tastingDate: string; bottlesPerParticipant: number };
			participant: { name: string };
			bottles: OwnBottle[];
	  }
	| { phase: 'order'; tasting: { name: string; tastingDate: string }; order: OrderEntry[] }
	| {
			phase: 'revealed';
			tasting: { name: string; tastingDate: string };
			bottles: RevealedBottle[];
	  };

/**
 * What a participant link shows. Before 18:00 only the holder's own bottles
 * are even queried; afterwards the order, and after the reveal everything
 * except the admin-only score breakdown.
 */
export function getParticipantView(
	db: Db,
	holder: TokenHolder,
	now: Date = new Date()
): ParticipantView {
	const tastingInfo = { name: holder.tastingName, tastingDate: holder.tastingDate };
	const phase = getTastingPhase(holder.tastingDate, now);
	switch (phase) {
		case 'entry': {
			const bottles = db
				.select()
				.from(tastingBottle)
				.where(eq(tastingBottle.participantId, holder.id))
				.orderBy(asc(tastingBottle.slot))
				.all()
				.map((row) => ({ slot: row.slot, ...toDomain(row) }));
			return {
				phase,
				tasting: { ...tastingInfo, bottlesPerParticipant: holder.bottlesPerParticipant },
				participant: { name: holder.name },
				bottles
			};
		}
		case 'order':
			return { phase, tasting: tastingInfo, order: toOrder(pouredBottles(db, holder.tastingId)) };
		case 'revealed':
			return {
				phase,
				tasting: tastingInfo,
				bottles: withoutBreakdown(toReveal(pouredBottles(db, holder.tastingId)))
			};
	}
}

// Case-insensitive also beyond ASCII (Ä/ä) – SQLite's lower() only folds ASCII,
// so the comparison happens here instead of in SQL.
function aliasKey(alias: string): string {
	return alias.toLocaleLowerCase('de-DE');
}

/**
 * Saves a bottle into the holder's slot (insert or update). Phase, slot and
 * alias uniqueness are checked in the same transaction as the upsert, so a
 * save can't overlap with the switch at 18:00. better-sqlite3 runs writes one
 * after another, so there is no race on the alias check either.
 *
 * Returns 'alias-taken' if another bottle of the tasting uses the alias;
 * throws TastingValidationError if the entry phase is over or the slot
 * doesn't exist.
 */
export function saveBottle(
	db: Db,
	holder: Pick<TokenHolder, 'id' | 'tastingId'>,
	slot: number,
	bottle: TastingBottle,
	now: Date = new Date()
): 'saved' | 'alias-taken' {
	return db.transaction((tx) => {
		const t = tx
			.select({
				tastingDate: tasting.tastingDate,
				bottlesPerParticipant: tasting.bottlesPerParticipant
			})
			.from(tasting)
			.where(eq(tasting.id, holder.tastingId))
			.get();
		if (!t || getTastingPhase(t.tastingDate, now) !== 'entry') {
			throw new TastingValidationError(
				`save rejected: tasting ${holder.tastingId} is past the entry phase`,
				'Die Eingabe ist geschlossen, deine Änderung wurde nicht gespeichert.'
			);
		}
		// Number.isInteger also catches NaN from a tampered form field.
		if (!Number.isInteger(slot) || slot < 1 || slot > t.bottlesPerParticipant) {
			throw new TastingValidationError(
				`save rejected: slot ${slot} out of range`,
				'Diese Flasche gibt es in diesem Tasting nicht.'
			);
		}

		const wanted = aliasKey(bottle.alias);
		const taken = tx
			.select({
				alias: tastingBottle.alias,
				participantId: tastingBottle.participantId,
				slot: tastingBottle.slot
			})
			.from(tastingBottle)
			.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
			.where(eq(tastingParticipant.tastingId, holder.tastingId))
			.all()
			.some(
				(other) =>
					!(other.participantId === holder.id && other.slot === slot) &&
					aliasKey(other.alias) === wanted
			);
		if (taken) return 'alias-taken';

		tx.insert(tastingBottle)
			.values({ id: randomUUID(), participantId: holder.id, slot, ...bottle, updatedAt: now })
			.onConflictDoUpdate({
				target: [tastingBottle.participantId, tastingBottle.slot],
				set: { ...bottle, updatedAt: now }
			})
			.run();
		return 'saved';
	});
}
