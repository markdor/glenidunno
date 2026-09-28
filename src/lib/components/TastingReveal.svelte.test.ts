import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import TastingReveal from './TastingReveal.svelte';

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
	breakdown: { smoke: 0, cask: 6, abv: 3, value: 4 }
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
	score: 61.5
};

describe('TastingReveal', () => {
	test('shows every bottle with alias, names, bringer, values and score', async () => {
		render(TastingReveal, { bottles: [nas, independent] });

		await expect.element(page.getByRole('heading', { name: '1. Blume' })).toBeVisible();
		await expect.element(page.getByText('Caol Ila')).toBeVisible();
		await expect.element(page.getByText('Sherry Cask')).toBeVisible();
		await expect.element(page.getByText('12 Jahre')).toBeVisible();
		await expect.element(page.getByText('Signatory')).toBeVisible();
		await expect.element(page.getByText('Anna')).toBeVisible();
		await expect.element(page.getByText('Rauch 0 · Fass 1 · 54,2 % · Wertigkeit 2')).toBeVisible();
		await expect.element(page.getByText('61,5')).toBeVisible();
	});

	test('shows an empty bottler as original bottling and a missing age as NAS', async () => {
		render(TastingReveal, { bottles: [nas] });
		await expect.element(page.getByText('Originalabfüllung')).toBeVisible();
		await expect.element(page.getByText('NAS')).toBeVisible();
	});

	test('opens the Whiskybase link in a new tab without referrer', async () => {
		render(TastingReveal, { bottles: [nas, independent] });
		const links = page.getByRole('link', { name: 'Auf Whiskybase ansehen' });
		expect(links.elements()).toHaveLength(1);
		await expect.element(links).toHaveAttribute('href', independent.whiskybaseUrl);
		await expect.element(links).toHaveAttribute('target', '_blank');
		await expect.element(links).toHaveAttribute('rel', 'external noopener noreferrer');
	});

	test('hides the score breakdown unless asked for', async () => {
		render(TastingReveal, { bottles: [nas] });
		expect(page.getByText('Score-Aufschlüsselung').elements()).toHaveLength(0);
	});

	test('offers a collapsible score breakdown in the admin view', async () => {
		render(TastingReveal, { bottles: [nas], showBreakdown: true });
		await page.getByText('Score-Aufschlüsselung').click();
		await expect.element(page.getByText('Wertigkeit', { exact: true })).toBeVisible();
		await expect.element(page.getByText('6,0')).toBeVisible();
	});

	test('says so when nobody entered a bottle', async () => {
		render(TastingReveal, { bottles: [] });
		await expect.element(page.getByText('Es wurden keine Flaschen eingetragen.')).toBeVisible();
	});
});
