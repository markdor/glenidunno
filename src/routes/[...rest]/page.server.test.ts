import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

type LoadEvent = Parameters<typeof load>[0];

function loadFor(rest: string, user: unknown) {
	return load({
		params: { rest },
		url: new URL(`http://localhost/${rest}`),
		locals: { user, session: null }
	} as unknown as LoadEvent);
}

describe('catch-all route', () => {
	it.each(['gibt-es-nicht', 'tasting', 'tasting/0123456789abcdef0123456789abcdef', 'admin/foo'])(
		'redirects /%s to the dashboard with the not-found notice',
		(rest) => {
			expect(() => loadFor(rest, { id: 'u', isAdmin: false })).toThrowError(
				expect.objectContaining({ status: 303, location: '/?notice=not-found' })
			);
		}
	);

	it('redirects without a session too – the guard then sends the user on to /login', () => {
		expect(() => loadFor('auth', null)).toThrowError(
			expect.objectContaining({ status: 303, location: '/?notice=not-found' })
		);
	});
});
