<script lang="ts">
	import { resolve } from '$app/paths';
	import { ChevronRight, GlassWater } from '@lucide/svelte';
	import { formatTastingDate, TASTING_ORDER_HOUR, type DashboardTasting } from '$lib/tasting';

	let { tasting }: { tasting: DashboardTasting | null } = $props();

	const revealed = $derived(tasting?.phase === 'revealed');
</script>

{#snippet heading(title: string)}
	<h2 class="flex items-center gap-2 font-semibold text-brand">
		<GlassWater size={20} strokeWidth={2} aria-hidden="true" />
		{title}
	</h2>
{/snippet}

{#if tasting}
	<!-- A plain <a>: the card has no nested controls. Management data only in
	     every phase – the reveal itself stays on the participant page. -->
	<a
		href={resolve('/tasting/[slug=tastingSlug]', { slug: tasting.slug })}
		class="block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-100"
	>
		{@render heading(revealed ? 'Letztes Tasting' : 'Kommendes Tasting')}
		<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
			<p class="min-w-0 text-xl font-semibold break-words">{tasting.name}</p>
			{#if tasting.isToday}
				<span class="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
					heute
				</span>
			{/if}
		</div>
		<p class="text-sm text-slate-500">{formatTastingDate(tasting.tastingDate)}</p>

		<p class="mt-3 text-sm">
			{#if tasting.phase === 'entry'}
				Flaschen eintragen bis {formatTastingDate(tasting.tastingDate)}, {TASTING_ORDER_HOUR} Uhr
			{:else if tasting.phase === 'order'}
				Die Reihenfolge steht
			{:else}
				Aufgelöst
			{/if}
		</p>
		{#if tasting.phase === 'entry'}
			<p class="text-sm text-slate-500">
				{tasting.progress.entered} von {tasting.progress.total} Flaschen eingetragen
			</p>
		{/if}

		<span class="mt-3 flex items-center justify-end gap-1 text-sm font-medium text-brand">
			{revealed ? 'Zur Auflösung' : 'Zum Tasting'}
			<ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
		</span>
	</a>
{:else}
	<div class="rounded-xl border border-slate-200 bg-white p-4">
		{@render heading('Kommendes Tasting')}
		<p class="mt-2 text-sm text-slate-500">Kein Tasting geplant.</p>
	</div>
{/if}
