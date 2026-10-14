import { describe, test, expect, vi, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Statistics, StatisticsBottle } from '$lib/tasting';

const mockPage = vi.hoisted(() => ({ url: new URL('http://localhost/statistics') }));
vi.mock('$app/state', () => ({ page: mockPage }));
// The real goto() needs a running SvelteKit client.
vi.mock('$app/navigation', () => ({ goto: vi.fn() }));

import Page from './+page.svelte';

const user = { id: 'u-anna', username: 'Anna', isAdmin: false };

function bottle(number: number, overrides: Partial<StatisticsBottle> = {}): StatisticsBottle {
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

const BOTTLES = [
	bottle(3, {
		tastingDate: '2022-10-21',
		distillery: 'Deanston',
		bottling: '2008/2022',
		bottler: 'Signatory',
		abv: 66.6,
		broughtBy: 'Ben'
	}),
	bottle(1, { distillery: 'Glen Spey', age: 24, bottler: 'Hunter Laing', abv: 54.1 }),
	bottle(2, { distillery: 'BenRiach', age: 8, abv: 43, broughtBy: 'Ben' })
];

const share = (count: number, percent: number) => ({ count, percent });

const STATISTICS: Statistics = {
	bottles: BOTTLES,
	overview: {
		tastings: 2,
		bottles: 3,
		distilleries: 3,
		meanAbv: 54.5667,
		medianAbv: 54.1,
		meanAge: 16,
		nas: share(1, 33),
		totalAge: 32,
		strongest: { value: 66.6, number: 3, more: 0 },
		oldest: { value: 24, number: 1, more: 2 }
	},
	distributions: { abv: [0, 1, 0, 1, 0, 1], age: [0, 1, 0, 0, 1] },
	alcohol: {
		pureMl: 2706.6,
		pureGrams: 2135.5,
		beers: 108.26,
		liquidMl: 5350,
		whiskyBottles: 7.64,
		hardest: { tastingDate: '2022-10-21', pureMl: 183.4 }
	},
	people: {
		persons: [
			{
				name: 'Anna',
				bottles: 1,
				meanAbv: 54.1,
				caskStrength: share(0, 0),
				independent: share(1, 100),
				meanAge: 24,
				nas: share(0, 0),
				uniqueDistilleries: 1,
				strongest: 1
			},
			{
				name: 'Ben',
				bottles: 2,
				meanAbv: 54.8,
				caskStrength: share(1, 50),
				independent: share(1, 50),
				meanAge: 8,
				nas: share(1, 50),
				uniqueDistilleries: 2,
				strongest: 3
			}
		],
		best: {
			meanAbv: ['Ben'],
			caskStrength: ['Ben'],
			independent: ['Anna'],
			meanAge: ['Anna'],
			uniqueDistilleries: []
		}
	},
	distilleries: {
		podium: [
			{ place: 1, count: 5, names: ['BenRiach'] },
			{ place: 2, count: 3, names: ['Ardbeg', 'Deanston', 'Lagavulin'] }
		],
		repeaters: [
			{ name: 'BenRiach', count: 5 },
			{ name: 'Ardbeg', count: 3 }
		],
		original: 73,
		independent: 34,
		topBottlers: { names: ['Gordon & MacPhail', 'Signatory'], count: 5 },
		dejaVu: [{ name: 'Kavalan Oloroso Sherry Oak', dates: ['2022-02-18', '2024-11-29'] }]
	},
	timeline: {
		tastings: [
			{ tastingDate: '2021-05-07', meanAbv: 54.1, meanAge: 24 },
			{ tastingDate: '2022-10-21', meanAbv: 54.8, meanAge: null }
		],
		perYear: [
			{ year: 2021, count: 1 },
			{ year: 2022, count: 1 }
		],
		longestBreak: { days: 532, from: '2021-05-07', to: '2022-10-21' },
		milestones: [1]
	}
};

function show(statistics: Statistics | null = STATISTICS, search = '') {
	mockPage.url = new URL(`http://localhost/statistics${search}`);
	return render(Page, { data: { user, statistics } });
}

function headings() {
	return page
		.getByRole('heading', { level: 2 })
		.elements()
		.map((h) => h.textContent?.trim());
}

beforeEach(() => {
	mockPage.url = new URL('http://localhost/statistics');
});

describe('Statistics page', () => {
	test('shows only a hint while no tasting is revealed', async () => {
		show(null);
		await expect
			.element(page.getByRole('heading', { level: 1, name: 'Statistiken' }))
			.toBeVisible();
		await expect.element(page.getByText('Noch kein Tasting aufgelöst.')).toBeVisible();
		expect(headings()).toEqual([]);
		await expect
			.element(page.getByRole('link', { name: 'Startseite' }))
			.toHaveAttribute('href', '/');
	});

	test('puts the sections in order, the table last', async () => {
		show();
		expect(headings()).toEqual([
			'Kennzahlen und Rekorde',
			'Verteilungen',
			'Reiner Alkohol',
			'Teilnehmer im Vergleich',
			'Destillerien und Abfüller',
			'Zeitverlauf',
			'Alle Flaschen'
		]);
	});

	test('shows the key figures in German format', async () => {
		show();
		for (const text of ['54,6 %', '54,1 %', '16,0 Jahre', '32 Jahre', '33 %', '1 Flasche']) {
			await expect.element(page.getByText(text, { exact: true }).first()).toBeVisible();
		}
		await expect.element(page.getByText('Ø 54,6 %')).toBeVisible();
		await expect.element(page.getByText('Ø 16,0 Jahre')).toBeVisible();
	});

	test('links the records to their table row, without search and filters', async () => {
		show(STATISTICS, '?q=ard&by=Ben&year=2022&sort=abv');
		const strongest = page.getByRole('link', { name: 'Deanston 2008/2022 (Signatory)' }).first();
		await expect.element(strongest).toHaveAttribute('href', '/statistics?sort=abv#bottle-3');
		await expect.element(page.getByText('+ 2 weitere')).toBeVisible();
	});

	test('links a record to the row alone without a sorting', async () => {
		show();
		await expect
			.element(page.getByRole('link', { name: 'Glen Spey 24 Jahre (Hunter Laing)' }).first())
			.toHaveAttribute('href', '/statistics#bottle-1');
	});

	test('shows the pure alcohol per person with the conversions and the hint', async () => {
		show();
		await expect.element(page.getByText('2.707 ml')).toBeVisible();
		await expect.element(page.getByText('pro Person, ≈ 2,1 kg')).toBeVisible();
		await expect.element(page.getByText('≈ 108 Halbe Bier (0,5 l mit 5 %)')).toBeVisible();
		await expect.element(page.getByText(/5,35 l Whisky ≈ 7,6 Flaschen à\s+0,7 l/)).toBeVisible();
		await expect.element(page.getByText(/21\.10\.2022 mit\s+183,4 ml/)).toBeVisible();
		await expect.element(page.getByText(/volles Sample à\s+50 ml/)).toBeVisible();
	});

	test('highlights the best value per row and awards the titles', async () => {
		show();
		const table = page.getByRole('table').first();
		const best = [...table.element().querySelectorAll('td')]
			.filter((cell) => cell.textContent?.includes('(höchster Wert)'))
			.map((cell) => cell.textContent?.replace('(höchster Wert)', '').trim());
		// Not for the number of bottles and the NAS share; nobody without a value.
		expect(best).toEqual(['54,8 %', '50 % (1)', '100 % (1)', '24,0 J.']);
		await expect.element(page.getByText('Fassstärken-Fan:')).toBeVisible();
		await expect.element(page.getByText('Indie-Scout:')).toBeVisible();
		await expect.element(page.getByText('Altersweise:')).toBeVisible();
		expect(page.getByText('Experimentierfreudigster:').elements()).toHaveLength(0);
		await expect
			.element(page.getByRole('listitem').filter({ hasText: 'Ben:' }).getByRole('link'))
			.toHaveAttribute('href', '/statistics#bottle-3');
	});

	test('shows podium, repeaters, bottlers and déjà-vus', async () => {
		show();
		await expect.element(page.getByText('Platz 2 · 3 Flaschen')).toBeVisible();
		await expect.element(page.getByText('Ardbeg, Deanston und Lagavulin')).toBeVisible();
		await expect.element(page.getByText('BenRiach (5) und Ardbeg (3)')).toBeVisible();
		await expect
			.element(page.getByText('Am häufigsten: Gordon & MacPhail und Signatory (je 5 Flaschen)'))
			.toBeVisible();
		await expect
			.element(page.getByText(/Unabhängige Abfüller:\s+34 Flaschen\s+\(32 %\)/))
			.toBeVisible();
		await expect.element(page.getByText('(18.02.2022 und 29.11.2024)')).toBeVisible();
	});

	test('shows the empty states of the distilleries', async () => {
		show({
			...STATISTICS,
			distilleries: {
				podium: [],
				repeaters: [],
				original: 0,
				independent: 0,
				topBottlers: null,
				dejaVu: []
			}
		});
		await expect.element(page.getByText('Noch keine Destillerie.')).toBeVisible();
		await expect
			.element(page.getByText('Noch keine Destillerie mit mehr als einer Flasche.'))
			.toBeVisible();
		await expect
			.element(page.getByText('Bisher kam kein Whisky zweimal auf den Tisch.'))
			.toBeVisible();
		expect(page.getByText(/Am häufigsten/).elements()).toHaveLength(0);
	});

	test('shows the timeline with the longest break and the milestones', async () => {
		show();
		await expect.element(page.getByRole('img', { name: 'Ø Alkohol pro Tasting' })).toBeVisible();
		await expect.element(page.getByText('532 Tage')).toBeVisible();
		await expect
			.element(page.getByRole('listitem').filter({ hasText: 'Die 1. Flasche:' }).getByRole('link'))
			.toHaveAttribute('href', '/statistics#bottle-1');
	});

	test('leaves out what a single tasting without bottles cannot have', async () => {
		show({
			...STATISTICS,
			bottles: [],
			overview: {
				...STATISTICS.overview,
				meanAbv: null,
				medianAbv: null,
				meanAge: null,
				strongest: null,
				oldest: null
			},
			alcohol: { ...STATISTICS.alcohol, pureGrams: 0, hardest: null },
			people: {
				persons: [],
				best: {
					meanAbv: [],
					caskStrength: [],
					independent: [],
					meanAge: [],
					uniqueDistilleries: []
				}
			},
			timeline: { ...STATISTICS.timeline, longestBreak: null, milestones: [] }
		});
		expect(page.getByText('–', { exact: true }).elements().length).toBeGreaterThan(0);
		await expect.element(page.getByText('pro Person, ≈ 0 g')).toBeVisible();
		expect(page.getByText(/Härtestes Tasting/).elements()).toHaveLength(0);
		expect(page.getByText(/Längste Pause/).elements()).toHaveLength(0);
		expect(page.getByText('Meilensteine').elements()).toHaveLength(0);
	});
});
