import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { HistoryBottle } from '$lib/tasting';

// The table reads its state from page.url and writes it back via goto(): the
// real goto() needs a running SvelteKit client.
const mockPage = vi.hoisted(() => ({ url: new URL('http://localhost/history') }));
vi.mock('$app/state', () => ({ page: mockPage }));
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import { goto } from '$app/navigation';
import HistoryBottleTable from './HistoryBottleTable.svelte';

const NAVIGATION = { replaceState: true, noScroll: true, keepFocus: true };

function bottle(number: number, overrides: Partial<HistoryBottle> = {}): HistoryBottle {
	return {
		number,
		tastingDate: '2021-05-07',
		slug: null,
		alias: `P${number}`,
		distillery: 'Ardbeg',
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		whiskybaseUrl: null,
		broughtBy: 'Anna',
		presentation: null,
		...overrides
	};
}

// In the table's default order: newest tasting first.
const BOTTLES = [
	bottle(4, {
		tastingDate: '2024-09-27',
		slug: 'fluffy-otter',
		alias: 'P113',
		distillery: 'Deanston',
		bottling: '2008/2022',
		age: 12,
		abv: 66.6,
		bottler: 'Signatory',
		broughtBy: 'Ben',
		whiskybaseUrl: 'https://www.whiskybase.com/whiskies/whisky/1234',
		presentation: { bottleId: 'b-4' }
	}),
	bottle(5, {
		tastingDate: '2024-09-27',
		slug: 'fluffy-otter',
		alias: 'P21',
		abv: 54.1,
		broughtBy: 'Ben'
	}),
	bottle(1, {
		alias: 'P2',
		distillery: 'Glen Spey',
		age: 24,
		bottler: 'Hunter Laing',
		broughtBy: 'Cem (inaktiv)',
		whiskybaseUrl: 'https://whiskybase.com/whiskies/whisky/9'
	}),
	bottle(2, { alias: 'p10', distillery: 'BenRiach', age: 8, abv: 43 })
];

function show(search = '') {
	mockPage.url = new URL(`http://localhost/history${search}`);
	return render(HistoryBottleTable, { bottles: BOTTLES });
}

/** The aliases of the rows in their order. */
function aliases() {
	return [...document.querySelectorAll('tbody[id]')].map((tbody) =>
		tbody.querySelector('tr')!.querySelectorAll('td')[3].textContent?.trim()
	);
}

function header(name: string) {
	return page.getByRole('columnheader', { name, exact: true });
}

beforeEach(() => {
	vi.mocked(goto).mockClear();
});

describe('HistoryBottleTable – sorting', () => {
	test('lists the newest tasting first and marks the date column as sorted', async () => {
		show();
		await expect.element(header('Datum')).toHaveAttribute('aria-sort', 'descending');
		await expect.element(header('Alkohol')).not.toHaveAttribute('aria-sort');
		expect(aliases()).toEqual(['P113', 'P21', 'P2', 'p10']);
		await expect.element(page.getByText('4 Flaschen', { exact: true })).toBeVisible();
	});

	test('sorts by a new column ascending, a second click reverses it', async () => {
		show();
		await header('Alkohol').getByRole('button').click();
		expect(goto).toHaveBeenLastCalledWith('/history?sort=abv&dir=asc', NAVIGATION);
		await header('Datum').getByRole('button').click();
		expect(goto).toHaveBeenLastCalledWith('/history?dir=asc', NAVIGATION);
	});

	test('reads the sorting from the URL – headings, mobile selection and direction agree', async () => {
		show('?sort=abv&dir=asc');
		expect(aliases()).toEqual(['p10', 'P2', 'P21', 'P113']);
		await expect.element(header('Alkohol')).toHaveAttribute('aria-sort', 'ascending');
		await expect.element(header('Datum')).not.toHaveAttribute('aria-sort');
		await expect.element(page.getByLabelText('Sortieren nach')).toHaveValue('abv');
		await expect.element(page.getByRole('button', { name: 'Aufsteigend' })).toBeVisible();

		await page.getByRole('button', { name: 'Aufsteigend' }).click();
		// Descending is the default direction, so it stays out of the URL.
		expect(goto).toHaveBeenLastCalledWith('/history?sort=abv', NAVIGATION);
		await header('Alkohol').getByRole('button').click();
		expect(goto).toHaveBeenLastCalledWith('/history?sort=abv', NAVIGATION);
	});

	test('sorts by the mobile selection, ascending', async () => {
		show('?sort=abv');
		await expect.element(page.getByRole('button', { name: 'Absteigend' })).toBeVisible();
		await page.getByLabelText('Sortieren nach').selectOptions('alias');
		expect(goto).toHaveBeenLastCalledWith('/history?sort=alias&dir=asc', NAVIGATION);
	});

	test('sorts aliases naturally', async () => {
		show('?sort=alias&dir=asc');
		expect(aliases()).toEqual(['P2', 'p10', 'P21', 'P113']);
	});

	test('keeps NAS at the end in both directions', async () => {
		const ascending = show('?sort=age&dir=asc');
		expect(aliases()).toEqual(['p10', 'P113', 'P2', 'P21']);
		ascending.unmount();
		show('?sort=age');
		expect(aliases()).toEqual(['P2', 'P113', 'p10', 'P21']);
	});

	test('falls back to the default for invalid parameters', async () => {
		show('?sort=score&dir=up&by=Mallory&year=1999');
		await expect.element(header('Datum')).toHaveAttribute('aria-sort', 'descending');
		expect(aliases()).toEqual(['P113', 'P21', 'P2', 'p10']);
		await expect.element(page.getByLabelText('Teilnehmer')).toHaveValue('');
		await expect.element(page.getByLabelText('Jahr')).toHaveValue('');
	});
});

describe('HistoryBottleTable – search and filters', () => {
	test('filters only from the third character on', async () => {
		const short = show('?q=gl');
		expect(aliases()).toHaveLength(4);
		short.unmount();
		show('?q=gle');
		expect(aliases()).toEqual(['P2']);
		await expect.element(page.getByText('1 von 4 Flaschen')).toBeVisible();
	});

	test.each([
		['the date', '27.09.2024', ['P113', 'P21']],
		['the bringer', 'INAKTIV', ['P2']],
		['NAS', 'nas', ['P21']],
		['the ABV as shown', '54,1 %', ['P21']],
		['the bottler', 'originalabf', ['P21', 'p10']]
	])('finds %s', async (_label, q, expected) => {
		show(`?${new URLSearchParams({ q })}`);
		expect(aliases()).toEqual(expected);
	});

	test('combines the search with the bringer and the year', async () => {
		show('?q=ardbeg&by=Ben&year=2024');
		expect(aliases()).toEqual(['P21']);
		await expect.element(page.getByLabelText('Teilnehmer')).toHaveValue('Ben');
		await expect.element(page.getByLabelText('Jahr')).toHaveValue('2024');
		await expect.element(page.getByLabelText('Suche')).toHaveValue('ardbeg');
	});

	test('says so when nothing is found', async () => {
		show('?q=lagavulin');
		await expect.element(page.getByText('Keine Flasche gefunden.')).toBeVisible();
		await expect.element(page.getByText('0 von 4 Flaschen')).toBeVisible();
	});

	test('writes search and filters into the URL, keeping the rest', async () => {
		show('?sort=abv');
		await page.getByLabelText('Suche').fill('Glen ');
		expect(goto).toHaveBeenLastCalledWith('/history?q=Glen+&sort=abv', NAVIGATION);
		await page.getByLabelText('Teilnehmer').selectOptions('Cem (inaktiv)');
		expect(goto).toHaveBeenLastCalledWith('/history?by=Cem+%28inaktiv%29&sort=abv', NAVIGATION);
		await page.getByLabelText('Jahr').selectOptions('2021');
		expect(goto).toHaveBeenLastCalledWith('/history?year=2021&sort=abv', NAVIGATION);
	});

	test('drops a filter set back to "Alle"', async () => {
		show('?by=Ben');
		await page.getByLabelText('Teilnehmer').selectOptions('');
		expect(goto).toHaveBeenLastCalledWith('/history', NAVIGATION);
	});
});

describe('HistoryBottleTable – cells and links', () => {
	test('shows every column as text, the whisky without the bottler', async () => {
		show();
		const row = page.getByRole('row').filter({ hasText: 'P113' }).first();
		await expect.element(row).toHaveTextContent('Deanston 12 Jahre 2008/2022');
		await expect.element(row).toHaveTextContent('Signatory');
		await expect.element(row).toHaveTextContent('66,6 %');
		expect(row.element().textContent).not.toContain('(Signatory)');
	});

	test('links the date and the presentation only for the own tastings', async () => {
		show();
		const dates = page.getByRole('link', { name: '27.09.2024' }).elements();
		expect(dates.map((a) => a.getAttribute('href'))).toEqual([
			'/tasting/fluffy-otter',
			'/tasting/fluffy-otter'
		]);
		expect(page.getByRole('link', { name: '07.05.2021' }).elements()).toHaveLength(0);

		// Row and tile each carry the links.
		const presentations = page.getByRole('link', { name: 'Präsentation zu P113' }).elements();
		expect(presentations).toHaveLength(2);
		expect(presentations[0]).toHaveAttribute('href', '/tasting/fluffy-otter/presentation/b-4');
		expect(presentations[0]).toHaveAttribute('download');
		expect(page.getByRole('link', { name: /^Präsentation/ }).elements()).toHaveLength(2);

		const whiskybase = page.getByRole('link', { name: 'Whiskybase zu P2' }).elements();
		expect(whiskybase[0]).toHaveAttribute('href', 'https://whiskybase.com/whiskies/whisky/9');
		expect(whiskybase[0]).toHaveAttribute('rel', 'external noopener noreferrer');
	});

	test('anchors every bottle and highlights the one a link jumped to', async () => {
		show('#bottle-1');
		expect([...document.querySelectorAll('tbody[id]')].map((t) => t.id)).toEqual([
			'bottle-4',
			'bottle-5',
			'bottle-1',
			'bottle-2'
		]);
		expect(document.getElementById('bottle-1')).toHaveClass('bg-slate-100');
		expect(document.getElementById('bottle-4')).not.toHaveClass('bg-slate-100');
	});

	test('ignores a malformed anchor instead of failing', async () => {
		show('#%');
		expect(aliases()).toEqual(['P113', 'P21', 'P2', 'p10']);
		expect(document.querySelectorAll('tbody.bg-slate-100')).toHaveLength(0);
	});
});
