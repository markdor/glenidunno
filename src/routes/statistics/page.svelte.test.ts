import { describe, test, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import type { Statistics, StatisticsBottle } from '$lib/tasting';
import Page from './+page.svelte';

const user = { id: 'u-anna', username: 'Anna', isAdmin: false };

function bottle(number: number, overrides: Partial<StatisticsBottle> = {}): StatisticsBottle {
	return {
		number,
		tastingDate: '2021-05-07',
		distillery: 'Ardbeg',
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		broughtBy: 'Anna',
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
		countries: 2,
		withoutCountry: 1,
		meanAbv: 54.5667,
		medianAbv: 54.1,
		meanAge: 16,
		nas: share(1, 33),
		totalAge: 32,
		strongest: { value: 66.6, number: 3, more: 0 },
		oldest: { value: 24, number: 1, more: 2 }
	},
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
				countries: 1,
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
				countries: 2,
				strongest: 3
			}
		],
		best: {
			meanAbv: ['Ben'],
			caskStrength: ['Ben'],
			independent: ['Anna'],
			meanAge: ['Anna'],
			uniqueDistilleries: [],
			countries: ['Ben']
		},
		capacity: {
			largest: { capacity: 3_000_000, distilleries: ['Deanston'], persons: ['Ben'] },
			smallest: { capacity: 1_400_000, distilleries: ['Glen Spey'], persons: ['Anna'] }
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

function show(statistics: Statistics | null = STATISTICS) {
	return render(Page, { data: { user, statistics } });
}

function headings() {
	return page
		.getByRole('heading', { level: 2 })
		.elements()
		.map((h) => h.textContent?.trim());
}

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

	test('puts the sections in order and ends with the link to the history', async () => {
		show();
		expect(headings()).toEqual([
			'Kennzahlen und Rekorde',
			'Verteilungen',
			'Reiner Alkohol',
			'Teilnehmer im Vergleich',
			'Destillerien und Abfüller',
			'Zeitverlauf'
		]);
		// No table of the bottles any more, they are in the history.
		expect(page.getByRole('region', { name: 'Alle Flaschen' }).elements()).toHaveLength(0);
		const last = [...document.querySelectorAll('a')].at(-1);
		expect(last).toHaveTextContent('Alle Flaschen in der Flaschen-Datenbank');
		expect(last).toHaveAttribute('href', '/history');
	});

	test('shows the key figures in German format', async () => {
		show();
		for (const text of ['54,6 %', '54,1 %', '16,0 Jahre', '32 Jahre', '33 %', '1 Flasche']) {
			await expect.element(page.getByText(text, { exact: true }).first()).toBeVisible();
		}
		await expect.element(page.getByText('Ø 54,6 %')).toBeVisible();
		await expect.element(page.getByText('Ø 16,0 Jahre (ohne NAS)')).toBeVisible();
	});

	/** Label, value and hint of the key figure tile with this label. */
	function tile(label: string) {
		const term = [...document.querySelectorAll('dt')].find((dt) => dt.textContent === label);
		return [...(term?.parentElement?.children ?? [])].map((c) => c.textContent?.trim());
	}

	test('counts the countries and the distilleries without one', () => {
		show();
		expect(tile('Länder')).toEqual(['Länder', '2', '1 Destillerie ohne Angabe']);
	});

	test('links the countries tile to the world map', async () => {
		show();
		await expect
			.element(page.getByRole('link', { name: '2 Länder auf der Weltkarte' }))
			.toHaveAttribute('href', '/map');
	});

	test('drops the hint once every distillery has its country', () => {
		show({ ...STATISTICS, overview: { ...STATISTICS.overview, withoutCountry: 0 } });
		expect(tile('Länder')).toEqual(['Länder', '2']);
	});

	test('links the records to their row in the history, without a query string', async () => {
		show();
		const strongest = page.getByRole('link', { name: 'Deanston 2008/2022 (Signatory)' }).first();
		await expect.element(strongest).toHaveAttribute('href', '/history#bottle-3');
		await expect.element(page.getByText('+ 2 weitere')).toBeVisible();
		await expect
			.element(page.getByRole('link', { name: 'Glen Spey 24 Jahre (Hunter Laing)' }).first())
			.toHaveAttribute('href', '/history#bottle-1');
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
		expect(best).toEqual(['54,8 %', '50 % (1)', '100 % (1)', '24,0 J.', '2']);
		await expect.element(page.getByText('Fassstärken-Fan:')).toBeVisible();
		await expect.element(page.getByText('Indie-Scout:')).toBeVisible();
		await expect.element(page.getByText('Altersweise:')).toBeVisible();
		expect(page.getByText('Experimentierfreudigster:').elements()).toHaveLength(0);
		const title = (name: string) => page.getByRole('listitem').filter({ hasText: name });
		await expect
			.element(title('Weltenbummler:'))
			.toHaveTextContent(/Weltenbummler:\s+Ben\s+– die meisten verschiedenen Länder/);
		await expect
			.element(title('Industrie-Fan:'))
			.toHaveTextContent(
				/Industrie-Fan:\s+Ben\s+– größte Destillerie \(Deanston, 3\.000\.000 l A\/Jahr\)/
			);
		await expect
			.element(title('Kleinod-Jäger:'))
			.toHaveTextContent(
				/Kleinod-Jäger:\s+Anna\s+– kleinste Destillerie \(Glen Spey, 1\.400\.000 l A\/Jahr\)/
			);
		await expect
			.element(page.getByRole('listitem').filter({ hasText: 'Ben:' }).getByRole('link'))
			.toHaveAttribute('href', '/history#bottle-3');
	});

	test('names several distilleries of the same size and all their bringers', async () => {
		show({
			...STATISTICS,
			people: {
				...STATISTICS.people,
				capacity: {
					...STATISTICS.people.capacity!,
					smallest: {
						capacity: 65_000,
						distilleries: ['Abhainn Dearg', 'Daftmill'],
						persons: ['Anna', 'Ben']
					}
				}
			}
		});
		await expect
			.element(page.getByRole('listitem').filter({ hasText: 'Kleinod-Jäger:' }))
			.toHaveTextContent(
				/Anna und Ben\s+– kleinste Destillerie \(Abhainn Dearg und Daftmill, je 65\.000 l A\/Jahr\)/
			);
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
			.toHaveAttribute('href', '/history#bottle-1');
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
					uniqueDistilleries: [],
					countries: []
				},
				capacity: null
			},
			timeline: { ...STATISTICS.timeline, longestBreak: null, milestones: [] }
		});
		expect(page.getByText('–', { exact: true }).elements().length).toBeGreaterThan(0);
		await expect.element(page.getByText('pro Person, ≈ 0 g')).toBeVisible();
		expect(page.getByText(/Härtestes Tasting/).elements()).toHaveLength(0);
		expect(page.getByText(/Längste Pause/).elements()).toHaveLength(0);
		expect(page.getByText('Meilensteine').elements()).toHaveLength(0);
		expect(page.getByText(/Industrie-Fan|Kleinod-Jäger|Weltenbummler/).elements()).toHaveLength(0);
	});
});

describe('Statistics page – histogram intervals', () => {
	/** Screen reader texts of a chart's columns – one per interval, NAS last. */
	function columns(chart: string) {
		const group = page.getByRole('group', { name: chart }).element();
		return [...group.querySelectorAll('.sr-only')].map((c) => c.textContent);
	}

	function slide(name: string, value: number) {
		const slider = page.getByRole('slider', { name }).element() as HTMLInputElement;
		slider.value = String(value);
		slider.dispatchEvent(new Event('input', { bubbles: true }));
	}

	const output = (unit: RegExp) => page.getByRole('status').filter({ hasText: unit });

	test('starts at 4 %-points and 3 years, the sliders named after their chart', async () => {
		show();
		const abv = page.getByRole('slider', { name: 'Intervall Alkoholgehalt' });
		const age = page.getByRole('slider', { name: 'Intervall Alter' });
		await expect.element(abv).toHaveValue('4');
		await expect.element(abv).toHaveAttribute('min', '1');
		await expect.element(abv).toHaveAttribute('max', '5');
		await expect.element(age).toHaveValue('3');
		expect(page.getByText('Intervall', { exact: true }).elements()).toHaveLength(2);
		await expect.element(output(/Punkt/)).toHaveTextContent('4 %-Punkte');
		await expect.element(output(/Jahr/)).toHaveTextContent('3 Jahre');

		// 43, 54.1 and 66.6 % vol. from 42 on, 46 being a bound.
		expect(columns('Flaschen nach Alkoholgehalt')).toEqual([
			'42–45,9 % vol.: 1 Flasche',
			'46–49,9 % vol.: 0 Flaschen',
			'50–53,9 % vol.: 0 Flaschen',
			'54–57,9 % vol.: 1 Flasche',
			'58–61,9 % vol.: 0 Flaschen',
			'62–65,9 % vol.: 0 Flaschen',
			'66–69,9 % vol.: 1 Flasche'
		]);
		// 8 and 24 years from 6 on, 3 being a bound; NAS apart.
		expect(columns('Flaschen nach Alter')).toEqual([
			'6–8 Jahre: 1 Flasche',
			'9–11 Jahre: 0 Flaschen',
			'12–14 Jahre: 0 Flaschen',
			'15–17 Jahre: 0 Flaschen',
			'18–20 Jahre: 0 Flaschen',
			'21–23 Jahre: 0 Flaschen',
			'24–26 Jahre: 1 Flasche',
			'NAS: 1 Flasche'
		]);
	});

	test('recomputes the columns when a slider moves', async () => {
		show();
		slide('Intervall Alkoholgehalt', 1);
		await expect.element(output(/Punkt/)).toHaveTextContent('1 %-Punkt');
		await expect.poll(() => columns('Flaschen nach Alkoholgehalt')).toHaveLength(24);
		expect(columns('Flaschen nach Alkoholgehalt')[0]).toBe('43–43,9 % vol.: 1 Flasche');

		slide('Intervall Alter', 1);
		await expect.element(output(/Jahr/)).toHaveTextContent('1 Jahr');
		await expect.poll(() => columns('Flaschen nach Alter')).toHaveLength(18);
		expect(columns('Flaschen nach Alter').slice(0, 2)).toEqual([
			'8 Jahre: 1 Flasche',
			'9 Jahre: 0 Flaschen'
		]);
	});
});
