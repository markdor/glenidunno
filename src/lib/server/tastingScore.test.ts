import { describe, it, expect } from 'vitest';
import { scoreBottle, smokeGroup, sortForPouring } from './tastingScore';

type TestBottle = {
	distillery: string;
	smoke: number;
	cask: number;
	abv: number;
	value: number;
};

function bottle(distillery: string, smoke: number, cask: number, abv: number, value: number) {
	return { distillery, age: null, bottling: null, bottler: null, smoke, cask, abv, value };
}

const names = (bottles: readonly Pick<TestBottle, 'distillery'>[]) =>
	bottles.map((b) => b.distillery);

// Reference bottles from the issue specification.
const speysider = bottle('Unsherried Speysider', 0, 1, 40, 2);
const sherryBomb = bottle('Sherry-Bombe', 1, 5, 46, 4);
const islay = bottle('Islay Cask Strength', 5, 2, 58, 3);

describe('scoreBottle', () => {
	it.each([
		{ b: speysider, expected: 10 },
		{ b: sherryBomb, expected: 52 },
		{ b: islay, expected: 76 }
	])('scores $b.distillery with $expected', ({ b, expected }) => {
		// toBe, not toBeCloseTo: the score must be rounded, free of float noise.
		expect(scoreBottle(b).score).toBe(expected);
	});

	it('breaks the score down into the points of each factor', () => {
		expect(scoreBottle(islay).breakdown).toEqual({ smoke: 40, cask: 12, abv: 18, value: 6 });
	});

	it('clamps the alcohol factor below 40 % and above 60 %', () => {
		expect(scoreBottle(bottle('low', 0, 0, 35, 0)).score).toBe(0);
		expect(scoreBottle(bottle('high', 0, 0, 75, 0)).score).toBe(20);
		expect(scoreBottle(bottle('high', 0, 0, 75, 0)).breakdown.abv).toBe(20);
	});

	it('scores all-zero values with 0 and all-maximum values with 100', () => {
		expect(scoreBottle(bottle('zero', 0, 0, 35, 0)).score).toBe(0);
		expect(scoreBottle(bottle('max', 5, 5, 75, 5)).score).toBe(100);
	});

	it('rounds to one decimal place', () => {
		// abv 46.3 → 0.315 normalized → 6.3 points
		expect(scoreBottle(bottle('decimal', 0, 0, 46.3, 0)).score).toBe(6.3);
	});
});

describe('smokeGroup', () => {
	it.each([
		[0, 1],
		[1, 1],
		[2, 2],
		[3, 2],
		[4, 3],
		[5, 3]
	])('puts smoke %i into group %i', (smoke, group) => {
		expect(smokeGroup(smoke)).toBe(group);
	});
});

describe('sortForPouring', () => {
	it('pours the reference bottles light → heavy → smoky', () => {
		expect(names(sortForPouring([islay, sherryBomb, speysider]))).toEqual([
			'Unsherried Speysider',
			'Sherry-Bombe',
			'Islay Cask Strength'
		]);
	});

	it('attaches the score to every bottle', () => {
		expect(sortForPouring([sherryBomb])[0]).toMatchObject({
			distillery: 'Sherry-Bombe',
			score: 52
		});
	});

	it('pours a smoky but otherwise weak bottle after the unsmoked ones', () => {
		const smokyWeak = bottle('Smoky weak', 4, 0, 40, 0); // score 32
		const strong = bottle('Strong unsmoked', 1, 5, 60, 5); // score 68
		expect(names(sortForPouring([smokyWeak, strong]))).toEqual(['Strong unsmoked', 'Smoky weak']);
	});

	it('orders by score alone when the smoke groups are switched off', () => {
		const smokyWeak = bottle('Smoky weak', 4, 0, 40, 0);
		const strong = bottle('Strong unsmoked', 1, 5, 60, 5);
		expect(names(sortForPouring([strong, smokyWeak], false))).toEqual([
			'Smoky weak',
			'Strong unsmoked'
		]);
	});

	describe('tie-breakers on identical scores', () => {
		it('pours the less smoky bottle first', () => {
			const smokier = bottle('Smokier', 1, 1, 40, 1); // 8 + 6 + 0 + 2 = 16
			const lessSmoky = bottle('Less smoky', 0, 2, 40, 2); // 0 + 12 + 0 + 4 = 16
			expect(names(sortForPouring([smokier, lessSmoky]))).toEqual(['Less smoky', 'Smokier']);
		});

		it('then the one with less cask influence', () => {
			const moreCask = bottle('More cask', 0, 1, 40, 0); // 6
			const lessCask = bottle('Less cask', 0, 0, 40, 3); // 6
			expect(names(sortForPouring([moreCask, lessCask]))).toEqual(['Less cask', 'More cask']);
		});

		it('then the one with less alcohol, unaffected by float noise', () => {
			// Both score 2.1. Computed as 100 * (0.2*A + 0.1*W) without rounding,
			// the first one comes out as 2.1000000000000014 and the second as
			// 2.100000000000002 – the float noise would reverse the abv tie-breaker.
			const moreAlcohol = bottle('More alcohol', 0, 0, 42.1, 0);
			const lessAlcohol = bottle('Less alcohol', 0, 0, 40.1, 1);
			expect(names(sortForPouring([moreAlcohol, lessAlcohol]))).toEqual([
				'Less alcohol',
				'More alcohol'
			]);
		});

		it('finally by display name', () => {
			const b = bottle('Bowmore', 0, 1, 43, 2);
			const a = bottle('Ardbeg', 0, 1, 43, 2);
			expect(names(sortForPouring([b, a]))).toEqual(['Ardbeg', 'Bowmore']);
		});
	});
});
