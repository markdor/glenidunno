export type GuardContext = {
	authenticated: boolean;
	/** SvelteKit route ID of the request (`event.route.id`), `null` if no route matched. */
	routeId: string | null;
};

export type GuardDecision = { action: 'resolve' } | { action: 'redirect'; location: string };

/** A tasting participant's token link – the page anonymous visitors may use. */
export const PUBLIC_TASTING_ROUTE_ID = '/tasting/[token=tastingToken]';

/** Download of a bottle's presentation through a participant's token link. */
export const PUBLIC_PRESENTATION_ROUTE_ID = '/tasting/[token=tastingToken]/presentation/[bottleId]';

/**
 * Deliberate, narrow exception from the closed app, matched by exact route ID
 * rather than by pathname: no prefix match on /tasting, and a token rejected
 * by the param matcher yields no route (`null`), which stays protected.
 */
export const PUBLIC_ROUTE_IDS: ReadonlySet<string> = new Set([
	PUBLIC_TASTING_ROUTE_ID,
	PUBLIC_PRESENTATION_ROUTE_ID
]);

/**
 * Exact segment-prefix match: matches the path itself or any sub-path, but not
 * an unrelated sibling. `/auth` and `/auth/x` match, `/author` does not. Using
 * a plain `startsWith('/auth')` would fail open – a future route like `/author`
 * would be treated as a public Better Auth endpoint and skip the session check.
 */
export function underPrefix(pathname: string, prefix: string): boolean {
	return pathname === prefix || pathname.startsWith(prefix + '/');
}

/**
 * Pure decision for the global auth guard (see hooks.server.ts):
 *   - /login, /health, /auth/* → public (login page, container healthcheck + Better Auth endpoints)
 *   - PUBLIC_ROUTE_IDS           → public (participant token link and its downloads)
 *   - everything else          → requires a session, else redirect to /login
 */
export function evaluateGuard(pathname: string, ctx: GuardContext): GuardDecision {
	const isPublic =
		pathname === '/login' ||
		pathname === '/health' ||
		underPrefix(pathname, '/auth') ||
		(ctx.routeId !== null && PUBLIC_ROUTE_IDS.has(ctx.routeId));
	if (!isPublic && !ctx.authenticated) {
		return { action: 'redirect', location: '/login' };
	}

	return { action: 'resolve' };
}
