<script lang="ts">
	import { ChartColumn, RotateCcwClock } from '@lucide/svelte';
	import DashboardLastTastingCard from '$lib/components/DashboardLastTastingCard.svelte';
	import DashboardTastingCard from '$lib/components/DashboardTastingCard.svelte';
	import DashboardTile from '$lib/components/DashboardTile.svelte';
	import TastingCard from '$lib/components/TastingCard.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Dashboard · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. -->
<div class="mx-auto max-w-3xl px-4 py-8">
	<h1 class="text-2xl font-semibold tracking-tight">Hallo {data.user?.username} 👋</h1>

	<div class="mt-6 space-y-4">
		<!-- auto-rows-fr: both cards get the same height, even if one has more
		     lines or shows its empty state. grid-cols-1 (minmax(0, 1fr)) rather
		     than the implicit auto column, which a long word would widen. -->
		<div class="grid auto-rows-fr grid-cols-1 gap-4">
			<DashboardTastingCard tasting={data.nextTasting} />
			<DashboardLastTastingCard tasting={data.lastTasting} />
		</div>

		{#if data.tastingSummary}
			<TastingCard summary={data.tastingSummary} />
		{/if}

		<!-- Each section still to come gets its link with its own issue. With an
		     odd number of tiles the last one spans both columns instead of
		     leaving a gap. -->
		<div class="grid auto-rows-fr grid-cols-2 gap-4 [&>:last-child:nth-child(odd)]:col-span-2">
			<DashboardTile title="Historie" icon={RotateCcwClock} />
			<DashboardTile title="Statistiken" icon={ChartColumn} />
		</div>
	</div>
</div>
