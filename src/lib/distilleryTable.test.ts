import { describe, it, expect } from 'vitest';
import { formatUsd, previewRename, renameMessage, sortDistilleries } from './distilleryTable';
import { TASTING_BOTTLING_LENGTH } from './validation';
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
		bottles: [],
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

describe('previewRename', () => {
	const stoisha = distillery('Stoisha', {
		bottles: [
			{ age: 12, bottling: null, bottler: null },
			{ age: null, bottling: 'Edition', bottler: 'Signatory' },
			{ age: null, bottling: 'stoisha Batch 2', bottler: null }
		]
	});
	const bunnahabhain = distillery('Bunnahabhain', { key: 'bunnahabhain' });
	const table = [stoisha, bunnahabhain];

	it('is unchanged with the same spelling and without prefix', () => {
		expect(previewRename(table, stoisha, ' Stoisha ', null)).toEqual({
			kind: 'unchanged',
			target: 'Stoisha',
			bottleNames: [],
			tooLong: false
		});
		expect(previewRename(table, stoisha, 'Stoisha', '  ').kind).toBe('unchanged');
	});

	it('tells rename, merge, placeholder and respelling apart', () => {
		expect(previewRename(table, stoisha, 'Stoisha Distillery', null)).toMatchObject({
			kind: 'renamed',
			target: 'Stoisha Distillery'
		});
		// The target's spelling in the table.
		expect(previewRename(table, stoisha, 'BUNNAHABHAIN', null)).toMatchObject({
			kind: 'merged',
			target: 'Bunnahabhain'
		});
		expect(previewRename(table, stoisha, 'unbekannt', null).kind).toBe('placeholder');
		expect(previewRename(table, stoisha, 'STOISHA', null).kind).toBe('respelled');
		// A prefix alone rewrites the bottles as well.
		expect(previewRename(table, stoisha, 'Stoisha', 'Stoisha').kind).toBe('respelled');
	});

	it('lists the new bottle names with a brand prefix', () => {
		expect(previewRename(table, stoisha, 'Bunnahabhain', ' Stoisha ').bottleNames).toEqual([
			'Bunnahabhain 12 Jahre Stoisha',
			'Bunnahabhain Stoisha Edition (Signatory)',
			'Bunnahabhain stoisha Batch 2'
		]);
	});

	it('flags a bottling that would get too long', () => {
		const prefix = 'x'.repeat(TASTING_BOTTLING_LENGTH.max - 'stoisha Batch 2'.length);
		expect(previewRename(table, stoisha, 'Bunnahabhain', prefix).tooLong).toBe(true);
		expect(previewRename(table, stoisha, 'Bunnahabhain', prefix.slice(1)).tooLong).toBe(false);
	});
});

describe('renameMessage', () => {
	const stoisha = distillery('Stoisha', { bottles: [{ age: 12, bottling: null, bottler: null }] });
	const table = [stoisha, distillery('Bunnahabhain')];
	const message = (name: string, prefix: string | null = null) =>
		renameMessage(stoisha, previewRename(table, stoisha, name, prefix));

	it('says what happens to how many bottles, and that it is final', () => {
		expect(message('Stoisha Distillery')).toBe(
			'„Stoisha“ wird in „Stoisha Distillery“ umbenannt (1 Flasche). Das lässt sich nicht rückgängig machen.'
		);
		expect(message('bunnahabhain')).toBe(
			'„Stoisha“ wird mit „Bunnahabhain“ zusammengeführt (1 Flasche). „Bunnahabhain“ behält seine Werte und übernimmt nur fehlende. Das lässt sich nicht rückgängig machen.'
		);
		expect(message('Unbekannt')).toContain('wird zum Platzhalter „Unbekannt“ (1 Flasche)');
		expect(message('STOISHA')).toContain('„Stoisha“ wird in 1 Flasche als „STOISHA“ geschrieben.');
	});

	it('announces the bottle names with a prefix', () => {
		expect(message('Bunnahabhain', 'Stoisha')).toMatch(/Die Flaschen heißen danach:$/);
		expect(message('Bunnahabhain')).not.toContain('heißen danach');
	});
});
