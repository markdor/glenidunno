<script lang="ts">
	import { resolve } from '$app/paths';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import WorldMap from '$lib/components/WorldMap.svelte';
	import WorldMapDetails from '$lib/components/WorldMapDetails.svelte';
	import { bottleAnchor } from '$lib/historyTable';
	import type { WorldMapSelection } from '$lib/worldMap';

	let { data } = $props();

	// Shared by the map and the details: plain page state, no store.
	let selection = $state.raw<WorldMapSelection | null>(null);
	let map = $state<WorldMap>();

	function select(next: WorldMapSelection | null, fly: boolean) {
		selection = next;
		if (!fly || !next) return;
		if (next.kind === 'country') map?.flyToCountry(next.code);
		else map?.flyToRegions();
	}

	function bottleHref(number: number) {
		return resolve(`/history#${bottleAnchor(number)}`);
	}
</script>

<svelte:head>
	<title>Weltkarte · Glen Idunno</title>
</svelte:head>

<div class="mx-auto max-w-6xl space-y-6 px-4 py-8">
	<SubHeader backHref={resolve('/')} backLabel="Startseite" title="Weltkarte" />

	{#if !data.worldMap}
		<p class="text-sm text-slate-500">Noch kein Tasting aufgelöst.</p>
	{:else}
		<!-- A phone shows the map on top in a fixed height, the details below in
		     the page flow; from lg on side by side. min-w-0: a long word in the
		     details mustn't widen its column. -->
		<div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
			<div class="min-w-0 space-y-1">
				<div class="h-[60svh] min-h-64 lg:h-[70svh]">
					<WorldMap
						bind:this={map}
						countries={data.worldMap.countries}
						regions={data.worldMap.regions}
						{selection}
						onselect={(next) => select(next, false)}
					/>
				</div>
				<p class="text-xs text-slate-500">Kartendaten: Natural Earth</p>
			</div>
			<div class="min-w-0">
				<WorldMapDetails map={data.worldMap} {selection} onselect={select} {bottleHref} />
			</div>
		</div>
	{/if}
</div>
