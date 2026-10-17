// Distillery names as participants enter them (free text). Shared by the
// statistics, the distillery research, the admin's distillery table, the input
// help of the participant page and scripts/import-history.ts – the script
// loads this file by Node type stripping, so it must stay without imports and
// without TypeScript syntax that can't be stripped (enums, parameter
// properties). Client-safe: the admin's rename dialog and the input help use
// nameKey() in the browser.

/**
 * Placeholders of the tasting history: they stand in the tables, but count as
 * a distillery neither in the statistics nor in the research.
 */
export const PLACEHOLDER_DISTILLERIES: ReadonlySet<string> = new Set(['blend', 'unbekannt']);

/**
 * Distilleries and bottlers are grouped by name, ignoring case. Spelling
 * variants ("Bruichladdich" vs. "Bruichladdich Distillery") stay apart until
 * the admin merges them on /admin – that rewrites the bottles, there is no
 * mapping of names.
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

/**
 * The distinct distilleries among these names in the given order, without
 * placeholders: name key → first spelling.
 */
export function distinctDistilleryNames(names: string[]): Map<string, string> {
	const byKey = new Map<string, string>();
	for (const name of names) {
		const key = nameKey(name);
		if (key && !isPlaceholderDistillery(name) && !byKey.has(key)) byKey.set(key, name.trim());
	}
	return byKey;
}
