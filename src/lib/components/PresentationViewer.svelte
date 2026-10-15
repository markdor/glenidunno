<script lang="ts">
	import { onMount, tick } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { ChevronLeft, ChevronRight, Maximize, X, ZoomIn, ZoomOut } from '@lucide/svelte';
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
	let stage = $state<HTMLDivElement>();
	let stageWidth = $state(0);
	let stageHeight = $state(0);

	// Full screen: `native` via the Fullscreen API (button only – browsers
	// refuse it without a tap), `overlay` where that is missing (iPhone
	// Safari): a layer over the whole page. A phone held in landscape gets
	// the same layer on its own, until closed or turned back.
	let fullscreen = $state<'off' | 'native' | 'overlay'>('off');
	let landscapePhone = $state(false);
	let landscapeDismissed = $state(false);
	const immersive = $derived(
		status === 'ready' && (fullscreen !== 'off' || (landscapePhone && !landscapeDismissed))
	);

	const pageCount = $derived(pdf?.numPages ?? 0);
	// Full screen fits the whole slide into the screen, otherwise it is as
	// wide as the page.
	const frameWidth = $derived(
		immersive && stageWidth > 0 && stageHeight > 0
			? Math.min(stageWidth, stageHeight / aspect)
			: measuredWidth > 0
				? measuredWidth
				: FALLBACK_WIDTH
	);
	const slideWidth = $derived(frameWidth * ZOOM_STEPS[immersive ? 0 : zoomIndex]);
	const zoomed = $derived(!immersive && zoomIndex > 0);

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
				// Rejects if the viewer is gone meanwhile, which is fine.
				if (number < doc.numPages) doc.getPage(number + 1).catch(() => {});
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

	// Phones only: a desktop window is landscape as well.
	onMount(() => {
		const query = window.matchMedia('(orientation: landscape) and (pointer: coarse)');
		const update = () => {
			landscapePhone = query.matches;
			// Turned back to portrait: the next landscape opens full screen again.
			if (!query.matches) landscapeDismissed = false;
		};
		update();
		query.addEventListener('change', update);
		// Left native full screen with the browser's own means (Esc, back gesture).
		const onFullscreenChange = () => {
			if (!document.fullscreenElement && fullscreen === 'native') closeFullscreen();
		};
		document.addEventListener('fullscreenchange', onFullscreenChange);
		return () => {
			query.removeEventListener('change', update);
			document.removeEventListener('fullscreenchange', onFullscreenChange);
		};
	});

	// The layer covers the page, so the page behind it must not scroll.
	$effect(() => {
		if (!immersive || fullscreen === 'native') return;
		const root = document.documentElement;
		const before = root.style.overflow;
		root.style.overflow = 'hidden';
		return () => {
			root.style.overflow = before;
		};
	});

	async function openFullscreen() {
		// Called right from the tap: requestFullscreen needs that gesture.
		if (stage && document.fullscreenEnabled) {
			try {
				await stage.requestFullscreen();
				fullscreen = 'native';
				// Slides are landscape. Only Android can lock it, and only in full screen.
				const orientation = screen.orientation as ScreenOrientation & {
					lock?: (orientation: 'landscape') => Promise<void>;
				};
				await orientation.lock?.('landscape').catch(() => {});
				return;
			} catch {
				// Refused – the layer instead.
			}
		}
		fullscreen = 'overlay';
	}

	function closeFullscreen() {
		fullscreen = 'off';
		// Still landscape: closing means "not now", not "open it again".
		if (landscapePhone) landscapeDismissed = true;
		if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
	}

	function onkeydown(event: KeyboardEvent) {
		if (immersive && event.key === 'Escape') {
			closeFullscreen();
			return;
		}
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
	const immersiveControlClass =
		'flex h-11 w-11 items-center justify-center rounded-lg hover:bg-white/20 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent';
</script>

<svelte:window {onkeydown} />

{#snippet pager(buttonClass: string)}
	<button
		type="button"
		onclick={previous}
		disabled={pageNumber <= 1}
		aria-label="Vorherige Folie"
		class={buttonClass}
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
		class={buttonClass}
	>
		<ChevronRight size={20} strokeWidth={2} aria-hidden="true" />
	</button>
{/snippet}

<div class="space-y-3">
	<!-- Measures an empty line: its width never depends on the slide drawn
	     from it, so drawing can't trigger another resize. -->
	<div bind:clientWidth={measuredWidth} aria-hidden="true"></div>

	{#if status === 'ready'}
		<!-- The stage: in the page flow, or in full screen fixed over the whole
		     screen. Position inline, so its size never depends on the slide –
		     also without Tailwind (component tests). -->
		<div
			bind:this={stage}
			class={[immersive && 'flex items-center justify-center bg-black']}
			style:position={immersive ? 'fixed' : null}
			style:inset={immersive ? '0' : null}
			style:z-index={immersive ? '50' : null}
		>
			{#if immersive}
				<!-- Measures the screen with an empty layer, like the line above
				     measures the page: drawing the slide can't resize it. -->
				<div
					bind:clientWidth={stageWidth}
					bind:clientHeight={stageHeight}
					aria-hidden="true"
					style:position="absolute"
					style:inset="0"
					style:pointer-events="none"
				></div>
			{/if}
			<!-- An image to assistive technology: the slide has no text layer, the
			     buttons turn it. Swiping is only a shortcut for touch. -->
			<div
				bind:this={frame}
				role="img"
				aria-label="Folie {pageNumber} von {pageCount}"
				class={[
					'bg-white',
					!immersive && 'rounded-xl ring-1 ring-slate-200',
					zoomed ? 'overflow-auto' : 'overflow-hidden'
				]}
				style:width={immersive ? `${frameWidth}px` : null}
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

			{#if immersive}
				<!-- Unobtrusive over the slide: turning, where we are, closing. -->
				<div
					class="absolute right-3 bottom-3 flex items-center gap-1 rounded-xl bg-black/60 p-1 text-white"
				>
					{@render pager(immersiveControlClass)}
					<button
						type="button"
						onclick={closeFullscreen}
						aria-label="Vollbild beenden"
						class={immersiveControlClass}
					>
						<X size={20} strokeWidth={2} aria-hidden="true" />
					</button>
				</div>
			{/if}
		</div>

		{#if !immersive}
			<div class="flex items-center justify-between gap-3">
				<div class="flex items-center gap-2">{@render pager(controlClass)}</div>
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
					<button type="button" onclick={openFullscreen} aria-label="Vollbild" class={controlClass}>
						<Maximize size={20} strokeWidth={2} aria-hidden="true" />
					</button>
				</div>
			</div>
		{/if}
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
