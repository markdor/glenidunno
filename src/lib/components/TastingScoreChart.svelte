<script lang="ts">
	import { ChartLine } from '@lucide/svelte';
	import { formatOneDecimal, normalizeScoreFactors, type RevealedBottle } from '$lib/tasting';

	type ChartBottle = Pick<
		RevealedBottle,
		'position' | 'alias' | 'smoke' | 'cask' | 'abv' | 'value'
	>;

	let { bottles }: { bottles: ChartBottle[] } = $props();

	// Categorical palette (dataviz skill, adjacent-pairlist order – this chart's
	// four lines never need to be told apart from a non-neighbor, so the
	// adjacent check, not the stricter all-pairs one, applies), chosen to read
	// as gray/braun/rot per factor: worst adjacent CVD ΔE 7.9 (cask↔abv, floor
	// band – legal only with the mandatory end-labels below as secondary
	// encoding), normal-vision ΔE 22.3, validated against a white surface. A
	// literal neutral gray for "Rauch" fails the chroma floor outright (every
	// real gray reads as chroma ~0, well under the 0.10 minimum), so it leans
	// into a dark blue-gray instead – the closest gray-reading hue that still
	// clears it. Gold alone sits below 3:1 contrast on white, same as before,
	// which is why every line also carries a direct end-label – the required
	// relief.
	const SERIES = [
		{ key: 'smoke', label: 'Rauch', color: '#4f6fb0' },
		{ key: 'cask', label: 'Fass', color: '#7d3e12' },
		{ key: 'abv', label: 'Alkohol', color: '#ec1337' },
		{ key: 'value', label: 'Wertigkeit', color: '#eda100' }
	] as const;

	const PAD_LEFT = 38;
	const PAD_TOP = 14;
	const PLOT_HEIGHT = 220;
	const PAD_BOTTOM = 54;
	const LABEL_RESERVE = 104;
	// Floor for the column spacing – never compressed narrower than this, even
	// when many bottles would otherwise force it; the wrapper scrolls instead.
	const STEP_MIN = 88;
	const MIN_LABEL_GAP = 16;
	// clientWidth rounds to an integer while the container's true (fractional)
	// width can be a hair narrower; drawing the SVG at exactly that integer
	// then overflows by a sub-pixel and shows an (otherwise hover-only,
	// normally hidden) horizontal scrollbar. This margin keeps the fill-mode
	// width just inside the measured value instead.
	const CONTAINER_SAFETY_MARGIN = 8;

	// Measured width of the chart's card slot. Until the ResizeObserver behind
	// bind:clientWidth reports a real value (SSR, first paint) this stays 0 and
	// the chart falls back to its natural, STEP_MIN-spaced width below.
	let containerWidth: number = $state(0);

	const points = $derived(bottles.map((b) => ({ ...b, factors: normalizeScoreFactors(b) })));
	const naturalWidth = $derived(
		PAD_LEFT + Math.max(1, points.length - 1) * STEP_MIN + LABEL_RESERVE
	);
	// Fills the available width when there's room (containerWidth > natural);
	// otherwise keeps the natural, STEP_MIN-spaced width and lets the wrapper
	// scroll horizontally.
	const width = $derived(Math.max(naturalWidth, containerWidth - CONTAINER_SAFETY_MARGIN));
	const plotWidth = $derived(width - PAD_LEFT - LABEL_RESERVE);
	const step = $derived(points.length > 1 ? plotWidth / (points.length - 1) : plotWidth);
	const height = PAD_TOP + PLOT_HEIGHT + PAD_BOTTOM;
	const axisLabelY = PAD_TOP + PLOT_HEIGHT + 14;

	function xAt(i: number): number {
		return PAD_LEFT + (points.length === 1 ? plotWidth / 2 : i * step);
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
		SERIES.map((s) => {
			const coords = points.map((p, i) => ({ x: xAt(i), y: yAt(p.factors[s.key]) }));
			return {
				...s,
				coords,
				linePath: smoothLinePath(coords),
				areaPath: smoothAreaPath(coords, yAt(0))
			};
		})
	);

	// End-of-line direct labels (mandatory relief at 4 series, see palette note
	// above): stacked top → bottom by their actual line-end position with a
	// minimum gap, each kept honest with a leader line back to its real value –
	// nudging them apart is only legible with that connector (dataviz skill).
	const endLabels = $derived.by(() => {
		if (points.length === 0) return [];
		const endX = xAt(points.length - 1);
		const sorted = seriesLines
			.map((s) => ({
				key: s.key,
				label: s.label,
				color: s.color,
				anchorY: s.coords[s.coords.length - 1].y
			}))
			.sort((a, b) => a.anchorY - b.anchorY);
		let prevY = -Infinity;
		return sorted.map((item) => {
			const placedY = Math.max(item.anchorY, prevY + MIN_LABEL_GAP);
			prevY = placedY;
			return { ...item, endX, placedY };
		});
	});

	let activeIndex: number | null = $state(null);
	const active = $derived(activeIndex === null ? null : (points[activeIndex] ?? null));

	function activate(i: number) {
		activeIndex = i;
	}
	function deactivate(i: number) {
		if (activeIndex === i) activeIndex = null;
	}
</script>

<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
	<div class="space-y-1">
		<h2 class="flex items-center gap-2 font-semibold">
			<ChartLine size={20} strokeWidth={2} aria-hidden="true" />
			Score-Entwicklung über das Tasting
		</h2>
		<p class="text-sm text-slate-500">
			Je Faktor die eigene Ausprägung relativ zur Skala (0–100&nbsp;%) – die Einträge sind hier in
			Ausschankreihenfolge sortiert.
		</p>
	</div>

	{#if points.length === 0}
		<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
	{:else}
		<div class="-mx-1 overflow-x-auto px-1" bind:clientWidth={containerWidth}>
			<svg
				{width}
				{height}
				viewBox={`0 0 ${width} ${height}`}
				role="img"
				aria-label="Entwicklung von Rauch, Fass, Alkohol und Wertigkeit über die Ausschankreihenfolge"
			>
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
						{fraction * 100}&nbsp;%
					</text>
				{/each}

				{#each points as p, i (p.position)}
					<line
						x1={xAt(i)}
						x2={xAt(i)}
						y1={PAD_TOP}
						y2={PAD_TOP + PLOT_HEIGHT}
						class="stroke-slate-200"
						stroke-width="1"
					/>
				{/each}

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
					{#each s.coords as c, i (i)}
						<circle cx={c.x} cy={c.y} r="4" fill={s.color} stroke="white" stroke-width="2" />
					{/each}
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

				{#each points as p, i (p.position)}
					<text
						x="0"
						y="0"
						dy="0.3em"
						text-anchor="end"
						transform={`translate(${xAt(i)},${axisLabelY}) rotate(-40)`}
						class="fill-slate-400 text-[10px]"
					>
						{truncate(p.alias)}
						<title>{p.alias}</title>
					</text>
					<rect
						x={xAt(i) - step / 2}
						y={PAD_TOP}
						width={step}
						height={PLOT_HEIGHT}
						fill="transparent"
						role="button"
						tabindex="0"
						aria-label={`Flasche ${p.alias}: Rauch ${p.smoke}, Fass ${p.cask}, Alkohol ${formatOneDecimal(p.abv)} %, Wertigkeit ${p.value}`}
						onpointerenter={() => activate(i)}
						onpointerdown={() => activate(i)}
						onpointerleave={() => deactivate(i)}
						onfocus={() => activate(i)}
						onblur={() => deactivate(i)}
					/>
				{/each}
			</svg>
		</div>

		<p class="min-h-5 text-xs text-slate-600" aria-live="polite">
			{#if active}
				<span class="font-medium text-slate-900">{active.alias}</span>
				· Rauch {active.smoke} · Fass {active.cask} · {formatOneDecimal(active.abv)} % · Wertigkeit
				{active.value}
			{:else}
				Tippe oder fahre mit der Maus über eine Flasche für die genauen Werte.
			{/if}
		</p>
	{/if}
</div>
