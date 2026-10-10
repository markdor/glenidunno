<script lang="ts">
	import { TASTING_ORDER_HOUR, type DashboardTasting } from '$lib/tasting';
	import DashboardTastingShell from './DashboardTastingShell.svelte';

	let { tasting }: { tasting: DashboardTasting | null } = $props();

	// The date line right above already names the day, the deadline doesn't
	// repeat it.
	function deadline(t: DashboardTasting): string {
		return t.isToday
			? `bis heute, ${TASTING_ORDER_HOUR} Uhr`
			: `bis ${TASTING_ORDER_HOUR} Uhr am Tasting-Tag`;
	}
</script>

<!-- Management data only: phase and the own progress, never content. -->
<DashboardTastingShell
	heading="Nächstes Tasting"
	{tasting}
	linkLabel="Zum Tasting"
	emptyText="Kein Tasting geplant."
>
	{#snippet badge(t)}
		{#if t.isToday}
			<span class="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
				heute
			</span>
		{/if}
	{/snippet}
	{#snippet details(t)}
		{#if t.phase === 'entry'}
			<p class="mt-3 text-sm">Flaschen eintragen {deadline(t)}</p>
			<p class="text-sm text-slate-500">
				{t.progress.entered} von {t.progress.total} Flaschen eingetragen
			</p>
		{:else}
			<p class="mt-3 text-sm">Die Reihenfolge steht</p>
		{/if}
	{/snippet}
</DashboardTastingShell>
