<script lang="ts" module>
	/** One line of the chart: a 0–1 fraction per bottle, in pouring order. */
	export type ChartSeries = {
		key: string;
		color: string;
		/** Direct end label – without one the line stays unnamed. */
		label?: string;
		values: number[];
	};
</script>

<script lang="ts">
	// The plot shared by the score charts: one smoothed line per series over
	// the pouring order, on a common 0–100 axis. The tiles around it decide
	// what the lines are called (a single line is named by the tile's title)
	// and whether a hovered bottle reveals anything at all.

	let {
		aliases,
		series,
		ariaLabel,
		describePoint,
		unit = '%',
		bottleMarks = true,
		activeIndex = $bindable(null)
	}: {
		/** X-axis: one alias per bottle, in pouring order. */
		aliases: string[];
		series: ChartSeries[];
		ariaLabel: string;
		/**
		 * Accessible name of a bottle's hover/focus target. Without it the chart
		 * has no targets at all: nothing to hover, tap or focus, no per-bottle
		 * text – only the line.
		 */
		describePoint?: (index: number) => string;
		/** Unit after the y-axis ticks 0, 50 and 100; `null` for plain numbers. */
		unit?: string | null;
		/**
		 * Per bottle a vertical guide, its alias below the plot and a point on
		 * every line. Without them only the lines and the y-axis remain.
		 */
		bottleMarks?: boolean;
		activeIndex?: number | null;
	} = $props();

	const PAD_LEFT = 38;
	const PAD_TOP = 14;
	const PLOT_HEIGHT = 220;
	// Below the plot: room for the rotated aliases, or – without them – just
	// for the lower half of the 0 tick label.
	const ALIAS_RESERVE = 54;
	const TICK_RESERVE = 8;
	// Right of the last bottle: room for the end labels, or – when no line is
	// labeled – just for the last point's marker.
	const LABEL_RESERVE = 104;
	const MARKER_RESERVE = 12;
	// Floor for the column spacing – never compressed narrower than this, even
	// when many bottles would otherwise force it; the wrapper scrolls instead.
	// The aliases need the wider one; without them only the hover targets
	// count (the dataviz skill's 24px minimum hit area) – a floor that also
	// keeps the line legible when there are no targets.
	const STEP_MIN = 88;
	const HIT_TARGET_MIN = 24;
	const MIN_LABEL_GAP = 16;
	// clientWidth rounds to an integer while the container's true (fractional)
	// width can be a hair narrower; drawing the SVG at exactly that integer
	// then overflows by a sub-pixel and shows an (otherwise hover-only,
	// normally hidden) horizontal scrollbar. This margin keeps the fill-mode
	// width just inside the measured value instead.
	const CONTAINER_SAFETY_MARGIN = 8;

	// Measured width of the chart's card slot. Until the ResizeObserver behind
	// bind:clientWidth reports a real value (SSR, first paint) this stays 0 and
	// the chart falls back to its natural, minimum-spaced width below.
	let containerWidth: number = $state(0);

	const stepMin = $derived(bottleMarks ? STEP_MIN : HIT_TARGET_MIN);
	const padRight = $derived(series.some((s) => s.label) ? LABEL_RESERVE : MARKER_RESERVE);
	const naturalWidth = $derived(PAD_LEFT + Math.max(1, aliases.length - 1) * stepMin + padRight);
	// Fills the available width when there's room (containerWidth > natural);
	// otherwise keeps the natural, minimum-spaced width and lets the wrapper
	// scroll horizontally.
	const width = $derived(Math.max(naturalWidth, containerWidth - CONTAINER_SAFETY_MARGIN));
	const plotWidth = $derived(width - PAD_LEFT - padRight);
	const step = $derived(aliases.length > 1 ? plotWidth / (aliases.length - 1) : plotWidth);
	const height = $derived(PAD_TOP + PLOT_HEIGHT + (bottleMarks ? ALIAS_RESERVE : TICK_RESERVE));
	const axisLabelY = PAD_TOP + PLOT_HEIGHT + 14;

	function xAt(i: number): number {
		return PAD_LEFT + (aliases.length === 1 ? plotWidth / 2 : i * step);
	}
	function yAt(fraction: number): number {
		return PAD_TOP + (1 - fraction) * PLOT_HEIGHT;
	}
	function truncate(text: string, max = 14): string {
		return text.length > max ? `${text.slice(0, max - 1)}…` : text;
	}

	type Point = { x: number; y: number };

	/**
	 * Monotone cubic (Fritsch–Carlson) tangents: the standard way to smooth a
	 * line without overshoot past the surrounding data points – a plain
	 * Catmull-Rom spline would bulge above/below the actual values, especially
	 * around a plateau, and misrepresent the data.
	 */
	function monotoneTangents(xs: number[], ys: number[]): number[] {
		const n = xs.length;
		const m = new Array<number>(n).fill(0);
		if (n < 2) return m;
		const d: number[] = [];
		for (let k = 0; k < n - 1; k++) {
			d.push((ys[k + 1] - ys[k]) / (xs[k + 1] - xs[k]));
		}
		m[0] = d[0];
		m[n - 1] = d[n - 2];
		for (let k = 1; k < n - 1; k++) {
			if (d[k - 1] === 0 || d[k] === 0 || d[k - 1] < 0 !== d[k] < 0) {
				m[k] = 0;
			} else {
				const w1 = 2 * (xs[k + 1] - xs[k]) + (xs[k] - xs[k - 1]);
				const w2 = xs[k + 1] - xs[k] + 2 * (xs[k] - xs[k - 1]);
				m[k] = (w1 + w2) / (w1 / d[k - 1] + w2 / d[k]);
			}
		}
		return m;
	}

	function smoothLinePath(coords: Point[]): string {
		if (coords.length === 0) return '';
		if (coords.length === 1) return `M${coords[0].x},${coords[0].y}`;
		const xs = coords.map((c) => c.x);
		const ys = coords.map((c) => c.y);
		const m = monotoneTangents(xs, ys);
		let d = `M${xs[0]},${ys[0]}`;
		for (let k = 0; k < xs.length - 1; k++) {
			const dx = xs[k + 1] - xs[k];
			const c1x = xs[k] + dx / 3;
			const c1y = ys[k] + (m[k] * dx) / 3;
			const c2x = xs[k + 1] - dx / 3;
			const c2y = ys[k + 1] - (m[k + 1] * dx) / 3;
			d += ` C${c1x},${c1y} ${c2x},${c2y} ${xs[k + 1]},${ys[k + 1]}`;
		}
		return d;
	}

	/** The same smoothed curve, closed down to the 0 % baseline for the fill. */
	function smoothAreaPath(coords: Point[], baselineY: number): string {
		if (coords.length < 2) return '';
		const first = coords[0];
		const last = coords[coords.length - 1];
		return `${smoothLinePath(coords)} L${last.x},${baselineY} L${first.x},${baselineY} Z`;
	}

	const seriesLines = $derived(
		series.map((s) => {
			const coords = s.values.map((fraction, i) => ({ x: xAt(i), y: yAt(fraction) }));
			return {
				...s,
				coords,
				linePath: smoothLinePath(coords),
				areaPath: smoothAreaPath(coords, yAt(0))
			};
		})
	);

	// End-of-line direct labels (for the labeled lines only): stacked top →
	// bottom by their actual line-end position with a minimum gap, each kept
	// honest with a leader line back to its real value – nudging them apart is
	// only legible with that connector (dataviz skill).
	const endLabels = $derived.by(() => {
		if (aliases.length === 0) return [];
		const endX = xAt(aliases.length - 1);
		const sorted = seriesLines
			.flatMap((s) =>
				s.label ? [{ key: s.key, label: s.label, anchorY: s.coords[s.coords.length - 1].y }] : []
			)
			.sort((a, b) => a.anchorY - b.anchorY);
		let prevY = -Infinity;
		return sorted.map((item) => {
			const placedY = Math.max(item.anchorY, prevY + MIN_LABEL_GAP);
			prevY = placedY;
			return { ...item, endX, placedY };
		});
	});

	function activate(i: number) {
		activeIndex = i;
	}
	function deactivate(i: number) {
		if (activeIndex === i) activeIndex = null;
	}
</script>

<div class="-mx-1 overflow-x-auto px-1" bind:clientWidth={containerWidth}>
	<svg {width} {height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={ariaLabel}>
		{#each [0, 0.5, 1] as fraction (fraction)}
			<line
				x1={PAD_LEFT}
				x2={PAD_LEFT + plotWidth}
				y1={yAt(fraction)}
				y2={yAt(fraction)}
				class="stroke-slate-200"
				stroke-width="1"
			/>
			<text
				x={PAD_LEFT - 6}
				y={yAt(fraction)}
				dy="0.32em"
				text-anchor="end"
				class="fill-slate-400 text-[10px]"
			>
				{fraction * 100}{#if unit}&nbsp;{unit}{/if}
			</text>
		{/each}

		<!-- Aliases are unique within a tasting, so they double as keys. -->
		{#if bottleMarks}
			{#each aliases as alias, i (alias)}
				<line
					x1={xAt(i)}
					x2={xAt(i)}
					y1={PAD_TOP}
					y2={PAD_TOP + PLOT_HEIGHT}
					class="stroke-slate-200"
					stroke-width="1"
				/>
			{/each}
		{/if}

		{#each seriesLines as s (s.key)}
			{#if s.areaPath}
				<path d={s.areaPath} fill={s.color} fill-opacity="0.12" stroke="none" />
			{/if}
			<path
				d={s.linePath}
				fill="none"
				stroke={s.color}
				stroke-width="2"
				stroke-linecap="round"
				stroke-linejoin="round"
			/>
			{#if bottleMarks}
				{#each s.coords as c, i (i)}
					<circle cx={c.x} cy={c.y} r="4" fill={s.color} stroke="white" stroke-width="2" />
				{/each}
			{/if}
		{/each}

		{#each endLabels as l (l.key)}
			{#if Math.abs(l.placedY - l.anchorY) > 1}
				<line
					x1={l.endX + 5}
					y1={l.anchorY}
					x2={l.endX + 9}
					y2={l.placedY}
					class="stroke-slate-300"
					stroke-width="1"
				/>
			{/if}
			<text
				x={l.endX + 10}
				y={l.placedY}
				dy="0.32em"
				class="fill-slate-700 text-[11px] font-medium"
			>
				{l.label}
			</text>
		{/each}

		{#each aliases as alias, i (alias)}
			{#if bottleMarks}
				<text
					x="0"
					y="0"
					dy="0.3em"
					text-anchor="end"
					transform={`translate(${xAt(i)},${axisLabelY}) rotate(-40)`}
					class="fill-slate-400 text-[10px]"
				>
					{truncate(alias)}
					<title>{alias}</title>
				</text>
			{/if}
			{#if describePoint}
				<rect
					x={xAt(i) - step / 2}
					y={PAD_TOP}
					width={step}
					height={PLOT_HEIGHT}
					fill="transparent"
					role="button"
					tabindex="0"
					aria-label={describePoint(i)}
					onpointerenter={() => activate(i)}
					onpointerdown={() => activate(i)}
					onpointerleave={() => deactivate(i)}
					onfocus={() => activate(i)}
					onblur={() => deactivate(i)}
				/>
			{/if}
		{/each}
	</svg>
</div>
