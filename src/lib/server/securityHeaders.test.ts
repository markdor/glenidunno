import { describe, it, expect } from 'vitest';
import { getSecurityHeaders } from './securityHeaders';
import { TASTING_PRESENTATION_ROUTE_ID, TASTING_ROUTE_ID } from './tastingRoutes';

describe('getSecurityHeaders', () => {
	it.each([TASTING_ROUTE_ID, TASTING_PRESENTATION_ROUTE_ID])(
		'disables caching on the participant route %s',
		(routeId) => {
			expect(getSecurityHeaders(routeId)).toEqual({ 'cache-control': 'no-store' });
		}
	);

	it.each([null, '/', '/admin', '/admin/tastings', '/admin/tastings/[id]', '/login'])(
		'adds nothing for %s',
		(routeId) => {
			expect(getSecurityHeaders(routeId)).toEqual({});
		}
	);
});
