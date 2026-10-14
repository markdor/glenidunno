<script lang="ts">
	// One line over time (x = date, not index), so a long break between two
	// tastings shows as one. The y-axis fits the values instead of 0–100.
	// Hover and tap pick the nearest point – the points may sit only a few
	// pixels apart – keyboard users tab through one target per point; the
	// line below the chart tells the value either way.

	import { formatDate } from '$lib/tasting';

	let {
		points,
		label,
		format,
		unit = null
	}: {
		/** In date order; points without a value are left out. */
		points: Array<{ date: string; value: number | null }>;
		/** Accessible name of the chart. */
		label: string;
		/** A value as the readout shows it, e.g. "50,6 %". */
		format: (value: number) => string;
		/** Unit after the y-axis ticks, `null` for plain numbers. */
		unit?: string | null;
	} = $props();

	// The logo's amber (--color-brand) like TastingOrderChart: one line, its
	// title names it, so no legend and no end label (dataviz skill).
	const LINE_COLOR = '#7d5212';

	const PAD_LEFT = 40;
	const PAD_RIGHT = 14;
	const PAD_TOP = 10;
	const PLOT_HEIGHT = 150;
	const AXIS_HEIGHT = 22;
	const HEIGHT = PAD_TOP + PLOT_HEIGHT + AXIS_HEIGHT;
	// Drawing width before the first measurement (server-side rendering). The
	// height is fixed, so the SVG fits this width into its container instead of
	// scaling up with it – on a desktop it would be twice as tall until
	// hydration and push everything below it down.
	const FALLBACK_WIDTH = 320;
	const MIN_YEAR_GAP = 32;

	let containerWidth = $state(0);
	let svg: SVGSVGElement | undefined = $state();
	let activeIndex: number | null = $state(null);

	const width = $derived(containerWidth > 0 ? containerWidth : FALLBACK_WIDTH);
	const plotWidth = $derived(width - PAD_LEFT - PAD_RIGHT);

	const times = $derived(points.map((p) => Date.parse(`${p.date}T00:00:00Z`)));
	const first = $derived(Math.min(...times));
	const last = $derived(Math.max(...times));

	/** Rounds a raw tick distance to 1, 2 or 5 times a power of ten. */
	function niceStep(raw: number): number {
		const magnitude = 10 ** Math.floor(Math.log10(raw));
		const fraction = raw / magnitude;
		return (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * magnitude;
	}

	const values = $derived(points.flatMap((p) => (p.value === null ? [] : [p.value])));
	const scale = $derived.by(() => {
		const min = Math.min(...values);
		const max = Math.max(...values);
		const step = niceStep(max > min ? (max - min) / 4 : Math.max(1, Math.abs(max) / 10));
		let lower = Math.floor(min / step) * step;
		let upper = Math.ceil(max / step) * step;
		if (upper === lower) {
			lower -= step;
			upper += step;
		}
		const count = Math.round((upper - lower) / step);
		// Rounded: 0.1 steps would add up to 45.00000001.
		const ticks = Array.from(
			{ length: count + 1 },
			(_, i) => Math.round((lower + i * step) * 1e6) / 1e6
		);
		return { lower, upper, ticks };
	});

	function xAt(time: number): number {
		return last > first
			? PAD_LEFT + ((time - first) / (last - first)) * plotWidth
			: PAD_LEFT + plotWidth / 2;
	}
	function yAt(value: number): number {
		return PAD_TOP + (1 - (value - scale.lower) / (scale.upper - scale.lower)) * PLOT_HEIGHT;
	}

	const drawn = $derived(
		points.flatMap((p, i) =>
			p.value === null ? [] : [{ date: p.date, value: p.value, x: xAt(times[i]), y: yAt(p.value) }]
		)
	);
	const path = $derived(drawn.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' '));
	const active = $derived(activeIndex === null ? null : (drawn[activeIndex] ?? null));

	// Every January 1st within the range; with too little room every other.
	const years = $derived.by(() => {
		const all: Array<{ year: number; x: number }> = [];
		const from = new Date(first).getUTCFullYear() + 1;
		const to = new Date(last).getUTCFullYear();
		for (let year = from; year <= to; year++) all.push({ year, x: xAt(Date.UTC(year, 0, 1)) });
		const gap = all.length > 1 ? all[1].x - all[0].x : Infinity;
		const every = Math.max(1, Math.ceil(MIN_YEAR_GAP / gap));
		return all.filter((_, i) => i % every === 0);
	});

	function nearest(event: PointerEvent): number | null {
		if (!svg || drawn.length === 0) return null;
		const box = svg.getBoundingClientRect();
		const x = ((event.clientX - box.left) / box.width) * width;
		let best = 0;
		drawn.forEach((p, i) => {
			if (Math.abs(p.x - x) < Math.abs(drawn[best].x - x)) best = i;
		});
		return best;
	}
	function point(event: PointerEvent) {
		activeIndex = nearest(event);
	}
	// A tap ends with pointerleave as well: keep its value until the next one.
	function leave(event: PointerEvent) {
		if (event.pointerType === 'mouse') activeIndex = null;
	}
	function describe(p: { date: string; value: number }): string {
		return `${formatDate(p.date)}: ${format(p.value)}`;
	}
</script>

<div bind:clientWidth={containerWidth}>
	{#if drawn.length === 0}
		<p class="text-sm text-slate-500">Keine Werte.</p>
	{:else}
		<svg
			bind:this={svg}
			viewBox={`0 0 ${width} ${HEIGHT}`}
			height={HEIGHT}
			class="block w-full"
			role="img"
			aria-label={label}
		>
			{#each scale.ticks as tick (tick)}
				<line
					x1={PAD_LEFT}
					x2={PAD_LEFT + plotWidth}
					y1={yAt(tick)}
					y2={yAt(tick)}
					class="stroke-slate-200"
					stroke-width="1"
				/>
				<text
					x={PAD_LEFT - 6}
					y={yAt(tick)}
					dy="0.32em"
					text-anchor="end"
					class="fill-slate-400 text-[10px] tabular-nums"
				>
					{tick.toLocaleString('de-DE')}{#if unit}&nbsp;{unit}{/if}
				</text>
			{/each}

			{#each years as y (y.year)}
				<line
					x1={y.x}
					x2={y.x}
					y1={PAD_TOP + PLOT_HEIGHT}
					y2={PAD_TOP + PLOT_HEIGHT + 4}
					class="stroke-slate-300"
					stroke-width="1"
				/>
				<text
					x={y.x}
					y={PAD_TOP + PLOT_HEIGHT + 16}
					text-anchor="middle"
					class="fill-slate-400 text-[10px] tabular-nums"
				>
					{y.year}
				</text>
			{/each}

			{#if active}
				<line
					x1={active.x}
					x2={active.x}
					y1={PAD_TOP}
					y2={PAD_TOP + PLOT_HEIGHT}
					class="stroke-slate-300"
					stroke-width="1"
				/>
			{/if}

			<path
				d={path}
				fill="none"
				stroke={LINE_COLOR}
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			{#each drawn as p, i (i)}
				<circle
					cx={p.x}
					cy={p.y}
					r={active === p ? 6 : 4}
					fill={LINE_COLOR}
					stroke="white"
					stroke-width="2"
				/>
			{/each}

			<rect
				x={PAD_LEFT - 8}
				y={PAD_TOP}
				width={plotWidth + 16}
				height={PLOT_HEIGHT}
				fill="transparent"
				role="presentation"
				onpointermove={point}
				onpointerdown={point}
				onpointerleave={leave}
			/>
			<!-- Focus targets only: the pointer goes to the layer above. -->
			{#each drawn as p, i (i)}
				<circle
					cx={p.x}
					cy={p.y}
					r="12"
					fill="transparent"
					pointer-events="none"
					role="button"
					tabindex="0"
					aria-label={describe(p)}
					onfocus={() => (activeIndex = i)}
					onblur={() => {
						if (activeIndex === i) activeIndex = null;
					}}
				/>
			{/each}
		</svg>
	{/if}
	<p class="min-h-5 text-xs text-slate-600" aria-live="polite">
		{#if active}
			<span class="font-medium text-slate-900">{formatDate(active.date)}</span>
			· {format(active.value)}
		{:else if drawn.length > 0}
			Tippe oder fahre mit der Maus über die Linie für die genauen Werte.
		{/if}
	</p>
</div>
