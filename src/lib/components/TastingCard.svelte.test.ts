import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingCard from './TastingCard.svelte';

const today = {
	id: 't1',
	name: 'Islay gegen den Rest',
	subtitle: 'Tasting #18',
	tastingDate: '2026-10-24',
	phase: 'entry' as const,
	progress: { entered: 5, total: 6 },
	isToday: true
};

const later = {
	id: 't2',
	name: 'Tasting #19',
	subtitle: null,
	tastingDate: '2026-12-12',
	phase: 'entry' as const,
	progress: { entered: 0, total: 4 },
	isToday: false
};

describe('TastingCard', () => {
	test('links to the tasting admin as a whole', async () => {
		render(TastingCard, { summary: { upcomingCount: 2, preview: [today, later] } });

		const card = page.getByRole('link', { name: /Tasting-Verwaltung/ });
		await expect.element(card).toHaveAttribute('href', '/admin/tastings');
		await expect.element(page.getByText('2 anstehend')).toBeVisible();
	});

	test('previews title, date, today marker and entry progress', async () => {
		render(TastingCard, { summary: { upcomingCount: 2, preview: [today, later] } });

		await expect.element(page.getByText('Islay gegen den Rest')).toBeVisible();
		await expect.element(page.getByText('Tasting #19')).toBeVisible();
		await expect.element(page.getByText('heute')).toBeVisible();
		await expect.element(page.getByText(/Sa\., 24\.10\.2026 · 5\/6 Flaschen/)).toBeVisible();
		await expect.element(page.getByText(/Sa\., 12\.12\.2026 · 0\/4 Flaschen/)).toBeVisible();
		expect(page.getByText('heute').elements()).toHaveLength(1);
	});

	test('shows the title in one line, the number below it only with a motto', async () => {
		render(TastingCard, { summary: { upcomingCount: 2, preview: [today, later] } });

		const items = page.getByRole('listitem').elements();
		const title = page.getByText('Islay gegen den Rest');
		await expect.element(title).toBeVisible();
		expect(title.element().classList).toContain('truncate');
		const subtitle = page.getByText('Tasting #18');
		await expect.element(subtitle).toBeVisible();
		expect(items[0].contains(subtitle.element())).toBe(true);
		expect(title.element().compareDocumentPosition(subtitle.element())).toBe(
			Node.DOCUMENT_POSITION_FOLLOWING
		);
		// Without a motto the number is the title: no second line.
		expect(items[1].textContent).not.toMatch(/Tasting #19.*Tasting #19/);
		expect(page.getByText('Tasting #19').elements()).toHaveLength(1);
	});

	test('shows no progress once the entry phase is over', async () => {
		render(TastingCard, {
			summary: { upcomingCount: 1, preview: [{ ...today, phase: 'order' }] }
		});
		await expect.element(page.getByText('Sa., 24.10.2026')).toBeVisible();
		expect(page.getByText(/Flaschen/).elements()).toHaveLength(0);
	});

	test('says so when no tasting is planned', async () => {
		render(TastingCard, { summary: { upcomingCount: 0, preview: [] } });
		await expect.element(page.getByText('0 anstehend')).toBeVisible();
		await expect.element(page.getByText('Kein Tasting geplant.')).toBeVisible();
	});
});
