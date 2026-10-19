import { randomInt, randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
	isViewablePresentation,
	normalizeScoreFactors,
	participantLabel,
	SCORE_RULES,
	type ArchivedRevealedBottle,
	type DashboardLastTasting,
	type DashboardTasting,
	type HistoryBottle,
	type ManualPhaseChanges,
	type NormalizedScoreFactors,
	type OrderEntry,
	type PresentationRef,
	type Progress,
	type Reveal,
	type RevealedBottle,
	type ScoreRules,
	type Statistics,
	type TastingBottle,
	type TastingHistoryDetail,
	type TastingHistoryItem,
	type TastingPhase
} from '$lib/tasting';
import {
	isValidTastingDate,
	TASTING_BOTTLE_SLOTS,
	TASTING_MOTTO_DESCRIPTION_LENGTH,
	TASTING_MOTTO_LENGTH
} from '$lib/validation';
import type { WorldMapData } from '$lib/worldMap';
import { distinctDistilleryNames, nameKey } from '$lib/distilleryNames';
import type * as Schema from './db/schema';
import {
	distillery,
	tasting,
	tastingBottle,
	tastingParticipant,
	tastingSlugAdjective,
	tastingSlugAnimal,
	user
} from './db/schema';
import {
	fileNameKey,
	presentationBaseName,
	presentationExtension,
	uniquePresentationFileName,
	type FileChange
} from './presentationFiles';
import { getBerlinToday, getTastingPhase, isTastingReleased } from './tastingPhase';
import { buildStatistics, numberBottles } from './statistics';
import { buildWorldMap } from './worldMap';
import type { PendingUpload, StoredPresentation } from './tastingMedia';
import { sortForPouring } from './tastingScore';

type Db = BetterSQLite3Database<typeof Schema>;
/** The database or a transaction on it – both can run the same queries. */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

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

export type TastingMotto = { motto: string | null; mottoDescription: string | null };

/**
 * Field-level check of the optional motto shared by "create" and "change
 * motto": a heading and a multi-line description, both trimmed, empty means
 * none (`null`). The description keeps its line breaks (normalized to `\n`)
 * and needs a heading – without one the heading reports `required`. The only
 * length guard: neither column has a CHECK constraint.
 */
export function validateTastingMotto(
	rawMotto: string,
	rawDescription: string
): TastingMotto & {
	fieldErrors: { motto?: 'invalid' | 'required'; mottoDescription?: 'invalid' };
} {
	const motto = rawMotto.trim() || null;
	const mottoDescription = rawDescription.replace(/\r\n?/g, '\n').trim() || null;
	const fieldErrors: { motto?: 'invalid' | 'required'; mottoDescription?: 'invalid' } = {};
	if (motto && motto.length > TASTING_MOTTO_LENGTH.max) fieldErrors.motto = 'invalid';
	else if (!motto && mottoDescription) fieldErrors.motto = 'required';
	if (mottoDescription && mottoDescription.length > TASTING_MOTTO_DESCRIPTION_LENGTH.max) {
		fieldErrors.mottoDescription = 'invalid';
	}
	return { motto, mottoDescription, fieldErrors };
}

type BottleRow = typeof tastingBottle.$inferSelect;

/**
 * A bottle entered in the app, not an archived one from the tasting history:
 * the CHECK tasting_bottle_archived_factors keeps its smoke, cask and value set.
 */
type ActiveBottleRow = BottleRow & { archived: false; smoke: number; cask: number; value: number };

function isActiveBottle(row: BottleRow): row is ActiveBottleRow {
	return !row.archived && row.smoke !== null && row.cask !== null && row.value !== null;
}

/** Maps a DB row to the domain bottle – drops ids, slot and timestamps. */
export function toDomain(row: ActiveBottleRow): TastingBottle {
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

function toOrder(
	poured: ReadonlyArray<{ alias: string; score: number; presentation: PresentationRef | null }>
): OrderEntry[] {
	return poured.map((b, i) => ({
		position: i + 1,
		alias: b.alias,
		score: b.score,
		// The link only: the original file name waits for the reveal.
		presentation: b.presentation && {
			bottleId: b.presentation.bottleId,
			viewable: b.presentation.viewable
		}
	}));
}

/** Score and factor shares of a bottle in the pouring order. */
type Pour = { score: number; shares: NormalizedScoreFactors };

type PouredBottle = TastingBottle &
	Pour & { broughtBy: string; presentation: PresentationRef | null };

function toReveal(poured: ReadonlyArray<PouredBottle>) {
	return poured.map((b, i): RevealedBottle => ({
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
		shares: {
			smoke: b.shares.smoke,
			cask: b.shares.cask,
			abv: b.shares.abv,
			value: b.shares.value
		},
		presentation: b.presentation
	}));
}

type BottleWithBringer = { bottle: BottleRow; username: string; deactivatedAt: Date | null };

/**
 * The reveal of a tasting with archived bottles: without smoke, cask and value
 * there is neither a score nor an order, so the bottles are listed by bringer
 * (compared here, SQLite only compares bytes) and slot. Picked explicitly – a
 * spread would put the NULL factors into the payload.
 */
function toArchivedReveal(
	rows: ReadonlyArray<BottleWithBringer>,
	presentations: boolean
): ArchivedRevealedBottle[] {
	return [...rows]
		.sort((a, b) => a.username.localeCompare(b.username, 'de-DE') || a.bottle.slot - b.bottle.slot)
		.map(({ bottle, username, deactivatedAt }): ArchivedRevealedBottle => ({
			id: bottle.id,
			alias: bottle.alias,
			distillery: bottle.distillery,
			bottler: bottle.bottler,
			bottling: bottle.bottling,
			age: bottle.age,
			whiskybaseUrl: bottle.whiskybaseUrl,
			abv: bottle.abv,
			broughtBy: participantLabel(username, deactivatedAt),
			presentation: presentations ? presentationRef(bottle) : null
		}));
}

/**
 * All bottles of a tasting with their participant, in pouring order. As soon
 * as one of them is archived (imported from the tasting history without
 * smoke, cask and value), there is no order: then all of them come as
 * archived bottles, see toArchivedReveal(). Without `presentations` (a viewer
 * who didn't take part) no bottle carries one: the download runs through the
 * participant's link, and the original file name stays on the server.
 */
function pouredBottles(
	db: Db,
	tastingId: string,
	presentations = true
):
	| { archived: false; bottles: PouredBottle[]; rules: ScoreRules }
	| { archived: true; bottles: ArchivedRevealedBottle[] } {
	const frozenRules = db
		.select({ pourRules: tasting.pourRules })
		.from(tasting)
		.where(eq(tasting.id, tastingId))
		.get()?.pourRules;
	const rows = db
		.select({
			bottle: tastingBottle,
			username: user.username,
			deactivatedAt: user.deactivatedAt
		})
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.innerJoin(user, eq(user.id, tastingParticipant.userId))
		.where(eq(tastingParticipant.tastingId, tastingId))
		.orderBy(asc(tastingBottle.id))
		.all();
	const active = rows.flatMap(({ bottle, username, deactivatedAt }) =>
		isActiveBottle(bottle)
			? [
					{
						...toDomain(bottle),
						broughtBy: participantLabel(username, deactivatedAt),
						presentation: presentations ? presentationRef(bottle) : null,
						frozen: frozenPour(bottle)
					}
				]
			: []
	);
	if (active.length !== rows.length) {
		return { archived: true, bottles: toArchivedReveal(rows, presentations) };
	}
	// Frozen with the order like positions and scores, the current ones before.
	const rules = frozenRules ? (JSON.parse(frozenRules) as ScoreRules) : SCORE_RULES;
	return { archived: false, bottles: inPouringOrder(active), rules };
}

type FrozenPour = Pour & { position: number };

function frozenPour(bottle: BottleRow): FrozenPour | null {
	const {
		pourPosition: position,
		pourScore: score,
		pourSmokeShare: smoke,
		pourCaskShare: cask,
		pourAbvShare: abv,
		pourValueShare: value
	} = bottle;
	return position !== null &&
		score !== null &&
		smoke !== null &&
		cask !== null &&
		abv !== null &&
		value !== null
		? { position, score, shares: { smoke, cask, abv, value } }
		: null;
}

/**
 * Bottles in pouring order with their scores and factor shares. Once the
 * order came out, as frozen then (freezePouringOrder): a later change of
 * weights, groups, normalization or tie-breakers changes neither the order
 * nor the score chart of a tasting that was poured already. Computed with the
 * current algorithm only before that.
 */
function inPouringOrder<T extends TastingBottle & { frozen: FrozenPour | null }>(
	bottles: T[]
): Array<T & Pour> {
	if (!bottles.every((b): b is T & { frozen: FrozenPour } => b.frozen !== null)) {
		return sortForPouring(bottles).map((b) => ({ ...b, shares: normalizeScoreFactors(b) }));
	}
	return bottles
		.map((b) => ({ ...b, score: b.frozen.score, shares: b.frozen.shares }))
		.sort((a, b) => a.frozen.position - b.frozen.position);
}

/**
 * Freezes a tasting's pouring order as the algorithm computes it now:
 * position, score and factor shares stored with each bottle, the rules the
 * explainer tile shows (SCORE_RULES) with the tasting – pouredBottles reads
 * them from then on. Runs once the order comes out (see freezeDueOrders), the
 * bottles can't change any more by then. Idempotent; a tasting with an
 * archived bottle has no order and stays as it is. Returns whether it froze
 * anything.
 */
function freezePouringOrder(db: Executor, tastingId: string): boolean {
	const rulesFrozen =
		db
			.select({ id: tasting.id })
			.from(tasting)
			.where(and(eq(tasting.id, tastingId), isNotNull(tasting.pourRules)))
			.get() !== undefined;
	const rows = db
		.select({ bottle: tastingBottle })
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.where(eq(tastingParticipant.tastingId, tastingId))
		// The same input order as pouredBottles.
		.orderBy(asc(tastingBottle.id))
		.all()
		.map((row) => row.bottle);
	if (rulesFrozen && rows.every((row) => frozenPour(row) !== null)) return false;
	const active = rows.filter(isActiveBottle);
	if (active.length !== rows.length) return false;

	sortForPouring(active.map((row) => ({ id: row.id, ...toDomain(row) }))).forEach((b, i) => {
		const shares = normalizeScoreFactors(b);
		db.update(tastingBottle)
			.set({
				pourPosition: i + 1,
				pourScore: b.score,
				pourSmokeShare: shares.smoke,
				pourCaskShare: shares.cask,
				pourAbvShare: shares.abv,
				pourValueShare: shares.value
			})
			.where(eq(tastingBottle.id, b.id))
			.run();
	});
	db.update(tasting)
		.set({ pourRules: JSON.stringify(SCORE_RULES) })
		.where(eq(tasting.id, tastingId))
		.run();
	return true;
}

/**
 * Freezes the pouring order of every tasting whose order is out – by the
 * clock or by the admin's buttons, which freeze theirs at once. Runs at
 * startup and daily at TASTING_ORDER_HOUR, so an order is frozen with the
 * algorithm of the code that showed it, before a deployment can change it.
 * Returns how many tastings it froze.
 */
export function freezeDueOrders(db: Db, now: Date = new Date()): number {
	return db.transaction(
		(tx) =>
			tx
				.select({ id: tasting.id, ...phaseColumns })
				.from(tasting)
				.all()
				.filter((t) => getTastingPhase(t.tastingDate, now, t) !== 'entry')
				.filter((t) => freezePouringOrder(tx, t.id)).length
	);
}

function presentationRef(bottle: BottleRow): PresentationRef | null {
	return bottle.presentationFile && bottle.presentationName
		? {
				bottleId: bottle.id,
				viewable: isViewablePresentation(bottle.presentationFile),
				name: bottle.presentationName
			}
		: null;
}

// Participants in the order the admin picked them (created in one insert,
// so created_at alone can't tell them apart).
const participantOrder = [asc(tastingParticipant.createdAt), sql`${tastingParticipant}.rowid`];

// Everything the phase depends on: the date and the admin's manual overrides.
const phaseColumns = {
	tastingDate: tasting.tastingDate,
	orderOpenedAt: tasting.orderOpenedAt,
	revealedAt: tasting.revealedAt
};

/**
 * Entry progress of one participant: every participant brings at least the
 * base number of bottles, a further one raises only their own target.
 */
function participantProgress(entered: number): Progress {
	return { entered, total: Math.max(TASTING_BOTTLE_SLOTS.base, entered) };
}

/** Current phase of a tasting, `null` if it doesn't exist. */
function currentPhase(db: Executor, id: string, now: Date): TastingPhase | null {
	const t = db.select(phaseColumns).from(tasting).where(eq(tasting.id, id)).get();
	return t ? getTastingPhase(t.tastingDate, now, t) : null;
}

/**
 * Whether one of the tasting's bottles is archived – reads nothing else, so
 * the entry phase can ask without querying the other participants' bottles.
 */
function hasArchivedBottles(db: Executor, tastingId: string): boolean {
	return (
		db
			.select({ id: tastingBottle.id })
			.from(tastingBottle)
			.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
			.where(and(eq(tastingParticipant.tastingId, tastingId), eq(tastingBottle.archived, true)))
			.limit(1)
			.get() !== undefined
	);
}

/**
 * Keys (fileNameKey) of all presentation file names in use, except for the
 * bottles the caller is about to rename. The database is the source of truth
 * for which names are taken in MEDIA_PATH.
 */
function takenFileNames(
	db: Executor,
	except: (bottle: { id: string; participantId: string; slot: number }) => boolean
): Set<string> {
	return new Set(
		db
			.select({
				id: tastingBottle.id,
				participantId: tastingBottle.participantId,
				slot: tastingBottle.slot,
				file: tastingBottle.presentationFile
			})
			.from(tastingBottle)
			.where(isNotNull(tastingBottle.presentationFile))
			.all()
			.filter((bottle) => !except(bottle))
			.map((bottle) => fileNameKey(bottle.file!))
	);
}

// ── Admin ───────────────────────────────────────────────────────────────────

export type NewTasting = {
	name: string;
	/** Optional, `null` (or missing) means no motto. */
	motto?: string | null;
	/** Optional explanation of the motto, only with a motto (validateTastingMotto). */
	mottoDescription?: string | null;
	tastingDate: string;
	/** Users taking part, in the order they are listed. */
	participantUserIds: string[];
};

/** A random index below `max`: crypto's randomInt, replaceable in tests. */
export type PickIndex = (max: number) => number;

/**
 * A random `<adjective>-<animal>` no other tasting uses, `null` once all
 * combinations are taken. Read inside the creating transaction, so two
 * creations can't pick the same slug (better-sqlite3 runs them one after
 * another).
 */
function pickFreeSlug(db: Executor, pick: PickIndex): string | null {
	const taken = new Set(
		db
			.select({ slug: tasting.slug })
			.from(tasting)
			.all()
			.map((t) => t.slug)
	);
	const words = (table: typeof tastingSlugAdjective | typeof tastingSlugAnimal) =>
		db
			.select({ word: table.word })
			.from(table)
			.orderBy(asc(table.word))
			.all()
			.map((row) => row.word);
	const animals = words(tastingSlugAnimal);
	const free = words(tastingSlugAdjective)
		.flatMap((adjective) => animals.map((animal) => `${adjective}-${animal}`))
		.filter((slug) => !taken.has(slug));
	return free.length > 0 ? free[pick(free.length)] : null;
}

/**
 * Creates the tasting with its participants and its one link, a free random
 * slug that never changes afterwards. Every participant must be an active
 * user – checked in the same transaction, so a user deactivated in the
 * meantime can't slip in.
 */
export function createTasting(
	db: Db,
	input: NewTasting,
	now: Date = new Date(),
	pick: PickIndex = (max) => randomInt(max)
): { id: string; slug: string } {
	const id = randomUUID();
	const userIds = [...new Set(input.participantUserIds)];

	const slug = db.transaction((tx) => {
		const active = tx
			.select({ id: user.id })
			.from(user)
			.where(and(inArray(user.id, userIds), isNull(user.deactivatedAt)))
			.all();
		if (active.length !== userIds.length) {
			throw new TastingValidationError(
				'create rejected: a participant is unknown or deactivated',
				'Mindestens eine ausgewählte Person ist nicht mehr aktiv. Lade die Seite neu und wähle erneut.'
			);
		}

		const slug = pickFreeSlug(tx, pick);
		if (!slug) {
			throw new TastingValidationError(
				'create rejected: all tasting links are taken',
				'Alle Tasting-Links sind vergeben, es lässt sich kein weiteres Tasting anlegen.'
			);
		}

		tx.insert(tasting)
			.values({
				id,
				slug,
				name: input.name,
				motto: input.motto ?? null,
				mottoDescription: input.mottoDescription ?? null,
				tastingDate: input.tastingDate,
				createdAt: now
			})
			.run();
		tx.insert(tastingParticipant)
			.values(
				userIds.map((userId) => ({ id: randomUUID(), tastingId: id, userId, createdAt: now }))
			)
			.run();
		return slug;
	});

	return { id, slug };
}

export type SelectableUser = { id: string; username: string };

/** Users the admin can pick as participants: the active ones, alphabetically. */
export function listSelectableUsers(db: Db): SelectableUser[] {
	return db
		.select({ id: user.id, username: user.username })
		.from(user)
		.where(isNull(user.deactivatedAt))
		.all()
		.sort((a, b) => a.username.localeCompare(b.username, 'de'));
}

export type TastingListItem = {
	id: string;
	name: string;
	/** The motto heading only, never its description. */
	motto: string | null;
	tastingDate: string;
	phase: TastingPhase;
	progress: Progress;
};

/**
 * Management data only: name, motto heading, date, phase and entry progress. The progress
 * adds up the participants' own targets, so a participant's third bottle
 * doesn't raise the target of the others.
 */
export function listTastings(db: Db, now: Date = new Date()): TastingListItem[] {
	const progress = new Map<string, Progress>();
	const perParticipant = db
		.select({
			tastingId: tastingParticipant.tastingId,
			entered: count(tastingBottle.id)
		})
		.from(tastingParticipant)
		.leftJoin(tastingBottle, eq(tastingBottle.participantId, tastingParticipant.id))
		.groupBy(tastingParticipant.id)
		.all();
	for (const { tastingId, entered } of perParticipant) {
		const sum = progress.get(tastingId) ?? { entered: 0, total: 0 };
		const own = participantProgress(entered);
		progress.set(tastingId, { entered: sum.entered + own.entered, total: sum.total + own.total });
	}

	return db
		.select()
		.from(tasting)
		.orderBy(desc(tasting.tastingDate), desc(tasting.createdAt))
		.all()
		.map((t) => ({
			id: t.id,
			name: t.name,
			motto: t.motto,
			tastingDate: t.tastingDate,
			phase: getTastingPhase(t.tastingDate, now, t),
			progress: progress.get(t.id) ?? { entered: 0, total: 0 }
		}));
}

export type TastingSummary = {
	upcomingCount: number;
	preview: Array<TastingListItem & { isToday: boolean }>;
};

const TASTING_PREVIEW_SIZE = 3;

/** Not yet revealed tastings for the admin page's card, soonest first. */
export function getTastingSummary(db: Db, now: Date = new Date()): TastingSummary {
	const today = getBerlinToday(now);
	const upcoming = listTastings(db, now)
		.filter((t) => t.phase !== 'revealed')
		.reverse();
	return {
		upcomingCount: upcoming.length,
		preview: upcoming
			.slice(0, TASTING_PREVIEW_SIZE)
			.map((t) => ({ ...t, isToday: t.tastingDate === today }))
	};
}

/**
 * The start page's two cards for every user: `next`, their own soonest
 * tasting that isn't revealed yet, and `last`, their own latest revealed one –
 * each `null` if there is none. Filtered on the user's own participations –
 * never derived from listTastings – so a slug only leaves the server for
 * tastings the user takes part in, the admin included. Management data only,
 * in every phase.
 */
export function getDashboardTasting(
	db: Db,
	userId: string,
	now: Date = new Date()
): { next: DashboardTasting | null; last: DashboardLastTasting | null } {
	const own = db
		.select({
			slug: tasting.slug,
			name: tasting.name,
			motto: tasting.motto,
			...phaseColumns,
			entered: count(tastingBottle.id)
		})
		.from(tastingParticipant)
		.innerJoin(tasting, eq(tasting.id, tastingParticipant.tastingId))
		.leftJoin(tastingBottle, eq(tastingBottle.participantId, tastingParticipant.id))
		.where(eq(tastingParticipant.userId, userId))
		.groupBy(tastingParticipant.id)
		// created_at only has second precision: the rowid keeps tastings on the
		// same date in creation order.
		.orderBy(asc(tasting.tastingDate), asc(tasting.createdAt), sql`${tasting}.rowid`)
		.all();

	// The admin's buttons can reveal a tasting ahead of an earlier one, so the
	// phase decides per tasting instead of the date alone.
	const today = getBerlinToday(now);
	let next: DashboardTasting | null = null;
	let last: DashboardLastTasting | null = null;
	for (const t of own) {
		const phase = getTastingPhase(t.tastingDate, now, t);
		if (phase === 'revealed') {
			// Sorted by date, so the latest revealed one is the last to get here.
			last = { slug: t.slug, name: t.name, motto: t.motto, tastingDate: t.tastingDate };
		} else {
			next ??= {
				slug: t.slug,
				name: t.name,
				motto: t.motto,
				tastingDate: t.tastingDate,
				phase,
				isToday: t.tastingDate === today,
				progress: participantProgress(t.entered)
			};
		}
	}
	return { next, last };
}

/**
 * The bottles of all revealed tastings, the same for every user: also those
 * without an own participation. Blind stays blind because only the `revealed`
 * phase counts – computed per tasting like on the start page, so a tasting
 * revealed early by the admin counts at once. Bottles of the other tastings
 * aren't even queried. Numbered in standard order (numberBottles), the one
 * source of the anchors the statistics link to in the history. `own` tells
 * the user's own tastings. `null` while nothing is revealed.
 */
function revealedBottles(db: Db, userId: string, now: Date) {
	const tastings = db
		.select({ id: tasting.id, slug: tasting.slug, motto: tasting.motto, ...phaseColumns })
		.from(tasting)
		// created_at only has second precision: see getDashboardTasting.
		.orderBy(asc(tasting.tastingDate), asc(tasting.createdAt), sql`${tasting}.rowid`)
		.all()
		.filter((t) => getTastingPhase(t.tastingDate, now, t) === 'revealed');
	if (tastings.length === 0) return null;

	const ids = tastings.map((t) => t.id);
	const own = new Set(
		db
			.select({ tastingId: tastingParticipant.tastingId })
			.from(tastingParticipant)
			.where(and(eq(tastingParticipant.userId, userId), inArray(tastingParticipant.tastingId, ids)))
			.all()
			.map((p) => p.tastingId)
	);

	// No factors (archived bottles have none). Every projection picks its
	// fields from these rows explicitly.
	const rows = db
		.select({
			id: tastingBottle.id,
			tastingId: tastingParticipant.tastingId,
			slot: tastingBottle.slot,
			alias: tastingBottle.alias,
			distillery: tastingBottle.distillery,
			bottler: tastingBottle.bottler,
			bottling: tastingBottle.bottling,
			age: tastingBottle.age,
			abv: tastingBottle.abv,
			whiskybaseUrl: tastingBottle.whiskybaseUrl,
			presentationFile: tastingBottle.presentationFile,
			presentationName: tastingBottle.presentationName,
			username: user.username,
			deactivatedAt: user.deactivatedAt
		})
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.innerJoin(user, eq(user.id, tastingParticipant.userId))
		.where(inArray(tastingParticipant.tastingId, ids))
		.all();

	return { tastings, own, bottles: numberBottles(tastings, rows) };
}

// All tastings in date order (same-day ones in creation order, see
// revealedBottles) with what their phase depends on.
function tastingsInOrder(db: Db) {
	return db
		.select({ id: tasting.id, ...phaseColumns })
		.from(tasting)
		.orderBy(asc(tasting.tastingDate), asc(tasting.createdAt), sql`${tasting}.rowid`)
		.all();
}

// The bottles of these tastings in standard order (numberBottles), so the
// first spelling of a distillery is the one the statistics show. Only the
// fields of the bottle's name leave the query, besides the ID.
function distilleryBottles(db: Db, tastings: Array<{ id: string }>): DistilleryBottle[] {
	if (tastings.length === 0) return [];
	const rows = db
		.select({
			tastingId: tastingParticipant.tastingId,
			username: user.username,
			slot: tastingBottle.slot,
			id: tastingBottle.id,
			distillery: tastingBottle.distillery,
			bottler: tastingBottle.bottler,
			bottling: tastingBottle.bottling,
			age: tastingBottle.age
		})
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.innerJoin(user, eq(user.id, tastingParticipant.userId))
		.where(
			inArray(
				tastingParticipant.tastingId,
				tastings.map((t) => t.id)
			)
		)
		.all();
	return numberBottles(tastings, rows).map((bottle) => ({
		id: bottle.id,
		distillery: bottle.distillery,
		bottler: bottle.bottler,
		bottling: bottle.bottling,
		age: bottle.age
	}));
}

/** A bottle with the fields of its name – what renaming a distillery rewrites. */
export type DistilleryBottle = Pick<
	TastingBottle,
	'distillery' | 'bottler' | 'bottling' | 'age'
> & { id: string };

/**
 * Distillery names of the released tastings (isTastingReleased: from 21:00 on
 * the tasting day or revealed) – what the distillery research may look up.
 */
export function listReleasedDistilleryNames(db: Db, now: Date = new Date()): string[] {
	return distilleryBottles(
		db,
		tastingsInOrder(db).filter((t) => isTastingReleased(t.tastingDate, now, t))
	).map((bottle) => bottle.distillery);
}

/**
 * The bottles of the revealed tastings only, archived ones included – what the
 * admin's distillery table may show and rename, like the statistics and the
 * history show them.
 */
export function listRevealedDistilleryBottles(db: Db, now: Date = new Date()): DistilleryBottle[] {
	return distilleryBottles(
		db,
		tastingsInOrder(db).filter((t) => getTastingPhase(t.tastingDate, now, t) === 'revealed')
	);
}

/** Distillery names of the revealed tastings only (see listRevealedDistilleryBottles). */
export function listRevealedDistilleryNames(db: Db, now: Date = new Date()): string[] {
	return listRevealedDistilleryBottles(db, now).map((bottle) => bottle.distillery);
}

/**
 * The known facts of the distilleries of these bottles only (the revealed
 * ones), like the admin's distillery table – read here rather than through
 * distilleries.ts, which imports this module. By name key; the values are null
 * unless found or set by the admin (CHECK in the schema).
 */
function distilleryFacts(db: Db, bottles: Array<{ distillery: string }>) {
	const keys = [...new Set(bottles.map((b) => nameKey(b.distillery)))];
	return new Map(
		keys.length === 0
			? []
			: db
					.select({
						key: distillery.nameKey,
						country: distillery.country,
						region: distillery.region,
						capacity: distillery.capacity
					})
					.from(distillery)
					.where(inArray(distillery.nameKey, keys))
					.all()
					.map((row) => [row.key, row])
	);
}

/**
 * The statistics page over all revealed tastings (see revealedBottles):
 * neither slug nor presentation, Whiskybase link or alias – none of the
 * statistics shows them, the history's table does. Country and capacity of
 * the distilleries only of these bottles (distilleryFacts). `null` while
 * nothing is revealed.
 */
export function getStatistics(db: Db, userId: string, now: Date = new Date()): Statistics | null {
	const revealed = revealedBottles(db, userId, now);
	if (!revealed) return null;
	const facts = distilleryFacts(db, revealed.bottles);
	return buildStatistics(
		revealed.tastings.map((t) => ({ id: t.id, tastingDate: t.tastingDate })),
		revealed.bottles.map((b) => ({
			number: b.number,
			tastingIndex: b.tastingIndex,
			tastingId: b.tastingId,
			slot: b.slot,
			distillery: b.distillery,
			bottler: b.bottler,
			bottling: b.bottling,
			age: b.age,
			abv: b.abv,
			whiskybaseUrl: b.whiskybaseUrl,
			country: facts.get(nameKey(b.distillery))?.country ?? null,
			capacity: facts.get(nameKey(b.distillery))?.capacity ?? null,
			username: b.username,
			deactivatedAt: b.deactivatedAt
		}))
	);
}

/**
 * The world map over all revealed tastings (see revealedBottles): countries
 * and regions of the distilleries only of these bottles (distilleryFacts),
 * the bottles with the fields of the statistics – neither slug nor
 * presentation, alias or Whiskybase link, nor capacities, sources or states
 * of the facts. `null` while nothing is revealed.
 */
export function getWorldMap(db: Db, userId: string, now: Date = new Date()): WorldMapData | null {
	const revealed = revealedBottles(db, userId, now);
	if (!revealed) return null;
	const facts = distilleryFacts(db, revealed.bottles);
	return buildWorldMap(
		revealed.bottles.map((b) => {
			const fact = facts.get(nameKey(b.distillery));
			return {
				number: b.number,
				tastingIndex: b.tastingIndex,
				tastingDate: revealed.tastings[b.tastingIndex].tastingDate,
				distillery: b.distillery,
				bottler: b.bottler,
				bottling: b.bottling,
				age: b.age,
				abv: b.abv,
				username: b.username,
				deactivatedAt: b.deactivatedAt,
				country: fact?.country ?? null,
				region: fact?.region ?? null
			};
		})
	);
}

/**
 * The history's table: every bottle of all revealed tastings (see
 * revealedBottles), newest tasting first, within one by bringer and slot.
 * Slug and presentation link only for the user's own tastings, like
 * getDashboardTasting; the file names only tell whether there is a
 * presentation, they don't leave the server. `null` while nothing is revealed.
 */
export function getHistory(db: Db, userId: string, now: Date = new Date()): HistoryBottle[] | null {
	const revealed = revealedBottles(db, userId, now);
	if (!revealed) return null;
	const { tastings, own } = revealed;
	return [...revealed.bottles]
		.sort((a, b) => b.tastingIndex - a.tastingIndex || a.number - b.number)
		.map((b) => {
			const t = tastings[b.tastingIndex];
			const isOwn = own.has(t.id);
			return {
				number: b.number,
				tastingDate: t.tastingDate,
				motto: t.motto,
				slug: isOwn ? t.slug : null,
				alias: b.alias,
				distillery: b.distillery,
				bottler: b.bottler,
				bottling: b.bottling,
				age: b.age,
				abv: b.abv,
				whiskybaseUrl: b.whiskybaseUrl,
				broughtBy: participantLabel(b.username, b.deactivatedAt),
				// File and name like presentationRef: the download route needs both
				// and checks the participation again (404 otherwise).
				presentation:
					isOwn && b.presentationFile && b.presentationName
						? { bottleId: b.id, viewable: isViewablePresentation(b.presentationFile) }
						: null
			};
		});
}

/**
 * The tasting history (/tastings): all revealed tastings for every user,
 * newest first – the same extended visibility as revealedBottles, with the
 * phase computed per tasting, so a tasting revealed early counts at once.
 * Management data plus the number of bottles, no slug (see
 * getTastingHistoryDetail).
 */
export function listTastingHistory(db: Db, now: Date = new Date()): TastingHistoryItem[] {
	const revealed = db
		.select({ id: tasting.id, name: tasting.name, motto: tasting.motto, ...phaseColumns })
		.from(tasting)
		// created_at only has second precision: see getDashboardTasting.
		.orderBy(desc(tasting.tastingDate), desc(tasting.createdAt), desc(sql`${tasting}.rowid`))
		.all()
		.filter((t) => getTastingPhase(t.tastingDate, now, t) === 'revealed');
	if (revealed.length === 0) return [];

	const ids = revealed.map((t) => t.id);
	const bottleCounts = new Map(
		db
			.select({ tastingId: tastingParticipant.tastingId, bottles: count(tastingBottle.id) })
			.from(tastingBottle)
			.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
			.where(inArray(tastingParticipant.tastingId, ids))
			.groupBy(tastingParticipant.tastingId)
			.all()
			.map((row) => [row.tastingId, row.bottles])
	);
	return revealed.map((t) => ({
		id: t.id,
		name: t.name,
		motto: t.motto,
		tastingDate: t.tastingDate,
		bottleCount: bottleCounts.get(t.id) ?? 0
	}));
}

/**
 * A revealed tasting's page in the tasting history (/tastings/[id]), for
 * every user: the reveal like on the participant page. The slug and the
 * presentations only with an own participation, like in getHistory. `null`
 * for an unknown tasting and for one that isn't revealed yet – the bottles of
 * those aren't even queried.
 */
export function getTastingHistoryDetail(
	db: Db,
	id: string,
	userId: string,
	now: Date = new Date()
): TastingHistoryDetail | null {
	const t = db
		.select({
			slug: tasting.slug,
			name: tasting.name,
			motto: tasting.motto,
			mottoDescription: tasting.mottoDescription,
			...phaseColumns
		})
		.from(tasting)
		.where(eq(tasting.id, id))
		.get();
	if (!t || getTastingPhase(t.tastingDate, now, t) !== 'revealed') return null;

	const own =
		db
			.select({ id: tastingParticipant.id })
			.from(tastingParticipant)
			.where(and(eq(tastingParticipant.tastingId, id), eq(tastingParticipant.userId, userId)))
			.get() !== undefined;
	const head = {
		name: t.name,
		tastingDate: t.tastingDate,
		motto: t.motto,
		mottoDescription: t.mottoDescription
	};
	const slug = own ? t.slug : null;
	const poured = pouredBottles(db, id, own);
	return poured.archived
		? { tasting: head, slug, archived: true, bottles: poured.bottles }
		: {
				tasting: head,
				slug,
				archived: false,
				bottles: toReveal(poured.bottles),
				rules: poured.rules
			};
}

/** `name` is the display label: the username, marked if deactivated. */
export type AdminParticipant = { id: string; name: string; progress: Progress };

export type AdminTastingDetail = {
	tasting: {
		id: string;
		name: string;
		motto: string | null;
		mottoDescription: string | null;
		tastingDate: string;
	};
	phase: TastingPhase;
	participants: AdminParticipant[];
	manual: ManualPhaseChanges;
};

/**
 * Management data only, in every phase: no bottles, no order, no reveal. The
 * admin tastes along and sees the content as a participant of the tasting
 * like everybody else. `null` if the tasting doesn't exist.
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
			username: user.username,
			deactivatedAt: user.deactivatedAt,
			entered: count(tastingBottle.id)
		})
		.from(tastingParticipant)
		.innerJoin(user, eq(user.id, tastingParticipant.userId))
		.leftJoin(tastingBottle, eq(tastingBottle.participantId, tastingParticipant.id))
		.where(eq(tastingParticipant.tastingId, id))
		.groupBy(tastingParticipant.id)
		.orderBy(...participantOrder)
		.all()
		.map((p) => ({
			id: p.id,
			name: participantLabel(p.username, p.deactivatedAt),
			progress: participantProgress(p.entered)
		}));

	return {
		tasting: {
			id: t.id,
			name: t.name,
			motto: t.motto,
			mottoDescription: t.mottoDescription,
			tastingDate: t.tastingDate
		},
		phase: getTastingPhase(t.tastingDate, now, t),
		participants,
		manual: { orderOpenedAt: t.orderOpenedAt, revealedAt: t.revealedAt }
	};
}

/**
 * Moves the tasting to another date – only while bottles can still be entered.
 * The presentation files carry the date in their name, so they are renamed
 * along; the caller applies the returned file changes after the commit.
 * Returns `null` if the tasting doesn't exist.
 */
export function updateTastingDate(
	db: Db,
	id: string,
	tastingDate: string,
	now: Date = new Date()
): FileChange[] | null {
	return db.transaction((tx) => {
		const current = tx
			.select({ ...phaseColumns })
			.from(tasting)
			.where(eq(tasting.id, id))
			.get();
		if (!current) return null;
		if (getTastingPhase(current.tastingDate, now, current) !== 'entry') {
			throw new TastingValidationError(
				`date change rejected: tasting ${id} is past the entry phase`,
				'Das Datum lässt sich nur ändern, solange die Eingabe offen ist.'
			);
		}
		tx.update(tasting).set({ tastingDate }).where(eq(tasting.id, id)).run();
		// Same date: nothing to rename (and renaming within one name set could
		// shuffle suffixes onto each other's files).
		if (current.tastingDate === tastingDate) return [];

		const bottles = tx
			.select({
				id: tastingBottle.id,
				alias: tastingBottle.alias,
				file: tastingBottle.presentationFile
			})
			.from(tastingBottle)
			.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
			.where(and(eq(tastingParticipant.tastingId, id), isNotNull(tastingBottle.presentationFile)))
			.all();
		const renamed = new Set(bottles.map((b) => b.id));
		const taken = takenFileNames(tx, (bottle) => renamed.has(bottle.id));

		const changes: FileChange[] = [];
		for (const bottle of bottles) {
			const from = bottle.file!;
			const to = uniquePresentationFileName(
				presentationBaseName(tastingDate, bottle.alias),
				presentationExtension(from),
				taken
			);
			taken.add(fileNameKey(to));
			tx.update(tastingBottle)
				.set({ presentationFile: to })
				.where(eq(tastingBottle.id, bottle.id))
				.run();
			changes.push({ move: from, to });
		}
		return changes;
	});
}

/**
 * Sets or clears (`null`) heading and description of the motto together – in
 * every phase, archived tastings included: like name and date it is
 * management data the admin sets blind. Expects validateTastingMotto's
 * output. Returns false if the tasting doesn't exist.
 */
export function updateTastingMotto(
	db: Db,
	id: string,
	{ motto, mottoDescription }: TastingMotto
): boolean {
	return (
		db.update(tasting).set({ motto, mottoDescription }).where(eq(tasting.id, id)).run().changes > 0
	);
}

/**
 * "18-Uhr-Button": shows the pouring order to all participants right away and
 * closes the entry, overruling the 18:00 rule. Only while the entry is still
 * open. Returns false if the tasting doesn't exist.
 */
export function openOrderEarly(db: Db, id: string, now: Date = new Date()): boolean {
	return db.transaction((tx) => {
		const phase = currentPhase(tx, id, now);
		if (!phase) return false;
		if (phase !== 'entry') {
			throw new TastingValidationError(
				`open order rejected: tasting ${id} is already in phase ${phase}`,
				'Die Reihenfolge ist bereits freigegeben.'
			);
		}
		tx.update(tasting).set({ orderOpenedAt: now }).where(eq(tasting.id, id)).run();
		// The order is out: frozen right away, not only by the next freezeDueOrders.
		freezePouringOrder(tx, id);
		return true;
	});
}

/**
 * "9-Uhr-Button": reveals everything to all participants right away,
 * overruling the 9:00 rule. Only once the order is out (by the clock or the
 * 18-Uhr-Button) – the steps can't be skipped. Returns false if the tasting
 * doesn't exist.
 */
export function revealEarly(db: Db, id: string, now: Date = new Date()): boolean {
	return db.transaction((tx) => {
		const phase = currentPhase(tx, id, now);
		if (!phase) return false;
		if (phase === 'entry') {
			throw new TastingValidationError(
				`reveal rejected: tasting ${id} is still in the entry phase`,
				'Gib zuerst die Reihenfolge frei.'
			);
		}
		if (phase === 'revealed') {
			throw new TastingValidationError(
				`reveal rejected: tasting ${id} is already revealed`,
				'Das Tasting ist bereits aufgelöst.'
			);
		}
		tx.update(tasting).set({ revealedAt: now }).where(eq(tasting.id, id)).run();
		// Normally frozen with the order already; this catches a failed daily run.
		freezePouringOrder(tx, id);
		return true;
	});
}

/** Deletes the tasting; participants, bottles and throttle rows cascade. */
export function deleteTasting(db: Db, id: string): boolean {
	return db.delete(tasting).where(eq(tasting.id, id)).run().changes > 0;
}

/**
 * Stored presentation files of a tasting – the cascade removes only the rows,
 * so the caller deletes these files after deleteTasting().
 */
export function listPresentationFiles(db: Db, tastingId: string): string[] {
	return db
		.select({ file: tastingBottle.presentationFile })
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.where(eq(tastingParticipant.tastingId, tastingId))
		.all()
		.flatMap((row) => (row.file ? [row.file] : []));
}

/** Stored presentation of a bottle plus the tasting it belongs to. */
function findPresentation(db: Db, bottleId: string) {
	const row = db
		.select({
			tastingId: tastingParticipant.tastingId,
			file: tastingBottle.presentationFile,
			name: tastingBottle.presentationName
		})
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.where(eq(tastingBottle.id, bottleId))
		.get();
	return row?.file && row.name
		? { tastingId: row.tastingId, file: row.file, name: row.name }
		: null;
}

/**
 * Presentation download from the participant page: only for bottles of the
 * participant's tasting and only from the order on – the slides are shown
 * during the tasting. Until the reveal the download is named after the stored
 * file (date + alias), not the original name, which may reveal the whisky.
 * `null` for everything else, so the route answers a uniform 404.
 */
export function getPresentationForParticipant(
	db: Db,
	holder: Participant,
	bottleId: string,
	now: Date = new Date()
): StoredPresentation | null {
	const found = findPresentation(db, bottleId);
	if (!found || found.tastingId !== holder.tastingId) return null;
	const phase = getTastingPhase(holder.tastingDate, now, holder);
	if (phase === 'entry') return null;
	return { file: found.file, name: phase === 'revealed' ? found.name : found.file };
}

// ── Participant page ────────────────────────────────────────────────────────

/** A user's participation in a tasting – `id` is the participant id. */
export type Participant = ManualPhaseChanges & {
	id: string;
	username: string;
	tastingId: string;
	tastingName: string;
	tastingDate: string;
	tastingMotto: string | null;
	tastingMottoDescription: string | null;
};

/**
 * The user's participation in the tasting behind `slug`, in one single query:
 * an unknown slug and a user who doesn't take part – the admin included – take
 * the same path and end in the same `null`.
 */
export function findParticipant(db: Db, slug: string, userId: string): Participant | null {
	return (
		db
			.select({
				id: tastingParticipant.id,
				username: user.username,
				tastingId: tasting.id,
				tastingName: tasting.name,
				tastingDate: tasting.tastingDate,
				tastingMotto: tasting.motto,
				tastingMottoDescription: tasting.mottoDescription,
				orderOpenedAt: tasting.orderOpenedAt,
				revealedAt: tasting.revealedAt
			})
			.from(tastingParticipant)
			.innerJoin(tasting, eq(tasting.id, tastingParticipant.tastingId))
			.innerJoin(user, eq(user.id, tastingParticipant.userId))
			.where(and(eq(tasting.slug, slug), eq(tastingParticipant.userId, userId)))
			.get() ?? null
	);
}

/** The participant's own bottle during entry, incl. the name of an uploaded presentation. */
export type OwnBottle = TastingBottle & { slot: number; presentationName: string | null };

/**
 * The page head in every phase. The motto is management data the admin sets
 * blind, no whisky content, so it shows before the reveal too.
 */
export type ParticipantTasting = {
	name: string;
	tastingDate: string;
	motto: string | null;
	mottoDescription: string | null;
};

export type ParticipantView =
	| {
			phase: 'entry';
			tasting: ParticipantTasting;
			participant: { username: string };
			bottles: OwnBottle[];
			/**
			 * Input help of the distillery field: one spelling per distillery of the
			 * revealed tastings, no placeholders, sorted. Never a name of a tasting
			 * not revealed yet, this one included.
			 */
			distilleryNames: string[];
	  }
	| {
			phase: 'order';
			tasting: ParticipantTasting;
			manual: ManualPhaseChanges;
			order: OrderEntry[];
			/** The rules the explainer tile shows, frozen with the order. */
			rules: ScoreRules;
	  }
	| ({
			phase: 'revealed';
			tasting: ParticipantTasting;
			manual: ManualPhaseChanges;
	  } & Reveal);

/**
 * Archived bottles come with the history import, whose tastings are all
 * revealed already. Before the reveal such a tasting has no order to show
 * (no factors), so its page fails closed: an error instead of any content.
 */
function archivedBeforeReveal(tastingId: string, phase: TastingPhase): Error {
	return new Error(`tasting ${tastingId} has archived bottles in phase ${phase}`);
}

/**
 * What the participant page shows. Before 18:00 only the participant's own
 * bottles are even queried; afterwards the order with each bottle's total
 * score, and after the reveal everything. A tasting with archived bottles
 * has no order: its reveal comes without score and position, before the
 * reveal it throws (archivedBeforeReveal).
 */
export function getParticipantView(
	db: Db,
	holder: Participant,
	now: Date = new Date()
): ParticipantView {
	const tastingInfo: ParticipantTasting = {
		name: holder.tastingName,
		tastingDate: holder.tastingDate,
		motto: holder.tastingMotto,
		mottoDescription: holder.tastingMottoDescription
	};
	// When the admin pressed the 18:00 / 9:00 button – every participant sees it.
	const manual = { orderOpenedAt: holder.orderOpenedAt, revealedAt: holder.revealedAt };
	const phase = getTastingPhase(holder.tastingDate, now, manual);
	switch (phase) {
		case 'entry': {
			if (hasArchivedBottles(db, holder.tastingId)) {
				throw archivedBeforeReveal(holder.tastingId, phase);
			}
			const bottles = db
				.select()
				.from(tastingBottle)
				.where(eq(tastingBottle.participantId, holder.id))
				.orderBy(asc(tastingBottle.slot))
				.all()
				// None of them is archived (checked above), this narrows the type.
				.filter(isActiveBottle)
				.map((row) => ({
					slot: row.slot,
					...toDomain(row),
					presentationName: row.presentationFile ? row.presentationName : null
				}));
			return {
				phase,
				tasting: tastingInfo,
				participant: { username: holder.username },
				bottles,
				distilleryNames: [
					...distinctDistilleryNames(listRevealedDistilleryNames(db, now)).values()
				].sort((a, b) => a.localeCompare(b, 'de-DE'))
			};
		}
		case 'order': {
			const poured = pouredBottles(db, holder.tastingId);
			if (poured.archived) throw archivedBeforeReveal(holder.tastingId, phase);
			return {
				phase,
				tasting: tastingInfo,
				manual,
				order: toOrder(poured.bottles),
				rules: poured.rules
			};
		}
		case 'revealed': {
			const poured = pouredBottles(db, holder.tastingId);
			return poured.archived
				? { phase, tasting: tastingInfo, manual, archived: true, bottles: poured.bottles }
				: {
						phase,
						tasting: tastingInfo,
						manual,
						archived: false,
						bottles: toReveal(poured.bottles),
						rules: poured.rules
					};
		}
	}
}

// Case-insensitive also beyond ASCII (Ä/ä) – SQLite's lower() only folds ASCII,
// so the comparison happens here instead of in SQL.
function aliasKey(alias: string): string {
	return alias.toLocaleLowerCase('de-DE');
}

/**
 * Saves a bottle into the participant's slot (insert or update). Phase, slot and
 * alias uniqueness are checked in the same transaction as the upsert, so a
 * save can't overlap with the switch at 18:00. better-sqlite3 runs writes one
 * after another, so there is no race on the alias check either.
 *
 * `presentation`: undefined keeps the current presentation, null removes it,
 * a staged upload replaces it. The file is named after the scheme in
 * presentationFiles.ts (tasting date + alias), so a changed alias renames a
 * kept file as well. On success `fileChanges` lists the moves and deletions
 * the caller applies to MEDIA_PATH after the commit.
 *
 * Returns status 'alias-taken' if another bottle of the tasting uses the
 * alias; throws TastingValidationError if the entry phase is over, the tasting
 * has archived bottles or the slot doesn't exist.
 */
export function saveBottle(
	db: Db,
	holder: Pick<Participant, 'id' | 'tastingId'>,
	slot: number,
	bottle: TastingBottle,
	now: Date = new Date(),
	presentation?: PendingUpload | null
): SaveBottleResult {
	return db.transaction((tx): SaveBottleResult => {
		const closed = 'Die Eingabe ist geschlossen, deine Änderung wurde nicht gespeichert.';
		const t = tx.select(phaseColumns).from(tasting).where(eq(tasting.id, holder.tastingId)).get();
		// Also catches the admin's 18:00 / 9:00 button pressed while the page was open.
		if (!t || getTastingPhase(t.tastingDate, now, t) !== 'entry') {
			throw new TastingValidationError(
				`save rejected: tasting ${holder.tastingId} is past the entry phase`,
				closed
			);
		}
		// Fail closed, see archivedBeforeReveal(). Same text: the UI never
		// mentions the archive.
		if (hasArchivedBottles(tx, holder.tastingId)) {
			throw new TastingValidationError(
				`save rejected: tasting ${holder.tastingId} has archived bottles`,
				closed
			);
		}
		// Number.isInteger also catches NaN from a tampered form field.
		if (!Number.isInteger(slot) || slot < 1 || slot > TASTING_BOTTLE_SLOTS.max) {
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
		if (taken) return { status: 'alias-taken' };

		const previousFile =
			tx
				.select({ file: tastingBottle.presentationFile })
				.from(tastingBottle)
				.where(and(eq(tastingBottle.participantId, holder.id), eq(tastingBottle.slot, slot)))
				.get()?.file ?? null;
		const { columns: presentationColumns, fileChanges } = planPresentationFile(
			previousFile,
			presentation,
			// The file name the scheme gives this bottle now (date + alias).
			(extension) =>
				uniquePresentationFileName(
					presentationBaseName(t.tastingDate, bottle.alias),
					extension,
					takenFileNames(tx, (other) => other.participantId === holder.id && other.slot === slot)
				)
		);

		tx.insert(tastingBottle)
			.values({
				id: randomUUID(),
				participantId: holder.id,
				slot,
				...bottle,
				...presentationColumns,
				updatedAt: now
			})
			.onConflictDoUpdate({
				target: [tastingBottle.participantId, tastingBottle.slot],
				set: { ...bottle, ...presentationColumns, updatedAt: now }
			})
			.run();

		return { status: 'saved', fileChanges };
	});
}

export type SaveBottleResult =
	{ status: 'saved'; fileChanges: FileChange[] } | { status: 'alias-taken' };

/**
 * Removes a further bottle (slot 3–6) of the participant, the base slots stay.
 * Like saveBottle the phase and the slot are checked in the same transaction
 * as the delete, and the bottle is only ever addressed by participant and
 * slot. Its alias and file name are free again afterwards. Returns the
 * presentation file the caller deletes after the commit; an empty slot (e.g.
 * removed in another tab already) is no error.
 *
 * Throws TastingValidationError if the entry phase is over, the tasting has
 * archived bottles or the slot can't be removed.
 */
export function removeBottle(
	db: Db,
	holder: Pick<Participant, 'id' | 'tastingId'>,
	slot: number,
	now: Date = new Date()
): FileChange[] {
	return db.transaction((tx) => {
		const closed = 'Die Eingabe ist geschlossen, die Flasche wurde nicht entfernt.';
		const t = tx.select(phaseColumns).from(tasting).where(eq(tasting.id, holder.tastingId)).get();
		// Also catches the admin's 18:00 / 9:00 button pressed while the page was open.
		if (!t || getTastingPhase(t.tastingDate, now, t) !== 'entry') {
			throw new TastingValidationError(
				`remove rejected: tasting ${holder.tastingId} is past the entry phase`,
				closed
			);
		}
		// An archived bottle is never removed, its presentation file neither.
		if (hasArchivedBottles(tx, holder.tastingId)) {
			throw new TastingValidationError(
				`remove rejected: tasting ${holder.tastingId} has archived bottles`,
				closed
			);
		}
		if (
			!Number.isInteger(slot) ||
			slot <= TASTING_BOTTLE_SLOTS.base ||
			slot > TASTING_BOTTLE_SLOTS.max
		) {
			throw new TastingValidationError(
				`remove rejected: slot ${slot} can't be removed`,
				'Diese Flasche lässt sich nicht entfernen.'
			);
		}

		const own = and(eq(tastingBottle.participantId, holder.id), eq(tastingBottle.slot, slot));
		const file = tx
			.select({ file: tastingBottle.presentationFile })
			.from(tastingBottle)
			.where(own)
			.get()?.file;
		tx.delete(tastingBottle).where(own).run();
		return file ? [{ delete: file }] : [];
	});
}

// Case-insensitive, see fileNameKey.
function sameFile(a: string, b: string): boolean {
	return fileNameKey(a) === fileNameKey(b);
}

/**
 * Columns and file steps for a bottle's presentation on save: remove it, put
 * a staged upload under the scheme's name, or rename a kept file whose name
 * no longer matches (alias changed). The upload is moved before the previous
 * file is deleted – with an unchanged name the move simply replaces it.
 */
function planPresentationFile(
	previousFile: string | null,
	presentation: PendingUpload | null | undefined,
	fileNameFor: (extension: string) => string
): { columns: Partial<typeof tastingBottle.$inferInsert>; fileChanges: FileChange[] } {
	if (presentation === null) {
		return {
			columns: { presentationFile: null, presentationName: null },
			fileChanges: previousFile ? [{ delete: previousFile }] : []
		};
	}
	if (presentation) {
		const file = fileNameFor(presentation.extension);
		const fileChanges: FileChange[] = [{ move: presentation.tempFile, to: file }];
		if (previousFile && !sameFile(previousFile, file)) fileChanges.push({ delete: previousFile });
		return {
			columns: { presentationFile: file, presentationName: presentation.name },
			fileChanges
		};
	}
	if (!previousFile) return { columns: {}, fileChanges: [] };
	const file = fileNameFor(presentationExtension(previousFile));
	if (file === previousFile) return { columns: {}, fileChanges: [] };
	return { columns: { presentationFile: file }, fileChanges: [{ move: previousFile, to: file }] };
}
