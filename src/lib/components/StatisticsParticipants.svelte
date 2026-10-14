<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import {
		CASK_STRENGTH_ABV,
		formatBottleName,
		formatInteger,
		formatNameList,
		formatOneDecimal,
		type PersonMetric,
		type PersonStatistics,
		type Share,
		type Statistics,
		type StatisticsBottle
	} from '$lib/tasting';

	let {
		people,
		bottles,
		bottleHref
	}: {
		people: Statistics['people'];
		bottles: StatisticsBottle[];
		/** Link to a bottle's row in the history's table. */
		bottleHref: (number: number) => ResolvedPathname;
	} = $props();

	const byNumber = $derived(new Map(bottles.map((b) => [b.number, b])));

	function share(value: Share) {
		return { main: `${value.percent} %`, sub: `(${formatInteger(value.count)})` };
	}
	function oneDecimal(value: number | null, unit: string) {
		return { main: value === null ? '–' : `${formatOneDecimal(value)}${unit}` };
	}
	function whole(value: number) {
		return { main: formatInteger(value) };
	}

	// Metrics as rows, people as columns: three people still fit on a phone,
	// a share's count goes below it. The highest value is highlighted – not for
	// the number of bottles and the NAS share, which are no achievement.
	const ROWS: Array<{
		label: string;
		value: (person: PersonStatistics) => { main: string; sub?: string };
		highlight: PersonMetric | null;
	}> = [
		{ label: 'Mitgebrachte Flaschen', value: (p) => whole(p.bottles), highlight: null },
		{ label: 'Ø Alkohol', value: (p) => oneDecimal(p.meanAbv, ' %'), highlight: 'meanAbv' },
		{
			// Non-breaking spaces: the threshold must not break apart.
			label: `Fassstärken-Niveau (≥\u00a0${CASK_STRENGTH_ABV}\u00a0%)`,
			value: (p) => share(p.caskStrength),
			highlight: 'caskStrength'
		},
		{ label: 'Unabhängige Abfüller', value: (p) => share(p.independent), highlight: 'independent' },
		{ label: 'Ø Alter ohne NAS', value: (p) => oneDecimal(p.meanAge, ' J.'), highlight: 'meanAge' },
		{ label: 'NAS-Anteil', value: (p) => share(p.nas), highlight: null },
		{
			label: 'Einmalige Destillerien',
			value: (p) => whole(p.uniqueDistilleries),
			highlight: 'uniqueDistilleries'
		}
	];

	const TITLES: Array<{ metric: PersonMetric; title: string; reason: string }> = [
		{ metric: 'meanAbv', title: 'Fassstärken-Fan', reason: 'höchster Ø Alkohol' },
		{
			metric: 'independent',
			title: 'Indie-Scout',
			reason: 'höchster Anteil unabhängiger Abfüller'
		},
		{ metric: 'meanAge', title: 'Altersweise', reason: 'höchstes Ø Alter' },
		{
			metric: 'uniqueDistilleries',
			title: 'Experimentierfreudigster',
			reason: 'die meisten einmaligen Destillerien'
		}
	];

	const titles = $derived(TITLES.filter((t) => people.best[t.metric].length > 0));

	function isBest(metric: PersonMetric | null, person: PersonStatistics): boolean {
		return metric !== null && people.best[metric].includes(person.name);
	}
</script>

<section class="space-y-3" aria-labelledby="statistics-people">
	<h2 id="statistics-people" class="text-lg font-semibold">Teilnehmer im Vergleich</h2>

	<div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4">
		<!-- With more people only this table scrolls, the metric column stays. -->
		<div class="-mx-4 overflow-x-auto px-4">
			<table class="w-full text-sm">
				<thead>
					<tr>
						<th scope="col" class="sticky left-0 bg-white"><span class="sr-only">Kennzahl</span></th
						>
						{#each people.persons as person (person.name)}
							<th scope="col" class="px-1.5 pb-2 text-right align-bottom font-semibold break-words">
								{person.name}
							</th>
						{/each}
					</tr>
				</thead>
				<tbody>
					{#each ROWS as row (row.label)}
						<tr class="border-t border-slate-200">
							<th
								scope="row"
								class="sticky left-0 min-w-24 bg-white py-2 pr-2 text-left font-normal break-words hyphens-auto text-slate-500"
							>
								{row.label}
							</th>
							{#each people.persons as person (person.name)}
								{@const best = isBest(row.highlight, person)}
								{@const value = row.value(person)}
								<td
									class={[
										'px-1.5 py-2 text-right tabular-nums',
										best && 'rounded bg-slate-100 font-semibold text-slate-900'
									]}
								>
									<span class="whitespace-nowrap">{value.main}</span>
									{#if value.sub}
										<span class="block text-xs font-normal text-slate-500">{value.sub}</span>
									{/if}
									{#if best}<span class="sr-only">(höchster Wert)</span>{/if}
								</td>
							{/each}
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		{#if titles.length > 0}
			<div class="space-y-1">
				<h3 class="font-semibold">Titel</h3>
				<ul class="space-y-1 text-sm">
					{#each titles as t (t.metric)}
						<li class="break-words">
							<span class="font-medium">{t.title}:</span>
							{formatNameList(people.best[t.metric])}
							<span class="text-slate-500">– {t.reason}</span>
						</li>
					{/each}
				</ul>
			</div>
		{/if}

		<div class="space-y-1">
			<h3 class="font-semibold">Die stärkste eigene Flasche</h3>
			<ul class="space-y-1 text-sm">
				{#each people.persons as person (person.name)}
					{@const bottle = byNumber.get(person.strongest)!}
					<li class="break-words">
						<span class="font-medium">{person.name}:</span>
						<a
							href={bottleHref(person.strongest)}
							class="font-medium text-brand underline hover:text-brand-hover"
						>
							{formatBottleName(bottle)}
						</a>
						<span class="whitespace-nowrap">· {formatOneDecimal(bottle.abv)} %</span>
					</li>
				{/each}
			</ul>
		</div>
	</div>
</section>
