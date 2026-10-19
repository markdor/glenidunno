import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { ResolvedPathname } from '$app/types';
import { SCORE_RULES, type ArchivedRevealedBottle, type RevealedBottle } from '$lib/tasting';
import TastingReveal from './TastingReveal.svelte';

const presentationHref = (bottleId: string) =>
	`/tasting/${'t'.repeat(32)}/presentation/${bottleId}` as ResolvedPathname;
const viewHref = (bottleId: string) =>
	`/tasting/${'t'.repeat(32)}/presentation/${bottleId}/view` as ResolvedPathname;

const nas = {
	position: 1,
	alias: 'Blume',
	distillery: 'Glenkinchie',
	bottler: null,
	bottling: null,
	age: null,
	whiskybaseUrl: null,
	smoke: 0,
	cask: 1,
	abv: 43,
	value: 2,
	broughtBy: 'Ben',
	score: 12,
	shares: { smoke: 0, cask: 0.2, abv: 0.075, value: 0.4 },
	presentation: null
};

const independent = {
	...nas,
	position: 2,
	alias: 'Nebel',
	distillery: 'Caol Ila',
	bottler: 'Signatory',
	bottling: 'Sherry Cask',
	age: 12,
	whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1',
	abv: 54.2,
	broughtBy: 'Anna',
	score: 61.5,
	presentation: { bottleId: 'b2', viewable: true, name: 'Caol Ila.pptx' }
};

function renderPoured(bottles: RevealedBottle[]) {
	return render(TastingReveal, {
		presentationHref,
		viewHref,
		reveal: { archived: false, bottles, rules: SCORE_RULES }
	});
}

function renderArchived(bottles: ArchivedRevealedBottle[]) {
	return render(TastingReveal, { presentationHref, viewHref, reveal: { archived: true, bottles } });
}

describe('TastingReveal', () => {
	test('shows every bottle with alias, names, bringer, values and score', async () => {
		renderPoured([nas, independent]);

		await expect.element(page.getByRole('heading', { name: '1. Blume' })).toBeVisible();
		await expect.element(page.getByText('Caol Ila', { exact: true })).toBeVisible();
		await expect.element(page.getByText('Sherry Cask')).toBeVisible();
		await expect.element(page.getByText('12 Jahre')).toBeVisible();
		await expect.element(page.getByText('Signatory')).toBeVisible();
		await expect.element(page.getByText('Anna')).toBeVisible();
		await expect.element(page.getByText('Rauch 0 · Fass 1 · 54,2 % · Kaliber 2')).toBeVisible();
		await expect.element(page.getByText('61,5')).toBeVisible();
	});

	test('shows an empty bottler as original bottling and a missing age as NAS', async () => {
		renderPoured([nas]);
		await expect.element(page.getByText('Originalabfüllung')).toBeVisible();
		await expect.element(page.getByText('NAS')).toBeVisible();
	});

	test('opens the Whiskybase link in a new tab without referrer', async () => {
		renderPoured([nas, independent]);
		const links = page.getByRole('link', { name: 'Auf Whiskybase ansehen' });
		expect(links.elements()).toHaveLength(1);
		await expect.element(links).toHaveAttribute('href', independent.whiskybaseUrl);
		await expect.element(links).toHaveAttribute('target', '_blank');
		await expect.element(links).toHaveAttribute('rel', 'external noopener noreferrer');
	});

	test('links an uploaded presentation as a download and in the viewer', async () => {
		renderPoured([nas, independent]);
		const links = page.getByRole('link', { name: /^Präsentation:/ });
		expect(links.elements()).toHaveLength(1);
		await expect.element(links).toHaveTextContent('Präsentation: Caol Ila.pptx');
		await expect.element(links).toHaveAttribute('href', presentationHref('b2'));
		await expect.element(links).toHaveAttribute('download');
		const view = page.getByRole('link', { name: 'Präsentation zu Nebel ansehen' });
		await expect.element(view).toHaveAttribute('href', viewHref('b2'));
		await expect.element(view).not.toHaveAttribute('download');
	});

	test('offers only the download for a format the viewer can not show', async () => {
		renderPoured([
			{ ...independent, presentation: { bottleId: 'b2', viewable: false, name: 'Caol Ila.zip' } }
		]);
		await expect.element(page.getByRole('link', { name: /^Präsentation:/ })).toBeVisible();
		expect(
			page.getByRole('link', { name: 'Präsentation zu Nebel ansehen' }).elements()
		).toHaveLength(0);
	});

	test('says so when nobody entered a bottle', async () => {
		renderPoured([]);
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});

	describe('archived bottles', () => {
		const archived = {
			id: 'b3',
			alias: 'Nebelhorn',
			distillery: 'Aberlour',
			bottler: null,
			bottling: "A'bunadh",
			age: null,
			whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/3',
			abv: 46,
			broughtBy: 'Josh',
			presentation: { bottleId: 'b3', viewable: true, name: 'Josh.pptx' }
		};

		test('show the ABV instead of the values, without score and position', async () => {
			renderArchived([archived, { ...archived, id: 'b4', alias: 'Moor', presentation: null }]);

			await expect.element(page.getByText('46,0 % vol.').first()).toBeVisible();
			expect(page.getByText('Alkohol', { exact: true }).elements()).toHaveLength(2);
			expect(page.getByText('Werte').elements()).toHaveLength(0);
			expect(page.getByText('Score').elements()).toHaveLength(0);
			// Just the alias, no "1." for screen readers either.
			expect(
				page
					.getByRole('heading')
					.elements()
					.map((h) => h.textContent?.trim())
			).toEqual(['Nebelhorn', 'Moor']);
			const list = page.getByRole('list', { name: 'Auflösung' }).element();
			// The position circle is the only aria-hidden text of a card (icons aside).
			expect(list.querySelector('span[aria-hidden="true"]')).toBeNull();
			// Without a pouring order the list isn't an ordered one.
			expect(list.tagName).toBe('UL');
		});

		test('keep names, bringer and links', async () => {
			renderArchived([archived]);

			await expect.element(page.getByText('Aberlour')).toBeVisible();
			await expect.element(page.getByText("A'bunadh")).toBeVisible();
			await expect.element(page.getByText('NAS')).toBeVisible();
			await expect.element(page.getByText('Originalabfüllung')).toBeVisible();
			await expect.element(page.getByText('Josh', { exact: true })).toBeVisible();
			await expect
				.element(page.getByRole('link', { name: 'Auf Whiskybase ansehen' }))
				.toHaveAttribute('href', archived.whiskybaseUrl);
			await expect
				.element(page.getByRole('link', { name: 'Präsentation: Josh.pptx' }))
				.toHaveAttribute('href', presentationHref('b3'));
			await expect
				.element(page.getByRole('link', { name: 'Präsentation zu Nebelhorn ansehen' }))
				.toHaveAttribute('href', viewHref('b3'));
		});
	});
});
