// The title of a tasting: its motto or, without one, "Tasting #<n>" – its
// running number among all tastings (tastingNumbers() in
// src/lib/server/tastings.ts). Client-safe.

/** "Tasting #<n>": the title without a motto, the subtitle with one. */
export function tastingLabel(number: number): string {
	return `Tasting #${number}`;
}

/** What a tasting is called everywhere: the motto, or "Tasting #<n>" without one. */
export function tastingTitle(tasting: { motto: string | null; number: number }): string {
	return tasting.motto ?? tastingLabel(tasting.number);
}

/**
 * The line between title and date in the tasting lists: "Tasting #<n>" for a
 * tasting with a motto, `null` without one – its title says it already.
 */
export function tastingSubtitle(tasting: { motto: string | null; number: number }): string | null {
	return tasting.motto ? tastingLabel(tasting.number) : null;
}
