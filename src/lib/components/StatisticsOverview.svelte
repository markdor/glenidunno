<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import {
		formatBottleName,
		formatCount,
		formatInteger,
		formatOneDecimal,
		type BottleRecord,
		type Statistics,
		type StatisticsBottle
	} from '$lib/tasting';

	let {
		overview,
		bottles,
		bottleHref
	}: {
		overview: Statistics['overview'];
		bottles: StatisticsBottle[];
		/** Link to a bottle's row in the table. */
		bottleHref: (number: number) => ResolvedPathname;
	} = $props();

	const byNumber = $derived(new Map(bottles.map((b) => [b.number, b])));

	function percent(value: number | null): string {
		return value === null ? '–' : `${formatOneDecimal(value)} %`;
	}

	const tiles = $derived([
		{ label: 'Tastings', value: formatInteger(overview.tastings) },
		{ label: 'Flaschen', value: formatInteger(overview.bottles) },
		{ label: 'Destillerien', value: formatInteger(overview.distilleries) },
		{ label: 'Zusammen im Fass', value: formatCount(overview.totalAge, 'Jahr', 'Jahre') },
		{ label: 'Ø Alkohol', value: percent(overview.meanAbv) },
		{ label: 'Median Alkohol', value: percent(overview.medianAbv) },
		{
			label: 'Ø Alter ohne NAS',
			value: overview.meanAge === null ? '–' : `${formatOneDecimal(overview.meanAge)} Jahre`
		},
		{
			label: 'NAS-Anteil',
			value: `${overview.nas.percent} %`,
			hint: formatCount(overview.nas.count, 'Flasche', 'Flaschen')
		}
	]);

	const records = $derived([
		{
			label: 'Stärkster Whisky',
			record: overview.strongest,
			value: (r: BottleRecord) => `${formatOneDecimal(r.value)} %`
		},
		{
			label: 'Ältester Whisky',
			record: overview.oldest,
			value: (r: BottleRecord) => formatCount(r.value, 'Jahr', 'Jahre')
		}
	]);
</script>

<section class="space-y-3" aria-labelledby="statistics-overview">
	<h2 id="statistics-overview" class="text-lg font-semibold">Kennzahlen und Rekorde</h2>

	<dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
		{#each tiles as tile (tile.label)}
			<div class="flex flex-col rounded-xl border border-slate-200 bg-white p-4">
				<dt class="text-sm text-slate-500">{tile.label}</dt>
				<dd class="text-2xl font-semibold tracking-tight">{tile.value}</dd>
				{#if tile.hint}
					<dd class="text-xs text-slate-500">{tile.hint}</dd>
				{/if}
			</div>
		{/each}
	</dl>

	<dl class="space-y-3 rounded-xl border border-slate-200 bg-white p-4 text-sm">
		{#each records as { label, record, value } (label)}
			<div>
				<dt class="text-slate-500">{label}</dt>
				<dd class="break-words">
					{#if record}
						{@const bottle = byNumber.get(record.number)!}
						<!-- No bottle page: the link jumps to the bottle's row in the table. -->
						<a
							href={bottleHref(record.number)}
							class="font-medium text-brand underline hover:text-brand-hover"
						>
							{formatBottleName(bottle)}
						</a>
						<span class="whitespace-nowrap">· {value(record)}</span>
						{#if record.more > 0}
							<span class="text-slate-500">+ {record.more} weitere</span>
						{/if}
					{:else}
						–
					{/if}
				</dd>
			</div>
		{/each}
	</dl>
</section>
