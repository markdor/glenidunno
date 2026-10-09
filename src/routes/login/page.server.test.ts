import { describe, it, expect } from 'vitest';
import { load } from './+page.server';

type LoadArg = Parameters<typeof load>[0];

function run(user: unknown, url: string) {
	return load({ locals: { user }, url: new URL(url) } as unknown as LoadArg);
}

describe('login load', () => {
	it('redirects logged-in users to /', () => {
		expect(() => run({ id: 'x' }, 'http://localhost/login')).toThrowError(
			expect.objectContaining({ status: 303, location: '/' })
		);
	});

	it('passes through known error codes', () => {
		// failed_to_create_session: the link of a since deactivated user.
		for (const code of [
			'expired',
			'invalid',
			'used',
			'INVALID_TOKEN',
			'EXPIRED_TOKEN',
			'failed_to_create_session'
		]) {
			const result = run(null, `http://localhost/login?error=${code}`) as { error: string | null };
			expect(result.error).toBe(code);
		}
	});

	it('drops unknown error codes (no info leak)', () => {
		const result = run(null, 'http://localhost/login?error=funky') as { error: string | null };
		expect(result.error).toBeNull();
	});

	it('returns null error when no param is present', () => {
		const result = run(null, 'http://localhost/login') as { error: string | null };
		expect(result.error).toBeNull();
	});
});
