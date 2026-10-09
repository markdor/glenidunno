<script lang="ts">
	import { resolve } from '$app/paths';
	import { ChartColumn, CircleCheck, Plus, RotateCcwClock } from '@lucide/svelte';
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
		<DashboardTastingCard tasting={data.heroTasting} />

		{#if data.tastingSummary}
			<TastingCard summary={data.tastingSummary} />
		{/if}

		<!-- Each section still to come gets its link with its own issue. With an
		     odd number of tiles (three for non-admins) the last one spans both
		     columns instead of leaving a gap. -->
		<div class="grid auto-rows-fr grid-cols-2 gap-4 [&>:last-child:nth-child(odd)]:col-span-2">
			{#if data.user?.isAdmin}
				<DashboardTile title="Neues Tasting" icon={Plus} href={resolve('/admin/tastings/new')} />
			{/if}
			<DashboardTile title="Abgeschlossene Tastings" icon={CircleCheck} />
			<DashboardTile title="Historie" icon={RotateCcwClock} />
			<DashboardTile title="Statistiken" icon={ChartColumn} />
		</div>
	</div>
</div>
