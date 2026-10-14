<script lang="ts">
	// Columns per class, the count on every column – with this few classes
	// the labels carry every value, so there is no tooltip (dataviz skill:
	// tooltips only enhance). One series, one color: the logo's amber. A
	// column outside the scale (NAS) stands apart in muted brown.

	type Column = { label: string; count: number };

	let {
		label,
		columns,
		extra = null,
		marker = null,
		units
	}: {
		/** Accessible name of the chart. */
		label: string;
		columns: Column[];
		/** A column set apart from the scale, e.g. NAS. */
		extra?: Column | null;
		/** A vertical line on the class axis (0 to columns.length), e.g. the mean. */
		marker?: { position: number; label: string } | null;
		/** How a count reads to screen readers: "1 Flasche", "2 Flaschen". */
		units: { one: string; other: string };
	} = $props();

	// Bars stay below this height, the count sits on top of them.
	const BAR_MAX_PX = 96;

	const max = $derived(Math.max(1, ...columns.map((c) => c.count), extra?.count ?? 0));
	const markerShare = $derived(marker ? marker.position / columns.length : 0);

	function barHeight(count: number): number {
		return Math.round((count / max) * BAR_MAX_PX);
	}
	function describe(column: Column): string {
		return `${column.label}: ${column.count} ${column.count === 1 ? units.one : units.other}`;
	}
</script>

{#snippet bar(column: Column, color: string)}
	<li class="flex min-w-0 flex-col items-center">
		<span class="sr-only">{describe(column)}</span>
		<div class="flex h-28 w-full flex-col items-center justify-end" aria-hidden="true">
			<span class="text-xs font-medium text-slate-700 tabular-nums">{column.count}</span>
			<div
				class="mt-0.5 w-full max-w-6 rounded-t {color}"
				style:height={`${barHeight(column.count)}px`}
			></div>
		</div>
		<span
			class="mt-1 w-full border-t border-slate-300 pt-1 text-center text-[11px] leading-tight break-words text-slate-500"
			aria-hidden="true"
		>
			{column.label}
		</span>
	</li>
{/snippet}

<div class="flex items-start gap-2" role="group" aria-label={label}>
	<div class="relative min-w-0 flex-1 pt-5">
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
				class="absolute top-5 h-28 w-px bg-slate-900"
				style:left={`${markerShare * 100}%`}
				aria-hidden="true"
			></div>
		{/if}
		<ul
			class="grid gap-x-0.5"
			style:grid-template-columns={`repeat(${columns.length}, minmax(0, 1fr))`}
		>
			{#each columns as column, i (i)}
				{@render bar(column, 'bg-brand')}
			{/each}
		</ul>
	</div>
	{#if extra}
		<ul class="w-12 shrink-0 border-l border-slate-200 pt-5 pl-2">
			{@render bar(extra, 'bg-slate-400')}
		</ul>
	{/if}
</div>
