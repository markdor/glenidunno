import { randomInt, randomUUID } from 'node:crypto';
import { and, asc, count, desc, eq, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
	participantLabel,
	type ArchivedRevealedBottle,
	type DashboardLastTasting,
	type DashboardTasting,
	type ManualPhaseChanges,
	type OrderEntry,
	type PresentationRef,
	type Progress,
	type Reveal,
	type RevealedBottle,
	type TastingBottle,
	type TastingPhase
} from '$lib/tasting';
import { isValidTastingDate, TASTING_BOTTLE_SLOTS, TASTING_MOTTO_LENGTH } from '$lib/validation';
import type * as Schema from './db/schema';
import {
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
import { getBerlinToday, getTastingPhase } from './tastingPhase';
import type { PendingUpload, StoredPresentation } from './tastingMedia';
import { sortForPouring, type BottleScore } from './tastingScore';

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

/**
 * Field-level check of the optional motto shared by "create" and "change
 * motto": trimmed, empty means no motto (`null`). The only length guard – the
 * column has no CHECK constraint.
 */
export function validateTastingMotto(raw: string): {
	motto: string | null;
	error: 'invalid' | null;
} {
	const motto = raw.trim();
	if (motto.length > TASTING_MOTTO_LENGTH.max) return { motto, error: 'invalid' };
	return { motto: motto || null, error: null };
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
		presentation: b.presentation && { bottleId: b.presentation.bottleId }
	}));
}

type PouredBottle = TastingBottle &
	BottleScore & { broughtBy: string; presentation: PresentationRef | null };

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
function toArchivedReveal(rows: ReadonlyArray<BottleWithBringer>): ArchivedRevealedBottle[] {
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
			presentation: presentationRef(bottle)
		}));
}

/**
 * All bottles of a tasting with their participant, in pouring order. As soon
 * as one of them is archived (imported from the tasting history without
 * smoke, cask and value), there is no order: then all of them come as
 * archived bottles, see toArchivedReveal().
 */
function pouredBottles(
	db: Db,
	tastingId: string
):
	| { archived: false; bottles: PouredBottle[] }
	| { archived: true; bottles: ArchivedRevealedBottle[] } {
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
						presentation: presentationRef(bottle)
					}
				]
			: []
	);
	return active.length === rows.length
		? { archived: false, bottles: sortForPouring(active) }
		: { archived: true, bottles: toArchivedReveal(rows) };
}

function presentationRef(bottle: BottleRow): PresentationRef | null {
	return bottle.presentationFile && bottle.presentationName
		? { bottleId: bottle.id, name: bottle.presentationName }
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
	tastingDate: string;
	phase: TastingPhase;
	progress: Progress;
};

/**
 * Management data only: name, date, phase and entry progress. The progress
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
			tastingDate: t.tastingDate,
			phase: getTastingPhase(t.tastingDate, now, t),
			progress: progress.get(t.id) ?? { entered: 0, total: 0 }
		}));
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

/** `name` is the display label: the username, marked if deactivated. */
export type AdminParticipant = { id: string; name: string; progress: Progress };

export type AdminTastingDetail = {
	tasting: {
		id: string;
		name: string;
		motto: string | null;
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
		tasting: { id: t.id, name: t.name, motto: t.motto, tastingDate: t.tastingDate },
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
 * Sets or clears (`null`) the motto – in every phase: like name and date it is
 * management data the admin sets blind. Returns false if the tasting doesn't
 * exist.
 */
export function updateTastingMotto(db: Db, id: string, motto: string | null): boolean {
	return db.update(tasting).set({ motto }).where(eq(tasting.id, id)).run().changes > 0;
}

/**
 * "18-Uhr-Button": shows the pouring order to all participants right away and
 * closes the entry, overruling the 18:00 rule. Only while the entry is still
 * open. Returns false if the tasting doesn't exist.
 */
export function openOrderEarly(db: Db, id: string, now: Date = new Date()): boolean {
	const phase = currentPhase(db, id, now);
	if (!phase) return false;
	if (phase !== 'entry') {
		throw new TastingValidationError(
			`open order rejected: tasting ${id} is already in phase ${phase}`,
			'Die Reihenfolge ist bereits freigegeben.'
		);
	}
	db.update(tasting).set({ orderOpenedAt: now }).where(eq(tasting.id, id)).run();
	return true;
}

/**
 * "9-Uhr-Button": reveals everything to all participants right away,
 * overruling the 9:00 rule. Only once the order is out (by the clock or the
 * 18-Uhr-Button) – the steps can't be skipped. Returns false if the tasting
 * doesn't exist.
 */
export function revealEarly(db: Db, id: string, now: Date = new Date()): boolean {
	const phase = currentPhase(db, id, now);
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
	db.update(tasting).set({ revealedAt: now }).where(eq(tasting.id, id)).run();
	return true;
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

export type ParticipantView =
	| {
			phase: 'entry';
			tasting: { name: string; tastingDate: string };
			participant: { username: string };
			bottles: OwnBottle[];
	  }
	| {
			phase: 'order';
			tasting: { name: string; tastingDate: string };
			manual: ManualPhaseChanges;
			order: OrderEntry[];
	  }
	| ({
			phase: 'revealed';
			tasting: { name: string; tastingDate: string };
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
	const tastingInfo = { name: holder.tastingName, tastingDate: holder.tastingDate };
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
				bottles
			};
		}
		case 'order': {
			const poured = pouredBottles(db, holder.tastingId);
			if (poured.archived) throw archivedBeforeReveal(holder.tastingId, phase);
			return { phase, tasting: tastingInfo, manual, order: toOrder(poured.bottles) };
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
						bottles: toReveal(poured.bottles)
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
