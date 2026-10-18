<script lang="ts">
	import { tick } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { ChevronLeft } from '@lucide/svelte';
	import { countryName } from '$lib/countries';
	import { formatCount, formatDate, formatOneDecimal, type StatisticsBottle } from '$lib/tasting';
	import {
		COUNTRY_LEVELS,
		LEVEL_BG_CLASSES,
		mapLevel,
		REGION_LEVELS,
		SCOTLAND_CODE,
		type WorldMapData,
		type WorldMapSelection
	} from '$lib/worldMap';

	let {
		map,
		selection,
		onselect,
		bottleHref
	}: {
		map: WorldMapData;
		selection: WorldMapSelection | null;
		/** `fly`: the map flies there too (list entries and chips, not the back links). */
		onselect: (selection: WorldMapSelection | null, fly: boolean) => void;
		/** Link to a bottle's row in the history's table. */
		bottleHref: (number: number) => ResolvedPathname;
	} = $props();

	let heading = $state<HTMLHeadingElement>();

	const country = $derived(
		selection?.kind === 'country'
			? (map.countries.find((c) => c.code === selection.code) ?? null)
			: null
	);
	const region = $derived(
		selection?.kind === 'region'
			? (map.regions.find((r) => r.region === selection.region) ?? null)
			: null
	);

	/** The button pressed goes away with the view: the focus moves to the new heading. */
	async function select(next: WorldMapSelection | null, fly: boolean) {
		onselect(next, fly);
		await tick();
		heading?.focus();
	}

	const whiskys = (n: number) => formatCount(n, 'Whisky', 'Whiskys');
	const distilleries = (n: number) => formatCount(n, 'Brennerei', 'Brennereien');

	const backClass =
		'-ml-1 inline-flex min-h-11 items-center gap-1 text-sm font-medium text-slate-500 hover:text-slate-700';
</script>

{#snippet bottles(list: StatisticsBottle[])}
	<ul class="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
		{#each list as bottle (bottle.number)}
			<li>
				<!-- No bottle page: the link jumps to the bottle's row in the history. -->
				<a href={bottleHref(bottle.number)} class="block px-4 py-3 text-sm hover:bg-slate-50">
					<span class="block text-xs text-slate-500">{formatDate(bottle.tastingDate)}</span>
					<span class="block font-medium break-words text-brand underline">
						{bottle.distillery} · {bottle.bottler ?? 'Originalabfüllung'}
					</span>
					{#if bottle.bottling}
						<span class="block break-words">{bottle.bottling}</span>
					{/if}
					<span class="block">
						{bottle.age === null ? 'NAS' : `${bottle.age} Jahre`} · {formatOneDecimal(bottle.abv)} %
					</span>
					<span class="block text-slate-500">mitgebracht von {bottle.broughtBy}</span>
				</a>
			</li>
		{/each}
	</ul>
{/snippet}

{#snippet swatch(level: number)}
	<span class={['size-3 shrink-0 rounded-sm', LEVEL_BG_CLASSES[level]]} aria-hidden="true"></span>
{/snippet}

<section class="space-y-4" aria-labelledby="world-map-details">
	{#if region}
		<div class="space-y-1">
			<button
				type="button"
				onclick={() => select({ kind: 'country', code: SCOTLAND_CODE }, false)}
				class={backClass}
			>
				<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
				Schottland
			</button>
			<h2
				id="world-map-details"
				bind:this={heading}
				tabindex="-1"
				class="text-lg font-semibold outline-none"
			>
				{region.region}
			</h2>
			<p class="text-sm text-slate-500">
				{distilleries(region.distilleries.length)} · {whiskys(region.bottles)}
			</p>
		</div>
		{#if region.distilleries.length > 0}
			<ul class="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white text-sm">
				{#each region.distilleries as distillery (distillery.name)}
					<li class="flex justify-between gap-3 px-4 py-3">
						<span class="min-w-0 break-words">{distillery.name}</span>
						<span class="shrink-0 text-slate-500">{whiskys(distillery.bottles)}</span>
					</li>
				{/each}
			</ul>
		{:else}
			<p class="text-sm text-slate-500">Noch kein Whisky von hier.</p>
		{/if}
	{:else if country}
		{@const scotland = country.code === SCOTLAND_CODE}
		<div class="space-y-1">
			<button type="button" onclick={() => select(null, false)} class={backClass}>
				<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
				Alle Länder
			</button>
			<h2
				id="world-map-details"
				bind:this={heading}
				tabindex="-1"
				class="text-lg font-semibold outline-none"
			>
				{countryName(country.code)}
			</h2>
			<p class="text-sm text-slate-500">
				{whiskys(country.bottles.length)} · {distilleries(country.distilleries)}
			</p>
		</div>
		{#if scotland}
			<div class="space-y-2">
				<h3 class="text-sm font-medium">Regionen</h3>
				<ul class="flex flex-wrap gap-2">
					{#each map.regions as chip (chip.region)}
						<li>
							<button
								type="button"
								onclick={() => select({ kind: 'region', region: chip.region }, true)}
								class="flex min-h-11 items-center gap-2 rounded-full border border-slate-300 bg-white px-3 text-sm hover:bg-slate-100"
							>
								{@render swatch(mapLevel(chip.distilleries.length, REGION_LEVELS))}
								<span>{chip.region}</span>
								<span class="text-slate-500 tabular-nums">
									{distilleries(chip.distilleries.length)}
								</span>
							</button>
						</li>
					{/each}
				</ul>
				{#if map.scotlandWithoutRegion > 0}
					<p class="text-sm text-slate-500">
						{distilleries(map.scotlandWithoutRegion)} ohne Region
					</p>
				{/if}
			</div>
		{/if}
		<h3 class="text-sm font-medium">Alle Flaschen</h3>
		{@render bottles(country.bottles)}
	{:else}
		<div class="space-y-1">
			<h2
				id="world-map-details"
				bind:this={heading}
				tabindex="-1"
				class="text-lg font-semibold outline-none"
			>
				Unsere Herkunftsländer
			</h2>
			<p class="text-sm text-slate-500">
				{formatCount(map.countries.length, 'Land', 'Länder')}
			</p>
		</div>
		{#if map.countries.length > 0}
			<ul class="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
				{#each map.countries as entry (entry.code)}
					<li>
						<button
							type="button"
							onclick={() => select({ kind: 'country', code: entry.code }, true)}
							class="flex min-h-11 w-full items-center gap-3 px-4 py-2 text-left text-sm hover:bg-slate-50"
						>
							{@render swatch(mapLevel(entry.bottles.length, COUNTRY_LEVELS))}
							<span class="min-w-0 flex-1 font-medium break-words">{countryName(entry.code)}</span>
							<span class="shrink-0 text-right text-slate-500">
								{distilleries(entry.distilleries)} · {whiskys(entry.bottles.length)}
							</span>
						</button>
					</li>
				{/each}
			</ul>
		{/if}
		{#if map.withoutCountry.length > 0}
			<div class="space-y-2">
				<h3 class="text-sm font-medium">
					Ohne Länderangabe
					<span class="font-normal text-slate-500">· {whiskys(map.withoutCountry.length)}</span>
				</h3>
				{@render bottles(map.withoutCountry)}
			</div>
		{/if}
	{/if}
</section>
