import { PUBLIC_ROUTE_IDS, underPrefix } from './guard';

const NO_STORE = { 'cache-control': 'no-store' } as const;

/**
 * Extra response headers per route ID, applied in hooks.server.ts after
 * resolve() so they also cover __data.json, action responses and the 404 of
 * an unknown token.
 *
 * - Participant link and its presentation downloads: no referrer (the URL
 *   carries the token), no indexing, and no caching – the content changes
 *   with the phase, a cached page would not show the pouring order at 18:00.
 * - /admin/tastings/*: no caching, since links are shown there exactly once.
 */
export function getSecurityHeaders(routeId: string | null): Record<string, string> {
	if (routeId !== null && PUBLIC_ROUTE_IDS.has(routeId)) {
		return {
			'referrer-policy': 'no-referrer',
			'x-robots-tag': 'noindex, nofollow',
			...NO_STORE
		};
	}
	if (routeId !== null && underPrefix(routeId, '/admin/tastings')) {
		return { ...NO_STORE };
	}
	return {};
}
