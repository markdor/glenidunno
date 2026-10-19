<script lang="ts">
	import { resolve } from '$app/paths';
	import HistoryBottleTable from '$lib/components/HistoryBottleTable.svelte';
	import SubHeader from '$lib/components/SubHeader.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Flaschen-Datenbank · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. Wider
     than the other pages, so from lg on all columns stand side by side; the
     header shares the container to stay flush with the table. -->
<div class="mx-auto max-w-6xl space-y-8 px-4 py-8">
	<SubHeader backHref={resolve('/')} backLabel="Startseite" title="Flaschen-Datenbank" />

	{#if data.bottles}
		<HistoryBottleTable bottles={data.bottles} />
	{:else}
		<p class="text-sm text-slate-500">Noch kein Tasting aufgelöst.</p>
	{/if}
</div>
