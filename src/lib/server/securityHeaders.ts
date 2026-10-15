import {
	TASTING_PRESENTATION_PDF_ROUTE_ID,
	TASTING_PRESENTATION_ROUTE_ID,
	TASTING_PRESENTATION_VIEW_ROUTE_ID,
	TASTING_ROUTE_ID
} from './tastingRoutes';

const NO_STORE = { 'cache-control': 'no-store' } as const;

const TASTING_ROUTE_IDS: ReadonlySet<string> = new Set([
	TASTING_ROUTE_ID,
	TASTING_PRESENTATION_ROUTE_ID,
	TASTING_PRESENTATION_PDF_ROUTE_ID,
	TASTING_PRESENTATION_VIEW_ROUTE_ID
]);

/**
 * Extra response headers per route ID, applied in hooks.server.ts after
 * resolve() so they also cover __data.json, action responses and the
 * redirect for a tasting the user doesn't take part in.
 *
 * - Participant page, its presentation downloads, the viewer and its PDF: no
 *   caching – the data is personal and changes with the phase, a cached page
 *   would not show the pouring order at 18:00.
 */
export function getSecurityHeaders(routeId: string | null): Record<string, string> {
	if (routeId !== null && TASTING_ROUTE_IDS.has(routeId)) return { ...NO_STORE };
	return {};
}
