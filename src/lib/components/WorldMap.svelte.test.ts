import { describe, test, expect, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { StatisticsBottle } from '$lib/tasting';
import { SCOTTISH_REGIONS, type ScottishRegion } from '$lib/validation';
import type {
	MapBox,
	WorldMapCountry,
	WorldMapGeometry,
	WorldMapRegion,
	WorldMapSelection
} from '$lib/worldMap';
import WorldMap from './WorldMap.svelte';

const square = ([x0, y0, x1, y1]: MapBox) => `M${x0},${y0}H${x1}V${y1}H${x0}Z`;

// A 2000 × 1000 world: Scotland a 40-unit square around (900, 200), Sweden
// and France small squares next to it, the regions inside Scotland.
const SCOTLAND: MapBox = [880, 180, 920, 220];
const REGION_BOXES: Record<ScottishRegion, MapBox> = {
	Islay: [882, 205, 888, 211],
	Campbeltown: [889, 212, 893, 216],
	Inseln: [882, 182, 888, 188],
	Speyside: [905, 185, 915, 195],
	Highlands: [890, 182, 904, 200],
	Lowlands: [895, 205, 918, 218]
};
const GEOMETRY: WorldMapGeometry = {
	width: 2000,
	height: 1000,
	sphere: square([0, 0, 2000, 1000]),
	graticule: 'M0,500H2000',
	land: square([1500, 800, 1510, 810]),
	countries: {
		'GB-SCT': { path: square(SCOTLAND), box: SCOTLAND, anchor: [900, 200] },
		SE: { path: square([925, 185, 935, 195]), box: [925, 185, 935, 195], anchor: [930, 190] },
		FR: { path: square([865, 225, 885, 240]), box: [865, 225, 885, 240], anchor: [875, 232] }
	},
	regions: Object.fromEntries(
		SCOTTISH_REGIONS.map((region) => [
			region,
			{
				path: square(REGION_BOXES[region]),
				anchor: [REGION_BOXES[region][0] + 2, REGION_BOXES[region][1] + 2],
				label: region === 'Islay' ? [860, 230] : null
			}
		])
	) as WorldMapGeometry['regions'],
	scotlandMainland: SCOTLAND
};
const SIZE = { width: 400, height: 500 };

function bottles(count: number): StatisticsBottle[] {
	return Array.from({ length: count }, (_, i) => ({
		number: i + 1,
		tastingDate: '2024-09-27',
		distillery: `Destillerie ${i}`,
		bottler: null,
		bottling: null,
		age: null,
		abv: 46,
		broughtBy: 'Anna'
	}));
}

const COUNTRIES: WorldMapCountry[] = [
	{ code: 'GB-SCT', distilleries: 56, bottles: bottles(87) },
	{ code: 'SE', distilleries: 2, bottles: bottles(3) }
];
const REGIONS: WorldMapRegion[] = SCOTTISH_REGIONS.map((region) => ({
	region,
	bottles: region === 'Islay' ? 20 : 0,
	distilleries:
		region === 'Islay'
			? Array.from({ length: 8 }, (_, i) => ({ name: `Islay ${i}`, bottles: 2 }))
			: []
}));

function stubGeometry(response: () => Response = () => new Response(JSON.stringify(GEOMETRY))) {
	const fetchMock = vi.fn(async () => response());
	vi.stubGlobal('fetch', fetchMock);
	return fetchMock;
}

/** No animations: views jump to their target at once. */
function reduceMotion() {
	const matchMedia = window.matchMedia.bind(window);
	vi.spyOn(window, 'matchMedia').mockImplementation((query) =>
		query === '(prefers-reduced-motion: reduce)'
			? ({ matches: true } as MediaQueryList)
			: matchMedia(query)
	);
}

async function show(selection: WorldMapSelection | null = null) {
	const onselect = vi.fn();
	const result = render(WorldMap, {
		countries: COUNTRIES,
		regions: REGIONS,
		selection,
		onselect
	});
	result.container.style.width = `${SIZE.width}px`;
	result.container.style.height = `${SIZE.height}px`;
	await expect.element(page.getByTestId('map-view')).toBeInTheDocument();
	// One frame for the ResizeObserver behind bind:clientWidth.
	await nextFrame();
	// Picked: the render result is a thenable, a spread would make this one too.
	return { component: result.component, container: result.container, onselect };
}

function nextFrame() {
	return new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
}

function transform() {
	const value = page.getByTestId('map-view').element().getAttribute('transform')!;
	const [, x, y, k] = /translate\((\S+) (\S+)\) scale\((\S+)\)/.exec(value)!.map(Number);
	return { x, y, k };
}

const path = (code: string) => document.querySelector<SVGPathElement>(`path[data-code="${code}"]`)!;
const regionPath = (region: ScottishRegion) =>
	document.querySelector<SVGPathElement>(`path[data-region="${region}"]`)!;

function centerOf(element: Element): [number, number] {
	const rect = element.getBoundingClientRect();
	return [rect.left + rect.width / 2, rect.top + rect.height / 2];
}

/** A pointer event at a point of the page, on the element there (like a real one). */
function pointer(
	type: string,
	[clientX, clientY]: [number, number],
	options: { id?: number; pointerType?: string } = {}
) {
	const target = document.elementFromPoint(clientX, clientY)!;
	target.dispatchEvent(
		new PointerEvent(type, {
			bubbles: true,
			button: 0,
			clientX,
			clientY,
			pointerId: options.id ?? 1,
			pointerType: options.pointerType ?? 'mouse'
		})
	);
}

function tap(point: [number, number], pointerType = 'mouse') {
	pointer('pointerdown', point, { pointerType });
	pointer('pointerup', point, { pointerType });
}

/** Somewhere at sea: the top left corner of the map. */
const SEA: [number, number] = [20, 20];

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

describe('WorldMap', () => {
	test('shows a loading state until the geometry arrives', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);
		render(WorldMap, {
			countries: COUNTRIES,
			regions: REGIONS,
			selection: null,
			onselect: vi.fn()
		});
		await expect.element(page.getByRole('status')).toHaveTextContent('Karte wird geladen …');
	});

	test.each([
		{ label: 'an error answer', response: () => new Response('', { status: 404 }) },
		{ label: 'broken JSON', response: () => new Response('keine Karte') }
	])('shows the error state after $label', async ({ response }) => {
		stubGeometry(response);
		render(WorldMap, {
			countries: COUNTRIES,
			regions: REGIONS,
			selection: null,
			onselect: vi.fn()
		});
		await expect.element(page.getByText('Die Karte konnte nicht geladen werden.')).toBeVisible();
	});

	test('stops loading when it goes away', async () => {
		const fetchMock = vi.fn(
			(_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const { unmount } = render(WorldMap, {
			countries: COUNTRIES,
			regions: REGIONS,
			selection: null,
			onselect: vi.fn()
		});
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
		unmount();
		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});

	test('colours the countries by their level, the others as land', async () => {
		stubGeometry();
		await show();
		expect(path('GB-SCT').getAttribute('class')).toContain('fill-map-4');
		expect(path('SE').getAttribute('class')).toContain('fill-map-2');
		expect(path('FR').getAttribute('class')).toContain('fill-map-land');
		expect(regionPath('Islay').getAttribute('class')).toContain('fill-map-3');
		expect(regionPath('Speyside').getAttribute('class')).toContain('fill-map-land');
	});

	test('starts on Scotland, its mainland a third of the map high, at the country level', async () => {
		stubGeometry();
		await show();
		// 0.32 × 500 px for 40 units, Scotland's middle in the middle of the map.
		expect(transform()).toEqual({ k: 4, x: 200 - 900 * 4, y: 250 - 200 * 4 });
		expect(page.getByTestId('map-regions').element().getAttribute('visibility')).toBe('hidden');
		await expect.element(page.getByText('Whiskys pro Land')).toBeVisible();
		await expect
			.element(page.getByRole('button', { name: 'Schottland: 87 Whiskys' }))
			.toBeVisible();
		await expect.element(page.getByText('Weiter hineinzoomen für die Regionen')).toBeVisible();
	});

	test('"Regionen zeigen" flies to the regions and switches the legend', async () => {
		stubGeometry();
		await show();
		await page.getByRole('button', { name: 'Regionen zeigen' }).click();

		// Animated: from the country level until the regions are fully there.
		await expect
			.poll(() => page.getByTestId('map-regions').element().getAttribute('opacity'))
			.toBe('1');
		await expect.element(page.getByText('Brennereien pro Region')).toBeVisible();
		await expect
			.element(page.getByText('Weiter hineinzoomen für die Regionen'))
			.not.toBeInTheDocument();
		await expect
			.element(page.getByRole('button', { name: 'Islay: 8 Brennereien' }))
			.not.toHaveAttribute('inert');
		// Scotland's own badge has made way.
		expect(document.querySelector('button[data-code="GB-SCT"]')!.hasAttribute('inert')).toBe(true);
	});

	test('zooms with the buttons, flies to the world and back to Scotland', async () => {
		stubGeometry();
		reduceMotion();
		await show();

		await page.getByRole('button', { name: 'Hineinzoomen' }).click();
		expect(transform().k).toBeCloseTo(4 * 1.8, 10);
		await page.getByRole('button', { name: 'Herauszoomen' }).click();
		expect(transform().k).toBeCloseTo(4, 10);

		await page.getByRole('button', { name: 'Welt' }).click();
		// The whole world fits: 400 px for 2000 units.
		expect(transform()).toEqual({ k: 0.2, x: 0, y: 150 });
		// Far out, Sweden's badge gives way to Scotland's bigger count.
		expect(document.querySelector('button[data-code="SE"]')!.textContent?.trim()).toBe('');

		await page.getByRole('button', { name: 'Schottland', exact: true }).click();
		expect(transform().k).toBeCloseTo(4, 10);
	});

	test('limits the zoom: the buttons give up at the limits', async () => {
		stubGeometry();
		reduceMotion();
		await show();
		const zoomIn = page.getByRole('button', { name: 'Hineinzoomen' });
		while (!(zoomIn.element() as HTMLButtonElement).disabled) await zoomIn.click();
		// Scotland at most 3.2 × the map height.
		expect(transform().k).toBeCloseTo((3.2 * 500) / 40, 10);
		await expect.element(zoomIn).toBeDisabled();

		const zoomOut = page.getByRole('button', { name: 'Herauszoomen' });
		while (!(zoomOut.element() as HTMLButtonElement).disabled) await zoomOut.click();
		expect(transform().k).toBeCloseTo(0.8 * 0.2, 10);
		await expect.element(zoomOut).toBeDisabled();
	});

	test('flies to a country of the list and to the regions on request', async () => {
		stubGeometry();
		reduceMotion();
		const { component } = await show();

		component.flyToCountry('SE');
		await nextFrame();
		// Never closer than the start view.
		expect(transform().k).toBeCloseTo(4, 10);
		const [x, y] = [transform().x + 930 * 4, transform().y + 190 * 4];
		expect([x, y]).toEqual([200, 250]);

		component.flyToCountry('XX');
		component.flyToRegions();
		await nextFrame();
		// The mainland 0.72 of the height: 90 % of the width.
		expect(transform().k).toBeCloseTo((0.72 * 500) / 40, 10);
	});

	test('selects a country with whiskies on a click, and nothing at sea', async () => {
		stubGeometry();
		const { onselect } = await show();

		tap(centerOf(path('GB-SCT')));
		expect(onselect).toHaveBeenLastCalledWith({ kind: 'country', code: 'GB-SCT' });

		// After the double-click time: a second tap close by would zoom.
		await new Promise((done) => setTimeout(done, 350));
		tap(SEA);
		expect(onselect).toHaveBeenLastCalledWith(null);
	});

	test('a country without whisky only shows its information, also on touch', async () => {
		stubGeometry();
		const { onselect } = await show();
		tap(centerOf(path('FR')), 'touch');
		expect(onselect).not.toHaveBeenCalled();
		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('Frankreich: Noch kein Whisky von hier');
	});

	test('a badge selects its country', async () => {
		stubGeometry();
		const { onselect } = await show();
		await page.getByRole('button', { name: 'Schweden: 3 Whiskys' }).click();
		expect(onselect).toHaveBeenLastCalledWith({ kind: 'country', code: 'SE' });
	});

	test('a badge selects by keyboard too', async () => {
		stubGeometry();
		const { onselect } = await show();
		page.getByRole('button', { name: 'Schweden: 3 Whiskys' }).element().focus();
		await userEvent.keyboard('{Enter}');
		expect(onselect).toHaveBeenLastCalledWith({ kind: 'country', code: 'SE' });
	});

	test('selects a region once the regions have taken over', async () => {
		stubGeometry();
		reduceMotion();
		const { onselect } = await show();
		await page.getByRole('button', { name: 'Regionen zeigen' }).click();
		tap(centerOf(regionPath('Speyside')));
		expect(onselect).toHaveBeenLastCalledWith({ kind: 'region', region: 'Speyside' });
	});

	test('shows hover information for countries and regions', async () => {
		stubGeometry();
		reduceMotion();
		await show();
		pointer('pointermove', centerOf(path('GB-SCT')));
		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('Schottland: 87 Whiskys · 56 Brennereien');
		pointer('pointermove', SEA);
		await expect.element(page.getByRole('status')).not.toBeInTheDocument();

		await page.getByRole('button', { name: 'Regionen zeigen' }).click();
		pointer('pointermove', centerOf(regionPath('Islay')));
		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('Islay: 8 Brennereien · 20 Whiskys');
		pointer('pointermove', centerOf(regionPath('Speyside')));
		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('Speyside: Noch kein Whisky von hier');
	});

	test('outlines the selection', async () => {
		stubGeometry();
		await show({ kind: 'region', region: 'Islay' });
		expect(page.getByTestId('map-selected').element().getAttribute('d')).toBe(
			GEOMETRY.regions.Islay.path
		);
		// Inert at the country level: out of the accessibility tree.
		const islay = document.querySelector('button[data-region="Islay"]')!;
		expect(islay.getAttribute('aria-pressed')).toBe('true');
		expect(islay.hasAttribute('inert')).toBe(true);
	});

	test('pans by dragging, without selecting', async () => {
		stubGeometry();
		const { onselect } = await show();
		const before = transform();
		pointer('pointerdown', [100, 100]);
		pointer('pointermove', [103, 101]);
		await nextFrame();
		// Below the threshold nothing moves.
		expect(transform()).toEqual(before);
		pointer('pointermove', [140, 130]);
		await nextFrame();
		pointer('pointerup', [140, 130]);
		expect(transform()).toEqual({ k: before.k, x: before.x + 40, y: before.y + 30 });
		expect(onselect).not.toHaveBeenCalled();
	});

	test('zooms with two fingers', async () => {
		stubGeometry();
		const { onselect } = await show();
		const before = transform();
		pointer('pointerdown', [100, 100], { id: 1, pointerType: 'touch' });
		pointer('pointerdown', [140, 100], { id: 2, pointerType: 'touch' });
		pointer('pointermove', [80, 100], { id: 1, pointerType: 'touch' });
		pointer('pointermove', [160, 100], { id: 2, pointerType: 'touch' });
		await nextFrame();
		pointer('pointerup', [80, 100], { id: 1, pointerType: 'touch' });
		pointer('pointerup', [160, 100], { id: 2, pointerType: 'touch' });
		// Twice the distance, around their middle.
		expect(transform().k).toBeCloseTo(before.k * 2, 10);
		expect(onselect).not.toHaveBeenCalled();
	});

	test('zooms in on a double tap', async () => {
		stubGeometry();
		reduceMotion();
		await show();
		tap(SEA);
		tap(SEA);
		await nextFrame();
		expect(transform().k).toBeCloseTo(8, 10);
	});

	test('zooms with the mouse wheel around the pointer, without scrolling the page', async () => {
		stubGeometry();
		await show();
		const map = page.getByTestId('map-view').element().closest('svg')!.parentElement!;
		const event = new WheelEvent('wheel', {
			bubbles: true,
			cancelable: true,
			clientX: 200,
			clientY: 250,
			deltaY: -100
		});
		map.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		await nextFrame();
		expect(transform().k).toBeCloseTo(4 * Math.exp(0.22), 10);
	});

	test('starts anew on a new size until moved, then keeps zoom and middle', async () => {
		stubGeometry();
		reduceMotion();
		const { container } = await show();
		container.style.height = '300px';
		// 0.32 × 300 px for 40 units.
		await expect.poll(() => transform().k).toBeCloseTo(2.4, 10);

		await page.getByRole('button', { name: 'Hineinzoomen' }).click();
		const zoomed = transform();
		container.style.width = '300px';
		await expect.poll(() => transform().x).toBeCloseTo(zoomed.x - 50, 10);
		expect(transform().k).toBeCloseTo(zoomed.k, 10);
		expect(transform().y).toBeCloseTo(zoomed.y, 10);
	});

	test('a tap on land without a country does nothing', async () => {
		stubGeometry();
		reduceMotion();
		const { onselect } = await show();
		await page.getByRole('button', { name: 'Welt' }).click();
		tap(centerOf(document.querySelector('path[data-land]')!), 'touch');
		expect(onselect).not.toHaveBeenCalled();
		expect(page.getByRole('status').elements()).toHaveLength(0);
	});

	test('a cancelled pointer neither pans nor taps, the right button does nothing', async () => {
		stubGeometry();
		const { onselect } = await show();
		const before = transform();
		pointer('pointerdown', [100, 100]);
		pointer('pointercancel', [100, 100]);
		pointer('pointerup', [100, 100]);
		document
			.elementFromPoint(100, 100)!
			.dispatchEvent(
				new PointerEvent('pointerdown', { bubbles: true, button: 2, clientX: 100, clientY: 100 })
			);
		pointer('pointermove', [160, 160]);
		await nextFrame();
		expect(transform()).toEqual(before);
		expect(onselect).not.toHaveBeenCalled();
	});

	test('animates a flight over time', async () => {
		stubGeometry();
		await show();
		await page.getByRole('button', { name: 'Welt' }).click();
		// Not at once …
		expect(transform().k).toBeGreaterThan(0.2);
		// … but in the end.
		await expect.poll(() => transform().k, { timeout: 2000 }).toBe(0.2);
	});
});
