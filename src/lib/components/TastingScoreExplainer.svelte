<script lang="ts">
	import { Info } from '@lucide/svelte';
	import type { ScoreFactor, ScoreRules } from '$lib/tasting';

	// The rules frozen with the tasting's order (SCORE_RULES before that), so
	// the tile explains the order this tasting was poured in – not the current
	// algorithm.
	let { rules }: { rules: ScoreRules } = $props();

	const FACTOR_LABEL: Record<ScoreFactor, string> = {
		smoke: 'Rauch',
		cask: 'Fass',
		abv: 'Alkohol',
		value: 'Kaliber'
	};

	const COUNT_WORD = ['keine', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs'];

	const abv = $derived(rules.abv);

	// The ABV normalization as a small table: % vol range → share, columns aligned.
	const abvFormula = $derived.by(() => {
		const rows = [
			[`bis ${abv.floor}:`, '0'],
			[`${abv.floor}–${abv.kink}:`, `(Wert − ${abv.floor}) ÷ ${abv.lowDivisor}`],
			[
				`${abv.kink}–${abv.ceiling}:`,
				`${abv.kinkShare} + (Wert − ${abv.kink}) ÷ ${abv.highDivisor}`
			],
			[`ab ${abv.ceiling}:`, '1']
		];
		const rangeWidth = Math.max(...rows.map(([range]) => range.length));
		return rows.map(([range, share]) => `${range.padEnd(rangeWidth)}  ${share}`).join('\n');
	});

	// Heaviest weight first – the same order the tie-breakers use, so summary,
	// list, formula and tie-breaker text all follow the weights.
	const factors = $derived(rules.factors.map((f) => ({ ...f, label: FACTOR_LABEL[f.key] })));
	const scoreFormula = $derived(factors.map((f) => `${f.weight} × ${f.label}`).join(' + '));
	const labels = $derived(factors.map((f) => f.label));
	// "Rauch, Fass, Kaliber und Alkohol" for the short summary.
	const factorList = $derived(new Intl.ListFormat('de-DE', { type: 'conjunction' }).format(labels));

	const smokeGroups = $derived(rules.smokeGroups.map((g, i) => ({ ...g, group: i + 1 })));
	const smokeGroupCount = $derived(COUNT_WORD[smokeGroups.length] ?? String(smokeGroups.length));
	const smokeGroupOrder = $derived(smokeGroups.map((g) => g.label).join(' → '));
</script>

<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
	<h2 class="flex items-center gap-2 font-semibold">
		<Info size={20} strokeWidth={2} aria-hidden="true" />
		Wie kommt die Reihenfolge zustande?
	</h2>
	<p class="text-sm text-slate-700">
		Die Flaschen werden zuerst nach Rauchintensität in {smokeGroupCount} Gruppen sortiert ({smokeGroupOrder}),
		innerhalb einer Gruppe entscheidet ein Score aus {factorList}.
	</p>

	<details class="text-sm">
		<summary class="cursor-pointer py-1 font-medium text-slate-700">Genauer erklärt</summary>
		<div class="mt-2 space-y-3">
			<div>
				<p class="font-medium text-slate-700">1. Rauchgruppen</p>
				<p class="mt-1 text-slate-600">
					Ausgeschenkt wird gruppenweise aufsteigend, jede Gruppe deckt einen Bereich der
					Rauch-Skala (0–{rules.scaleMax}) ab:
				</p>
				<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600">
					{#each smokeGroups as g (g.group)}
						<dt>Gruppe {g.group}</dt>
						<dd>{g.label} (Rauch {g.range})</dd>
					{/each}
				</dl>
			</div>

			<div>
				<p class="font-medium text-slate-700">2. Score innerhalb der Gruppe</p>
				<ul class="mt-1 space-y-2">
					{#each factors as f (f.key)}
						<li>
							<p class="flex items-baseline justify-between gap-3">
								<span class="text-slate-700">{f.label}</span>
								<span class="text-slate-500">
									{Math.round(f.weight * 100)} % des Scores
								</span>
							</p>
							{#if f.key === 'abv'}
								<p class="mt-0.5 text-slate-600">
									Auf einen Anteil zwischen 0 und 1 umgerechnet, aber in zwei Abschnitten: Von {abv.floor}
									bis {abv.kink} % vol. steigt der Anteil gemächlich, ab {abv.kink} % vol. doppelt so
									schnell, bis er bei {abv.ceiling} % vol. 1 erreicht – jedes Prozent über
									{abv.kink} % vol. zählt also doppelt. Unter {abv.floor} % vol. bleibt er bei 0, über
									{abv.ceiling} % vol. bei 1. Mit Wert = eigener Alkoholgehalt in % vol.:
								</p>
								<pre
									class="mt-1 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"><code
										>{abvFormula}</code
									></pre>
							{:else}
								<p class="mt-0.5 text-slate-600">
									Auf einen Anteil zwischen 0 und 1 umgerechnet: eigener Wert ÷ {rules.scaleMax}
								</p>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-slate-600">Aus den Anteilen ergibt sich der Score:</p>
				<p
					class="mt-1 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs break-words text-slate-700"
				>
					Score = 100 × ({scoreFormula})
				</p>
			</div>

			<div>
				<p class="font-medium text-slate-700">3. Gleichstand</p>
				<p class="mt-1 text-slate-600">
					Bei identischem Score entscheiden der Reihe nach {labels.join(', ')} und zuletzt der Flaschenname.
				</p>
			</div>
		</div>
	</details>
</div>
