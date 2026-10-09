import { describe, it, expect } from 'vitest';
import { evaluateGuard } from './guard';

const anonymous = { authenticated: false };
const loggedIn = { authenticated: true };

describe('evaluateGuard', () => {
	describe('public routes', () => {
		it('lets unauthenticated users reach /login', () => {
			expect(evaluateGuard('/login', anonymous)).toEqual({ action: 'resolve' });
		});

		it('lets unauthenticated requests reach /health (container healthcheck)', () => {
			expect(evaluateGuard('/health', anonymous)).toEqual({ action: 'resolve' });
		});

		it('lets Better Auth endpoints through', () => {
			expect(evaluateGuard('/auth/sign-in/magic-link', anonymous)).toEqual({
				action: 'resolve'
			});
		});

		it('treats the bare /auth path as public', () => {
			expect(evaluateGuard('/auth', anonymous)).toEqual({ action: 'resolve' });
		});
	});

	describe('prefix matching does not leak (fail-open) to sibling paths', () => {
		it('does not treat /author as a public Better Auth endpoint', () => {
			// startsWith('/auth') would wrongly let this through unauthenticated.
			expect(evaluateGuard('/author', anonymous)).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('does not treat /healthcheck as the public /health path', () => {
			expect(evaluateGuard('/healthcheck', anonymous)).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});
	});

	describe('tastings need a login', () => {
		// Including the old anonymous token links: they are gone for good.
		it.each([
			'/tasting',
			'/tasting/fluffy-otter',
			'/tasting/fluffy-otter/presentation/some-id',
			`/tasting/${'a'.repeat(32)}`,
			'/admin/tastings',
			'/admin/tastings/new'
		])('redirects anonymous requests to %s', (path) => {
			expect(evaluateGuard(path, anonymous)).toEqual({ action: 'redirect', location: '/login' });
		});

		it('resolves a tasting link for a logged-in user (the route checks participation)', () => {
			expect(evaluateGuard('/tasting/fluffy-otter', loggedIn)).toEqual({ action: 'resolve' });
		});
	});

	describe('protected routes', () => {
		it('redirects unauthenticated users to /login', () => {
			expect(evaluateGuard('/', anonymous)).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('redirects unauthenticated users away from /admin', () => {
			expect(evaluateGuard('/admin', anonymous)).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('resolves for an authenticated user', () => {
			expect(evaluateGuard('/admin', loggedIn)).toEqual({ action: 'resolve' });
		});

		// /api/* gets no special treatment: it must fall under the normal session
		// guard like any other route, never become a public path.
		it.each(['/api', '/api/users'])('redirects unauthenticated requests to %s', (path) => {
			expect(evaluateGuard(path, anonymous)).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('resolves /api/* only for an authenticated user', () => {
			expect(evaluateGuard('/api/users', loggedIn)).toEqual({ action: 'resolve' });
		});
	});
});
