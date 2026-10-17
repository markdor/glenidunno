// Database side of the distillery facts: what the research looks for and what
// it may write, the costs of its calls, the editable research rules and the
// admin's table and edit. The research itself is distilleryResearch.ts, the
// runs and their triggers distilleryResearchJob.ts.

import { eq, inArray, sql } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import type { AdminDistillery, DistilleryFact } from '$lib/tasting';
import {
	SCOTLAND,
	type DistilleryFacts,
	type DistilleryValueState,
	type ScottishRegion
} from '$lib/validation';
import type * as Schema from './db/schema';
import { appSetting, distillery, distilleryResearchCall } from './db/schema';
import { isPlaceholderDistillery, nameKey } from './distilleryNames';
import {
	DEFAULT_RESEARCH_RULES,
	rulesHash,
	type FoundFact,
	type ResearchCall,
	type ResearchFacts,
	type ResearchField
} from './distilleryResearch';
import { listReleasedDistilleryNames, listRevealedDistilleryNames } from './tastings';

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

// Distinct name keys in the given order, without placeholders: key → first spelling.
function namesByKey(names: string[]): Map<string, string> {
	const byKey = new Map<string, string>();
	for (const name of names) {
		const key = nameKey(name);
		if (key && !isPlaceholderDistillery(name) && !byKey.has(key)) byKey.set(key, name.trim());
	}
	return byKey;
}

function rowsByKey(db: Db, keys: string[]): Map<string, DistilleryRow> {
	if (keys.length === 0) return new Map();
	const rows = db.select().from(distillery).where(inArray(distillery.nameKey, keys)).all();
	return new Map(rows.map((row) => [row.nameKey, row]));
}

/**
 * The distilleries of released tastings that still have a value to look for:
 * those with a value never researched first, then the ones touched longest
 * ago – a limited run doesn't take the same values not found every time.
 */
export function researchTargets(
	db: Db,
	mode: ResearchMode,
	now: Date = new Date()
): ResearchTarget[] {
	const names = namesByKey(listReleasedDistilleryNames(db, now));
	const rows = rowsByKey(db, [...names.keys()]);
	return [...names]
		.flatMap(([key, name]) => {
			const row = rows.get(key);
			const target = fieldsToResearch(row, mode);
			if (target.fields.length === 0) return [];
			// Never researched: what the timer would look for, too.
			const neverResearched = !row || fieldsToResearch(row, 'pending').fields.length > 0;
			const rank = neverResearched ? 0 : row.updatedAt.getTime();
			return [{ target: { key, name, ...target }, rank }];
		})
		.sort((a, b) => a.rank - b.rank)
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

/** Estimated costs of all research calls so far, also discarded ones and hidden distilleries. */
export function getTotalResearchCost(db: Db): number {
	const row = db
		.select({ total: sql<number>`coalesce(sum(${distilleryResearchCall.costMicroUsd}), 0)` })
		.from(distilleryResearchCall)
		.get();
	return row?.total ?? 0;
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

// Only distilleries of revealed tastings: name keys and display names of
// unrevealed bottles must not reach the admin page (blind for everyone).
function revealedNames(db: Db, now: Date): Map<string, string> {
	return namesByKey(listRevealedDistilleryNames(db, now));
}

/**
 * The admin's distillery table: every distillery of a revealed tasting with
 * its values and costs. Fields picked explicitly; the region only for Scotland.
 */
export function getAdminDistilleries(db: Db, now: Date = new Date()): AdminDistillery[] {
	const names = revealedNames(db, now);
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
			costMicroUsd: costs.get(key) ?? 0
		};
	});
}

/**
 * The admin's edit of one row (already validated). Only a changed value
 * changes its state: set → `admin` (without source), cleared → `empty`
 * (looked for again with the next "Neu starten"). Moving the country away
 * from Scotland makes the region "never researched" again. `false` for a
 * distillery that isn't in the admin's table.
 */
export function updateDistilleryFacts(
	db: Db,
	key: string,
	input: DistilleryFacts,
	now: Date = new Date()
): boolean {
	if (!revealedNames(db, now).has(key)) return false;
	db.transaction((tx) => {
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
	});
	return true;
}
