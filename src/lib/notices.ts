// Notices the dashboard shows as a toast after a redirect (see
// redirectNotFound in $lib/server/authGuards.ts). Client-safe: the server
// builds the redirect and whitelists the parameter, the page shows the text.

/** Query parameter that carries the notice to the dashboard. */
export const NOTICE_PARAM = 'notice';

/**
 * Whitelist and text in one: only these values are shown, the text never
 * comes from the URL.
 */
export const NOTICES = {
	'not-found': 'Diese Seite gibt es nicht (mehr).'
} as const;

export type Notice = keyof typeof NOTICES;

const NOT_FOUND: Notice = 'not-found';

/**
 * Where every page-level 404 and 403 ends: one location for all causes, so
 * the response doesn't reveal which one applied.
 */
export const NOT_FOUND_LOCATION = `/?${NOTICE_PARAM}=${NOT_FOUND}`;

/** The notice for a parameter value, `null` for anything not whitelisted. */
export function parseNotice(value: string | null): Notice | null {
	// Object.hasOwn rather than `in`: keeps toString, __proto__ & co. out.
	return value !== null && Object.hasOwn(NOTICES, value) ? (value as Notice) : null;
}
