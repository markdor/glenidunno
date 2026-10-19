<script lang="ts">
	import { resolve } from '$app/paths';
	import StatisticsDistilleries from '$lib/components/StatisticsDistilleries.svelte';
	import StatisticsHistogram from '$lib/components/StatisticsHistogram.svelte';
	import StatisticsLineChart from '$lib/components/StatisticsLineChart.svelte';
	import StatisticsOverview from '$lib/components/StatisticsOverview.svelte';
	import StatisticsParticipants from '$lib/components/StatisticsParticipants.svelte';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import { bottleAnchor } from '$lib/historyTable';
	import {
		ABV_HISTOGRAM,
		AGE_HISTOGRAM,
		formatBottleName,
		formatCount,
		formatDate,
		formatInteger,
		formatOneDecimal,
		HISTOGRAM_STEP,
		histogramBoundIndex,
		histogramIntervals,
		histogramPosition,
		SAMPLE_SIZE_ML,
		WHISKY_BOTTLE_ML,
		type HistogramInterval
	} from '$lib/tasting';

	let { data } = $props();

	const statistics = $derived(data.statistics);
	const bottles = $derived(statistics?.bottles ?? []);
	const byNumber = $derived(new Map(bottles.map((b) => [b.number, b])));

	const BOTTLE_UNITS = { one: 'Flasche', other: 'Flaschen' };

	// Plain component state: every page load starts at the default widths.
	let abvStep = $state<number>(ABV_HISTOGRAM.step);
	let ageStep = $state<number>(AGE_HISTOGRAM.step);

	const abvIntervals = $derived(
		histogramIntervals(
			bottles.map((b) => b.abv),
			ABV_HISTOGRAM,
			abvStep
		)
	);
	const ageIntervals = $derived(
		histogramIntervals(
			bottles.flatMap((b) => (b.age === null ? [] : [b.age])),
			AGE_HISTOGRAM,
			ageStep
		)
	);

	/** The ABV is labelled at the bounds; the column names its whole range. */
	function abvColumn(interval: HistogramInterval) {
		const last = formatOneDecimal((interval.end * 10 - 1) / 10);
		return {
			label: '',
			count: interval.count,
			description: `${interval.start}–${last} % vol.`
		};
	}
	function abvBounds(intervals: HistogramInterval[]): string[] {
		return intervals.length === 0
			? []
			: [...intervals.map((i) => String(i.start)), String(intervals[intervals.length - 1].end)];
	}

	/** The age is labelled below the column: "3" at a width of 1, else "3–5". */
	function ageColumn(interval: HistogramInterval) {
		const label =
			interval.end - interval.start === 1
				? String(interval.start)
				: `${interval.start}–${interval.end - 1}`;
		return {
			label,
			count: interval.count,
			description: `${label} ${label === '1' ? 'Jahr' : 'Jahre'}`
		};
	}

	/**
	 * Link to a bottle's row in the history's table. There is no bottle page,
	 * and the participant page is for participants only.
	 */
	function bottleHref(number: number) {
		return resolve(`/history#${bottleAnchor(number)}`);
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

{#snippet intervalSlider(
	id: string,
	name: string,
	value: number,
	set: (value: number) => void,
	one: string,
	other: string
)}
	<!-- The visible label is the same for both charts, the accessible name tells them apart. -->
	<div class="flex items-center gap-3 sm:w-80">
		<label for={id} class="text-sm text-slate-500">Intervall</label>
		<input
			{id}
			type="range"
			min={HISTOGRAM_STEP.min}
			max={HISTOGRAM_STEP.max}
			step="1"
			{value}
			aria-label={name}
			oninput={(e) => set(e.currentTarget.valueAsNumber)}
			class="h-11 min-w-0 flex-1 accent-brand"
		/>
		<output for={id} class="w-20 shrink-0 text-right text-sm font-semibold whitespace-nowrap">
			{formatCount(value, one, other)}
		</output>
	</div>
{/snippet}

<svelte:head>
	<title>Statistiken · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. -->
<div class="mx-auto max-w-3xl space-y-8 px-4 py-8">
	<SubHeader backHref={resolve('/')} backLabel="Startseite" title="Statistiken" />

	{#if !statistics}
		<p class="text-sm text-slate-500">Noch kein Tasting aufgelöst.</p>
	{:else}
		{@const { overview, alcohol, timeline } = statistics}

		<StatisticsOverview {overview} {bottles} {bottleHref} />

		<section class="space-y-3" aria-labelledby="statistics-distributions">
			<h2 id="statistics-distributions" class="text-lg font-semibold">Verteilungen</h2>
			<div class="space-y-6 rounded-xl border border-slate-200 bg-white p-4">
				<div class="space-y-2">
					<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
						<h3 class="font-semibold">Alkoholgehalt in % vol.</h3>
						{@render intervalSlider(
							'interval-abv',
							'Intervall Alkoholgehalt',
							abvStep,
							(value) => (abvStep = value),
							'%-Punkt',
							'%-Punkte'
						)}
					</div>
					<StatisticsHistogram
						label="Flaschen nach Alkoholgehalt"
						columns={abvIntervals.map(abvColumn)}
						bounds={abvBounds(abvIntervals)}
						anchor={histogramBoundIndex(ABV_HISTOGRAM.anchor, abvIntervals)}
						fill
						marker={overview.meanAbv === null
							? null
							: {
									position: histogramPosition(overview.meanAbv, abvIntervals),
									label: `Ø ${oneDecimalPercent(overview.meanAbv)}`
								}}
						units={BOTTLE_UNITS}
					/>
				</div>
				<div class="space-y-2">
					<div class="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
						<h3 class="font-semibold">Alter in Jahren</h3>
						{@render intervalSlider(
							'interval-age',
							'Intervall Alter',
							ageStep,
							(value) => (ageStep = value),
							'Jahr',
							'Jahre'
						)}
					</div>
					<StatisticsHistogram
						label="Flaschen nach Alter"
						columns={ageIntervals.map(ageColumn)}
						anchor={histogramBoundIndex(AGE_HISTOGRAM.anchor, ageIntervals)}
						fill
						extra={{ label: 'NAS', count: overview.nas.count }}
						marker={overview.meanAge === null
							? null
							: {
									position: histogramPosition(overview.meanAge, ageIntervals),
									label: `Ø ${oneDecimalYears(overview.meanAge)} (ohne NAS)`
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

		<p>
			<a href={resolve('/history')} class="font-medium text-brand underline hover:text-brand-hover">
				Alle Flaschen in der Flaschen-Datenbank
			</a>
		</p>
	{/if}
</div>
