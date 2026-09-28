// Whisky tasting domain: phase boundaries, shared types and display helpers.
// Like validation.ts this module must stay free of server-only imports – the
// participant page and the admin pages render dates and bottle names in the
// browser as well.

/**
 * Time zone all tasting phases are computed in. The container runs in UTC
 * (no TZ is set), so the server converts `now` to Berlin local time instead of
 * relying on the process time zone.
 */
export const TASTING_TIME_ZONE = 'Europe/Berlin';

/** Local hour on the tasting day from which only the pouring order is shown. */
export const TASTING_ORDER_HOUR = 18;

/** Local hour on the day after the tasting from which everything is revealed. */
export const TASTING_REVEAL_HOUR = 9;

/**
 * - `entry`: participants enter their bottles, nobody sees anyone else's
 * - `order`: from 18:00 on the tasting day, only the pouring order of the aliases
 * - `revealed`: from 9:00 on the following day, everything
 */
export type TastingPhase = 'entry' | 'order' | 'revealed';

export const TASTING_PHASE_LABEL: Record<TastingPhase, string> = {
	entry: 'Eingabe',
	order: 'Reihenfolge',
	revealed: 'Aufgelöst'
};

/** A bottle as entered by its participant. Empty optional fields are `null`. */
export type TastingBottle = {
	alias: string;
	distillery: string;
	/** Independent bottler; `null` means original bottling. */
	bottler: string | null;
	bottling: string | null;
	/** Age statement in years; `null` means NAS. */
	age: number | null;
	whiskybaseUrl: string | null;
	smoke: number;
	cask: number;
	abv: number;
	value: number;
};

// View types of the phase-dependent projection (src/lib/server/tastings.ts),
// shared with the components that render them.

/** Entry progress of a participant or a whole tasting. */
export type Progress = { entered: number; total: number };

/** Position in the pouring order – everything the `order` phase may show. */
export type OrderEntry = { position: number; alias: string };

/** A bottle after the reveal: all fields plus bringer and score. */
export type RevealedBottle = TastingBottle & { position: number; broughtBy: string; score: number };

/** Points each factor contributes to the score (they add up to it). */
export type ScoreBreakdown = { smoke: number; cask: number; abv: number; value: number };

/** Admin-only: the reveal plus the score breakdown. */
export type RevealedBottleWithBreakdown = RevealedBottle & { breakdown: ScoreBreakdown };

/** Display name from the name fields, e.g. "Caol Ila 12 Jahre Distillers Edition (Signatory)". */
export function formatBottleName(
	bottle: Pick<TastingBottle, 'distillery' | 'age' | 'bottling' | 'bottler'>
): string {
	const parts = [bottle.distillery];
	if (bottle.age !== null) parts.push(`${bottle.age} Jahre`);
	if (bottle.bottling) parts.push(bottle.bottling);
	const name = parts.join(' ');
	return bottle.bottler ? `${name} (${bottle.bottler})` : name;
}

/**
 * Formats a calendar date (`YYYY-MM-DD`) as e.g. "Sa., 24.10.2026". Parsed and
 * formatted in UTC so the day never shifts with the viewer's time zone.
 */
export function formatTastingDate(date: string): string {
	return new Date(`${date}T00:00:00Z`).toLocaleDateString('de-DE', {
		timeZone: 'UTC',
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
}

/** German decimal with exactly one fraction digit, e.g. 46.3 → "46,3". */
export function formatOneDecimal(value: number): string {
	return value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
