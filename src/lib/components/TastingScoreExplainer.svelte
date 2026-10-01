<script lang="ts">
	import { Info } from '@lucide/svelte';
	import {
		ABV_FLOOR,
		ABV_KINK,
		ABV_SPAN,
		formatSmokeGroupRange,
		SCORE_WEIGHTS,
		SMOKE_GROUPS
	} from '$lib/tasting';
	import { TASTING_SCALE } from '$lib/validation';

	const abvCeiling = ABV_FLOOR + ABV_SPAN;

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
		innerhalb einer Gruppe entscheidet ein Score aus Rauch, Fass, Alkohol und Kaliber.
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
				<p class="mt-1 text-slate-600">
					Rauch, Fass und Kaliber werden dafür auf einen Anteil zwischen 0 und 1 umgerechnet
					(eigener Wert ÷ {TASTING_SCALE.max}). Alkohol läuft ebenfalls auf einen Anteil zwischen 0
					und 1 hinaus, aber in zwei Abschnitten: zwischen {ABV_FLOOR} % vol. (0) und {ABV_KINK} % vol.
					gemächlich, ab {ABV_KINK} % vol. doppelt so schnell bis {abvCeiling} % vol. (1) – Werte außerhalb
					dieser Spanne werden gekappt. In der Formel unten steht „Alkohol" für diesen umgerechneten Anteil,
					nicht für den Rohwert in % vol. Jeder Anteil geht unterschiedlich stark in den Score ein:
				</p>
				<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600">
					<dt>Rauch</dt>
					<dd>{SCORE_WEIGHTS.smoke * 100} %</dd>
					<dt>Fass</dt>
					<dd>{SCORE_WEIGHTS.cask * 100} %</dd>
					<dt>Alkohol</dt>
					<dd>{SCORE_WEIGHTS.abv * 100} %</dd>
					<dt>Kaliber</dt>
					<dd>{SCORE_WEIGHTS.value * 100} %</dd>
				</dl>
				<p
					class="mt-2 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs break-words text-slate-700"
				>
					Score = 100 × ({SCORE_WEIGHTS.smoke} × Rauch + {SCORE_WEIGHTS.cask} × Fass + {SCORE_WEIGHTS.abv}
					× Alkohol + {SCORE_WEIGHTS.value} × Kaliber)
				</p>
			</div>

			<div>
				<p class="font-medium text-slate-700">3. Gleichstand</p>
				<p class="mt-1 text-slate-600">
					Bei identischem Score entscheiden der Reihe nach Rauch, Fass, Alkohol und zuletzt der
					Flaschenname.
				</p>
			</div>
		</div>
	</details>
</div>
