<script lang="ts">
	import { resolve } from '$app/paths';
	import { Plus } from '@lucide/svelte';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import TastingListCard from '$lib/components/TastingListCard.svelte';
	import { TASTING_PHASE_LABEL } from '$lib/tasting';

	let { data } = $props();
</script>

<svelte:head>
	<title>Whisky-Tastings · Glen Idunno</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<SubHeader backHref={resolve('/admin')} backLabel="Admin" title="Whisky-Tastings">
		{#snippet action()}
			<a
				href={resolve('/admin/tastings/new')}
				class="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
			>
				<Plus size={20} strokeWidth={2} aria-hidden="true" />
				Neues Tasting
			</a>
		{/snippet}
	</SubHeader>

	{#if data.tastings.length === 0}
		<p class="text-sm text-slate-500">Noch keine Tastings angelegt.</p>
	{:else}
		<ul class="space-y-2">
			{#each data.tastings as t (t.id)}
				<li>
					<TastingListCard
						href={resolve('/admin/tastings/[id]', { id: t.id })}
						name={t.name}
						motto={t.motto}
						tastingDate={t.tastingDate}
						badge={TASTING_PHASE_LABEL[t.phase]}
					>
						{t.progress.entered}/{t.progress.total} Flaschen eingetragen
					</TastingListCard>
				</li>
			{/each}
		</ul>
	{/if}
</div>
