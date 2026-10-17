// The admin's distillery table (AdminDistilleryTable.svelte): columns, sort
// order and formatting. Client-safe like historyTable.ts; the sort state is
// local to the component, the admin page has no shareable table state.

import type { SortDirection } from '$lib/historyTable';
import type { AdminDistillery } from '$lib/tasting';
import { SCOTTISH_REGIONS } from '$lib/validation';

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
