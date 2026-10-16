import { describe, it, expect } from 'vitest';
import { formatUsd, sortDistilleries } from './distilleryTable';
import type { AdminDistillery, DistilleryFact } from './tasting';

const pending = { value: null, state: 'pending', source: null } as const;
const empty = { value: null, state: 'empty', source: null } as const;
const found = <T>(value: T): DistilleryFact<T> => ({ value, state: 'found', source: null });

function distillery(name: string, over: Partial<AdminDistillery> = {}): AdminDistillery {
	return {
		key: name.toLowerCase(),
		name,
		country: pending,
		region: null,
		capacity: pending,
		costMicroUsd: 0,
		...over
	};
}

const names = (rows: AdminDistillery[]) => rows.map((row) => row.name);

describe('sortDistilleries', () => {
	const ardbeg = distillery('Ardbeg', {
		country: found('Schottland'),
		region: found('Islay'),
		capacity: found(1_400_000),
		costMicroUsd: 500_000
	});
	const glengoyne = distillery('Glengoyne', {
		country: found('Schottland'),
		region: found('Highlands'),
		capacity: found(1_100_000),
		costMicroUsd: 300_000
	});
	const bushmills = distillery('Bushmills', {
		country: found('Nordirland'),
		capacity: empty,
		costMicroUsd: 800_000
	});
	const unknown = distillery('Zuidam');
	const rows = [unknown, bushmills, glengoyne, ardbeg];

	it('sorts by name in both directions', () => {
		expect(names(sortDistilleries(rows, 'name', 'asc'))).toEqual([
			'Ardbeg',
			'Bushmills',
			'Glengoyne',
			'Zuidam'
		]);
		expect(names(sortDistilleries(rows, 'name', 'desc'))).toEqual([
			'Zuidam',
			'Glengoyne',
			'Bushmills',
			'Ardbeg'
		]);
	});

	it('puts missing values last in both directions', () => {
		expect(names(sortDistilleries(rows, 'country', 'asc'))).toEqual([
			'Bushmills',
			'Ardbeg',
			'Glengoyne',
			'Zuidam'
		]);
		expect(names(sortDistilleries(rows, 'country', 'desc'))).toEqual([
			'Ardbeg',
			'Glengoyne',
			'Bushmills',
			'Zuidam'
		]);
		expect(names(sortDistilleries(rows, 'capacity', 'desc'))).toEqual([
			'Ardbeg',
			'Glengoyne',
			'Bushmills',
			'Zuidam'
		]);
	});

	it('sorts the regions in the order of the rules, not alphabetically', () => {
		expect(names(sortDistilleries(rows, 'region', 'asc'))).toEqual([
			'Ardbeg',
			'Glengoyne',
			'Bushmills',
			'Zuidam'
		]);
		expect(names(sortDistilleries(rows, 'region', 'desc'))).toEqual([
			'Glengoyne',
			'Ardbeg',
			'Bushmills',
			'Zuidam'
		]);
	});

	it('sorts by costs, ties by name', () => {
		const tie = distillery('Aberlour', { costMicroUsd: 300_000 });
		expect(names(sortDistilleries([...rows, tie], 'cost', 'asc'))).toEqual([
			'Zuidam',
			'Aberlour',
			'Glengoyne',
			'Ardbeg',
			'Bushmills'
		]);
	});

	it('leaves the input alone', () => {
		const input = [...rows];
		sortDistilleries(input, 'name', 'asc');
		expect(input).toEqual(rows);
	});
});

describe('formatUsd', () => {
	it('shows micro-dollars as dollars with cents', () => {
		expect(formatUsd(1_234_567)).toBe('1,23 $');
		expect(formatUsd(0)).toBe('0,00 $');
	});
});
