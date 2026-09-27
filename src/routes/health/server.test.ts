import { describe, it, expect } from 'vitest';
import { GET } from './+server';

describe('GET /health', () => {
	it('resolves 200 with an empty body', async () => {
		const response = await GET({} as unknown as Parameters<typeof GET>[0]);
		expect(response.status).toBe(200);
		expect(await response.text()).toBe('');
	});
});
