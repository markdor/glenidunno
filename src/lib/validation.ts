// Shared validation constraints for client and server. Deliberately not under
// $lib/server: the login form runs isValidEmail() in the browser, so this module
// must stay free of server-only imports.

/**
 * Length limit for email addresses.
 *
 * Shared validation constraint: used by the login form
 * (`login/+page.svelte`) and the admin user management (`admin/+page.server.ts`),
 * so client and server validation don't drift apart.
 */
export const EMAIL_LENGTH = { max: 254 } as const;

/** Regex for a roughly plausible email format (not a full RFC 5322 parser). */
export const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Checks format ({@link EMAIL_REGEX}) and length ({@link EMAIL_LENGTH}) in one step. */
export function isValidEmail(value: string): boolean {
	return EMAIL_REGEX.test(value) && value.length <= EMAIL_LENGTH.max;
}

/**
 * Regex for valid usernames.
 *
 * Shared validation constraint: currently only used by the admin user
 * management, but lives here together with the other auth validation constraints.
 */
export const USERNAME_RE = /^[a-zA-Z0-9_.-]{2,40}$/;

// ── Whisky tasting ──────────────────────────────────────────────────────────
// Single source for the form attributes (maxlength/min/max), the server-side
// validation and the CHECK constraints in db/schema.ts. Changing a limit means
// generating a new migration (`npm run db:generate`).

export const TASTING_NAME_LENGTH = { max: 60 } as const;
/**
 * Optional motto heading shown next to name and date; empty means none.
 * Deliberately without a CHECK constraint (see `motto` in db/schema.ts), so the
 * server-side validation is the only guard.
 */
export const TASTING_MOTTO_LENGTH = { max: 120 } as const;
/**
 * Optional multi-line explanation of the motto, only together with a heading.
 * Counted after normalizing line breaks to `\n` and trimming, like a
 * textarea's maxlength counts. No CHECK constraint either.
 */
export const TASTING_MOTTO_DESCRIPTION_LENGTH = { max: 1000 } as const;
/** Number of users the admin picks as participants of a tasting. */
export const TASTING_PARTICIPANTS = { min: 2, max: 12 } as const;
/**
 * Bottle slots of a participant. Slots 1..`base` are always there and set the
 * participant's target in the entry progress (max(base, own bottles)); the
 * participant adds the slots up to `max` themselves. `max` is also the bound
 * of the CHECK on tasting_bottle.slot – changing it rebuilds that table.
 */
export const TASTING_BOTTLE_SLOTS = { base: 2, max: 6 } as const;

export const TASTING_ALIAS_LENGTH = { max: 30 } as const;
export const TASTING_DISTILLERY_LENGTH = { max: 60 } as const;
/** Independent bottler; empty means original bottling. */
export const TASTING_BOTTLER_LENGTH = { max: 60 } as const;
export const TASTING_BOTTLING_LENGTH = { max: 120 } as const;
/** Age statement in years; empty means NAS. */
export const TASTING_AGE = { min: 1, max: 80 } as const;
export const TASTING_WHISKYBASE_URL_LENGTH = { max: 300 } as const;
/** 0–5 scale shared by smoke, cask and value. */
export const TASTING_SCALE = { min: 0, max: 5 } as const;
/** Alcohol by volume in percent, one decimal place. */
export const TASTING_ABV = { min: 35, max: 75, step: 0.1 } as const;

/**
 * Optional presentation per bottle (usually PowerPoint), stored byte for byte.
 * The upload request may be slightly larger (form fields, multipart framing):
 * see UPLOAD_BODY_LIMIT_BYTES in $lib/server/bodyLimit.ts and BODY_SIZE_LIMIT
 * in the Dockerfile.
 */
export const TASTING_PRESENTATION_MAX_BYTES = 30 * 1024 * 1024;
export const TASTING_PRESENTATION_NAME_LENGTH = { max: 255 } as const;

/**
 * Format of a tasting's link `/tasting/<adjective>-<animal>`: two words from
 * the lists seeded into the database (lower-case a–z only, so the hyphen is
 * an unambiguous separator). Used by the param matcher
 * (src/params/tastingSlug.ts), which also runs in the browser.
 */
export const TASTING_SLUG_RE = /^[a-z]+-[a-z]+$/;

/** Checks for a real calendar date in `YYYY-MM-DD` form (no 2026-02-30). */
export function isValidTastingDate(value: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return (
		date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
	);
}

/** True for an absolute `http:`/`https:` URL – never `javascript:` or the like. */
export function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

const WHISKYBASE_HOSTS = new Set(['whiskybase.com', 'www.whiskybase.com']);

/**
 * Returns the normalized URL if `value` is an `https:` link to whiskybase.com
 * (or www.), otherwise `null`. Parsed with `new URL()` rather than a regex so
 * `javascript:` links, look-alike hosts (whiskybase.com.evil.io) and embedded
 * credentials can't slip into the reveal page.
 */
export function normalizeWhiskybaseUrl(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	const valid =
		url.protocol === 'https:' &&
		WHISKYBASE_HOSTS.has(url.hostname) &&
		!url.username &&
		!url.password &&
		!url.port &&
		url.href.length <= TASTING_WHISKYBASE_URL_LENGTH.max;
	return valid ? url.href : null;
}

const WHISKYBASE_WHISKY_PATH = /^\/whiskies\/whisky\/(\d+)(?:\/|$)/;

/**
 * The whisky's ID from a Whiskybase link (`/whiskies/whisky/<id>[/…]`), the
 * same with and without `www.`. `null` for any other page, host or no URL.
 */
export function whiskybaseId(value: string): string | null {
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		return null;
	}
	if (!WHISKYBASE_HOSTS.has(url.hostname)) return null;
	return WHISKYBASE_WHISKY_PATH.exec(url.pathname)?.[1] ?? null;
}

// ── Distilleries ────────────────────────────────────────────────────────────
// Facts the app researches once per distillery (src/lib/server/distilleryResearch.ts)
// and the admin corrects on /admin. Single source for the admin form, the
// server-side validation, the history import, the enum of the research's result
// tool and the CHECK constraints of the `distillery` table.

/** Country, in German; Scotland, England, Wales and Northern Ireland count as countries. */
export const DISTILLERY_COUNTRY_LENGTH = { max: 60 } as const;
/** Production capacity in litres of pure alcohol per year; grain distilleries exceed 100 million. */
export const DISTILLERY_CAPACITY = { min: 1, max: 1_000_000_000 } as const;
/** Source link of a researched or imported value. */
export const DISTILLERY_SOURCE_LENGTH = { max: 2048 } as const;
/** The editable rules of the research prompt (the admin's deviation from the default). */
export const DISTILLERY_PROMPT_LENGTH = { max: 20_000 } as const;

/** The only country with a region. */
export const SCOTLAND = 'Schottland';

/**
 * Whisky regions of Scotland in the order the rules check them: the first one
 * that applies wins, also with contradicting sources (Highlands before Lowlands).
 */
export const SCOTTISH_REGIONS = [
	'Islay',
	'Campbeltown',
	'Inseln',
	'Speyside',
	'Highlands',
	'Lowlands'
] as const;
export type ScottishRegion = (typeof SCOTTISH_REGIONS)[number];

export function isScottishRegion(value: string): value is ScottishRegion {
	return (SCOTTISH_REGIONS as readonly string[]).includes(value);
}

/**
 * State of one value (country, region, capacity) of a distillery:
 * - `pending`: never researched
 * - `found`: researched or imported, with its source
 * - `admin`: set by the admin
 * - `empty`: not found (`null`) – researched without result or cleared by the admin
 */
export const DISTILLERY_VALUE_STATES = ['pending', 'found', 'admin', 'empty'] as const;
export type DistilleryValueState = (typeof DISTILLERY_VALUE_STATES)[number];

/**
 * Kind of a variant the Claude API suggests (src/lib/server/distilleryVariants.ts):
 * - `spelling`: another spelling of the same distillery
 * - `brand`: a brand of the distillery entered as distillery; with a prefix
 *   for the front of the bottling
 */
export const DISTILLERY_VARIANT_KINDS = ['spelling', 'brand'] as const;
export type DistilleryVariantKind = (typeof DISTILLERY_VARIANT_KINDS)[number];

export type DistilleryFacts = {
	country: string | null;
	region: string | null;
	capacity: number | null;
};

/**
 * Checks country, region and capacity (`null` = no value) by the rules the
 * admin's edit and the history import share: the country is free text within
 * its length, the region one of SCOTTISH_REGIONS and only for exactly
 * `Schottland`, the capacity a whole number in range. Returns the invalid fields.
 */
export function checkDistilleryFacts(
	facts: DistilleryFacts
): Partial<Record<keyof DistilleryFacts, 'invalid'>> {
	const errors: Partial<Record<keyof DistilleryFacts, 'invalid'>> = {};
	const { country, region, capacity } = facts;
	if (
		country !== null &&
		(country.length === 0 ||
			country.trim() !== country ||
			country.length > DISTILLERY_COUNTRY_LENGTH.max)
	) {
		errors.country = 'invalid';
	}
	if (region !== null && (!isScottishRegion(region) || country !== SCOTLAND)) {
		errors.region = 'invalid';
	}
	if (
		capacity !== null &&
		(!Number.isInteger(capacity) ||
			capacity < DISTILLERY_CAPACITY.min ||
			capacity > DISTILLERY_CAPACITY.max)
	) {
		errors.capacity = 'invalid';
	}
	return errors;
}

/** A source link the app stores and renders: `http(s)` only and within its length. */
export function isValidDistillerySource(value: string): boolean {
	return isHttpUrl(value) && value.length <= DISTILLERY_SOURCE_LENGTH.max;
}
