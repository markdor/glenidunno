import { describe, test, expect, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import type { ResolvedPathname } from '$app/types';
// Three 16:9 slides, plain red, green and blue (shared with the e2e test).
import slidesUrl from '../../../tests/fixtures/slides.pdf?url';
import PresentationViewer from './PresentationViewer.svelte';

const DOWNLOAD = '/tasting/fluffy-otter/presentation/b1' as ResolvedPathname;
const RED = [204, 26, 26];
const GREEN = [26, 153, 51];
const BLUE = [26, 51, 204];

function show(pdfHref = slidesUrl, width = 400) {
	const result = render(PresentationViewer, {
		pdfHref: pdfHref as ResolvedPathname,
		downloadHref: DOWNLOAD
	});
	result.container.style.width = `${width}px`;
	return result;
}

const canvas = () => document.querySelector('canvas')!;
const slide = () => page.getByRole('img');

/** The colour in the middle of the slide shown, as RGB. */
function centerColour() {
	const { width, height } = canvas();
	const pixel = canvas()
		.getContext('2d')!
		.getImageData(Math.floor(width / 2), Math.floor(height / 2), 1, 1).data;
	return [...pixel.slice(0, 3)];
}

/** A horizontal swipe across the slide, `dx` CSS pixels to the right. */
function swipe(dx: number) {
	const frame = slide().element();
	const init = { pointerId: 1, isPrimary: true, bubbles: true, clientY: 100 };
	frame.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientX: 300 }));
	frame.dispatchEvent(new PointerEvent('pointerup', { ...init, clientX: 300 + dx }));
}

async function expectSlide(number: number, colour: number[]) {
	await expect.element(page.getByText(`${number} / 3`)).toBeVisible();
	await expect.element(slide()).toHaveAccessibleName(`Folie ${number} von 3`);
	await expect.poll(centerColour).toEqual(colour);
}

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
});

/** The Fullscreen API answering like a browser that has it (or refuses it). */
function mockFullscreenApi(request: () => Promise<void> = async () => {}) {
	vi.spyOn(document, 'fullscreenEnabled', 'get').mockReturnValue(true);
	const requestFullscreen = vi
		.spyOn(HTMLElement.prototype, 'requestFullscreen')
		.mockImplementation(request);
	const lock = vi.fn(async () => {});
	vi.spyOn(screen, 'orientation', 'get').mockReturnValue({ lock } as unknown as ScreenOrientation);
	return { requestFullscreen, lock };
}

/** A phone's orientation query that the test turns around. */
function mockOrientation(landscape: boolean) {
	const listeners = new Set<() => void>();
	const query = {
		matches: landscape,
		addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
		removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener)
	};
	vi.stubGlobal(
		'matchMedia',
		vi.fn(() => query)
	);
	return (turned: boolean) => {
		query.matches = turned;
		for (const listener of listeners) listener();
	};
}

const fullscreenButton = () => page.getByRole('button', { name: 'Vollbild', exact: true });
const closeButton = () => page.getByRole('button', { name: 'Vollbild beenden' });
const stage = () => slide().element().parentElement!;

/** Whether the slide fills the screen: fixed over it, as wide or as high as it. */
function fitted() {
	const { clientWidth, clientHeight } = stage();
	return (
		stage().style.position === 'fixed' &&
		canvas().style.width === `${Math.min(clientWidth, (clientHeight * 16) / 9)}px`
	);
}

describe('PresentationViewer', () => {
	test('shows the first slide as wide as its container', async () => {
		show();

		await expectSlide(1, RED);
		expect(canvas().style.width).toBe('400px');
		expect(canvas().width).toBe(400);
		// 16:9: the frame keeps the slide's height.
		expect(slide().element().style.height).toBe('225px');
		await expect
			.element(
				page.getByText('Animationen und Videos funktionieren nur in der heruntergeladenen Datei.')
			)
			.toBeVisible();
	});

	test('renders in the device pixel ratio, sharp on dense screens', async () => {
		vi.stubGlobal('devicePixelRatio', 2);
		show();

		await expectSlide(1, RED);
		expect(canvas().style.width).toBe('400px');
		expect(canvas().width).toBe(800);
	});

	test('renders again when its width changes, e.g. after rotating the phone', async () => {
		const { container } = show();
		await expectSlide(1, RED);

		container.style.width = '300px';

		await expect.poll(() => canvas().width).toBe(300);
		expect(slide().element().style.height).toBe('168.75px');
	});

	test('turns the slides with the buttons, disabled at both ends', async () => {
		show();
		const previous = page.getByRole('button', { name: 'Vorherige Folie' });
		const next = page.getByRole('button', { name: 'Nächste Folie' });

		await expectSlide(1, RED);
		await expect.element(previous).toBeDisabled();
		await next.click();
		await expectSlide(2, GREEN);
		await expect.element(previous).toBeEnabled();
		await next.click();
		await expectSlide(3, BLUE);
		await expect.element(next).toBeDisabled();
		await previous.click();
		await expectSlide(2, GREEN);
	});

	test('turns the slides with the arrow keys', async () => {
		show();
		await expectSlide(1, RED);

		await userEvent.keyboard('{ArrowRight}');
		await expectSlide(2, GREEN);
		await userEvent.keyboard('{ArrowLeft}');
		await expectSlide(1, RED);
		// Nothing before the first slide.
		await userEvent.keyboard('{ArrowLeft}');
		await expectSlide(1, RED);
		// With a modifier the key belongs to the browser (Alt: back and forward).
		await userEvent.keyboard('{Shift>}{ArrowRight}{/Shift}');
		await expectSlide(1, RED);
	});

	test('turns the slides by swiping, but not on a short or steep move', async () => {
		show();
		await expectSlide(1, RED);

		swipe(-120);
		await expectSlide(2, GREEN);
		swipe(120);
		await expectSlide(1, RED);
		swipe(-30);
		const frame = slide().element();
		frame.dispatchEvent(
			new PointerEvent('pointerdown', {
				pointerId: 2,
				isPrimary: true,
				bubbles: true,
				clientX: 300,
				clientY: 0
			})
		);
		frame.dispatchEvent(
			new PointerEvent('pointerup', {
				pointerId: 2,
				isPrimary: true,
				bubbles: true,
				clientX: 200,
				clientY: 300
			})
		);
		await expectSlide(1, RED);
	});

	test('zooms with the buttons and then moves the slide instead of turning it', async () => {
		show();
		const zoomIn = page.getByRole('button', { name: 'Vergrößern' });
		const zoomOut = page.getByRole('button', { name: 'Verkleinern' });
		await expectSlide(1, RED);
		await expect.element(zoomOut).toBeDisabled();

		await zoomIn.click();
		await expect.poll(() => canvas().width).toBe(600);
		expect(canvas().style.width).toBe('600px');
		// The frame keeps its size and scrolls instead.
		expect(slide().element().style.height).toBe('225px');
		expect(slide().element().style.touchAction).toBe('auto');

		swipe(-120);
		await expect.element(page.getByText('1 / 3')).toBeVisible();

		for (let step = 0; step < 3; step++) await zoomIn.click();
		await expect.poll(() => canvas().width).toBe(1200);
		await expect.element(zoomIn).toBeDisabled();

		for (let step = 0; step < 4; step++) await zoomOut.click();
		await expect.poll(() => canvas().width).toBe(400);
		expect(slide().element().style.touchAction).toBe('pan-y pinch-zoom');
		swipe(-120);
		await expectSlide(2, GREEN);
	});

	test('shows the slide in full screen, in landscape on phones that can lock it', async () => {
		const { requestFullscreen, lock } = mockFullscreenApi();
		show();
		await expectSlide(1, RED);
		await page.getByRole('button', { name: 'Vergrößern' }).click();

		await fullscreenButton().click();

		expect(requestFullscreen).toHaveBeenCalledOnce();
		expect(lock).toHaveBeenCalledWith('landscape');
		await expect.element(closeButton()).toBeVisible();
		// Fitted at 100 %, the page's controls make way for the small ones.
		await expect.poll(() => stage().style.position).toBe('fixed');
		await expect.poll(fitted).toBe(true);
		expect(page.getByRole('button', { name: 'Vergrößern' }).elements()).toHaveLength(0);
		await page.getByRole('button', { name: 'Nächste Folie' }).click();
		await expectSlide(2, GREEN);

		await closeButton().click();
		await expect.element(fullscreenButton()).toBeVisible();
		expect(stage().style.position).toBe('');
	});

	test('ends full screen when the browser leaves it (Esc, back gesture)', async () => {
		mockFullscreenApi();
		show();
		await expectSlide(1, RED);
		await fullscreenButton().click();
		await expect.element(closeButton()).toBeVisible();

		document.dispatchEvent(new Event('fullscreenchange'));

		await expect.element(fullscreenButton()).toBeVisible();
	});

	test.each([
		{ label: 'without the Fullscreen API (iPhone)', api: false },
		{ label: 'when the browser refuses it', api: true }
	])('covers the page with a layer $label', async ({ api }) => {
		if (api) mockFullscreenApi(() => Promise.reject(new Error('refused')));
		else vi.spyOn(document, 'fullscreenEnabled', 'get').mockReturnValue(false);
		show();
		await expectSlide(1, RED);

		await fullscreenButton().click();

		await expect.element(closeButton()).toBeVisible();
		await expect.poll(fitted).toBe(true);
		// The page behind doesn't scroll.
		expect(document.documentElement.style.overflow).toBe('hidden');
		swipe(-120);
		await expectSlide(2, GREEN);

		await userEvent.keyboard('{Escape}');
		await expect.element(fullscreenButton()).toBeVisible();
		expect(document.documentElement.style.overflow).toBe('');
	});

	test('goes full screen by itself when the phone is turned to landscape', async () => {
		const turn = mockOrientation(false);
		show();
		await expectSlide(1, RED);
		await expect.element(fullscreenButton()).toBeVisible();

		turn(true);
		await expect.element(closeButton()).toBeVisible();
		await expect.poll(fitted).toBe(true);

		// Closed in landscape it stays closed – until the next turn.
		await closeButton().click();
		await expect.element(fullscreenButton()).toBeVisible();
		turn(false);
		turn(true);
		await expect.element(closeButton()).toBeVisible();

		turn(false);
		await expect.element(fullscreenButton()).toBeVisible();
	});

	test('shows a loading state until the PDF arrives', async () => {
		vi.stubGlobal(
			'fetch',
			vi.fn(() => new Promise<Response>(() => {}))
		);
		show('/presentation.pdf');

		await expect
			.element(page.getByRole('status'))
			.toHaveTextContent('Präsentation wird vorbereitet …');
		expect(page.getByRole('button').elements()).toHaveLength(0);
	});

	test.each([
		{ label: 'an error answer', response: () => new Response('', { status: 503 }) },
		{ label: 'a broken PDF', response: () => new Response('kein PDF') }
	])('shows the error state with the download after $label', async ({ response }) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response())
		);
		show('/presentation.pdf');

		await expect
			.element(page.getByText('Die Präsentation lässt sich gerade nicht anzeigen.'))
			.toBeVisible();
		const download = page.getByRole('link', { name: 'Präsentation herunterladen' });
		await expect.element(download).toHaveAttribute('href', DOWNLOAD);
		await expect.element(download).toHaveAttribute('download');
	});

	test('stops loading when it goes away', async () => {
		const fetchMock = vi.fn(
			(_url: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				})
		);
		vi.stubGlobal('fetch', fetchMock);
		const { unmount } = show('/presentation.pdf');
		await expect.poll(() => fetchMock.mock.calls.length).toBe(1);

		unmount();

		expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
	});
});
