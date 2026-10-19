<script lang="ts">
	import { resolve } from '$app/paths';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import TastingListCard from '$lib/components/TastingListCard.svelte';

	let { data } = $props();
</script>

<svelte:head>
	<title>Tasting-Historie · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. -->
<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<SubHeader backHref={resolve('/')} backLabel="Startseite" title="Tasting-Historie" />

	{#if data.tastings.length === 0}
		<p class="text-sm text-slate-500">Noch kein Tasting aufgelöst.</p>
	{:else}
		<ul class="space-y-2">
			{#each data.tastings as t (t.id)}
				<li>
					<TastingListCard
						href={resolve('/tastings/[id]', { id: t.id })}
						name={t.name}
						motto={t.motto}
						tastingDate={t.tastingDate}
						badge="{t.bottleCount} {t.bottleCount === 1 ? 'Flasche' : 'Flaschen'}"
					/>
				</li>
			{/each}
		</ul>
	{/if}
</div>
