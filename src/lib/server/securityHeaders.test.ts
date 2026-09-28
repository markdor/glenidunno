import { describe, it, expect } from 'vitest';
import { getSecurityHeaders } from './securityHeaders';

describe('getSecurityHeaders', () => {
	it.each([
		'/tasting/[token=tastingToken]',
		'/tasting/[token=tastingToken]/presentation/[bottleId]'
	])('locks down the public participant route %s', (routeId) => {
		expect(getSecurityHeaders(routeId)).toEqual({
			'referrer-policy': 'no-referrer',
			'x-robots-tag': 'noindex, nofollow',
			'cache-control': 'no-store'
		});
	});

	it.each([
		'/admin/tastings',
		'/admin/tastings/new',
		'/admin/tastings/[id]',
		'/admin/tastings/[id]/presentation/[bottleId]'
	])('disables caching on %s, where links are shown once', (routeId) => {
		expect(getSecurityHeaders(routeId)).toEqual({ 'cache-control': 'no-store' });
	});

	it.each([null, '/', '/admin', '/admin/tastingsx', '/login'])('adds nothing for %s', (routeId) => {
		expect(getSecurityHeaders(routeId)).toEqual({});
	});
});
