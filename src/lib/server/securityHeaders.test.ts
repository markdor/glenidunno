import { describe, it, expect } from 'vitest';
import { getSecurityHeaders } from './securityHeaders';
import {
	SHARE_PDF_ROUTE_ID,
	SHARE_ROUTE_ID,
	TASTING_PRESENTATION_PDF_ROUTE_ID,
	TASTING_PRESENTATION_ROUTE_ID,
	TASTING_PRESENTATION_VIEW_ROUTE_ID,
	TASTING_ROUTE_ID
} from './tastingRoutes';

describe('getSecurityHeaders', () => {
	it.each([
		TASTING_ROUTE_ID,
		TASTING_PRESENTATION_ROUTE_ID,
		TASTING_PRESENTATION_PDF_ROUTE_ID,
		TASTING_PRESENTATION_VIEW_ROUTE_ID
	])('disables caching on the participant route %s', (routeId) => {
		expect(getSecurityHeaders(routeId)).toEqual({ 'cache-control': 'no-store' });
	});

	it.each([SHARE_ROUTE_ID, SHARE_PDF_ROUTE_ID])(
		'keeps the public share route %s out of caches, referrers and search engines',
		(routeId) => {
			expect(getSecurityHeaders(routeId)).toEqual({
				'cache-control': 'no-store',
				'referrer-policy': 'no-referrer',
				'x-robots-tag': 'noindex'
			});
		}
	);

	it.each([null, '/', '/admin', '/admin/tastings', '/admin/tastings/[id]', '/login', '/[...rest]'])(
		'adds nothing for %s',
		(routeId) => {
			expect(getSecurityHeaders(routeId)).toEqual({});
		}
	);
});
