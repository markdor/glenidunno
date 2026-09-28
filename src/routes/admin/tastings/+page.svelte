<script lang="ts">
	import { resolve } from '$app/paths';
	import { Plus } from '@lucide/svelte';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import { formatTastingDate, TASTING_PHASE_LABEL } from '$lib/tasting';

	let { data } = $props();
</script>

<svelte:head>
	<title>Whisky-Tastings · Glen Idunno</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<SubHeader backHref={resolve('/')} backLabel="Startseite" title="Whisky-Tastings">
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
					<a
						href={resolve('/admin/tastings/[id]', { id: t.id })}
						class="block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-100"
					>
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="truncate font-medium">{t.name}</p>
								<p class="text-sm text-slate-500">{formatTastingDate(t.tastingDate)}</p>
							</div>
							<span
								class="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
							>
								{TASTING_PHASE_LABEL[t.phase]}
							</span>
						</div>
						<p class="mt-2 text-sm text-slate-500">
							{t.progress.entered}/{t.progress.total} Flaschen eingetragen
						</p>
					</a>
				</li>
			{/each}
		</ul>
	{/if}
</div>
