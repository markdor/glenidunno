import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import { resolve } from '$app/paths';
import { ChartColumn, RotateCcwClock } from '@lucide/svelte';
import DashboardTile from './DashboardTile.svelte';

describe('DashboardTile', () => {
	test('links an existing section', async () => {
		render(DashboardTile, {
			title: 'Statistiken',
			icon: ChartColumn,
			href: resolve('/statistics')
		});

		const tile = page.getByRole('link', { name: 'Statistiken' });
		await expect.element(tile).toHaveAttribute('href', '/statistics');
		expect(page.getByText('Demnächst').elements()).toHaveLength(0);
	});

	test('shows a section still to come as neither link nor focus target', async () => {
		const { container } = render(DashboardTile, { title: 'Historie', icon: RotateCcwClock });

		await expect.element(page.getByText('Historie')).toBeVisible();
		await expect.element(page.getByText('Demnächst')).toBeVisible();
		expect(page.getByRole('link').elements()).toHaveLength(0);
		expect(container.querySelector('a, button, [tabindex]')).toBeNull();

		const tile = container.firstElementChild as HTMLElement;
		tile.focus();
		expect(document.activeElement).not.toBe(tile);
	});
});
