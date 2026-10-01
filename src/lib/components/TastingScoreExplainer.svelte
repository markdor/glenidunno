<script lang="ts">
	import { Info } from '@lucide/svelte';
	import {
		ABV_FLOOR,
		ABV_HIGH_DIVISOR,
		ABV_KINK,
		ABV_KINK_FRACTION,
		ABV_LOW_DIVISOR,
		ABV_SPAN,
		formatSmokeGroupRange,
		SCORE_FACTORS_BY_WEIGHT,
		SCORE_WEIGHTS,
		SMOKE_GROUPS,
		type ScoreFactor
	} from '$lib/tasting';
	import { TASTING_SCALE } from '$lib/validation';

	const abvCeiling = ABV_FLOOR + ABV_SPAN;

	// The ABV normalization as a small table: % vol range → share, columns aligned.
	const abvFormulaRows = [
		[`bis ${ABV_FLOOR}:`, '0'],
		[`${ABV_FLOOR}–${ABV_KINK}:`, `(Wert − ${ABV_FLOOR}) ÷ ${ABV_LOW_DIVISOR}`],
		[
			`${ABV_KINK}–${abvCeiling}:`,
			`${ABV_KINK_FRACTION} + (Wert − ${ABV_KINK}) ÷ ${ABV_HIGH_DIVISOR}`
		],
		[`ab ${abvCeiling}:`, '1']
	];
	const abvRangeWidth = Math.max(...abvFormulaRows.map(([range]) => range.length));
	const abvFormula = abvFormulaRows
		.map(([range, share]) => `${range.padEnd(abvRangeWidth)}  ${share}`)
		.join('\n');

	const FACTOR_LABEL: Record<ScoreFactor, string> = {
		smoke: 'Rauch',
		cask: 'Fass',
		abv: 'Alkohol',
		value: 'Kaliber'
	};

	// Heaviest weight first – the same order the tie-breakers use, so summary,
	// list, formula and tie-breaker text all follow the weights if they change.
	const factors = SCORE_FACTORS_BY_WEIGHT.map((key) => ({ key, label: FACTOR_LABEL[key] }));
	const scoreFormula = factors.map((f) => `${SCORE_WEIGHTS[f.key]} × ${f.label}`).join(' + ');
	const labels = factors.map((f) => f.label);
	// "Rauch, Fass, Kaliber und Alkohol" for the short summary.
	const factorList = new Intl.ListFormat('de-DE', { type: 'conjunction' }).format(labels);

	const smokeGroups = SMOKE_GROUPS.map((g, i) => ({
		group: i + 1,
		label: g.label,
		range: formatSmokeGroupRange(i + 1)
	}));
	const smokeGroupOrder = smokeGroups.map((g) => g.label).join(' → ');
</script>

<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
	<h2 class="flex items-center gap-2 font-semibold">
		<Info size={20} strokeWidth={2} aria-hidden="true" />
		Wie kommt die Reihenfolge zustande?
	</h2>
	<p class="text-sm text-slate-700">
		Die Flaschen werden zuerst nach Rauchintensität in drei Gruppen sortiert ({smokeGroupOrder}),
		innerhalb einer Gruppe entscheidet ein Score aus {factorList}.
	</p>

	<details class="text-sm">
		<summary class="cursor-pointer py-1 font-medium text-slate-700">Genauer erklärt</summary>
		<div class="mt-2 space-y-3">
			<div>
				<p class="font-medium text-slate-700">1. Rauchgruppen</p>
				<p class="mt-1 text-slate-600">
					Ausgeschenkt wird gruppenweise aufsteigend, jede Gruppe deckt einen Bereich der
					Rauch-Skala (0–{TASTING_SCALE.max}) ab:
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
									{Math.round(SCORE_WEIGHTS[f.key] * 100)} % des Scores
								</span>
							</p>
							{#if f.key === 'abv'}
								<p class="mt-0.5 text-slate-600">
									Auf einen Anteil zwischen 0 und 1 umgerechnet, aber in zwei Abschnitten: Von {ABV_FLOOR}
									bis {ABV_KINK} % vol. steigt der Anteil gemächlich, ab {ABV_KINK} % vol. doppelt so
									schnell, bis er bei {abvCeiling} % vol. 1 erreicht – jedes Prozent über
									{ABV_KINK} % vol. zählt also doppelt. Unter {ABV_FLOOR} % vol. bleibt er bei 0, über
									{abvCeiling} % vol. bei 1. Mit Wert = eigener Alkoholgehalt in % vol.:
								</p>
								<pre
									class="mt-1 overflow-x-auto rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs text-slate-700"><code
										>{abvFormula}</code
									></pre>
							{:else}
								<p class="mt-0.5 text-slate-600">
									Auf einen Anteil zwischen 0 und 1 umgerechnet: eigener Wert ÷ {TASTING_SCALE.max}
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
