import { describe, it, expect } from 'vitest';
import { getSecurityHeaders } from './securityHeaders';

describe('getSecurityHeaders', () => {
	it('locks down the public participant route', () => {
		expect(getSecurityHeaders('/tasting/[token=tastingToken]')).toEqual({
			'referrer-policy': 'no-referrer',
			'x-robots-tag': 'noindex, nofollow',
			'cache-control': 'no-store'
		});
	});

	it.each(['/admin/tastings', '/admin/tastings/new', '/admin/tastings/[id]'])(
		'disables caching on %s, where links are shown once',
		(routeId) => {
			expect(getSecurityHeaders(routeId)).toEqual({ 'cache-control': 'no-store' });
		}
	);

	it.each([null, '/', '/admin', '/admin/tastingsx', '/login'])('adds nothing for %s', (routeId) => {
		expect(getSecurityHeaders(routeId)).toEqual({});
	});
});
