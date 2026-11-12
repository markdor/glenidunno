export type GuardContext = {
	authenticated: boolean;
};

export type GuardDecision = { action: 'resolve' } | { action: 'redirect'; location: string };

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
 * Pure decision for the global auth guard (see hooks.server.ts). Closed app,
 * nothing is usable anonymously:
 *   - /login, /health, /auth/* → public (login page, container healthcheck + Better Auth endpoints)
 *   - /share/*                 → public: a bottle's share link (issue #58), its
 *                                unguessable token is the only protection
 *   - everything else          → requires a session, else redirect to /login
 */
export function evaluateGuard(pathname: string, ctx: GuardContext): GuardDecision {
	const isPublic =
		pathname === '/login' ||
		pathname === '/health' ||
		underPrefix(pathname, '/auth') ||
		underPrefix(pathname, '/share');
	if (!isPublic && !ctx.authenticated) {
		return { action: 'redirect', location: '/login' };
	}

	return { action: 'resolve' };
}
