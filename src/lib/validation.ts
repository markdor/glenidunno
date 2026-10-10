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
 * Optional motto shown next to name and date; empty means none. Deliberately
 * without a CHECK constraint (see `motto` in db/schema.ts), so the server-side
 * validation is the only guard.
 */
export const TASTING_MOTTO_LENGTH = { max: 120 } as const;
/** Number of users the admin picks as participants of a tasting. */
export const TASTING_PARTICIPANTS = { min: 2, max: 12 } as const;
export const TASTING_BOTTLES_PER_PARTICIPANT = { min: 1, max: 6, default: 2 } as const;

export const TASTING_ALIAS_LENGTH = { max: 30 } as const;
export const TASTING_DISTILLERY_LENGTH = { max: 60 } as const;
/** Independent bottler; empty means original bottling. */
export const TASTING_BOTTLER_LENGTH = { max: 60 } as const;
export const TASTING_BOTTLING_LENGTH = { max: 80 } as const;
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
