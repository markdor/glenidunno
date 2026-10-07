import { TASTING_PRESENTATION_MAX_BYTES } from '$lib/validation';
import { TASTING_ROUTE_ID } from './tastingRoutes';

/** SvelteKit's usual limit – kept for every request except the bottle upload. */
export const DEFAULT_BODY_LIMIT_BYTES = 512 * 1024;

/**
 * The save action of the participant page carries the presentation upload plus
 * a few form fields and the multipart framing. adapter-node's BODY_SIZE_LIMIT
 * (Dockerfile) must be at least this large, but applies to every route – so
 * hooks.server.ts puts all other routes back to the default.
 */
export const UPLOAD_BODY_LIMIT_BYTES = TASTING_PRESENTATION_MAX_BYTES + 1024 * 1024;

/** Allowed request body size for a route and method. */
export function bodyLimitFor(routeId: string | null, method: string): number {
	return method === 'POST' && routeId === TASTING_ROUTE_ID
		? UPLOAD_BODY_LIMIT_BYTES
		: DEFAULT_BODY_LIMIT_BYTES;
}

/**
 * True if the declared Content-Length exceeds the route's limit. Requests
 * without a length (chunked) are still capped by adapter-node's
 * BODY_SIZE_LIMIT while their body is read.
 */
export function exceedsBodyLimit(
	routeId: string | null,
	method: string,
	contentLength: string | null
): boolean {
	if (contentLength === null) return false;
	const length = Number(contentLength);
	return Number.isFinite(length) && length > bodyLimitFor(routeId, method);
}
