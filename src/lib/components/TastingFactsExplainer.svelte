<script lang="ts">
	import { Info } from '@lucide/svelte';
	import { formatNumber, type FactsFactor, type FactsScoreRules } from '$lib/tastingFacts';

	// The facts algorithm's tile (version 2, see TastingScoreExplainer): every
	// number comes from the rules frozen with the order, none from the current
	// constants – the tile keeps explaining the order this tasting was poured in.
	let { rules }: { rules: FactsScoreRules } = $props();

	const FACTOR_LABEL: Record<FactsFactor, string> = {
		cask: 'Fass',
		abv: 'Alkohol',
		price: 'Preis'
	};

	const COUNT_WORD = ['keine', 'eine', 'zwei', 'drei', 'vier', 'fünf', 'sechs'];

	const factors = $derived(rules.factors.map((f) => ({ ...f, label: FACTOR_LABEL[f.key] })));
	const factorList = $derived(
		new Intl.ListFormat('de-DE', { type: 'conjunction' }).format(factors.map((f) => f.label))
	);
	const formula = $derived(
		factors.map((f) => `${formatNumber(f.weight)} × ${f.label}`).join(' + ')
	);
	const groups = $derived(rules.peatGroups.map((g, i) => ({ ...g, group: i + 1 })));
	const groupCount = $derived(COUNT_WORD[groups.length] ?? String(groups.length));
	const groupOrder = $derived(groups.map((g) => g.label).join(' → '));
	const hasGroups = $derived(groups.length > 0);
	const firstSection = $derived(hasGroups ? 2 : 1);

	const cask = $derived(rules.cask);
	const refilled = (base: number) => Math.max(0, base - cask.refillPenalty);
	const tieBreakers = $derived(
		[
			...rules.tieBreakers.map((key) =>
				key === 'price' ? 'Preis (unbekannt zuletzt)' : FACTOR_LABEL[key]
			),
			'zuletzt der Flaschenname'
		].join(', ')
	);
</script>

<div class="space-y-2 rounded-xl border border-slate-200 bg-white p-4">
	<h2 class="flex items-center gap-2 font-semibold">
		<Info size={20} strokeWidth={2} aria-hidden="true" />
		Wie kommt die Reihenfolge zustande?
	</h2>
	<p class="text-sm text-slate-700">
		{#if hasGroups}
			Die Flaschen werden zuerst nach Torf in {groupCount} Gruppen sortiert ({groupOrder}),
			innerhalb einer Gruppe entscheidet die Wucht aus {factorList} – alles Angaben von Etikett und Shop.
		{:else}
			Die Flaschen werden aufsteigend nach der Wucht aus {factorList} sortiert – alles Angaben von Etikett
			und Shop.
		{/if}
	</p>

	<details class="text-sm">
		<summary class="cursor-pointer py-1 font-medium text-slate-700">Genauer erklärt</summary>
		<div class="mt-2 space-y-3">
			{#if hasGroups}
				<div>
					<p class="font-medium text-slate-700">1. Torfgruppen</p>
					<p class="mt-1 text-slate-600">Ausgeschenkt wird gruppenweise aufsteigend:</p>
					<dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-slate-600">
						{#each groups as g (g.key)}
							<dt>Gruppe {g.group}</dt>
							<dd>{g.label}</dd>
						{/each}
					</dl>
				</div>
			{/if}

			<div>
				<p class="font-medium text-slate-700">
					{firstSection}. {hasGroups ? 'Wucht innerhalb der Gruppe' : 'Wucht'}
				</p>
				<ul class="mt-1 space-y-2">
					{#each factors as f (f.key)}
						<li>
							<p class="flex items-baseline justify-between gap-3">
								<span class="text-slate-700">{f.label}</span>
								<span class="text-slate-500">{Math.round(f.weight * 100)} % der Wucht</span>
							</p>
							{#if f.key === 'cask'}
								<p class="mt-0.5 text-slate-600">
									Ein Fass-Score von 0 bis {cask.max} aus Hauptreifung und Nachreifung, als Anteil Fass-Score
									÷ {cask.max}. Jedes Fass der Liste hat einen typischen Wert, mit Haken bei
									„Refill“ zählt es {cask.refillPenalty} weniger:
								</p>
								<table class="mt-1 w-full text-left text-slate-600">
									<thead>
										<tr class="text-xs text-slate-500">
											<th class="py-0.5 font-medium">Fass</th>
											<th class="py-0.5 text-right font-medium">typisch</th>
											<th class="py-0.5 text-right font-medium">Refill</th>
										</tr>
									</thead>
									<tbody>
										{#each cask.types as t (t.key)}
											<tr>
												<td class="py-0.5">{t.label}</td>
												<td class="py-0.5 text-right">{formatNumber(t.base)}</td>
												<td class="py-0.5 text-right">
													{t.refill ? formatNumber(refilled(t.base)) : '–'}
												</td>
											</tr>
										{/each}
									</tbody>
								</table>
								<p class="mt-1 text-slate-600">
									Ein anderes Fass („Sonstiges“) zählt mit seiner Einschätzung von {cask.influence
										.min} bis
									{cask.influence.max}. Die Nachreifung zählt ihren Wert × {formatNumber(
										cask.finishFactor
									)}, voll ab {cask.finishFullMonths} Monaten, kürzer anteilig, ohne Angabe der Dauer
									×
									{formatNumber(cask.unknownDurationFactor)}. Ohne Angabe rechnet die Reihenfolge
									für die Hauptreifung mit {formatNumber(cask.unknown.cask)}, für die Nachreifung
									mit
									{formatNumber(cask.unknown.finish)}. Zusammen höchstens {cask.max}.
								</p>
							{:else if f.key === 'abv'}
								<p class="mt-0.5 text-slate-600">
									Gleichmäßig von 0 bei {rules.abv.floor} % vol. bis 1 bei {rules.abv.ceiling} % vol.,
									darunter 0, darüber 1.
								</p>
							{:else}
								<p class="mt-0.5 text-slate-600">
									Listenpreis pro 0,7 l, logarithmisch von 0 bei {rules.price.floor} € bis 1 bei {rules
										.price.ceiling} € – jede Verdopplung des Preises zählt gleich viel. Ist der Preis
									unbekannt, entfällt er, und die übrigen Faktoren zählen anteilig mehr.
								</p>
							{/if}
						</li>
					{/each}
				</ul>
				<p class="mt-2 text-slate-600">Aus den Anteilen ergibt sich die Wucht:</p>
				<p
					class="mt-1 rounded-lg bg-slate-50 px-3 py-2 font-mono text-xs break-words text-slate-700"
				>
					Wucht = 100 × ({formula})
				</p>
			</div>

			<div>
				<p class="font-medium text-slate-700">{firstSection + 1}. Gleichstand</p>
				<p class="mt-1 text-slate-600">
					Bei identischer Wucht entscheiden der Reihe nach {tieBreakers}.
				</p>
			</div>

			<div>
				<p class="font-medium text-slate-700">{firstSection + 2}. Unbekanntes Fass</p>
				<p class="mt-1 text-slate-600">
					Die Reihenfolge rechnet mit den Werten ohne Angabe. Die Auflösung zeigt bei solchen
					Flaschen zusätzlich die Spanne der Wucht: für die Hauptreifung jeder Wert von {formatNumber(
						cask.unknownRange.cask.min
					)} bis {formatNumber(cask.unknownRange.cask.max)}, für die Nachreifung von {formatNumber(
						cask.unknownRange.finish.min * cask.finishFactor
					)} bis {formatNumber(cask.unknownRange.finish.max * cask.finishFactor)} bei voller Dauer.
				</p>
			</div>
		</div>
	</details>
</div>
