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

/**
 * Admin overrides of the clock rules (the "18-Uhr-" and "9-Uhr-Button"): when
 * the pouring order was opened resp. the tasting revealed ahead of time, `null`
 * if the button wasn't pressed. They only ever move the phase forward.
 */
export type ManualPhaseChanges = { orderOpenedAt: Date | null; revealedAt: Date | null };

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

/**
 * An uploaded presentation: the bottle id addresses the download route, the
 * original file name is shown. The name counts as content (it may reveal
 * the whisky), so it only leaves the server with the reveal.
 */
export type PresentationRef = { bottleId: string; name: string };

/** A bottle after the reveal: all fields plus bringer, score and presentation. */
export type RevealedBottle = TastingBottle & {
	position: number;
	broughtBy: string;
	score: number;
	presentation: PresentationRef | null;
};

/** Points each factor contributes to the score (they add up to it). */
export type ScoreBreakdown = { smoke: number; cask: number; abv: number; value: number };

// ── Scoring ──────────────────────────────────────────────────────────────
// Starting values, to be revisited after the first tasting with real bottles.
// Shared source of truth for the actual computation (tastingScore.ts, server-only)
// and the TastingScoreExplainer tile, which renders these same numbers for
// participants – so it can't import from $lib/server.

/** Weights of the normalized factors. They sum to 1, so the score spans 0–100. */
export const SCORE_WEIGHTS = { smoke: 0.4, cask: 0.3, abv: 0.2, value: 0.1 } as const;

/** ABV at or below the floor counts as 0, at or above floor + span as 1. */
export const ABV_FLOOR = 40;
export const ABV_SPAN = 20;

/**
 * Smoke groups are poured in ascending order before the score is compared:
 * group 1 = smoke 0–1, group 2 = 2–3, group 3 = 4–5 (upper bounds below).
 */
export const SMOKE_GROUP_UPPER_BOUNDS = [1, 3, 5] as const;

/** With `false` only the score (and the tie-breakers) decide the order. */
export const SMOKE_GROUPS_ENABLED = true;

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

/**
 * Formats an instant in Berlin time, e.g. "Sa., 24.10.2026 um 17:32 Uhr" – the
 * same for every viewer, independent of the device's time zone.
 */
export function formatTastingTimestamp(value: Date): string {
	const date = value.toLocaleDateString('de-DE', {
		timeZone: TASTING_TIME_ZONE,
		weekday: 'short',
		day: '2-digit',
		month: '2-digit',
		year: 'numeric'
	});
	const time = value.toLocaleTimeString('de-DE', {
		timeZone: TASTING_TIME_ZONE,
		hour: '2-digit',
		minute: '2-digit'
	});
	return `${date} um ${time} Uhr`;
}

/** German decimal with exactly one fraction digit, e.g. 46.3 → "46,3". */
export function formatOneDecimal(value: number): string {
	return value.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}
