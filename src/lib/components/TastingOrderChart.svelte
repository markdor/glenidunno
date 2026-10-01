<script lang="ts">
	import { ChartLine } from '@lucide/svelte';
	import { SMOKE_GROUPS_ENABLED, type OrderEntry } from '$lib/tasting';
	import TastingLineChart from './TastingLineChart.svelte';

	let { order }: { order: OrderEntry[] } = $props();

	// One line in the logo's amber (--color-brand). Its chroma sits just under
	// the dataviz skill's categorical floor, which only matters when several
	// lines must be told apart; the 3:1 contrast on white a lone line needs
	// passes. The title names the line, so there is no end label – and no
	// per-bottle marks either: the list above names the bottles. Before the
	// reveal the chart only shows the course of the score, so it has no
	// hover/tap/focus targets that would tell a single bottle's value.
	const SCORE_COLOR = '#7d5212';

	// The score spans 0–100 (the weights sum to 1), the chart takes fractions.
	const series = $derived([
		{ key: 'score', color: SCORE_COLOR, values: order.map((entry) => entry.score / 100) }
	]);
	const aliases = $derived(order.map((entry) => entry.alias));
</script>

<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
	<div class="space-y-1">
		<h2 class="flex items-center gap-2 font-semibold">
			<ChartLine size={20} strokeWidth={2} aria-hidden="true" />
			Gesamtscore über das Tasting
		</h2>
		<p class="text-sm text-slate-500">
			Der Score jeder Flasche (0–100) in Ausschankreihenfolge.
			{#if SMOKE_GROUPS_ENABLED}
				Innerhalb einer Rauchgruppe steigt er, mit der nächsten Gruppe kann er wieder fallen.
			{/if}
		</p>
	</div>

	{#if order.length === 0}
		<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
	{:else}
		<TastingLineChart
			{aliases}
			{series}
			ariaLabel="Gesamtscore der Flaschen über die Ausschankreihenfolge"
			unit={null}
			bottleMarks={false}
		/>
	{/if}
</div>
