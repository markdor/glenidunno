import { randomUUID } from 'node:crypto';
import { and, asc, count, countDistinct, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import {
	normalizeScoreFactors,
	type ManualPhaseChanges,
	type OrderCurves,
	type OrderEntry,
	type PresentationRef,
	type Progress,
	type RevealedBottle,
	type ScoreInput,
	type TastingBottle,
	type TastingPhase
} from '$lib/tasting';
import { isValidTastingDate } from '$lib/validation';
import type * as Schema from './db/schema';
import { tasting, tastingBottle, tastingParticipant } from './db/schema';
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
import { generateTastingToken, hashTastingToken } from './tastingToken';

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

const CURVE_FACTORS = ['smoke', 'cask', 'abv', 'value'] as const;

/** See OrderCurves: one anonymous curve per factor, sorted by its values. */
function toCurves(poured: ReadonlyArray<ScoreInput>): OrderCurves {
	const factors = poured.map((b) => normalizeScoreFactors(b));
	return CURVE_FACTORS.map((key) => factors.map((f) => f[key])).sort(compareCurves);
}

// Lexicographic – every curve has one value per bottle.
function compareCurves(a: number[], b: number[]): number {
	const i = a.findIndex((value, k) => value !== b[k]);
	return i === -1 ? 0 : a[i] - b[i];
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

/** All bottles of a tasting with their participant, in pouring order. */
function pouredBottles(db: Db, tastingId: string) {
	const rows = db
		.select({ bottle: tastingBottle, broughtBy: tastingParticipant.name })
		.from(tastingBottle)
		.innerJoin(tastingParticipant, eq(tastingParticipant.id, tastingBottle.participantId))
		.where(eq(tastingParticipant.tastingId, tastingId))
		.orderBy(asc(tastingBottle.id))
		.all();
	return sortForPouring(
		rows.map(({ bottle, broughtBy }) => ({
			...toDomain(bottle),
			broughtBy,
			presentation: presentationRef(bottle)
		}))
	);
}

function presentationRef(bottle: BottleRow): PresentationRef | null {
	return bottle.presentationFile && bottle.presentationName
		? { bottleId: bottle.id, name: bottle.presentationName }
		: null;
}

// Participants in the order the admin entered them (created in one insert,
// so created_at alone can't tell them apart).
const participantOrder = [asc(tastingParticipant.createdAt), sql`${tastingParticipant}.rowid`];

// Everything the phase depends on: the date and the admin's manual overrides.
const phaseColumns = {
	tastingDate: tasting.tastingDate,
	orderOpenedAt: tasting.orderOpenedAt,
	revealedAt: tasting.revealedAt
};

/** Current phase of a tasting, `null` if it doesn't exist. */
function currentPhase(db: Executor, id: string, now: Date): TastingPhase | null {
	const t = db.select(phaseColumns).from(tasting).where(eq(tasting.id, id)).get();
	return t ? getTastingPhase(t.tastingDate, now, t) : null;
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
				phase: getTastingPhase(t.tastingDate, now, t),
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
	phase: TastingPhase;
	participants: AdminParticipant[];
	manual: ManualPhaseChanges;
};

/**
 * Management data only, in every phase: no bottles, no order, no reveal. The
 * admin tastes along and sees the content through their own participant link
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

	return {
		tasting: {
			id: t.id,
			name: t.name,
			tastingDate: t.tastingDate,
			bottlesPerParticipant: t.bottlesPerParticipant
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
 * "18-Uhr-Button": shows the pouring order on all links right away and closes
 * the entry, overruling the 18:00 rule. Only while the entry is still open.
 * Returns false if the tasting doesn't exist.
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
 * "9-Uhr-Button": reveals everything on all links right away, overruling the
 * 9:00 rule. Only once the order is out (by the clock or the 18-Uhr-Button) –
 * the steps can't be skipped. Returns false if the tasting doesn't exist.
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
 * Presentation download through a participant link: only for bottles of the
 * holder's tasting and only after the reveal – the file (and its name) is
 * content. `null` for everything else, so the route answers a uniform 404.
 */
export function getPresentationForParticipant(
	db: Db,
	holder: TokenHolder,
	bottleId: string,
	now: Date = new Date()
): StoredPresentation | null {
	const found = findPresentation(db, bottleId);
	if (!found || found.tastingId !== holder.tastingId) return null;
	if (getTastingPhase(holder.tastingDate, now, holder) !== 'revealed') return null;
	return { file: found.file, name: found.name };
}

// ── Participant link ────────────────────────────────────────────────────────

export type TokenHolder = ManualPhaseChanges & {
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
				bottlesPerParticipant: tasting.bottlesPerParticipant,
				orderOpenedAt: tasting.orderOpenedAt,
				revealedAt: tasting.revealedAt
			})
			.from(tastingParticipant)
			.innerJoin(tasting, eq(tasting.id, tastingParticipant.tastingId))
			.where(eq(tastingParticipant.tokenHash, hashTastingToken(token)))
			.get() ?? null
	);
}

/** The holder's own bottle during entry, incl. the name of an uploaded presentation. */
export type OwnBottle = TastingBottle & { slot: number; presentationName: string | null };

export type ParticipantView =
	| {
			phase: 'entry';
			tasting: { name: string; tastingDate: string; bottlesPerParticipant: number };
			participant: { name: string };
			bottles: OwnBottle[];
	  }
	| {
			phase: 'order';
			tasting: { name: string; tastingDate: string };
			manual: ManualPhaseChanges;
			order: OrderEntry[];
			curves: OrderCurves;
	  }
	| {
			phase: 'revealed';
			tasting: { name: string; tastingDate: string };
			manual: ManualPhaseChanges;
			bottles: RevealedBottle[];
	  };

/**
 * What a participant link shows. Before 18:00 only the holder's own bottles
 * are even queried; afterwards the order with the anonymous factor curves,
 * and after the reveal everything.
 */
export function getParticipantView(
	db: Db,
	holder: TokenHolder,
	now: Date = new Date()
): ParticipantView {
	const tastingInfo = { name: holder.tastingName, tastingDate: holder.tastingDate };
	// When the admin pressed the 18:00 / 9:00 button – every link shows it.
	const manual = { orderOpenedAt: holder.orderOpenedAt, revealedAt: holder.revealedAt };
	const phase = getTastingPhase(holder.tastingDate, now, manual);
	switch (phase) {
		case 'entry': {
			const bottles = db
				.select()
				.from(tastingBottle)
				.where(eq(tastingBottle.participantId, holder.id))
				.orderBy(asc(tastingBottle.slot))
				.all()
				.map((row) => ({
					slot: row.slot,
					...toDomain(row),
					presentationName: row.presentationFile ? row.presentationName : null
				}));
			return {
				phase,
				tasting: { ...tastingInfo, bottlesPerParticipant: holder.bottlesPerParticipant },
				participant: { name: holder.name },
				bottles
			};
		}
		case 'order': {
			const poured = pouredBottles(db, holder.tastingId);
			return {
				phase,
				tasting: tastingInfo,
				manual,
				order: toOrder(poured),
				curves: toCurves(poured)
			};
		}
		case 'revealed':
			return {
				phase,
				tasting: tastingInfo,
				manual,
				bottles: toReveal(pouredBottles(db, holder.tastingId))
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
 * `presentation`: undefined keeps the current presentation, null removes it,
 * a staged upload replaces it. The file is named after the scheme in
 * presentationFiles.ts (tasting date + alias), so a changed alias renames a
 * kept file as well. On success `fileChanges` lists the moves and deletions
 * the caller applies to MEDIA_PATH after the commit.
 *
 * Returns status 'alias-taken' if another bottle of the tasting uses the
 * alias; throws TastingValidationError if the entry phase is over or the slot
 * doesn't exist.
 */
export function saveBottle(
	db: Db,
	holder: Pick<TokenHolder, 'id' | 'tastingId'>,
	slot: number,
	bottle: TastingBottle,
	now: Date = new Date(),
	presentation?: PendingUpload | null
): SaveBottleResult {
	return db.transaction((tx): SaveBottleResult => {
		const t = tx
			.select({ ...phaseColumns, bottlesPerParticipant: tasting.bottlesPerParticipant })
			.from(tasting)
			.where(eq(tasting.id, holder.tastingId))
			.get();
		// Also catches the admin's 18:00 / 9:00 button pressed while the page was open.
		if (!t || getTastingPhase(t.tastingDate, now, t) !== 'entry') {
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
