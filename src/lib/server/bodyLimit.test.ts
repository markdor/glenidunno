import { describe, it, expect } from 'vitest';
import { TASTING_PRESENTATION_MAX_BYTES } from '$lib/validation';
import {
	bodyLimitFor,
	DEFAULT_BODY_LIMIT_BYTES,
	exceedsBodyLimit,
	UPLOAD_BODY_LIMIT_BYTES
} from './bodyLimit';
import { TASTING_PRESENTATION_ROUTE_ID, TASTING_ROUTE_ID as PAGE } from './tastingRoutes';

describe('bodyLimitFor', () => {
	it('allows the presentation upload only on the POST to the participant page', () => {
		expect(bodyLimitFor(PAGE, 'POST')).toBe(UPLOAD_BODY_LIMIT_BYTES);
		expect(UPLOAD_BODY_LIMIT_BYTES).toBeGreaterThan(TASTING_PRESENTATION_MAX_BYTES);
	});

	it.each([
		[PAGE, 'GET'],
		[TASTING_PRESENTATION_ROUTE_ID, 'POST'],
		['/admin/tastings/new', 'POST'],
		['/login', 'POST'],
		// Better Auth's /auth/* endpoints have no SvelteKit route.
		[null, 'POST']
	])('keeps %s (%s) at the default limit', (routeId, method) => {
		expect(bodyLimitFor(routeId, method)).toBe(DEFAULT_BODY_LIMIT_BYTES);
	});
});

describe('exceedsBodyLimit', () => {
	it('compares the declared content length with the route limit', () => {
		expect(exceedsBodyLimit(null, 'POST', String(DEFAULT_BODY_LIMIT_BYTES))).toBe(false);
		expect(exceedsBodyLimit(null, 'POST', String(DEFAULT_BODY_LIMIT_BYTES + 1))).toBe(true);
		expect(exceedsBodyLimit(PAGE, 'POST', String(UPLOAD_BODY_LIMIT_BYTES))).toBe(false);
		expect(exceedsBodyLimit(PAGE, 'POST', String(UPLOAD_BODY_LIMIT_BYTES + 1))).toBe(true);
	});

	it('leaves requests without or with a garbled length to the adapter limit', () => {
		expect(exceedsBodyLimit(null, 'POST', null)).toBe(false);
		expect(exceedsBodyLimit(null, 'POST', 'lots')).toBe(false);
	});
});
