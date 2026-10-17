// Database side of the distillery facts: what the research looks for and what
// it may write, the costs of its calls (also those of the variant search), the
// editable research rules and the admin's table, edit and rename. The research
// itself is distilleryResearch.ts, the runs and their triggers
// distilleryResearchJob.ts, the variant search distilleryVariantSearch.ts.

import { and, eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { distinctDistilleryNames, isPlaceholderDistillery, nameKey } from '$lib/distilleryNames';
import { applyBrandPrefix, type AdminDistillery, type DistilleryFact } from '$lib/tasting';
import {
	SCOTLAND,
	TASTING_BOTTLING_LENGTH,
	type DistilleryFacts,
	type DistilleryValueState,
	type ScottishRegion
} from '$lib/validation';
import type * as Schema from './db/schema';
import {
	appSetting,
	distillery,
	distilleryResearchCall,
	distilleryVariantCall,
	distilleryVariantSuggestion,
	tastingBottle
} from './db/schema';
import {
	DEFAULT_RESEARCH_RULES,
	rulesHash,
	type FoundFact,
	type ResearchCall,
	type ResearchFacts,
	type ResearchField
} from './distilleryResearch';
import type { VariantCall } from './distilleryVariants';
import {
	listReleasedDistilleryNames,
	listRevealedDistilleryBottles,
	type DistilleryBottle
} from './tastings';

type Db = BetterSQLite3Database<typeof Schema>;
type DistilleryRow = typeof distillery.$inferSelect;
type NewDistillery = typeof distillery.$inferInsert;
/** The database or a transaction on it. */
type Executor = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

/**
 * `pending`: timer and "Jetzt auflösen" – only values never researched.
 * `manual` (the job's button): additionally the `null` values, also those the
 * admin cleared.
 */
export type ResearchMode = 'pending' | 'manual';

/** A distillery of a released tasting with the values still to look for. */
export type ResearchTarget = {
	key: string;
	/** First spelling among the released bottles – what the API gets. */
	name: string;
	fields: ResearchField[];
	knownCountry: string | null;
};

const FIELDS: readonly ResearchField[] = ['country', 'region', 'capacity'];

// The four columns of each value.
const COLUMNS = {
	country: {
		value: 'country',
		state: 'countryState',
		source: 'countrySource',
		rules: 'countryRules'
	},
	region: { value: 'region', state: 'regionState', source: 'regionSource', rules: 'regionRules' },
	capacity: {
		value: 'capacity',
		state: 'capacityState',
		source: 'capacitySource',
		rules: 'capacityRules'
	}
} as const satisfies Record<ResearchField, Record<string, keyof DistilleryRow>>;

function stateOf(row: DistilleryRow | undefined, field: ResearchField): DistilleryValueState {
	return row ? row[COLUMNS[field].state] : 'pending';
}

// The stored value, only for found or admin-set values (the CHECK guarantees
// that the column is null otherwise).
function valueOf(row: DistilleryRow | undefined, field: ResearchField): string | number | null {
	return row ? row[COLUMNS[field].value] : null;
}

function researchable(state: DistilleryValueState, mode: ResearchMode): boolean {
	return state === 'pending' || (mode === 'manual' && state === 'empty');
}

// Found or set by the admin: a value that stays for good.
function known(row: DistilleryRow | undefined, field: ResearchField): boolean {
	const state = stateOf(row, field);
	return state === 'found' || state === 'admin';
}

/**
 * The values of one distillery to look for. A found or admin-set value never
 * is; the region only with a known Scotland or a country looked for alongside.
 */
function fieldsToResearch(
	row: DistilleryRow | undefined,
	mode: ResearchMode
): Pick<ResearchTarget, 'fields' | 'knownCountry'> {
	const country = researchable(stateOf(row, 'country'), mode);
	const knownCountry = (valueOf(row, 'country') as string | null) ?? null;
	const fields = FIELDS.filter((field) => {
		if (!researchable(stateOf(row, field), mode)) return false;
		return field !== 'region' || country || knownCountry === SCOTLAND;
	});
	return { fields, knownCountry: country ? null : knownCountry };
}

function rowsByKey(db: Db, keys: string[]): Map<string, DistilleryRow> {
	if (keys.length === 0) return new Map();
	const rows = db.select().from(distillery).where(inArray(distillery.nameKey, keys)).all();
	return new Map(rows.map((row) => [row.nameKey, row]));
}

// When each distillery was last sent to the API (its latest research call),
// in seconds; missing if never.
function lastResearched(db: Db, keys: string[]): Map<string, number> {
	if (keys.length === 0) return new Map();
	const rows = db
		.select({
			key: distilleryResearchCall.nameKey,
			at: sql<number>`max(${distilleryResearchCall.createdAt})`
		})
		.from(distilleryResearchCall)
		.where(inArray(distilleryResearchCall.nameKey, keys))
		.groupBy(distilleryResearchCall.nameKey)
		.all();
	return new Map(rows.map((row) => [row.key, row.at]));
}

/**
 * The distilleries of released tastings that still have a value to look for:
 * those with a value never researched first, then the rest; within both the
 * ones researched longest ago first. The time of the last research, not of the
 * last change: an admin's edit doesn't push a value back, and a limited run
 * takes neither the same values not found nor the same failing ones every time.
 */
export function researchTargets(
	db: Db,
	mode: ResearchMode,
	now: Date = new Date()
): ResearchTarget[] {
	const names = distinctDistilleryNames(listReleasedDistilleryNames(db, now));
	const keys = [...names.keys()];
	const rows = rowsByKey(db, keys);
	const researchedAt = lastResearched(db, keys);
	return [...names]
		.flatMap(([key, name]) => {
			const row = rows.get(key);
			const target = fieldsToResearch(row, mode);
			if (target.fields.length === 0) return [];
			// Never researched: what the timer would look for, too.
			const group = !row || fieldsToResearch(row, 'pending').fields.length > 0 ? 0 : 1;
			return [{ target: { key, name, ...target }, group, at: researchedAt.get(key) ?? 0 }];
		})
		.sort((a, b) => a.group - b.group || a.at - b.at)
		.map(({ target }) => target);
}

/**
 * The target again right before its API call: in the meantime another run or
 * the admin may have decided values. `null` if nothing is left to look for.
 */
export function refreshTarget(
	db: Db,
	target: ResearchTarget,
	mode: ResearchMode
): ResearchTarget | null {
	const current = fieldsToResearch(rowsByKey(db, [target.key]).get(target.key), mode);
	return current.fields.length > 0 ? { ...target, ...current } : null;
}

function columnsFor(
	field: ResearchField,
	value: string | number | null,
	state: DistilleryValueState,
	source: string | null,
	rules: string | null
): Partial<NewDistillery> {
	const c = COLUMNS[field];
	return { [c.value]: value, [c.state]: state, [c.source]: source, [c.rules]: rules };
}

function upsert(db: Executor, key: string, update: Partial<NewDistillery>, now: Date) {
	db.insert(distillery)
		.values({ ...update, nameKey: key, updatedAt: now })
		.onConflictDoUpdate({ target: distillery.nameKey, set: { ...update, updatedAt: now } })
		.run();
}

/**
 * Stores the decided values of a research in one transaction. A value that
 * is no longer researchable (found or set by the admin, also in the meantime)
 * is never overwritten; a region only with Scotland as country.
 */
export function applyResearchResult(
	db: Db,
	key: string,
	facts: ResearchFacts,
	rules: string,
	mode: ResearchMode,
	now: Date = new Date()
): void {
	const hash = rulesHash(rules);
	db.transaction((tx) => {
		const row = tx.select().from(distillery).where(eq(distillery.nameKey, key)).get();
		let update: Partial<NewDistillery> = {};
		let country = valueOf(row, 'country');
		for (const field of FIELDS) {
			const fact: FoundFact<unknown> | undefined = facts[field];
			if (fact === undefined || !researchable(stateOf(row, field), mode)) continue;
			if (field === 'region' && country !== SCOTLAND) continue;
			const value = (fact?.value ?? null) as string | number | null;
			update = {
				...update,
				...columnsFor(
					field,
					value,
					fact ? 'found' : 'empty',
					fact?.source ?? null,
					fact ? hash : null
				)
			};
			if (field === 'country') country = value;
		}
		if (Object.keys(update).length > 0) upsert(tx, key, update, now);
	});
}

/** Stores one API response with its costs, also one without a result. */
export function recordResearchCall(
	db: Db,
	key: string,
	call: ResearchCall,
	now: Date = new Date()
): void {
	db.insert(distilleryResearchCall)
		.values({ ...call, nameKey: key, createdAt: now })
		.run();
}

/** Stores one API response of the variant search with its costs, also one without a result. */
export function recordVariantCall(db: Db, call: VariantCall, now: Date = new Date()): void {
	db.insert(distilleryVariantCall)
		.values({ ...call, createdAt: now })
		.run();
}

/**
 * Estimated costs of all calls so far: the research (also discarded ones and
 * hidden distilleries) and the variant search.
 */
export function getTotalResearchCost(db: Db): number {
	const research = db
		.select({ total: sql<number>`coalesce(sum(${distilleryResearchCall.costMicroUsd}), 0)` })
		.from(distilleryResearchCall)
		.get();
	const variants = db
		.select({ total: sql<number>`coalesce(sum(${distilleryVariantCall.costMicroUsd}), 0)` })
		.from(distilleryVariantCall)
		.get();
	return (research?.total ?? 0) + (variants?.total ?? 0);
}

// ── Research rules ────────────────────────────────────────────────────────

const RULES_SETTING = 'distillery_research_rules';

/** The rules in effect: the admin's deviation or else the default of the code. */
export function getResearchRules(db: Db): { text: string; custom: boolean } {
	const row = db
		.select({ value: appSetting.value })
		.from(appSetting)
		.where(eq(appSetting.key, RULES_SETTING))
		.get();
	return row ? { text: row.value, custom: true } : { text: DEFAULT_RESEARCH_RULES, custom: false };
}

/** Stores only a deviation: the default text itself removes it. */
export function saveResearchRules(db: Db, text: string, now: Date = new Date()): void {
	if (text === DEFAULT_RESEARCH_RULES) {
		resetResearchRules(db);
		return;
	}
	db.insert(appSetting)
		.values({ key: RULES_SETTING, value: text, updatedAt: now })
		.onConflictDoUpdate({ target: appSetting.key, set: { value: text, updatedAt: now } })
		.run();
}

/** Back to the default of the code, including its improvements with the next deployment. */
export function resetResearchRules(db: Db): void {
	db.delete(appSetting).where(eq(appSetting.key, RULES_SETTING)).run();
}

// ── Admin table ───────────────────────────────────────────────────────────

function fact<T>(row: DistilleryRow | undefined, field: ResearchField): DistilleryFact<T> {
	return {
		value: valueOf(row, field) as T | null,
		state: stateOf(row, field),
		source: row ? row[COLUMNS[field].source] : null
	};
}

/**
 * The distilleries of the revealed tastings: name key → first spelling, and
 * their bottles. Only these: name keys, display names and bottles of
 * unrevealed tastings must not reach the admin page (blind for everyone).
 */
export function revealedDistilleries(db: Db, now: Date = new Date()) {
	const bottles = listRevealedDistilleryBottles(db, now);
	const names = distinctDistilleryNames(bottles.map((bottle) => bottle.distillery));
	const bottlesByKey = new Map<string, DistilleryBottle[]>();
	for (const bottle of bottles) {
		const key = nameKey(bottle.distillery);
		bottlesByKey.set(key, [...(bottlesByKey.get(key) ?? []), bottle]);
	}
	return { names, bottlesByKey };
}

/**
 * The admin's distillery table: every distillery of a revealed tasting with
 * its values, costs and the name fields of its bottles. Fields picked
 * explicitly; the region only for Scotland.
 */
export function getAdminDistilleries(db: Db, now: Date = new Date()): AdminDistillery[] {
	const { names, bottlesByKey } = revealedDistilleries(db, now);
	const keys = [...names.keys()];
	const rows = rowsByKey(db, keys);
	const costs = new Map(
		keys.length === 0
			? []
			: db
					.select({
						key: distilleryResearchCall.nameKey,
						cost: sql<number>`sum(${distilleryResearchCall.costMicroUsd})`
					})
					.from(distilleryResearchCall)
					.where(inArray(distilleryResearchCall.nameKey, keys))
					.groupBy(distilleryResearchCall.nameKey)
					.all()
					.map((c) => [c.key, c.cost])
	);
	return [...names].map(([key, name]) => {
		const row = rows.get(key);
		return {
			key,
			name,
			country: fact<string>(row, 'country'),
			region: valueOf(row, 'country') === SCOTLAND ? fact<ScottishRegion>(row, 'region') : null,
			capacity: fact<number>(row, 'capacity'),
			costMicroUsd: costs.get(key) ?? 0,
			bottles: (bottlesByKey.get(key) ?? []).map((bottle) => ({
				age: bottle.age,
				bottling: bottle.bottling,
				bottler: bottle.bottler
			}))
		};
	});
}

/**
 * The admin's edit of one row's values (already validated). Only a changed
 * value changes its state: set → `admin` (without source), cleared → `empty`
 * (looked for again by the job's button, after the values never researched).
 * Moving the country away from Scotland makes the region "never researched"
 * again.
 */
function applyFactsEdit(tx: Executor, key: string, input: DistilleryFacts, now: Date): void {
	const row = tx.select().from(distillery).where(eq(distillery.nameKey, key)).get();
	let update: Partial<NewDistillery> = {};
	const change = (field: ResearchField, value: string | number | null) => {
		if (value === valueOf(row, field)) return;
		update = {
			...update,
			...columnsFor(field, value, value === null ? 'empty' : 'admin', null, null)
		};
	};
	change('country', input.country);
	if (input.country === SCOTLAND) change('region', input.region);
	else if (valueOf(row, 'country') !== input.country) {
		update = { ...update, ...columnsFor('region', null, 'pending', null, null) };
	}
	change('capacity', input.capacity);
	if (Object.keys(update).length > 0) upsert(tx, key, update, now);
}

/**
 * The admin's edit of one row's values (see applyFactsEdit). `false` for a
 * distillery that isn't in the admin's table.
 */
export function updateDistilleryFacts(
	db: Db,
	key: string,
	input: DistilleryFacts,
	now: Date = new Date()
): boolean {
	if (!revealedDistilleries(db, now).names.has(key)) return false;
	db.transaction((tx) => applyFactsEdit(tx, key, input, now));
	return true;
}

// ── Rename and merge ──────────────────────────────────────────────────────

export type RenameInput = {
	/** The new distillery name, trimmed and validated. */
	name: string;
	/** A brand for the front of the bottlings (trimmed), `null` without. */
	prefix: string | null;
	/** The values of the edit form, applied to the old name first. */
	facts: DistilleryFacts;
};

/**
 * - `renamed`: the row moved to the new key
 * - `merged`: into a distillery that already exists (in the table or as a row)
 * - `placeholder`: into "Blend" or "Unbekannt", the values are gone
 * - `respelled`: same name key, only the bottles changed
 */
export type RenameStatus = 'renamed' | 'merged' | 'placeholder' | 'respelled';

export type RenameResult =
	| { status: RenameStatus; bottles: number }
	| { status: 'not-found' }
	| { status: 'bottling-too-long' };

// The variant's values the target takes over: every found or admin-set one
// for which the target has none. A region only if the target's country is
// Scotland afterwards (CHECK distillery_region_country).
function mergeInto(tx: Executor, key: string, source: DistilleryRow, now: Date): void {
	const row = tx.select().from(distillery).where(eq(distillery.nameKey, key)).get();
	let update: Partial<NewDistillery> = {};
	let country = valueOf(row, 'country');
	for (const field of FIELDS) {
		if (known(row, field) || !known(source, field)) continue;
		if (field === 'region' && country !== SCOTLAND) continue;
		const c = COLUMNS[field];
		update = {
			...update,
			...columnsFor(field, source[c.value], source[c.state], source[c.source], source[c.rules])
		};
		if (field === 'country') country = source.country;
	}
	if (Object.keys(update).length > 0) upsert(tx, key, update, now);
}

/**
 * The admin renames a distillery of the revealed tastings (input validated):
 * every bottle of a revealed tasting with this name key gets the new name,
 * archived ones included; bottles of tastings not revealed yet stay as they
 * are. Optionally a brand goes to the front of their bottlings – nothing is
 * written if one would get too long. The values of the edit form apply to the
 * old name first; then its row moves to the new key or is merged into the
 * existing one, and its research calls follow. Not reversible: a later rename
 * doesn't split merged bottles again.
 */
export function renameDistillery(
	db: Db,
	key: string,
	input: RenameInput,
	now: Date = new Date()
): RenameResult {
	const { names, bottlesByKey } = revealedDistilleries(db, now);
	if (!names.has(key)) return { status: 'not-found' };
	const bottles = (bottlesByKey.get(key) ?? []).map((bottle) => ({
		id: bottle.id,
		bottling:
			input.prefix === null ? bottle.bottling : applyBrandPrefix(bottle.bottling, input.prefix)
	}));
	if (bottles.some((b) => (b.bottling?.length ?? 0) > TASTING_BOTTLING_LENGTH.max)) {
		return { status: 'bottling-too-long' };
	}

	const target = nameKey(input.name);
	const status: RenameStatus =
		target === key
			? 'respelled'
			: isPlaceholderDistillery(input.name)
				? 'placeholder'
				: // A row without a revealed bottle (released or orphaned) can't take the key either.
					names.has(target) || rowsByKey(db, [target]).has(target)
					? 'merged'
					: 'renamed';

	db.transaction((tx) => {
		applyFactsEdit(tx, key, input.facts, now);
		for (const bottle of bottles) {
			tx.update(tastingBottle)
				.set({ distillery: input.name, bottling: bottle.bottling, updatedAt: now })
				.where(eq(tastingBottle.id, bottle.id))
				.run();
		}
		if (status === 'respelled') return;

		if (status === 'renamed') {
			tx.update(distillery)
				.set({ nameKey: target, updatedAt: now })
				.where(eq(distillery.nameKey, key))
				.run();
		} else {
			const source = tx.select().from(distillery).where(eq(distillery.nameKey, key)).get();
			if (status === 'merged' && source) mergeInto(tx, target, source, now);
			tx.delete(distillery).where(eq(distillery.nameKey, key)).run();
		}
		// The costs go along: the total stays the same, the target's sum is complete.
		tx.update(distilleryResearchCall)
			.set({ nameKey: target })
			.where(eq(distilleryResearchCall.nameKey, key))
			.run();
		// Done with, the variant is gone; rejected pairs stay.
		tx.delete(distilleryVariantSuggestion)
			.where(
				and(
					eq(distilleryVariantSuggestion.variantKey, key),
					eq(distilleryVariantSuggestion.status, 'open')
				)
			)
			.run();
	});
	return { status, bottles: bottles.length };
}
