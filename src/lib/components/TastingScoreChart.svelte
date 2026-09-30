<script lang="ts">
	import { ChartLine } from '@lucide/svelte';
	import { formatOneDecimal, normalizeScoreFactors, type RevealedBottle } from '$lib/tasting';
	import TastingLineChart from './TastingLineChart.svelte';

	type ChartBottle = Pick<
		RevealedBottle,
		'position' | 'alias' | 'smoke' | 'cask' | 'abv' | 'value'
	>;

	let { bottles }: { bottles: ChartBottle[] } = $props();

	// Categorical palette (dataviz skill, adjacent-pairlist order – this chart's
	// four lines never need to be told apart from a non-neighbor, so the
	// adjacent check, not the stricter all-pairs one, applies), chosen to read
	// as gray/braun/rot per factor: worst adjacent CVD ΔE 7.9 (cask↔abv, floor
	// band – legal only with the mandatory end-labels as secondary encoding),
	// normal-vision ΔE 22.3, validated against a white surface. A literal
	// neutral gray for "Rauch" fails the chroma floor outright (every real gray
	// reads as chroma ~0, well under the 0.10 minimum), so it leans into a dark
	// blue-gray instead – the closest gray-reading hue that still clears it.
	// Gold alone sits below 3:1 contrast on white, same as before, which is why
	// every line also carries a direct end-label – the required relief.
	const SERIES = [
		{ key: 'smoke', label: 'Rauch', color: '#4f6fb0' },
		{ key: 'cask', label: 'Fass', color: '#7d3e12' },
		{ key: 'abv', label: 'Alkohol', color: '#ec1337' },
		{ key: 'value', label: 'Kaliber', color: '#eda100' }
	] as const;

	const series = $derived.by(() => {
		const factors = bottles.map((b) => normalizeScoreFactors(b));
		return SERIES.map((s) => ({ ...s, values: factors.map((f) => f[s.key]) }));
	});
	const aliases = $derived(bottles.map((b) => b.alias));

	let activeIndex: number | null = $state(null);
	const active = $derived(activeIndex === null ? null : (bottles[activeIndex] ?? null));

	function describe(i: number): string {
		const b = bottles[i];
		return `Flasche ${b.alias}: Rauch ${b.smoke}, Fass ${b.cask}, Alkohol ${formatOneDecimal(b.abv)} %, Kaliber ${b.value}`;
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

	{#if bottles.length === 0}
		<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
	{:else}
		<TastingLineChart
			{aliases}
			{series}
			ariaLabel="Entwicklung von Rauch, Fass, Alkohol und Kaliber über die Ausschankreihenfolge"
			describePoint={describe}
			bind:activeIndex
		/>

		<p class="min-h-5 text-xs text-slate-600" aria-live="polite">
			{#if active}
				<span class="font-medium text-slate-900">{active.alias}</span>
				· Rauch {active.smoke} · Fass {active.cask} · {formatOneDecimal(active.abv)} % · Kaliber
				{active.value}
			{:else}
				Tippe oder fahre mit der Maus über eine Flasche für die genauen Werte.
			{/if}
		</p>
	{/if}
</div>
