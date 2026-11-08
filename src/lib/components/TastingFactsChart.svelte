<script lang="ts">
	import { ChartLine } from '@lucide/svelte';
	import { formatOneDecimal, type RevealedFactsBottle } from '$lib/tasting';
	import { formatCask, formatFinish, formatPrice } from '$lib/tastingFacts';
	import TastingLineChart from './TastingLineChart.svelte';

	// The score development of a facts tasting: like TastingScoreChart, each
	// factor's normalized value (0–100 %) over the pouring order, the shares as
	// frozen with the order. An unknown price is a gap in its line.
	type ChartBottle = Pick<RevealedFactsBottle, 'position' | 'alias' | 'abv' | 'facts' | 'shares'>;

	let { bottles }: { bottles: ChartBottle[] } = $props();

	// The validated palette of TastingScoreChart (see there): cask and ABV keep
	// their colors, the price takes the value's – the same place in the score.
	// Every line carries a direct end label, the required secondary encoding.
	const SERIES = [
		{ key: 'cask', label: 'Fass', color: '#7d3e12' },
		{ key: 'abv', label: 'Alkohol', color: '#ec1337' },
		{ key: 'price', label: 'Preis', color: '#eda100' }
	] as const;

	const series = $derived(
		SERIES.map((s) => ({ ...s, values: bottles.map((b) => b.shares[s.key]) }))
	);
	const aliases = $derived(bottles.map((b) => b.alias));

	let activeIndex: number | null = $state(null);
	const active = $derived(activeIndex === null ? null : (bottles[activeIndex] ?? null));

	function details(b: ChartBottle): string {
		const finish = b.facts.finish.kind === 'none' ? '' : ` + ${formatFinish(b.facts.finish)}`;
		return `${formatCask(b.facts.cask)}${finish}, ${formatOneDecimal(b.abv)} %, Preis ${formatPrice(b.facts.priceCents)}`;
	}

	function describe(i: number): string {
		const b = bottles[i];
		return `Flasche ${b.alias}: ${details(b)}`;
	}
</script>

<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
	<div class="space-y-1">
		<h2 class="flex items-center gap-2 font-semibold">
			<ChartLine size={20} strokeWidth={2} aria-hidden="true" />
			Score-Entwicklung über das Tasting
		</h2>
		<p class="text-sm text-slate-500">
			Je Faktor die Ausprägung relativ zur Skala (0–100&nbsp;%) – die Einträge sind hier in
			Ausschankreihenfolge sortiert. Bei unbekanntem Preis hat die Preislinie eine Lücke.
		</p>
	</div>

	{#if bottles.length === 0}
		<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
	{:else}
		<TastingLineChart
			{aliases}
			{series}
			ariaLabel="Entwicklung von Fass, Alkohol und Preis über die Ausschankreihenfolge"
			describePoint={describe}
			bind:activeIndex
		/>

		<p class="min-h-5 text-xs text-slate-600" aria-live="polite">
			{#if active}
				<span class="font-medium text-slate-900">{active.alias}</span>
				· {details(active)}
			{:else}
				Tippe oder fahre mit der Maus über eine Flasche für die genauen Werte.
			{/if}
		</p>
	{/if}
</div>
