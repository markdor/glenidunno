import { describe, it, expect } from 'vitest';
import { evaluateGuard } from './guard';

describe('evaluateGuard', () => {
	describe('public routes', () => {
		it('lets unauthenticated users reach /login', () => {
			expect(evaluateGuard('/login', { authenticated: false })).toEqual({ action: 'resolve' });
		});

		it('lets unauthenticated requests reach /health (container healthcheck)', () => {
			expect(evaluateGuard('/health', { authenticated: false })).toEqual({ action: 'resolve' });
		});

		it('lets Better Auth endpoints through', () => {
			expect(evaluateGuard('/auth/sign-in/magic-link', { authenticated: false })).toEqual({
				action: 'resolve'
			});
		});

		it('treats the bare /auth path as public', () => {
			expect(evaluateGuard('/auth', { authenticated: false })).toEqual({ action: 'resolve' });
		});
	});

	describe('prefix matching does not leak (fail-open) to sibling paths', () => {
		it('does not treat /author as a public Better Auth endpoint', () => {
			// startsWith('/auth') would wrongly let this through unauthenticated.
			expect(evaluateGuard('/author', { authenticated: false })).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('does not treat /healthcheck as the public /health path', () => {
			expect(evaluateGuard('/healthcheck', { authenticated: false })).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});
	});

	describe('protected routes', () => {
		it('redirects unauthenticated users to /login', () => {
			expect(evaluateGuard('/', { authenticated: false })).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('redirects unauthenticated users away from /admin', () => {
			expect(evaluateGuard('/admin', { authenticated: false })).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('resolves for an authenticated user', () => {
			expect(evaluateGuard('/admin', { authenticated: true })).toEqual({ action: 'resolve' });
		});

		// /api/* gets no special treatment: it must fall under the normal session
		// guard like any other route, never become a public path.
		it.each(['/api', '/api/users'])('redirects unauthenticated requests to %s', (path) => {
			expect(evaluateGuard(path, { authenticated: false })).toEqual({
				action: 'redirect',
				location: '/login'
			});
		});

		it('resolves /api/* only for an authenticated user', () => {
			expect(evaluateGuard('/api/users', { authenticated: true })).toEqual({ action: 'resolve' });
		});
	});
});
