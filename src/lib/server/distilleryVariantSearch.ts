import { and, asc, eq } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { nameKey } from '$lib/distilleryNames';
import type { DistilleryVariantSuggestion } from '$lib/tasting';
import type * as Schema from './db/schema';
import { distilleryVariantSuggestion } from './db/schema';
import { recordVariantCall, revealedDistilleries } from './distilleries';
import { anthropicMessages, type CreateMessage } from './distilleryResearch';
import { anthropicApiKey } from './distilleryResearchJob';
import { findDistilleryVariants, type VariantSuggestion } from './distilleryVariants';
import { logger } from './logger';

// The admin's variant search ("Varianten suchen" on /admin) and its stored
// suggestions. Only from the button: no timer, no reveal, no startup job –
// every search costs money. Only names of revealed tastings go to the API.

type Db = BetterSQLite3Database<typeof Schema>;

/**
 * - `searched`: `added` new suggestions (0 also without a call: fewer than
 *   two distilleries can't be variants of each other)
 * - `running`: a search is going on already
 * - `no-key`: ANTHROPIC_API_KEY isn't set
 * - `failed`: API error or no result, details only in the log
 */
export type VariantSearchResult =
	| { status: 'searched'; added: number }
	| { status: 'running' }
	| { status: 'no-key' }
	| { status: 'failed' };

export type VariantSearchOptions = {
	createClient?: (apiKey: string) => CreateMessage;
	now?: () => Date;
};

// One search at a time in this process (enough for one app instance, like the
// research's lock). Independent of the research: the search only writes
// suggestions and its costs.
let running = false;

export function isVariantSearchRunning(): boolean {
	return running;
}

// Order doesn't matter for a rejected pair: A → B rejected also rules out B → A.
function pairKey(a: string, b: string): string {
	return [a, b].sort().join('\u0000');
}

/**
 * Stores the new suggestions as open: none for a pair that is open or was
 * rejected already, in either direction. Returns how many were added.
 */
function storeSuggestions(db: Db, suggestions: VariantSuggestion[], now: Date): number {
	return db.transaction((tx) => {
		const known = new Set(
			tx
				.select({
					variantKey: distilleryVariantSuggestion.variantKey,
					targetKey: distilleryVariantSuggestion.targetKey
				})
				.from(distilleryVariantSuggestion)
				.all()
				.map((row) => pairKey(row.variantKey, row.targetKey))
		);
		let added = 0;
		for (const suggestion of suggestions) {
			const targetKey = nameKey(suggestion.targetName);
			const pair = pairKey(suggestion.variantKey, targetKey);
			if (known.has(pair)) continue;
			known.add(pair);
			tx.insert(distilleryVariantSuggestion)
				.values({ ...suggestion, targetKey, status: 'open', createdAt: now })
				.run();
			added++;
		}
		return added;
	});
}

/**
 * One search over the distilleries of the revealed tastings (without
 * placeholders), the costs counted per response. Never throws.
 */
export async function searchDistilleryVariants(
	db: Db,
	{ createClient = anthropicMessages, now = () => new Date() }: VariantSearchOptions = {}
): Promise<VariantSearchResult> {
	if (running) return { status: 'running' };
	const key = anthropicApiKey();
	if (!key) return { status: 'no-key' };
	const names = [...revealedDistilleries(db, now()).names.values()];
	if (names.length < 2) return { status: 'searched', added: 0 };

	running = true;
	try {
		const suggestions = await findDistilleryVariants(names, {
			createMessage: createClient(key),
			onCall: (call) => recordVariantCall(db, call, now())
		});
		const added = storeSuggestions(db, suggestions, now());
		// Counts only: no names on info/error.
		logger.info(
			{ distilleries: names.length, suggested: suggestions.length, added },
			'distillery variant search finished'
		);
		return { status: 'searched', added };
	} catch (err: unknown) {
		logger.error({ err }, 'distillery variant search failed');
		return { status: 'failed' };
	} finally {
		running = false;
	}
}

/**
 * The open suggestions whose variant is still a distillery of the revealed
 * tastings (a rename may have taken it in the meantime), oldest first, with
 * the variant's spelling and number of bottles.
 */
export function getVariantSuggestions(
	db: Db,
	now: Date = new Date()
): DistilleryVariantSuggestion[] {
	const { names, bottlesByKey } = revealedDistilleries(db, now);
	return db
		.select()
		.from(distilleryVariantSuggestion)
		.where(eq(distilleryVariantSuggestion.status, 'open'))
		.orderBy(asc(distilleryVariantSuggestion.id))
		.all()
		.flatMap((row) => {
			const variantName = names.get(row.variantKey);
			if (variantName === undefined) return [];
			return [
				{
					id: row.id,
					variantKey: row.variantKey,
					variantName,
					targetName: row.targetName,
					kind: row.kind,
					prefix: row.prefix,
					bottles: bottlesByKey.get(row.variantKey)?.length ?? 0
				}
			];
		});
}

/** Rejects an open suggestion for good; `false` if there is none with this ID. */
export function rejectVariantSuggestion(db: Db, id: number): boolean {
	const result = db
		.update(distilleryVariantSuggestion)
		.set({ status: 'rejected' })
		.where(
			and(eq(distilleryVariantSuggestion.id, id), eq(distilleryVariantSuggestion.status, 'open'))
		)
		.run();
	return result.changes > 0;
}
