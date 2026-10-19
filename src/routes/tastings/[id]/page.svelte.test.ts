import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Page from './+page.svelte';

const user = { id: 'u1', username: 'maxi', isAdmin: false };

const tasting = {
	name: 'Herbst-Tasting',
	tastingDate: '2026-10-24',
	motto: 'Inselhüpfen',
	mottoDescription: 'Eine Insel pro Flasche.\nKeine Blends.'
};

const nebel = {
	position: 1,
	alias: 'Nebel',
	distillery: 'Ardbeg',
	bottler: null,
	bottling: null,
	age: 10,
	whiskybaseUrl: null,
	smoke: 5,
	cask: 2,
	abv: 46,
	value: 3,
	broughtBy: 'Anna',
	score: 67,
	presentation: null
};

function renderDetail(detail: Record<string, unknown>) {
	return render(Page, { data: { user, detail: { tasting, slug: null, ...detail } } } as never);
}

describe('Tasting history detail page', () => {
	test('shows name, date and the whole motto, and leads back to the tasting history', async () => {
		renderDetail({ archived: false, bottles: [nebel] });

		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Herbst-Tasting' }))
			.toBeVisible();
		await expect.element(page.getByText('Sa., 24.10.2026')).toBeVisible();
		await expect.element(page.getByText('Inselhüpfen')).toBeVisible();
		await expect.element(page.getByText(/Eine Insel pro Flasche/)).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Tasting-Historie' }))
			.toHaveAttribute('href', '/tastings');
		expect(document.title).toBe('Tasting · Glen Idunno');
	});

	test('shows the reveal with the score chart and the explainer', async () => {
		renderDetail({ archived: false, bottles: [nebel] });

		await expect.element(page.getByRole('heading', { name: 'Auflösung' })).toBeVisible();
		await expect.element(page.getByRole('heading', { name: /Nebel/ })).toBeVisible();
		await expect.element(page.getByText('10 Jahre')).toBeVisible();
		await expect.element(page.getByText('Anna')).toBeVisible();
		await expect.element(page.getByRole('img')).toBeVisible();
		await expect
			.element(page.getByRole('heading', { name: 'Wie kommt die Reihenfolge zustande?' }))
			.toBeVisible();
		// Without an own participation: no presentation links at all.
		expect(page.getByRole('link', { name: /Präsentation/ }).elements()).toHaveLength(0);
	});

	test('shows archived bottles without the score chart and the explainer', async () => {
		renderDetail({
			archived: true,
			bottles: [
				{
					id: 'b1',
					alias: 'Nebelhorn',
					distillery: 'Aberlour',
					bottler: null,
					bottling: null,
					age: null,
					whiskybaseUrl: null,
					abv: 40,
					broughtBy: 'Josh',
					presentation: null
				}
			]
		});

		await expect.element(page.getByRole('heading', { name: 'Nebelhorn' })).toBeVisible();
		await expect.element(page.getByText('40,0 % vol.')).toBeVisible();
		expect(page.getByRole('img').elements()).toHaveLength(0);
		expect(
			page.getByRole('heading', { name: 'Wie kommt die Reihenfolge zustande?' }).elements()
		).toHaveLength(0);
	});

	test('links a participant’s presentations through the tasting link, the viewer back here', async () => {
		renderDetail({
			slug: 'fluffy-otter',
			archived: false,
			bottles: [{ ...nebel, presentation: { bottleId: 'b1', viewable: true, name: 'Ardbeg.pptx' } }]
		});

		await expect
			.element(page.getByRole('link', { name: 'Präsentation: Ardbeg.pptx' }))
			.toHaveAttribute('href', '/tasting/fluffy-otter/presentation/b1');
		await expect
			.element(page.getByRole('link', { name: 'Präsentation zu Nebel ansehen' }))
			.toHaveAttribute('href', '/tasting/fluffy-otter/presentation/b1/view?from=tastings');
	});
});
