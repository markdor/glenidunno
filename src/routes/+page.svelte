<script lang="ts">
	import TastingCard from '$lib/components/TastingCard.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Dashboard · Glen Idunno</title>
</svelte:head>

<main class="mx-auto max-w-3xl px-4 py-8">
	<h1 class="text-2xl font-semibold tracking-tight">Hallo {data.user?.username} 👋</h1>
	{#if data.tastingSummary}
		<div class="mt-6">
			<TastingCard summary={data.tastingSummary} />
		</div>
	{:else}
		<p class="mt-2 text-sm text-slate-500">Hier entsteht bald das Tasting.</p>
	{/if}
</main>
