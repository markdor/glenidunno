// The admin's distillery table (AdminDistilleryTable.svelte): columns, sort
// order, formatting and the preview of a rename. Client-safe like
// historyTable.ts; the sort state is local to the component, the admin page
// has no shareable table state.

import { isPlaceholderDistillery, nameKey } from '$lib/distilleryNames';
import type { SortDirection } from '$lib/historyTable';
import {
	applyBrandPrefix,
	formatBottleName,
	formatCount,
	type AdminDistillery
} from '$lib/tasting';
import {
	SCOTTISH_REGIONS,
	TASTING_BOTTLING_LENGTH,
	type DistilleryVariantKind
} from '$lib/validation';

export const DISTILLERY_SORT_KEYS = ['name', 'country', 'region', 'capacity', 'cost'] as const;
export type DistillerySortKey = (typeof DISTILLERY_SORT_KEYS)[number];

export const DISTILLERY_COLUMN_LABELS: Record<DistillerySortKey, string> = {
	name: 'Destillerie',
	country: 'Land',
	region: 'Region',
	capacity: 'Kapazität',
	cost: 'Kosten'
};

const text = new Intl.Collator('de');

// `null` without a value: never researched, not found, or no region (another
// country) – sorted last in both directions, like NAS in sortBottles().
function sortValue(distillery: AdminDistillery, key: DistillerySortKey): string | number | null {
	switch (key) {
		case 'name':
			return distillery.name;
		case 'country':
			return distillery.country.value;
		case 'region': {
			// In the order the rules check them (Islay … Lowlands), not alphabetically.
			const region = distillery.region?.value;
			return region ? SCOTTISH_REGIONS.indexOf(region) : null;
		}
		case 'capacity':
			return distillery.capacity.value;
		case 'cost':
			return distillery.costMicroUsd;
	}
}

/** Sorted copy; ties and missing values keep the alphabetical order of the names. */
export function sortDistilleries(
	distilleries: AdminDistillery[],
	key: DistillerySortKey,
	dir: SortDirection
): AdminDistillery[] {
	const sign = dir === 'asc' ? 1 : -1;
	return [...distilleries].sort((a, b) => {
		const x = sortValue(a, key);
		const y = sortValue(b, key);
		const byName = text.compare(a.name, b.name);
		if (x === null || y === null) {
			return x === y ? byName : Number(x === null) - Number(y === null);
		}
		const order = typeof x === 'string' ? text.compare(x, y as string) : x - (y as number);
		return sign * order || byName;
	});
}

/** Micro-dollars as US dollars with cents, e.g. 1234567 → "1,23 $". */
export function formatUsd(microUsd: number): string {
	return (microUsd / 1_000_000).toLocaleString('de-DE', { style: 'currency', currency: 'USD' });
}

/** The field error of a brand prefix that makes a bottling too long (client and server). */
export const BOTTLING_TOO_LONG = `Mit dem Präfix würde eine Abfüllung länger als ${TASTING_BOTTLING_LENGTH.max} Zeichen.`;

export const VARIANT_KIND_LABELS: Record<DistilleryVariantKind, string> = {
	spelling: 'Schreibvariante',
	brand: 'Marke'
};

/**
 * What saving the edit form with this name does, as the server decides it
 * (renameDistillery): only from the admin's view – merging into a row of a
 * tasting not revealed yet looks like a rename here.
 */
export type RenameKind = 'unchanged' | 'renamed' | 'merged' | 'placeholder' | 'respelled';

export type RenamePreview = {
	kind: RenameKind;
	/** The display name of the target, for a merge its spelling in the table. */
	target: string;
	/** The names of the bottles afterwards (formatBottleName), only with a brand prefix. */
	bottleNames: string[];
	/** With the prefix a bottling would exceed TASTING_BOTTLING_LENGTH: nothing is saved. */
	tooLong: boolean;
};

/**
 * The preview of saving `distillery` under `name`, with a brand prefix or
 * `null`. Unchanged only with the same spelling and without prefix: a prefix
 * alone rewrites the bottles, too.
 */
export function previewRename(
	distilleries: AdminDistillery[],
	distillery: AdminDistillery,
	name: string,
	prefix: string | null
): RenamePreview {
	const target = name.trim();
	const brand = prefix?.trim() || null;
	const bottlings = brand
		? distillery.bottles.map((bottle) => applyBrandPrefix(bottle.bottling, brand))
		: [];
	const key = nameKey(target);
	const existing = distilleries.find((d) => d.key === key && d.key !== distillery.key);
	const kind: RenameKind =
		target === distillery.name && !brand
			? 'unchanged'
			: key === distillery.key
				? 'respelled'
				: isPlaceholderDistillery(target)
					? 'placeholder'
					: existing
						? 'merged'
						: 'renamed';
	return {
		kind,
		target: existing?.name ?? target,
		bottleNames: distillery.bottles.flatMap((bottle, index) =>
			brand ? [formatBottleName({ ...bottle, distillery: target, bottling: bottlings[index] })] : []
		),
		tooLong: bottlings.some((bottling) => bottling.length > TASTING_BOTTLING_LENGTH.max)
	};
}

/** The text of the confirmation dialog for a rename (not for `unchanged`). */
export function renameMessage(distillery: AdminDistillery, preview: RenamePreview): string {
	const old = `„${distillery.name}“`;
	const target = `„${preview.target}“`;
	const bottles = formatCount(distillery.bottles.length, 'Flasche', 'Flaschen');
	const what: Record<Exclude<RenameKind, 'unchanged'>, string> = {
		renamed: `${old} wird in ${target} umbenannt (${bottles}).`,
		merged: `${old} wird mit ${target} zusammengeführt (${bottles}). ${target} behält seine Werte und übernimmt nur fehlende.`,
		placeholder: `${old} wird zum Platzhalter ${target} (${bottles}). Land, Region und Kapazität von ${old} werden gelöscht.`,
		respelled: `${old} wird in ${bottles} als ${target} geschrieben.`
	};
	const lines = [
		what[preview.kind as Exclude<RenameKind, 'unchanged'>],
		'Das lässt sich nicht rückgängig machen.'
	];
	if (preview.bottleNames.length > 0) lines.push('Die Flaschen heißen danach:');
	return lines.join(' ');
}
