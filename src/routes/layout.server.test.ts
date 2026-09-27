import { describe, it, expect } from 'vitest';
import { load } from './+layout.server';

type Arg = Parameters<typeof load>[0];

describe('root layout load', () => {
	it('returns a null user when logged out', () => {
		expect(load({ locals: { user: null } } as unknown as Arg)).toEqual({ user: null });
	});

	it('exposes only a safe view of the user', () => {
		const result = load({
			locals: {
				user: {
					id: 'u1',
					username: 'maxi',
					isAdmin: true,
					email: 'secret@glenidunno.de'
				}
			}
		} as unknown as Arg);
		// No email leaks into the client payload.
		expect(result).toEqual({ user: { id: 'u1', username: 'maxi', isAdmin: true } });
	});
});
