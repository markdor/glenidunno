import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingManualNotice from './TastingManualNotice.svelte';

const pressedOrder = new Date('2026-10-24T15:32:00Z');
const pressedReveal = new Date('2026-10-24T20:05:00Z');

describe('TastingManualNotice', () => {
	test('says when the admin opened the order early, in Berlin time', async () => {
		render(TastingManualNotice, { manual: { orderOpenedAt: pressedOrder, revealedAt: null } });
		await expect
			.element(
				page.getByText(
					'Der Admin hat die Reihenfolge am Sa., 24.10.2026 um 17:32 Uhr vorzeitig freigegeben.'
				)
			)
			.toBeVisible();
	});

	test('says when the admin revealed the tasting early', async () => {
		render(TastingManualNotice, {
			manual: { orderOpenedAt: pressedOrder, revealedAt: pressedReveal }
		});
		await expect.element(page.getByText(/Reihenfolge am .* um 17:32 Uhr/)).toBeVisible();
		await expect
			.element(
				page.getByText(
					'Der Admin hat das Tasting am Sa., 24.10.2026 um 22:05 Uhr vorzeitig aufgelöst.'
				)
			)
			.toBeVisible();
	});

	test('shows nothing while the clock decides', async () => {
		const { container } = render(TastingManualNotice, {
			manual: { orderOpenedAt: null, revealedAt: null }
		});
		expect(container.textContent?.trim()).toBe('');
	});
});
