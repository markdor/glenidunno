// Distillery names as participants enter them (free text). Shared by the
// statistics, the distillery research and scripts/import-history.ts – the
// script loads this file by Node type stripping, so it must stay without
// imports and without TypeScript syntax that can't be stripped (enums,
// parameter properties).

/**
 * Placeholders of the tasting history: they stand in the tables, but count as
 * a distillery neither in the statistics nor in the research.
 */
export const PLACEHOLDER_DISTILLERIES: ReadonlySet<string> = new Set(['blend', 'unbekannt']);

/**
 * Distilleries and bottlers are grouped by name, ignoring case. Spelling
 * variants ("Bruichladdich" vs. "Bruichladdich Distillery") stay apart.
 */
export function nameKey(name: string): string {
	return name.trim().toLocaleLowerCase('de-DE');
}

export function isPlaceholderDistillery(name: string): boolean {
	return PLACEHOLDER_DISTILLERIES.has(nameKey(name));
}

/** Counts per name key; the name shown is the first spelling in the given order. */
export function groupByName(names: string[]): Array<{ name: string; count: number }> {
	const groups = new Map<string, { name: string; count: number }>();
	for (const name of names) {
		const group = groups.get(nameKey(name));
		if (group) group.count++;
		else groups.set(nameKey(name), { name: name.trim(), count: 1 });
	}
	return [...groups.values()];
}
