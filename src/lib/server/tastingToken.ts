import { createHash, randomBytes } from 'node:crypto';

/**
 * New participant link token: 24 random bytes as base64url, i.e. 32
 * characters from [A-Za-z0-9_-] and 192 bits – not guessable, so the public
 * route needs no per-IP rate limit. Format: TASTING_TOKEN_RE in validation.ts.
 */
export function generateTastingToken(): string {
	return randomBytes(24).toString('base64url');
}

/**
 * Only this SHA-256 hash is stored. The plaintext token exists solely in the
 * response of the create/regenerate actions and is shown to the admin once.
 */
export function hashTastingToken(token: string): string {
	return createHash('sha256').update(token).digest('hex');
}

/** Full participant link on top of the app's public base URL. */
export function buildTastingLink(baseUrl: string, token: string): string {
	return new URL(`/tasting/${token}`, baseUrl).href;
}
