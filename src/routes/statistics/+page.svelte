<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import StatisticsBottleTable from '$lib/components/StatisticsBottleTable.svelte';
	import StatisticsDistilleries from '$lib/components/StatisticsDistilleries.svelte';
	import StatisticsHistogram from '$lib/components/StatisticsHistogram.svelte';
	import StatisticsLineChart from '$lib/components/StatisticsLineChart.svelte';
	import StatisticsOverview from '$lib/components/StatisticsOverview.svelte';
	import StatisticsParticipants from '$lib/components/StatisticsParticipants.svelte';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import {
		bottleAnchor,
		filterOptions,
		linkQueryString,
		parseTableQuery
	} from '$lib/statisticsTable';
	import {
		ABV_HISTOGRAM_BOUNDS,
		AGE_HISTOGRAM_BOUNDS,
		formatBottleName,
		formatCount,
		formatDate,
		formatInteger,
		formatOneDecimal,
		histogramLabels,
		histogramPosition,
		SAMPLE_SIZE_ML,
		WHISKY_BOTTLE_ML
	} from '$lib/tasting';
	import { TASTING_ABV, TASTING_AGE } from '$lib/validation';

	let { data } = $props();

	const statistics = $derived(data.statistics);
	const bottles = $derived(statistics?.bottles ?? []);
	const byNumber = $derived(new Map(bottles.map((b) => [b.number, b])));

	const BOTTLE_UNITS = { one: 'Flasche', other: 'Flaschen' };
	const ABV_LABELS = histogramLabels(ABV_HISTOGRAM_BOUNDS, TASTING_ABV.step);
	const AGE_LABELS = histogramLabels(AGE_HISTOGRAM_BOUNDS, 1);

	/**
	 * Link to a bottle's row in the table. There is no bottle page, and the
	 * participant page is for participants only. Keeps the sorting, but drops
	 * search and filters, which could hide the row.
	 */
	function bottleHref(number: number) {
		const query = parseTableQuery(page.url.searchParams, filterOptions(bottles));
		const qs = linkQueryString(query);
		const hash = bottleAnchor(number);
		return qs ? resolve(`/statistics?${qs}#${hash}`) : resolve(`/statistics#${hash}`);
	}

	function oneDecimalPercent(value: number): string {
		return `${formatOneDecimal(value)} %`;
	}
	function oneDecimalYears(value: number): string {
		return `${formatOneDecimal(value)} Jahre`;
	}
	function weight(grams: number): string {
		return grams >= 1000 ? `${formatOneDecimal(grams / 1000)} kg` : `${formatInteger(grams)} g`;
	}
	function litres(ml: number): string {
		return `${(ml / 1000).toLocaleString('de-DE', { maximumFractionDigits: 2 })} l`;
	}
</script>

<svelte:head>
	<title>Statistiken · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. -->
<div class="mx-auto max-w-3xl space-y-8 px-4 py-8">
	<SubHeader backHref={resolve('/')} backLabel="Startseite" title="Statistiken" />

	{#if !statistics}
		<p class="text-sm text-slate-500">Noch kein Tasting aufgelöst.</p>
	{:else}
		{@const { overview, distributions, alcohol, timeline } = statistics}

		<StatisticsOverview {overview} {bottles} {bottleHref} />

		<section class="space-y-3" aria-labelledby="statistics-distributions">
			<h2 id="statistics-distributions" class="text-lg font-semibold">Verteilungen</h2>
			<div class="space-y-6 rounded-xl border border-slate-200 bg-white p-4">
				<div class="space-y-2">
					<h3 class="font-semibold">Alkoholgehalt in % vol.</h3>
					<StatisticsHistogram
						label="Flaschen nach Alkoholgehalt"
						columns={ABV_LABELS.map((label, i) => ({ label, count: distributions.abv[i] }))}
						marker={overview.meanAbv === null
							? null
							: {
									position: histogramPosition(overview.meanAbv, ABV_HISTOGRAM_BOUNDS, TASTING_ABV),
									label: `Ø ${oneDecimalPercent(overview.meanAbv)}`
								}}
						units={BOTTLE_UNITS}
					/>
				</div>
				<div class="space-y-2">
					<h3 class="font-semibold">Alter in Jahren</h3>
					<StatisticsHistogram
						label="Flaschen nach Alter"
						columns={AGE_LABELS.map((label, i) => ({ label, count: distributions.age[i] }))}
						extra={{ label: 'NAS', count: overview.nas.count }}
						marker={overview.meanAge === null
							? null
							: {
									position: histogramPosition(overview.meanAge, AGE_HISTOGRAM_BOUNDS, TASTING_AGE),
									label: `Ø ${oneDecimalYears(overview.meanAge)}`
								}}
						units={BOTTLE_UNITS}
					/>
				</div>
			</div>
		</section>

		<section class="space-y-3" aria-labelledby="statistics-alcohol">
			<h2 id="statistics-alcohol" class="text-lg font-semibold">Reiner Alkohol</h2>
			<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
				<p>
					<span class="text-3xl font-semibold tracking-tight">
						{formatInteger(alcohol.pureMl)} ml
					</span>
					<span class="text-slate-500">pro Person, ≈ {weight(alcohol.pureGrams)}</span>
				</p>
				<ul class="space-y-1 text-sm">
					<li>≈ {formatInteger(alcohol.beers)} Halbe Bier (0,5 l mit 5 %)</li>
					<li>
						{litres(alcohol.liquidMl)} Whisky ≈ {formatOneDecimal(alcohol.whiskyBottles)} Flaschen à
						{formatOneDecimal(WHISKY_BOTTLE_ML / 1000)} l
					</li>
					{#if alcohol.hardest}
						<li>
							Härtestes Tasting: {formatDate(alcohol.hardest.tastingDate)} mit
							{formatOneDecimal(alcohol.hardest.pureMl)} ml reinem Alkohol pro Person
						</li>
					{/if}
				</ul>
				<p class="text-xs text-slate-500">
					Für jemanden, der bei jedem Tasting dabei war: von jeder Flasche ein volles Sample à
					{SAMPLE_SIZE_ML} ml. Reste und Spucknapf bleiben unberücksichtigt.
				</p>
			</div>
		</section>

		<StatisticsParticipants people={statistics.people} {bottles} {bottleHref} />

		<StatisticsDistilleries distilleries={statistics.distilleries} />

		<section class="space-y-3" aria-labelledby="statistics-timeline">
			<h2 id="statistics-timeline" class="text-lg font-semibold">Zeitverlauf</h2>
			<div class="space-y-6 rounded-xl border border-slate-200 bg-white p-4">
				<div class="space-y-2">
					<h3 class="font-semibold">Ø Alkohol pro Tasting</h3>
					<StatisticsLineChart
						label="Ø Alkohol pro Tasting"
						points={timeline.tastings.map((t) => ({ date: t.tastingDate, value: t.meanAbv }))}
						format={oneDecimalPercent}
						unit="%"
					/>
				</div>
				<div class="space-y-2">
					<h3 class="font-semibold">Ø Alter pro Tasting in Jahren</h3>
					<StatisticsLineChart
						label="Ø Alter pro Tasting in Jahren, ohne NAS"
						points={timeline.tastings.map((t) => ({ date: t.tastingDate, value: t.meanAge }))}
						format={oneDecimalYears}
					/>
				</div>
				<div class="space-y-2">
					<h3 class="font-semibold">Tastings pro Jahr</h3>
					<StatisticsHistogram
						label="Tastings pro Jahr"
						columns={timeline.perYear.map((y) => ({ label: String(y.year), count: y.count }))}
						units={{ one: 'Tasting', other: 'Tastings' }}
					/>
				</div>
				{#if timeline.longestBreak}
					<p class="text-sm">
						<span class="font-medium">Längste Pause:</span>
						{formatCount(timeline.longestBreak.days, 'Tag', 'Tage')}
						({formatDate(timeline.longestBreak.from)} bis {formatDate(timeline.longestBreak.to)})
					</p>
				{/if}
				{#if timeline.milestones.length > 0}
					<div class="space-y-1">
						<h3 class="font-semibold">Meilensteine</h3>
						<ul class="space-y-1 text-sm">
							{#each timeline.milestones as number (number)}
								{@const bottle = byNumber.get(number)!}
								<li class="break-words">
									Die {number}. Flasche:
									<a
										href={bottleHref(number)}
										class="font-medium text-brand underline hover:text-brand-hover"
									>
										{formatBottleName(bottle)}
									</a>
									<span class="text-slate-500">
										({formatDate(bottle.tastingDate)}, mitgebracht von {bottle.broughtBy})
									</span>
								</li>
							{/each}
						</ul>
					</div>
				{/if}
			</div>
		</section>
	{/if}
</div>

{#if statistics}
	<!-- Wider than the rest of the page: from lg on all columns side by side. -->
	<div class="mx-auto max-w-6xl px-4 pb-8">
		<StatisticsBottleTable {bottles} />
	</div>
{/if}
