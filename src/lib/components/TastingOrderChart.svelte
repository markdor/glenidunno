<script lang="ts">
	import { ChartLine } from '@lucide/svelte';
	import type { OrderCurves, OrderEntry } from '$lib/tasting';
	import TastingLineChart from './TastingLineChart.svelte';

	let { order, curves }: { order: OrderEntry[]; curves: OrderCurves } = $props();

	// Blind on purpose: every curve in one and the same brown (the logo's
	// amber, --color-brand), no end labels and no values on hover – which line
	// is which factor only comes out with the reveal. The server already sends
	// the curves without factor names (toCurves in tastings.ts).
	const CURVE_COLOR = '#7d5212';

	const series = $derived(
		curves.map((values, i) => ({ key: String(i), color: CURVE_COLOR, values }))
	);
	const aliases = $derived(order.map((entry) => entry.alias));
</script>

<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
	<div class="space-y-1">
		<h2 class="flex items-center gap-2 font-semibold">
			<ChartLine size={20} strokeWidth={2} aria-hidden="true" />
			Score-Entwicklung über das Tasting
		</h2>
		<p class="text-sm text-slate-500">
			Rauch, Fass, Alkohol und Kaliber je Flasche relativ zur Skala (0–100&nbsp;%), in
			Ausschankreihenfolge. Welche Linie zu welchem Faktor gehört, verrät erst die Auflösung.
		</p>
	</div>

	{#if order.length === 0}
		<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
	{:else}
		<TastingLineChart
			{aliases}
			{series}
			ariaLabel="Entwicklung von vier nicht zugeordneten Faktoren über die Ausschankreihenfolge"
		/>
	{/if}
</div>
