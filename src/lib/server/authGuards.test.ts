import { describe, it, expect } from 'vitest';
import { redirectNotFound, requireUser, requireAdmin } from './authGuards';

const NOT_FOUND_REDIRECT = expect.objectContaining({ status: 303, location: '/?notice=not-found' });

function locals(user: unknown): App.Locals {
	return { user, session: null } as unknown as App.Locals;
}

describe('requireUser', () => {
	it('returns the user when present', () => {
		const u = { id: '1', username: 'a', isAdmin: false };
		expect(requireUser(locals(u))).toBe(u);
	});

	it('throws 401 when there is no user', () => {
		expect(() => requireUser(locals(null))).toThrowError(expect.objectContaining({ status: 401 }));
	});
});

describe('requireAdmin', () => {
	it('returns the user when admin', () => {
		const u = { id: '1', username: 'admin', isAdmin: true };
		expect(requireAdmin(locals(u))).toBe(u);
	});

	it('throws 401 when there is no user', () => {
		expect(() => requireAdmin(locals(null))).toThrowError(expect.objectContaining({ status: 401 }));
	});

	it('redirects a non-admin to the dashboard like any missing page', () => {
		const u = { id: '1', username: 'user', isAdmin: false };
		expect(() => requireAdmin(locals(u))).toThrowError(NOT_FOUND_REDIRECT);
	});
});

describe('redirectNotFound', () => {
	it('redirects to the dashboard with the not-found notice', () => {
		expect(() => redirectNotFound()).toThrowError(NOT_FOUND_REDIRECT);
	});
});
