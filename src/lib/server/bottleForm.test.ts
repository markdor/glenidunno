import { describe, expect, it } from 'vitest';
import { parseBottleForm } from './bottleForm';

function formData(fields: Record<string, string>): FormData {
	const form = new FormData();
	for (const [key, value] of Object.entries(fields)) form.append(key, value);
	return form;
}

const COMMON = { alias: 'Bernstein', distillery: 'Glenfarclas', abv: '46,0' };
const FACTS = {
	...COMMON,
	peat: 'none',
	mainCask: 'sherry_oloroso',
	finish: 'none',
	price: '59,90'
};

const parse = (fields: Record<string, string>) => parseBottleForm(formData(fields), 'facts');

describe('parseBottleForm – facts', () => {
	it('reads the facts instead of the sliders', () => {
		const result = parse(FACTS);
		expect(result.fieldErrors).toEqual({});
		expect(result.foreign).toBe(false);
		expect(result.bottle).toEqual({
			alias: 'Bernstein',
			distillery: 'Glenfarclas',
			bottler: null,
			bottling: null,
			age: null,
			whiskybaseUrl: null,
			abv: 46,
			facts: {
				peat: 'none',
				cask: { kind: 'known', type: 'sherry_oloroso', refill: false },
				finish: { kind: 'none' },
				priceCents: 5990
			}
		});
		expect(result.values).toMatchObject({ peat: 'none', price: '59,90', priceUnknown: '' });
		expect(result.values).not.toHaveProperty('smoke');
	});

	it('reads a refill, an other cask with its rating and a finish with its duration', () => {
		const result = parse({
			...FACTS,
			mainCask: 'other',
			mainCaskLabel: ' Tequila ',
			mainCaskInfluence: '4',
			finish: 'port',
			finishRefill: 'on',
			finishMonths: '18'
		});
		expect(result.bottle).toMatchObject({
			facts: {
				cask: { kind: 'other', label: 'Tequila', influence: 4 },
				finish: { kind: 'known', type: 'port', refill: true, months: 18 }
			}
		});
	});

	it('reads unknown casks, a finish without duration and an unknown price', () => {
		const result = parse({
			...FACTS,
			mainCask: 'unknown',
			finish: 'other',
			finishLabel: 'Mizunara',
			finishInfluence: '6',
			price: '',
			priceUnknown: 'on'
		});
		expect(result.bottle).toMatchObject({
			facts: {
				cask: { kind: 'unknown' },
				finish: { kind: 'other', label: 'Mizunara', influence: 6, months: null },
				priceCents: null
			}
		});
		expect(parse({ ...FACTS, finish: 'unknown' }).bottle).toMatchObject({
			facts: { finish: { kind: 'unknown' } }
		});
	});

	it('takes the price bounds with up to two decimals', () => {
		expect(parse({ ...FACTS, price: '10' }).bottle).toMatchObject({ facts: { priceCents: 1000 } });
		expect(parse({ ...FACTS, price: '999' }).bottle).toMatchObject({
			facts: { priceCents: 99900 }
		});
		expect(parse({ ...FACTS, price: '24.95' }).bottle).toMatchObject({
			facts: { priceCents: 2495 }
		});
		expect(parse({ ...FACTS, price: '999,01' }).fieldErrors).toEqual({ price: 'invalid' });
	});

	it.each([
		[{ peat: '' }, { peat: 'required' }],
		[{ peat: 'smoky' }, { peat: 'invalid' }],
		[{ mainCask: '' }, { mainCask: 'required' }],
		[{ mainCask: 'tequila' }, { mainCask: 'invalid' }],
		[{ mainCask: 'none' }, { mainCask: 'invalid' }],
		[{ finish: '' }, { finish: 'required' }],
		[{ mainCask: 'other' }, { mainCaskLabel: 'required', mainCaskInfluence: 'required' }],
		[
			{ mainCask: 'other', mainCaskLabel: 'x'.repeat(41), mainCaskInfluence: '11' },
			{ mainCaskLabel: 'invalid', mainCaskInfluence: 'invalid' }
		],
		[{ mainCaskLabel: 'Tequila' }, { mainCaskLabel: 'invalid' }],
		[{ mainCask: 'virgin_oak', mainCaskRefill: 'on' }, { mainCaskRefill: 'invalid' }],
		[{ mainCaskRefill: 'yes' }, { mainCaskRefill: 'invalid' }],
		[
			{ mainCask: 'other', mainCaskLabel: 'x', mainCaskInfluence: '1', mainCaskRefill: 'on' },
			{ mainCaskRefill: 'invalid' }
		],
		[{ mainCask: 'unknown', mainCaskInfluence: '3' }, { mainCaskInfluence: 'invalid' }],
		[{ finishMonths: '6' }, { finishMonths: 'invalid' }],
		[{ finish: 'unknown', finishRefill: 'on' }, { finishRefill: 'invalid' }],
		[{ finish: 'port', finishMonths: '0' }, { finishMonths: 'invalid' }],
		[{ finish: 'port', finishMonths: '121' }, { finishMonths: 'invalid' }],
		[{ finish: 'port', finishMonths: '6,5' }, { finishMonths: 'invalid' }],
		[{ price: '' }, { price: 'required' }],
		[{ price: '9,99' }, { price: 'invalid' }],
		[{ price: '1000' }, { price: 'invalid' }],
		[{ price: '12,345' }, { price: 'invalid' }],
		[{ price: 'zwölf' }, { price: 'invalid' }],
		[{ priceUnknown: 'on' }, { price: 'invalid' }],
		[
			{ alias: '', abv: '' },
			{ alias: 'required', abv: 'required' }
		]
	])('rejects %o', (overrides, fieldErrors) => {
		const result = parse({ ...FACTS, ...overrides });
		expect(result.bottle).toBeNull();
		expect(result.fieldErrors).toEqual(fieldErrors);
	});

	it('tells fields of the other algorithm', () => {
		expect(parse({ ...FACTS, smoke: '3' }).foreign).toBe(true);
		const taste = parseBottleForm(
			formData({ ...COMMON, smoke: '1', cask: '2', value: '3', peat: 'none' }),
			'taste'
		);
		expect(taste.foreign).toBe(true);
		expect(taste.bottle).toMatchObject({ smoke: 1, cask: 2, value: 3 });
	});
});

describe('parseBottleForm – taste', () => {
	it('reads the sliders and nothing of the facts', () => {
		const result = parseBottleForm(
			formData({ ...COMMON, smoke: '5', cask: '0', value: '3' }),
			'taste'
		);
		expect(result.bottle).toMatchObject({ abv: 46, smoke: 5, cask: 0, value: 3 });
		expect(result.bottle).not.toHaveProperty('facts');
		expect(Object.keys(result.values)).not.toContain('peat');
	});

	it('requires all three sliders', () => {
		const result = parseBottleForm(formData({ ...COMMON, smoke: '6' }), 'taste');
		expect(result.fieldErrors).toEqual({ smoke: 'invalid', cask: 'required', value: 'required' });
	});
});
