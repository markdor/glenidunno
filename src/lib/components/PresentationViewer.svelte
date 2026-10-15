<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from '@lucide/svelte';
	import type { PDFDocumentLoadingTask, PDFDocumentProxy } from 'pdfjs-dist';
	import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

	let {
		pdfHref,
		downloadHref
	}: {
		/** The presentation as PDF – an office file is converted on the first request. */
		pdfHref: ResolvedPathname;
		/** The original file, offered when the viewer fails. */
		downloadHref: ResolvedPathname;
	} = $props();

	/** Zoom steps of the − / + buttons; 100 % is the slide as wide as the page. */
	const ZOOM_STEPS = [1, 1.5, 2, 2.5, 3];
	/** Horizontal distance (CSS px) a swipe needs to turn the slide. */
	const SWIPE_MIN_PX = 50;
	/** Canvas pixel budget: iOS Safari draws nothing on larger canvases. */
	const MAX_CANVAS_PIXELS = 4096 * 4096;
	/** Slide width before the first measurement (server-side rendering): about a phone's. */
	const FALLBACK_WIDTH = 343;

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	let pdf = $state.raw<PDFDocumentProxy | null>(null);
	let pdfjs: typeof import('pdfjs-dist') | null = null;
	let pageNumber = $state(1);
	let zoomIndex = $state(0);
	let measuredWidth = $state(0);
	// Height per width of the current slide, 16:9 until the first one is known.
	let aspect = $state(9 / 16);
	let canvas = $state<HTMLCanvasElement>();
	let frame = $state<HTMLDivElement>();

	const pageCount = $derived(pdf?.numPages ?? 0);
	const frameWidth = $derived(measuredWidth > 0 ? measuredWidth : FALLBACK_WIDTH);
	const slideWidth = $derived(frameWidth * ZOOM_STEPS[zoomIndex]);
	const zoomed = $derived(zoomIndex > 0);

	// Fetched only after the mount, never in the load: hovering a link preloads
	// it, and the first request may convert an office file. pdf.js only ever
	// runs in the browser, loaded with this page alone.
	onMount(() => {
		const controller = new AbortController();
		let task: PDFDocumentLoadingTask | undefined;
		void (async () => {
			try {
				const [module, response] = await Promise.all([
					import('pdfjs-dist'),
					fetch(pdfHref, { signal: controller.signal })
				]);
				if (!response.ok) throw new Error(`presentation pdf answered ${response.status}`);
				const data = new Uint8Array(await response.arrayBuffer());
				module.GlobalWorkerOptions.workerSrc = workerSrc;
				pdfjs = module;
				task = module.getDocument({ data });
				pdf = await task.promise;
				status = 'ready';
			} catch {
				if (!controller.signal.aborted) status = 'error';
			}
		})();
		return () => {
			controller.abort();
			void task?.destroy();
		};
	});

	// Renders the current slide only – again on turning, zooming and every
	// change of the width (rotation, resized window). Off-screen first and then
	// copied over, so the slide shown never goes blank or half-drawn. pdf.js
	// keeps the pages it parsed, so turning back costs no second parse.
	$effect(() => {
		if (status !== 'ready' || !pdf || !canvas) return;
		const doc = pdf;
		const target = canvas;
		const number = pageNumber;
		const cssWidth = slideWidth;
		let stale = false;
		let cancel: (() => void) | undefined;

		void (async () => {
			try {
				const page = await doc.getPage(number);
				if (stale) return;
				const unscaled = page.getViewport({ scale: 1 });
				const slideAspect = unscaled.height / unscaled.width;
				aspect = slideAspect;
				// Sharp on high-density screens, but within the canvas budget.
				const pixelRatio = Math.min(
					window.devicePixelRatio || 1,
					Math.sqrt(MAX_CANVAS_PIXELS / (cssWidth * cssWidth * slideAspect))
				);
				const viewport = page.getViewport({ scale: (cssWidth / unscaled.width) * pixelRatio });
				const offscreen = document.createElement('canvas');
				offscreen.width = Math.floor(viewport.width);
				offscreen.height = Math.floor(viewport.height);
				const render = page.render({ canvas: offscreen, viewport });
				cancel = () => render.cancel();
				await render.promise;
				if (stale) return;
				target.width = offscreen.width;
				target.height = offscreen.height;
				target.getContext('2d')?.drawImage(offscreen, 0, 0);
				// The next slide is prepared (parsed), not rendered.
				if (number < doc.numPages) void doc.getPage(number + 1);
			} catch (err) {
				// Cancelled by a newer render; anything else ends in the error state.
				if (!stale && !(pdfjs && err instanceof pdfjs.RenderingCancelledException)) {
					status = 'error';
				}
			}
		})();

		return () => {
			stale = true;
			cancel?.();
		};
	});

	function previous() {
		if (pageNumber > 1) pageNumber -= 1;
	}

	function next() {
		if (pageNumber < pageCount) pageNumber += 1;
	}

	// The point in the middle of the frame stays there while zooming.
	async function zoomTo(index: number) {
		const before = ZOOM_STEPS[zoomIndex];
		const centerX = frame ? (frame.scrollLeft + frame.clientWidth / 2) / before : 0;
		const centerY = frame ? (frame.scrollTop + frame.clientHeight / 2) / before : 0;
		zoomIndex = index;
		await tick();
		if (!frame) return;
		frame.scrollLeft = centerX * ZOOM_STEPS[index] - frame.clientWidth / 2;
		frame.scrollTop = centerY * ZOOM_STEPS[index] - frame.clientHeight / 2;
	}

	function onkeydown(event: KeyboardEvent) {
		if (status !== 'ready' || event.defaultPrevented) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
		if (event.target instanceof Element && event.target.closest('input, select, textarea')) return;
		if (event.key === 'ArrowLeft') previous();
		else if (event.key === 'ArrowRight') next();
		else return;
		event.preventDefault();
	}

	// Swiping turns the slide at 100 % only. Zoomed, the frame scrolls natively
	// instead (touch-action), in both directions.
	let swipe: { pointerId: number; x: number; y: number } | null = null;

	function onpointerdown(event: PointerEvent) {
		if (zoomed || !event.isPrimary) return;
		swipe = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
	}

	function onpointerup(event: PointerEvent) {
		const start = swipe;
		swipe = null;
		if (zoomed || !start || start.pointerId !== event.pointerId) return;
		const dx = event.clientX - start.x;
		if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(event.clientY - start.y)) return;
		if (dx < 0) next();
		else previous();
	}

	const controlClass =
		'flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';
</script>

<svelte:window {onkeydown} />

<div class="space-y-3">
	<!-- Measures an empty line: its width never depends on the slide drawn
	     from it, so drawing can't trigger another resize. -->
	<div bind:clientWidth={measuredWidth} aria-hidden="true"></div>

	{#if status === 'ready'}
		<!-- An image to assistive technology: the slide has no text layer, the
		     buttons below turn it. Swiping is only a shortcut for touch. -->
		<div
			bind:this={frame}
			role="img"
			aria-label="Folie {pageNumber} von {pageCount}"
			class={[
				'rounded-xl bg-white ring-1 ring-slate-200',
				zoomed ? 'overflow-auto' : 'overflow-hidden'
			]}
			style:height="{frameWidth * aspect}px"
			style:touch-action={zoomed ? 'auto' : 'pan-y pinch-zoom'}
			{onpointerdown}
			{onpointerup}
			onpointercancel={() => (swipe = null)}
		>
			<canvas
				bind:this={canvas}
				aria-hidden="true"
				class="block max-w-none"
				style:width="{slideWidth}px"
				style:height="{slideWidth * aspect}px"
			></canvas>
		</div>

		<div class="flex items-center justify-between gap-3">
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={previous}
					disabled={pageNumber <= 1}
					aria-label="Vorherige Folie"
					class={controlClass}
				>
					<ChevronLeft size={20} strokeWidth={2} aria-hidden="true" />
				</button>
				<p class="min-w-16 text-center text-sm font-medium tabular-nums" aria-live="polite">
					<span aria-hidden="true">{pageNumber} / {pageCount}</span>
					<span class="sr-only">Folie {pageNumber} von {pageCount}</span>
				</p>
				<button
					type="button"
					onclick={next}
					disabled={pageNumber >= pageCount}
					aria-label="Nächste Folie"
					class={controlClass}
				>
					<ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>
			<div class="flex items-center gap-2">
				<button
					type="button"
					onclick={() => zoomTo(zoomIndex - 1)}
					disabled={zoomIndex === 0}
					aria-label="Verkleinern"
					class={controlClass}
				>
					<ZoomOut size={20} strokeWidth={2} aria-hidden="true" />
				</button>
				<button
					type="button"
					onclick={() => zoomTo(zoomIndex + 1)}
					disabled={zoomIndex === ZOOM_STEPS.length - 1}
					aria-label="Vergrößern"
					class={controlClass}
				>
					<ZoomIn size={20} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>
		</div>
	{:else if status === 'error'}
		<div
			class="flex aspect-video flex-col items-center justify-center gap-2 rounded-xl border border-red-300 bg-red-50 px-4 text-center text-sm text-red-900"
		>
			<p>Die Präsentation lässt sich gerade nicht anzeigen.</p>
			<!-- Served as an attachment by a +server.ts route: `download` keeps the
			     client router out of it. -->
			<a href={downloadHref} download class="py-2 font-medium underline">
				Präsentation herunterladen
			</a>
		</div>
	{:else}
		<p
			role="status"
			class="flex aspect-video items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-center text-sm text-slate-500"
		>
			Präsentation wird vorbereitet …
		</p>
	{/if}

	<p class="text-xs text-slate-500">
		Animationen und Videos funktionieren nur in der heruntergeladenen Datei.
	</p>
</div>
