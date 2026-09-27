import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { RequestEvent } from '@sveltejs/kit';

const { signOut } = vi.hoisted(() => ({ signOut: vi.fn(async () => ({})) }));
vi.mock('$lib/server/auth', () => ({ auth: { api: { signOut } } }));

import { actions, load } from './+page.server';

beforeEach(() => signOut.mockClear());

describe('logout', () => {
	it('load bounces direct visits to /', () => {
		expect(() => load({} as unknown as Parameters<typeof load>[0])).toThrowError(
			expect.objectContaining({ status: 303, location: '/' })
		);
	});

	it('signs out and redirects to /login', async () => {
		const event = {
			request: new Request('http://localhost/logout', { method: 'POST' })
		} as unknown as RequestEvent;

		await expect(actions.default(event)).rejects.toMatchObject({
			status: 303,
			location: '/login'
		});
		expect(signOut).toHaveBeenCalledOnce();
	});
});
