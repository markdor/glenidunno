// One-off import of the tasting history from before Glen Idunno (issue #27):
// checks a history.json (format: see the issue) and, only with --apply, writes
// its tastings as archived tastings (tasting_bottle.archived = 1, no smoke,
// cask and value) in a single transaction, each bottle with its own copy of
// its presentation in MEDIA_PATH. Version 2 adds the facts per distillery
// (#39), written as researched values in the same transaction.
//
//   npm run db:import-history -- <path/history.json>           # dry run
//   npm run db:import-history -- <path/history.json> --apply   # import
//
// DB_PATH and MEDIA_PATH come from the environment or .env/.env.local
// (resolveDevEnv). Meant for a copy of the production database and an empty
// media directory that go back into the volumes afterwards (steps in the
// issue), never for the live volumes.
//
// Every run checks everything first, against the database too, and reports
// all problems at once, each with tasting date and bottle index, so the JSON
// can be fixed in a few rounds. Without --apply it then only prints what an
// import would write.
//
// Unlike seed-test-tasting.ts it never migrates: the raw SQL below is written
// against the schema of this checkout, so it refuses a database whose
// __drizzle_migrations doesn't match drizzle/meta/_journal.json – after the
// next migration it aborts until it's adapted. Also unlike seed-test-tasting.ts
// it imports from src/: validation.ts, presentationFiles.ts and
// distilleryNames.ts have no imports and no TS syntax Node's type stripping
// can't erase, so they load with their .ts extension. What it needs from modules that don't (tastings.ts,
// tastingPhase.ts, tastingMedia.ts, db/schema.ts) is rebuilt here.

import { randomUUID } from 'node:crypto';
import {
	constants,
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';
import Database from 'better-sqlite3';
import { resolveDevEnv } from './devEnv.ts';
import { isPlaceholderDistillery, nameKey } from '../src/lib/distilleryNames.ts';
import {
	fileNameKey,
	presentationBaseName,
	presentationExtension,
	PRESENTATION_FILE_RE,
	uniquePresentationFileName,
	UPLOAD_TEMP_FILE_RE
} from '../src/lib/server/presentationFiles.ts';
import {
	checkDistilleryFacts,
	DISTILLERY_CAPACITY,
	DISTILLERY_COUNTRY_LENGTH,
	DISTILLERY_SOURCE_LENGTH,
	isValidDistillerySource,
	isValidTastingDate,
	normalizeWhiskybaseUrl,
	TASTING_ABV,
	TASTING_AGE,
	TASTING_ALIAS_LENGTH,
	TASTING_BOTTLE_SLOTS,
	TASTING_BOTTLER_LENGTH,
	TASTING_BOTTLING_LENGTH,
	TASTING_DISTILLERY_LENGTH,
	TASTING_MOTTO_LENGTH,
	TASTING_NAME_LENGTH,
	TASTING_PARTICIPANTS,
	TASTING_PRESENTATION_MAX_BYTES,
	TASTING_PRESENTATION_NAME_LENGTH,
	TASTING_WHISKYBASE_URL_LENGTH,
	SCOTLAND,
	SCOTTISH_REGIONS
} from '../src/lib/validation.ts';

const USAGE = 'Usage: npm run db:import-history -- <path/history.json> [--apply]';

type SourceFile = { path: string; name: string; size: number };

type BottleFields = {
	broughtBy: string;
	alias: string;
	distillery: string;
	bottler: string | null;
	bottling: string | null;
	age: number | null;
	abv: number;
	/** As returned by normalizeWhiskybaseUrl(), stored like that. */
	whiskybaseUrl: string | null;
	presentation: SourceFile | null;
};

type ImportBottle = BottleFields & {
	where: string;
	/** Key of the participant who brought it, see ImportParticipant. */
	participant: string;
	slot: number;
	/** Name in MEDIA_PATH, assigned once every other check passed. */
	file: string | null;
};

type ImportParticipant = {
	/** broughtBy case-folded, matched against the usernames the same way. */
	key: string;
	broughtBy: string;
	/** Indices into the tasting's bottles; the order gives the slots. */
	bottles: number[];
};

type ImportTasting = {
	where: string;
	date: string;
	name: string;
	motto: string | null;
	/** In the order of their first bottle, which becomes the display order. */
	participants: ImportParticipant[];
	bottles: ImportBottle[];
};

type UserRow = { id: string; username: string; deactivated_at: number | null };

type DistilleryField = 'country' | 'region' | 'capacity';
const DISTILLERY_FACTS: readonly DistilleryField[] = ['country', 'region', 'capacity'];

/** An imported value with its optional source; missing or null stays "never researched". */
type ImportFact = { value: string | number; source: string | null };

type ImportDistillery = {
	where: string;
	/** nameKey() of the name, the distillery's key in the database. */
	key: string;
	name: string;
	facts: Partial<Record<DistilleryField, ImportFact>>;
	/** Values the database keeps (found or set by the admin), see planDistilleries. */
	kept: DistilleryField[];
};

type DistilleryRow = {
	country: string | null;
	country_state: string;
	region_state: string;
	capacity_state: string;
};

type ImportHistory = { tastings: ImportTasting[]; distilleries: ImportDistillery[] };

/** A staged copy of a presentation and the name it gets after the commit. */
type FileMove = { temp: string; file: string };

const errors: string[] = [];
const warnings: string[] = [];

function error(where: string, message: string): void {
	errors.push(`${where}: ${message}`);
}

function warn(where: string, message: string): void {
	warnings.push(`${where}: ${message}`);
}

function megabytes(bytes: number): string {
	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// Case-insensitive beyond ASCII too, like aliasKey() in tastings.ts.
function foldCase(value: string): string {
	return value.toLocaleLowerCase('de-DE');
}

// Today in Berlin like getBerlinToday() in src/lib/server/tastingPhase.ts
// (TASTING_TIME_ZONE in src/lib/tasting.ts) – neither module loads in plain Node.
function berlinToday(now: Date): string {
	const parts = Object.fromEntries(
		new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Europe/Berlin',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		})
			.formatToParts(now)
			.map((part) => [part.type, part.value])
	);
	return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

// ── Arguments and input ─────────────────────────────────────────────────────

function parseArguments(): { apply: boolean; historyPath: string } {
	try {
		const { values, positionals } = parseArgs({
			allowPositionals: true,
			options: { apply: { type: 'boolean' } }
		});
		if (positionals.length !== 1) throw new Error('Expected exactly one path to a history.json.');
		return { apply: values.apply === true, historyPath: resolve(positionals[0]) };
	} catch (err) {
		console.error(`${err instanceof Error ? err.message : err}\n${USAGE}`);
		process.exit(1);
	}
}

function readHistory(path: string): unknown {
	try {
		const content = readFileSync(path, 'utf8');
		// A byte order mark (some Windows editors write one) isn't valid JSON.
		return JSON.parse(content.charCodeAt(0) === 0xfeff ? content.slice(1) : content);
	} catch (err) {
		console.error(`\nCan't read ${path}: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	}
}

// ── Checks of the JSON ──────────────────────────────────────────────────────

type Fields = Record<string, unknown>;

const HISTORY_FIELDS = ['version', 'tastings', 'distilleries'];
const DISTILLERY_FIELDS = [
	'name',
	'country',
	'region',
	'capacity',
	'countrySource',
	'regionSource',
	'capacitySource'
];
const TASTING_FIELDS = ['date', 'name', 'motto', 'bottles'];
const BOTTLE_FIELDS = [
	'broughtBy',
	'alias',
	'distillery',
	'bottler',
	'bottling',
	'age',
	'abv',
	'whiskybaseUrl',
	'presentation'
];

function isFields(value: unknown): value is Fields {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// An unknown field is most likely a typo, which would otherwise silently drop
// an optional field (a missing optional field counts as null).
function checkFieldNames(where: string, fields: Fields, known: readonly string[]): void {
	for (const field of Object.keys(fields)) {
		if (!known.includes(field)) error(where, `unknown field "${field}"`);
	}
}

/**
 * A text field, `null` if it's missing, null or no string. Never trimmed
 * silently: an empty string (null instead) or surrounding whitespace is an
 * error, like a value longer than `max`.
 */
function text(
	where: string,
	fields: Fields,
	field: string,
	required: boolean,
	max = Infinity
): string | null {
	const value = fields[field];
	if (value === undefined || value === null) {
		if (required) error(where, `${field} is missing`);
		return null;
	}
	if (typeof value !== 'string') {
		error(where, `${field} must be a string${required ? '' : ' or null'}`);
		return null;
	}
	if (value === '') {
		error(where, required ? `${field} must not be empty` : `${field} is empty, use null instead`);
		return null;
	}
	if (value.trim() !== value) error(where, `${field} "${value}" has surrounding whitespace`);
	if (value.length > max) error(where, `${field} has ${value.length} characters, at most ${max}`);
	return value;
}

/** The presentation file, a path relative to the JSON's folder that stays inside it. */
function presentationSource(where: string, fields: Fields, baseDir: string): SourceFile | null {
	const value = text(where, fields, 'presentation', false);
	if (value === null) return null;

	const path = resolve(baseDir, value);
	const inside = relative(baseDir, path);
	if (isAbsolute(value) || !inside || inside.split(sep)[0] === '..' || isAbsolute(inside)) {
		error(where, `presentation "${value}" must be a relative path inside the folder of the JSON`);
		return null;
	}

	let size: number;
	try {
		const stats = statSync(path);
		if (!stats.isFile()) {
			error(where, `presentation "${value}" is not a file`);
			return null;
		}
		size = stats.size;
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		error(
			where,
			`presentation "${value}" ${code === 'ENOENT' ? 'not found' : `unreadable (${code})`}`
		);
		return null;
	}

	const name = basename(path);
	if (name.length > TASTING_PRESENTATION_NAME_LENGTH.max) {
		error(
			where,
			`presentation file name longer than ${TASTING_PRESENTATION_NAME_LENGTH.max} characters`
		);
	}
	// The limit is for uploads; the download streams the file whatever its size.
	if (size > TASTING_PRESENTATION_MAX_BYTES) {
		warn(where, `presentation "${value}" has ${megabytes(size)}, more than the upload limit`);
	}
	return { path, name, size };
}

function checkBottle(raw: unknown, where: string, baseDir: string): BottleFields | null {
	if (!isFields(raw)) {
		error(where, 'must be an object');
		return null;
	}
	checkFieldNames(where, raw, BOTTLE_FIELDS);

	const broughtBy = text(where, raw, 'broughtBy', true) ?? '';
	const alias = text(where, raw, 'alias', true, TASTING_ALIAS_LENGTH.max) ?? '';
	const distillery = text(where, raw, 'distillery', true, TASTING_DISTILLERY_LENGTH.max) ?? '';
	const bottler = text(where, raw, 'bottler', false, TASTING_BOTTLER_LENGTH.max);
	const bottling = text(where, raw, 'bottling', false, TASTING_BOTTLING_LENGTH.max);

	const age = raw.age ?? null;
	const validAge =
		age === null ||
		(typeof age === 'number' &&
			Number.isInteger(age) &&
			age >= TASTING_AGE.min &&
			age <= TASTING_AGE.max);
	if (!validAge) {
		error(
			where,
			`age must be null (NAS) or a whole number from ${TASTING_AGE.min} to ${TASTING_AGE.max}`
		);
	}

	const abv = raw.abv;
	const validAbv =
		typeof abv === 'number' &&
		abv >= TASTING_ABV.min &&
		abv <= TASTING_ABV.max &&
		Math.round(abv * 10) / 10 === abv;
	if (!validAbv) {
		error(
			where,
			`abv must be a number from ${TASTING_ABV.min} to ${TASTING_ABV.max} with at most one decimal`
		);
	}

	const rawUrl = text(where, raw, 'whiskybaseUrl', false);
	const whiskybaseUrl = rawUrl === null ? null : normalizeWhiskybaseUrl(rawUrl);
	if (rawUrl !== null && whiskybaseUrl === null) {
		error(
			where,
			`whiskybaseUrl must be an https link to whiskybase.com of at most ` +
				`${TASTING_WHISKYBASE_URL_LENGTH.max} characters`
		);
	}

	return {
		broughtBy,
		alias,
		distillery,
		bottler,
		bottling,
		age: validAge ? age : null,
		abv: validAbv ? abv : 0,
		whiskybaseUrl,
		presentation: presentationSource(where, raw, baseDir)
	};
}

function checkTasting(
	raw: unknown,
	index: number,
	baseDir: string,
	latestDate: string,
	dates: Map<string, number>
): ImportTasting | null {
	if (!isFields(raw)) {
		error(`tastings[${index}]`, 'must be an object');
		return null;
	}
	const where =
		typeof raw.date === 'string' ? `tastings[${index}] (${raw.date})` : `tastings[${index}]`;
	checkFieldNames(where, raw, TASTING_FIELDS);

	const date = text(where, raw, 'date', true) ?? '';
	if (date) {
		// The reveal starts at 9:00 (Berlin) the day after the tasting: two days
		// back, a tasting is revealed whatever the time of day.
		if (!isValidTastingDate(date)) error(where, 'date must be a calendar date like 2020-11-06');
		else if (date > latestDate) {
			error(where, `date must be ${latestDate} or earlier, so the tasting is revealed`);
		}
		const first = dates.get(date);
		if (first === undefined) dates.set(date, index);
		else error(where, `date is also used by tastings[${first}]`);
	}
	const name = text(where, raw, 'name', true, TASTING_NAME_LENGTH.max) ?? '';
	const motto = text(where, raw, 'motto', false, TASTING_MOTTO_LENGTH.max);

	if (!Array.isArray(raw.bottles) || raw.bottles.length === 0) {
		error(where, 'bottles must be a non-empty array');
		return { where, date, name, motto, participants: [], bottles: [] };
	}

	// The participants are the distinct broughtBy, each participant's slots
	// follow the order of their bottles (1, 2, 3 … without gaps).
	const participants = new Map<string, ImportParticipant>();
	const aliases = new Map<string, number>();
	const bottles: ImportBottle[] = [];
	raw.bottles.forEach((rawBottle: unknown, bottleIndex: number) => {
		const bottleWhere = `${where} bottles[${bottleIndex}]`;
		const fields = checkBottle(rawBottle, bottleWhere, baseDir);
		if (!fields) return;

		const key = foldCase(fields.broughtBy);
		let slot = 0;
		if (fields.broughtBy) {
			let participant = participants.get(key);
			if (!participant) {
				participant = { key, broughtBy: fields.broughtBy, bottles: [] };
				participants.set(key, participant);
			}
			participant.bottles.push(bottleIndex);
			slot = participant.bottles.length;
			if (slot === TASTING_BOTTLE_SLOTS.max + 1) {
				error(
					bottleWhere,
					`${fields.broughtBy} brings more than ${TASTING_BOTTLE_SLOTS.max} bottles`
				);
			}
		}

		if (fields.alias) {
			const aliasKey = foldCase(fields.alias);
			const first = aliases.get(aliasKey);
			if (first === undefined) {
				aliases.set(aliasKey, bottleIndex);
			} else {
				error(bottleWhere, `alias "${fields.alias}" is also used by bottles[${first}] (any case)`);
			}
		}

		bottles.push({ ...fields, where: bottleWhere, participant: key, slot, file: null });
	});

	if (
		participants.size < TASTING_PARTICIPANTS.min ||
		participants.size > TASTING_PARTICIPANTS.max
	) {
		error(
			where,
			`participants (distinct broughtBy): ${participants.size}, ` +
				`allowed ${TASTING_PARTICIPANTS.min} to ${TASTING_PARTICIPANTS.max}`
		);
	}

	return { where, date, name, motto, participants: [...participants.values()], bottles };
}

/**
 * The facts of one distillery (version 2). The values follow the rules of the
 * admin's edit (checkDistilleryFacts): the region only with the country
 * Schottland in the same entry. A source only with its value, http(s) only.
 */
function checkDistillery(
	raw: unknown,
	where: string,
	bottleKeys: Set<string>,
	keys: Map<string, number>,
	index: number
): ImportDistillery | null {
	if (!isFields(raw)) {
		error(where, 'must be an object');
		return null;
	}
	checkFieldNames(where, raw, DISTILLERY_FIELDS);

	const name = text(where, raw, 'name', true, TASTING_DISTILLERY_LENGTH.max) ?? '';
	const key = nameKey(name);
	if (name) {
		const first = keys.get(key);
		if (first !== undefined) {
			error(where, `name "${name}" is also used by distilleries[${first}] (any case)`);
		} else keys.set(key, index);
		if (isPlaceholderDistillery(name)) error(where, `"${name}" is a placeholder, not a distillery`);
		else if (!bottleKeys.has(key)) {
			error(where, `"${name}" is the distillery of no bottle in this file (any case)`);
		}
	}

	const country = text(where, raw, 'country', false, DISTILLERY_COUNTRY_LENGTH.max);
	const region = text(where, raw, 'region', false);
	const capacity = raw.capacity ?? null;
	const invalid = checkDistilleryFacts({
		country,
		region,
		capacity: typeof capacity === 'number' ? capacity : null
	});
	if (invalid.region) {
		error(
			where,
			`region must be one of ${SCOTTISH_REGIONS.join(', ')}, only with country "${SCOTLAND}"`
		);
	}
	const validCapacity = capacity === null || (typeof capacity === 'number' && !invalid.capacity);
	if (!validCapacity) {
		error(
			where,
			`capacity must be null or a whole number from ${DISTILLERY_CAPACITY.min} to ${DISTILLERY_CAPACITY.max}`
		);
	}

	const values: Record<DistilleryField, string | number | null> = {
		country,
		region: invalid.region ? null : region,
		capacity: validCapacity ? (capacity as number | null) : null
	};
	const facts: ImportDistillery['facts'] = {};
	for (const field of DISTILLERY_FACTS) {
		const source = text(where, raw, `${field}Source`, false, DISTILLERY_SOURCE_LENGTH.max);
		if (source !== null && !isValidDistillerySource(source)) {
			error(where, `${field}Source must be an http(s) link`);
		}
		if (source !== null && (raw[field] === undefined || raw[field] === null)) {
			error(where, `${field}Source without ${field}`);
		}
		const value = values[field];
		if (value !== null) facts[field] = { value, source };
	}
	return { where, key, name, facts, kept: [] };
}

function checkHistory(history: unknown, file: string, latestDate: string): ImportHistory {
	const where = basename(file);
	if (!isFields(history)) {
		error(where, 'must be an object with version and tastings');
		return { tastings: [], distilleries: [] };
	}
	checkFieldNames(where, history, HISTORY_FIELDS);
	if (history.version !== 1 && history.version !== 2) error(where, 'version must be 1 or 2');
	if (!Array.isArray(history.tastings) || history.tastings.length === 0) {
		error(where, 'tastings must be a non-empty array');
		return { tastings: [], distilleries: [] };
	}

	const baseDir = dirname(file);
	const dates = new Map<string, number>();
	const tastings = history.tastings.flatMap(
		(raw: unknown, index: number) => checkTasting(raw, index, baseDir, latestDate, dates) ?? []
	);

	if (history.distilleries === undefined) return { tastings, distilleries: [] };
	if (history.version !== 2) error(where, 'distilleries need version 2');
	if (!Array.isArray(history.distilleries)) {
		error(where, 'distilleries must be an array');
		return { tastings, distilleries: [] };
	}
	const bottleKeys = new Set(
		tastings.flatMap((tasting) => tasting.bottles.map((bottle) => nameKey(bottle.distillery)))
	);
	const keys = new Map<string, number>();
	const distilleries = history.distilleries.flatMap(
		(raw: unknown, index: number) =>
			checkDistillery(raw, `distilleries[${index}]`, bottleKeys, keys, index) ?? []
	);
	return { tastings, distilleries };
}

// ── Checks against the database ─────────────────────────────────────────────

/**
 * Whether the database is at exactly the migration state of this checkout:
 * as many rows in __drizzle_migrations as entries in the journal, the latest
 * created_at being the `when` of the last entry (the id column is always NULL
 * in SQLite, useless for comparing).
 */
function checkMigrations(sqlite: Database.Database): boolean {
	const journal = JSON.parse(
		readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8')
	) as { entries: { tag: string; when: number }[] };
	const last = journal.entries.at(-1);

	const table = sqlite
		.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'`)
		.get();
	if (!table) {
		error(
			'database',
			'no __drizzle_migrations table, not a Glen Idunno database? Skipped its checks'
		);
		return false;
	}

	const applied = sqlite
		.prepare('SELECT count(*) AS count, max(created_at) AS latest FROM __drizzle_migrations')
		.get() as { count: number; latest: number | null };
	if (applied.count !== journal.entries.length || Number(applied.latest) !== last?.when) {
		error(
			'database',
			`migration state differs from this checkout: ${applied.count} migrations applied ` +
				`(latest created_at ${applied.latest}), the journal has ${journal.entries.length} ` +
				`(latest ${last?.tag}, when ${last?.when}). Check out the release the database is on, ` +
				`this script never migrates. Skipped the other checks against the database`
		);
		return false;
	}
	return true;
}

/**
 * The user behind each participant: an existing user (deactivated ones too –
 * it's history) whose username matches broughtBy in any case. Never creates
 * users. Usernames are only unique case-sensitively, so a name can match
 * several users.
 */
function resolveUsers(sqlite: Database.Database, tastings: ImportTasting[]): Map<string, UserRow> {
	const rows = sqlite.prepare('SELECT id, username, deactivated_at FROM user').all() as UserRow[];
	const byKey = new Map<string, UserRow[]>();
	for (const user of rows) {
		const key = foldCase(user.username);
		byKey.set(key, [...(byKey.get(key) ?? []), user]);
	}

	const users = new Map<string, UserRow>();
	for (const tasting of tastings) {
		for (const participant of tasting.participants) {
			const matches = byKey.get(participant.key) ?? [];
			const where = `${tasting.where} bottles[${participant.bottles.join(', ')}]`;
			if (matches.length === 1) users.set(participant.key, matches[0]);
			else if (matches.length === 0) {
				error(where, `broughtBy "${participant.broughtBy}" matches no username`);
			} else {
				const names = matches.map((user) => user.username).join(', ');
				error(where, `broughtBy "${participant.broughtBy}" matches several users (${names})`);
			}
		}
	}
	return users;
}

function checkExistingTastings(sqlite: Database.Database, tastings: ImportTasting[]): void {
	// tasting_date has no unique index: this is what stops a second import.
	const existing = new Map(
		(
			sqlite.prepare('SELECT tasting_date, slug FROM tasting').all() as {
				tasting_date: string;
				slug: string;
			}[]
		).map((row) => [row.tasting_date, row.slug])
	);
	for (const tasting of tastings) {
		const slug = existing.get(tasting.date);
		if (slug !== undefined) {
			error(tasting.where, `a tasting on this date exists (/tasting/${slug})`);
		}
	}

	const freeSlugs = sqlite
		.prepare(
			`SELECT count(*) FROM tasting_slug_adjective a CROSS JOIN tasting_slug_animal n
			 WHERE a.word || '-' || n.word NOT IN (SELECT slug FROM tasting)`
		)
		.pluck()
		.get() as number;
	if (freeSlugs < tastings.length) {
		error('database', `only ${freeSlugs} free tasting links left for ${tastings.length} tastings`);
	}
}

// Found or set by the admin: such a value is never overwritten.
function isDecided(state: string): boolean {
	return state === 'found' || state === 'admin';
}

/**
 * The values the database keeps: a found or admin-set value is never
 * overwritten, and a region needs Schottland as the country after the import.
 * With `report` (the checks before writing) each one becomes a warning.
 */
function planDistilleries(
	sqlite: Database.Database,
	distilleries: ImportDistillery[],
	report: boolean
): void {
	const select = sqlite.prepare(
		'SELECT country, country_state, region_state, capacity_state FROM distillery WHERE name_key = ?'
	);
	for (const distillery of distilleries) {
		const row = select.get(distillery.key) as DistilleryRow | undefined;
		const decided = (field: DistilleryField) =>
			row !== undefined && isDecided(row[`${field}_state`]);
		distillery.kept = DISTILLERY_FACTS.filter((field) => distillery.facts[field] && decided(field));
		const country = decided('country')
			? row!.country
			: ((distillery.facts.country?.value as string | undefined) ?? null);
		const regionSkipped =
			distillery.facts.region !== undefined &&
			!distillery.kept.includes('region') &&
			country !== SCOTLAND;
		if (regionSkipped) distillery.kept.push('region');
		if (!report) continue;
		for (const field of distillery.kept) {
			warn(
				distillery.where,
				field === 'region' && regionSkipped
					? `region skipped, the country in the database is "${country}"`
					: `${field} is already ${row![`${field}_state`]} in the database and stays`
			);
		}
	}
}

/** Keys (fileNameKey) of all presentation file names the database uses. */
function takenFileKeys(sqlite: Database.Database): Set<string> {
	const files = sqlite
		.prepare('SELECT presentation_file FROM tasting_bottle WHERE presentation_file IS NOT NULL')
		.pluck()
		.all() as string[];
	return new Set(files.map(fileNameKey));
}

/**
 * Names the presentation files after the scheme in presentationFiles.ts,
 * unique against the database and the names given in this run – the same way
 * saveBottle() in tastings.ts does. A file of that name in MEDIA_PATH would be
 * overwritten by the rename after the commit, so that's an error.
 */
function assignFileNames(
	sqlite: Database.Database,
	tastings: ImportTasting[],
	mediaDir: string
): void {
	const taken = takenFileKeys(sqlite);
	for (const tasting of tastings) {
		for (const bottle of tasting.bottles) {
			if (!bottle.presentation) continue;
			const file = uniquePresentationFileName(
				presentationBaseName(tasting.date, bottle.alias),
				presentationExtension(bottle.presentation.name),
				taken
			);
			taken.add(fileNameKey(file));
			if (!PRESENTATION_FILE_RE.test(file)) {
				error(bottle.where, `"${file}" is no valid file name`);
			} else if (existsSync(join(mediaDir, file))) {
				error(bottle.where, `${file} exists in MEDIA_PATH`);
			}
			bottle.file = file;
		}
	}
}

// ── Writing (--apply) ───────────────────────────────────────────────────────

/**
 * Copies each bottle's presentation to a temporary .upload-<uuid> in
 * MEDIA_PATH – on disk, not through memory like stageUpload() in
 * tastingMedia.ts. A full disk shows up here, before the database is touched.
 * On failure every copy is removed again, a half-written one included.
 */
function stagePresentations(tastings: ImportTasting[], mediaDir: string): FileMove[] | null {
	const moves: FileMove[] = [];
	try {
		mkdirSync(mediaDir, { recursive: true });
		for (const bottle of tastings.flatMap((tasting) => tasting.bottles)) {
			if (!bottle.presentation || !bottle.file) continue;
			const temp = `.upload-${randomUUID()}`;
			moves.push({ temp, file: bottle.file });
			copyFileSync(bottle.presentation.path, join(mediaDir, temp), constants.COPYFILE_EXCL);
		}
		return moves;
	} catch (err) {
		console.error('\nCopying the presentations failed, nothing was written:', err);
		removeTempFiles(moves, mediaDir);
		return null;
	}
}

function removeTempFiles(moves: FileMove[], mediaDir: string): void {
	const left: string[] = [];
	for (const { temp } of moves) {
		try {
			rmSync(join(mediaDir, temp), { force: true });
		} catch {
			left.push(temp);
		}
	}
	if (left.length > 0) {
		console.error(`Couldn't remove from ${mediaDir}, delete by hand:\n  ${left.join('\n  ')}`);
	}
}

/**
 * Writes all tastings in one IMMEDIATE transaction, all or nothing, and
 * returns their slugs. Dates and file names were checked before; checked
 * again here under the write lock, so nothing that changed in between gets
 * through.
 */
function writeTastings(
	sqlite: Database.Database,
	{ tastings, distilleries }: ImportHistory,
	users: Map<string, UserRow>
): string[] {
	const now = Math.floor(Date.now() / 1000); // Unix seconds, like every timestamp column
	const existingSlug = sqlite.prepare('SELECT slug FROM tasting WHERE tasting_date = ?').pluck();
	// A free random <adjective>-<animal>; the tastings written before in this
	// transaction already count as taken.
	const freeSlug = sqlite
		.prepare(
			`SELECT a.word || '-' || n.word FROM tasting_slug_adjective a
			 CROSS JOIN tasting_slug_animal n
			 WHERE a.word || '-' || n.word NOT IN (SELECT slug FROM tasting)
			 ORDER BY random() LIMIT 1`
		)
		.pluck();
	// The motto's description (motto_description) isn't part of the format: it
	// stays NULL, the admin adds it on the tasting's admin page.
	const insertTasting = sqlite.prepare(
		`INSERT INTO tasting
		   (id, slug, name, motto, tasting_date, created_at, order_opened_at, revealed_at)
		 VALUES (@id, @slug, @name, @motto, @date, @now, NULL, NULL)`
	);
	const insertParticipant = sqlite.prepare(
		`INSERT INTO tasting_participant (id, tasting_id, user_id, created_at)
		 VALUES (@id, @tastingId, @userId, @now)`
	);
	const insertBottle = sqlite.prepare(
		`INSERT INTO tasting_bottle
		   (id, participant_id, slot, alias, distillery, bottler, bottling, age, whiskybase_url,
		    smoke, cask, abv, value, archived, updated_at, presentation_file, presentation_name)
		 VALUES
		   (@id, @participantId, @slot, @alias, @distillery, @bottler, @bottling, @age,
		    @whiskybaseUrl, NULL, NULL, @abv, NULL, 1, @now, @file, @name)`
	);

	const insertDistillery = sqlite.prepare(
		`INSERT INTO distillery (name_key, updated_at) VALUES (?, ?) ON CONFLICT (name_key) DO NOTHING`
	);
	// Imported values count as researched ("found", without a rules hash). The
	// state guard keeps found and admin-set values, the region needs the country.
	const updateFact = Object.fromEntries(
		DISTILLERY_FACTS.map((field) => [
			field,
			sqlite.prepare(
				`UPDATE distillery SET ${field} = @value, ${field}_state = 'found',
				   ${field}_source = @source, ${field}_rules = NULL, updated_at = @now
				 WHERE name_key = @key AND ${field}_state NOT IN ('found', 'admin')
				 ${field === 'region' ? `AND country = '${SCOTLAND}'` : ''}`
			)
		])
	) as Record<DistilleryField, Database.Statement>;

	const write = sqlite.transaction((): string[] => {
		const taken = takenFileKeys(sqlite);
		const slugs = tastings.map((tasting) => {
			const existing = existingSlug.get(tasting.date) as string | undefined;
			if (existing !== undefined) {
				throw new Error(`a tasting on ${tasting.date} exists by now (/tasting/${existing})`);
			}
			const slug = freeSlug.get() as string | undefined;
			if (slug === undefined) throw new Error('all tasting links are taken');

			const tastingId = randomUUID();
			insertTasting.run({
				id: tastingId,
				slug,
				name: tasting.name,
				motto: tasting.motto,
				date: tasting.date,
				now
			});

			// Same created_at for all: the participants show in rowid order,
			// i.e. in the order of their first bottle.
			const participantIds = new Map<string, string>();
			for (const participant of tasting.participants) {
				const id = randomUUID();
				participantIds.set(participant.key, id);
				insertParticipant.run({ id, tastingId, userId: users.get(participant.key)!.id, now });
			}

			for (const bottle of tasting.bottles) {
				if (bottle.file && taken.has(fileNameKey(bottle.file))) {
					throw new Error(`presentation file name ${bottle.file} is taken by now`);
				}
				insertBottle.run({
					id: randomUUID(),
					participantId: participantIds.get(bottle.participant),
					slot: bottle.slot,
					alias: bottle.alias,
					distillery: bottle.distillery,
					bottler: bottle.bottler,
					bottling: bottle.bottling,
					age: bottle.age,
					whiskybaseUrl: bottle.whiskybaseUrl,
					abv: bottle.abv,
					now,
					file: bottle.file,
					name: bottle.presentation?.name ?? null
				});
			}
			return slug;
		});

		// Planned again under the write lock, like the tastings are checked again.
		planDistilleries(sqlite, distilleries, false);
		for (const distillery of distilleries) {
			insertDistillery.run(distillery.key, now);
			for (const field of DISTILLERY_FACTS) {
				const fact = distillery.facts[field];
				if (!fact || distillery.kept.includes(field)) continue;
				updateFact[field].run({ key: distillery.key, value: fact.value, source: fact.source, now });
			}
		}
		return slugs;
	});
	return write.immediate();
}

/**
 * Gives the staged copies their final names, now that the database is
 * committed. Returns the moves that failed.
 */
function renameTempFiles(moves: FileMove[], mediaDir: string): (FileMove & { reason: string })[] {
	const failed: (FileMove & { reason: string })[] = [];
	for (const move of moves) {
		try {
			// Like isOwnFile() in tastingMedia.ts: only names the scheme or the
			// temp naming can produce reach path.join.
			if (!UPLOAD_TEMP_FILE_RE.test(move.temp) || !PRESENTATION_FILE_RE.test(move.file)) {
				throw new Error('unexpected file name');
			}
			renameSync(join(mediaDir, move.temp), join(mediaDir, move.file));
		} catch (err) {
			failed.push({ ...move, reason: err instanceof Error ? err.message : String(err) });
		}
	}
	return failed;
}

// ── Output ──────────────────────────────────────────────────────────────────

/** Per tasting date, participants, bottles and presentations, then the totals. */
function printSummary(
	{ tastings, distilleries }: ImportHistory,
	users: Map<string, UserRow>,
	slugs?: string[]
): void {
	let bottles = 0;
	let copies = 0;
	let bytes = 0;
	const sources = new Set<string>();

	tastings.forEach((tasting, index) => {
		const link = slugs ? `  /tasting/${slugs[index]}` : '';
		console.log(
			`\n${tasting.date}  ${tasting.name}${tasting.motto ? ` – ${tasting.motto}` : ''}${link}`
		);
		const participants = tasting.participants.map((participant) => {
			const user = users.get(participant.key)!;
			return user.deactivated_at === null ? user.username : `${user.username} (inactive)`;
		});
		console.log(`  participants: ${participants.join(', ')}`);

		const usernameWidth = Math.max(...participants.map((name) => name.length));
		const aliasWidth = Math.max(...tasting.bottles.map((bottle) => bottle.alias.length));
		for (const bottle of tasting.bottles) {
			const username = users.get(bottle.participant)!.username;
			const presentation = bottle.presentation
				? `${bottle.presentation.name} (${megabytes(bottle.presentation.size)}) → ${bottle.file}`
				: 'no presentation';
			console.log(
				`  ${username.padEnd(usernameWidth)} ${bottle.slot}  ${bottle.alias.padEnd(aliasWidth)}  ` +
					`${bottle.distillery}, ${bottle.abv} %  ${presentation}`
			);

			bottles++;
			if (bottle.presentation) {
				copies++;
				bytes += bottle.presentation.size;
				sources.add(bottle.presentation.path);
			}
		}
	});

	if (distilleries.length > 0) console.log('\ndistillery facts (kept: stays as in the database):');
	const nameWidth = Math.max(0, ...distilleries.map((distillery) => distillery.name.length));
	for (const distillery of distilleries) {
		const facts = DISTILLERY_FACTS.flatMap((field) => {
			const fact = distillery.facts[field];
			if (!fact) return [];
			const kept = distillery.kept.includes(field) ? ' (kept)' : '';
			return [`${field} ${fact.value}${fact.source ? ` <${fact.source}>` : ''}${kept}`];
		});
		console.log(`  ${distillery.name.padEnd(nameWidth)}  ${facts.join(', ') || 'no values'}`);
	}

	console.log(
		`\n${tastings.length} tastings, ${bottles} bottles, ${copies} presentation copies ` +
			`of ${sources.size} files (${megabytes(bytes)}), ${distilleries.length} distilleries with facts`
	);
}

function printList(title: string, lines: string[]): void {
	if (lines.length === 0) return;
	console.error(`\n${title}`);
	for (const line of lines) console.error(`  ${line}`);
}

// ── Main ────────────────────────────────────────────────────────────────────

function run(
	sqlite: Database.Database,
	history: unknown,
	historyPath: string,
	mediaDir: string,
	apply: boolean
): number {
	// The dry run can't write by accident. Not opened read-only: a read-only
	// connection leaves -wal/-shm next to a WAL database, a read-write one
	// removes them on close.
	if (!apply) sqlite.pragma('query_only = ON');
	sqlite.pragma('foreign_keys = ON');

	const latestDate = addDays(berlinToday(new Date()), -2);
	const schemaMatches = checkMigrations(sqlite);
	const checked = checkHistory(history, historyPath, latestDate);
	const { tastings } = checked;
	let users = new Map<string, UserRow>();
	if (schemaMatches) {
		users = resolveUsers(sqlite, tastings);
		checkExistingTastings(sqlite, tastings);
		planDistilleries(sqlite, checked.distilleries, true);
		if (errors.length === 0) assignFileNames(sqlite, tastings, mediaDir);
	}

	printList(`${warnings.length} warning(s):`, warnings);
	if (errors.length > 0) {
		printList(`${errors.length} problem(s), nothing was written:`, errors);
		return 1;
	}

	if (!apply) {
		printSummary(checked, users);
		console.log('\nDry run, nothing was written. Run again with --apply to import.');
		return 0;
	}

	console.log('\nCopying the presentations to MEDIA_PATH …');
	const moves = stagePresentations(tastings, mediaDir);
	if (!moves) return 1;

	let slugs: string[];
	try {
		slugs = writeTastings(sqlite, checked, users);
	} catch (err) {
		console.error('\nThe import failed, nothing was written:', err);
		removeTempFiles(moves, mediaDir);
		return 1;
	}

	const failed = renameTempFiles(moves, mediaDir);
	printSummary(checked, users, slugs);
	if (failed.length > 0) {
		printList(
			`The tastings are committed, but ${failed.length} presentation(s) couldn't be renamed in ` +
				`${mediaDir}. Discard the database copy and the media directory and start over:`,
			failed.map((move) => `${move.temp} → ${move.file} (${move.reason})`)
		);
		return 1;
	}
	console.log(`\nImported ${tastings.length} tastings.`);
	return 0;
}

const { apply, historyPath } = parseArguments();
const { dbPath, mediaPath } = resolveDevEnv();
const mediaDir = resolve(mediaPath);

console.log(`${apply ? 'Import' : 'Dry run'} of ${historyPath}`);
console.log(`  DB_PATH     ${resolve(dbPath)}`);
console.log(`  MEDIA_PATH  ${mediaDir}`);

const history = readHistory(historyPath);
if (!existsSync(dbPath)) {
	console.error(`\nNo database at ${resolve(dbPath)}.`);
	process.exit(1);
}

const sqlite = new Database(dbPath, { fileMustExist: true });
try {
	process.exitCode = run(sqlite, history, historyPath, mediaDir, apply);
} finally {
	// Writes the WAL back into the database file, so no -wal/-shm stays
	// next to it.
	sqlite.close();
}
