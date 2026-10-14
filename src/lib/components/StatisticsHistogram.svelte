<script lang="ts">
	// Columns per interval or category, one series in the logo's amber; a
	// column outside the scale (NAS) stands apart in muted brown. The count
	// sits on top of every bar. Where the counts don't fit side by side, the
	// highest bars keep theirs, and hover or tap shows any bar's count (dataviz
	// skill: tooltips only enhance, the screen reader text carries every count).

	import { histogramBarHeight, isLabeled, labelStep, visibleCounts } from '$lib/tasting';

	type Column = {
		/** Axis label below the column – unused with `bounds`. */
		label: string;
		count: number;
		/** For screen readers, if it differs from the label: "46–46,9 % vol.". */
		description?: string;
	};

	let {
		label,
		columns,
		extra = null,
		marker = null,
		units,
		bounds = null,
		anchor = 0,
		fill = false
	}: {
		/** Accessible name of the chart. */
		label: string;
		columns: Column[];
		/** A column set apart from the scale, e.g. NAS. */
		extra?: Column | null;
		/** A vertical line on the column axis (0 to columns.length), e.g. the mean. */
		marker?: { position: number; label: string } | null;
		/** How a count reads to screen readers: "1 Flasche", "2 Flaschen". */
		units: { one: string; other: string };
		/**
		 * Labels at the bounds between the columns (columns.length + 1) instead
		 * of below them, e.g. 40, 41, 42 for intervals of 1 %-point.
		 */
		bounds?: string[] | null;
		/** Index of the label that always stays when there is no room for all. */
		anchor?: number;
		/** Bars fill their column up to a small gap, like intervals on an axis. */
		fill?: boolean;
	} = $props();

	// Plot width before the first measurement (server-side rendering): about
	// a phone's, so hydration only ever adds labels and counts.
	const FALLBACK_WIDTH = 296;

	let containerWidth = $state(0);
	let plot: HTMLElement | undefined = $state();
	let active: number | null = $state(null);

	const width = $derived(containerWidth > 0 ? containerWidth : FALLBACK_WIDTH);
	const slotPx = $derived(width / Math.max(1, columns.length));
	const max = $derived(Math.max(1, ...columns.map((c) => c.count), extra?.count ?? 0));
	const shownCounts = $derived(
		visibleCounts(
			columns.map((c) => c.count),
			max,
			slotPx
		)
	);
	const step = $derived(labelStep(bounds ?? columns.map((c) => c.label), slotPx));
	const markerShare = $derived(marker && columns.length > 0 ? marker.position / columns.length : 0);

	function describe(column: Column): string {
		const unit = column.count === 1 ? units.one : units.other;
		return `${column.description ?? column.label}: ${column.count} ${unit}`;
	}

	function columnAt(event: PointerEvent): number | null {
		if (!plot || columns.length === 0) return null;
		const box = plot.getBoundingClientRect();
		const index = Math.floor(((event.clientX - box.left) / box.width) * columns.length);
		return Math.min(columns.length - 1, Math.max(0, index));
	}
	function point(event: PointerEvent) {
		active = columnAt(event);
	}
	// A tap ends with pointerleave as well: keep its count until the next one.
	function leave(event: PointerEvent) {
		if (event.pointerType === 'mouse') active = null;
	}
</script>

{#snippet bar(column: Column, color: string, count: 'shown' | 'raised' | 'hidden')}
	<span class="sr-only">{describe(column)}</span>
	<div class="flex h-28 w-full flex-col items-center justify-end" aria-hidden="true">
		{#if column.count > 0}
			<span
				class={[
					'text-xs font-medium text-slate-700 tabular-nums',
					count === 'hidden' && 'invisible',
					count === 'raised' && 'relative z-10 rounded bg-white px-0.5'
				]}
			>
				{column.count}
			</span>
			<div
				class={['mt-0.5 w-full rounded-t', color, !fill && 'max-w-6']}
				style:height={`${histogramBarHeight(column.count, max)}px`}
			></div>
		{/if}
	</div>
{/snippet}

{#snippet centerLabel(text: string)}
	<!-- Centered even when wider than its column: the neighbours' labels are thinned out. -->
	<span
		class="mt-1 flex w-full justify-center border-t border-slate-300 pt-1 text-[11px] leading-tight text-slate-500"
		aria-hidden="true"
	>
		<span class="whitespace-nowrap">{text}</span>
	</span>
{/snippet}

{#if columns.length === 0 && !extra?.count}
	<p class="text-sm text-slate-500">Keine Werte.</p>
{:else}
	<div class="flex items-start gap-2" role="group" aria-label={label}>
		<div class="relative min-w-0 flex-1 pt-5">
			<!-- Measures an empty line: its size never depends on the labels and counts
			     the width decides, so showing them can't trigger another resize. -->
			<div bind:clientWidth={containerWidth} aria-hidden="true"></div>
			{#if marker}
				<!-- Kept inside the chart at both ends instead of overflowing the card. -->
				<span
					class={[
						'absolute top-0 text-xs font-medium whitespace-nowrap text-slate-900',
						markerShare < 0.2 ? '' : markerShare > 0.8 ? '-translate-x-full' : '-translate-x-1/2'
					]}
					style:left={`${markerShare * 100}%`}
				>
					{marker.label}
				</span>
				<div
					class="absolute top-5 h-28 w-0 border-l border-dashed border-slate-900"
					style:left={`${markerShare * 100}%`}
					aria-hidden="true"
				></div>
			{/if}
			<ul
				bind:this={plot}
				class="grid gap-x-0.5"
				style:grid-template-columns={`repeat(${columns.length}, minmax(0, 1fr))`}
				onpointermove={point}
				onpointerdown={point}
				onpointerleave={leave}
			>
				{#each columns as column, i (i)}
					<li class="flex min-w-0 flex-col items-center">
						{@render bar(
							column,
							'bg-brand',
							shownCounts[i] ? 'shown' : active === i ? 'raised' : 'hidden'
						)}
						{#if !bounds}
							{@render centerLabel(isLabeled(i, anchor, step) ? column.label : '')}
						{/if}
					</li>
				{/each}
			</ul>
			{#if bounds}
				<div class="relative mt-1 h-5 border-t border-slate-300" aria-hidden="true">
					{#each bounds as bound, i (i)}
						{#if isLabeled(i, anchor, step)}
							<span
								class="absolute top-0 flex -translate-x-1/2 flex-col items-center"
								style:left={`${(i / columns.length) * 100}%`}
							>
								<span class="h-1 w-px bg-slate-300"></span>
								<span class="text-[11px] leading-tight text-slate-500 tabular-nums">{bound}</span>
							</span>
						{/if}
					{/each}
				</div>
			{/if}
		</div>
		{#if extra}
			<ul class="w-12 shrink-0 self-stretch border-l border-dashed border-slate-400 pt-5 pl-2">
				<li class="flex min-w-0 flex-col items-center">
					{@render bar(extra, 'bg-slate-400', 'shown')}
					{@render centerLabel(extra.label)}
				</li>
			</ul>
		{/if}
	</div>
{/if}
