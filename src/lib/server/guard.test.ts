import { describe, it, expect } from 'vitest';
import { evaluateGuard } from './guard';

const anonymous = (routeId: string | null) => ({ authenticated: false, routeId });
const loggedIn = (routeId: string | null) => ({ authenticated: true, routeId });

describe('evaluateGuard', () => {
	describe('public routes', () => {
		it('lets unauthenticated users reach /login', () => {
			expect(evaluateGuard('/login', anonymous('/login'))).toEqual({ action: 'resolve' });
		});

		it('lets unauthenticated requests reach /health (container healthcheck)', () => {
			expect(evaluateGuard('/health', anonymous('/health'))).toEqual({ action: 'resolve' });
		});

		it('lets Better Auth endpoints through', () => {
			expect(evaluateGuard('/auth/sign-in/magic-link', anonymous(null))).toEqual({
				action: 'resolve'
			});
		});

		it('treats the bare /auth path as public', () => {
			expect(evaluateGuard('/auth', anonymous(null))).toEqual({ action: 'resolve' });
		});

		it('lets anonymous visitors open a participant token link', () => {
			expect(
				evaluateGuard(`/tasting/${'a'.repeat(32)}`, anonymous('/tasting/[token=tastingToken]'))
			).toEqual({ action: 'resolve' });
		});

		it('lets anonymous visitors download presentations through their link', () => {
			expect(
				evaluateGuard(
					`/tasting/${'a'.repeat(32)}/presentation/some-id`,
					anonymous('/tasting/[token=tastingToken]/presentation/[bottleId]')
				)
			).toEqual({ action: 'resolve' });
		});
	});

	describe('prefix matching does not leak (fail-open) to sibling paths', () => {
		it('does not treat /author as a public Better Auth endpoint', () => {
			// startsWith('/auth') would wrongly let this through unauthenticated.
			expect(evaluateGuard('/author', anonymous(null))).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('does not treat /healthcheck as the public /health path', () => {
			expect(evaluateGuard('/healthcheck', anonymous(null))).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});
	});

	describe('the tasting exception is an exact route ID, not a path prefix', () => {
		// A token rejected by the param matcher, or /tasting without a token,
		// matches no route at all.
		it.each(['/tasting', '/tasting/not-a-token', `/tasting/${'a'.repeat(32)}/extra`])(
			'redirects anonymous requests to %s without a matched route',
			(path) => {
				expect(evaluateGuard(path, anonymous(null))).toEqual({
					action: 'redirect',
					location: '/login'
				});
			}
		);

		it.each([
			'/admin/tastings',
			'/admin/tastings/new',
			'/admin/tastings/[id]',
			'/admin/tastings/[id]/presentation/[bottleId]'
		])('keeps the admin route %s protected', (routeId) => {
			expect(evaluateGuard(routeId, anonymous(routeId))).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});
	});

	describe('protected routes', () => {
		it('redirects unauthenticated users to /login', () => {
			expect(evaluateGuard('/', anonymous('/'))).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('redirects unauthenticated users away from /admin', () => {
			expect(evaluateGuard('/admin', anonymous('/admin'))).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('resolves for an authenticated user', () => {
			expect(evaluateGuard('/admin', loggedIn('/admin'))).toEqual({ action: 'resolve' });
		});

		// /api/* gets no special treatment: it must fall under the normal session
		// guard like any other route, never become a public path.
		it.each(['/api', '/api/users'])('redirects unauthenticated requests to %s', (path) => {
			expect(evaluateGuard(path, anonymous(null))).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('resolves /api/* only for an authenticated user', () => {
			expect(evaluateGuard('/api/users', loggedIn(null))).toEqual({ action: 'resolve' });
		});
	});
});
