<script lang="ts">
	import { resolve } from '$app/paths';
	import { GlassWater } from '@lucide/svelte';
	import { formatTastingDate, type Progress, type TastingPhase } from '$lib/tasting';

	type PreviewItem = {
		id: string;
		name: string;
		tastingDate: string;
		phase: TastingPhase;
		progress: Progress;
		isToday: boolean;
	};

	let { summary }: { summary: { upcomingCount: number; preview: PreviewItem[] } } = $props();
</script>

<!-- A plain <a>: the card has no nested controls, so the div role="link"
     pattern from CLAUDE.md isn't needed. Never shows content before the reveal. -->
<a
	href={resolve('/admin/tastings')}
	class="block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-100"
>
	<div class="flex items-center justify-between gap-3">
		<h2 class="flex items-center gap-2 font-semibold">
			<GlassWater size={20} strokeWidth={2} aria-hidden="true" />
			Tasting-Verwaltung
		</h2>
		<span
			class="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
		>
			{summary.upcomingCount} anstehend
		</span>
	</div>

	{#if summary.preview.length === 0}
		<p class="mt-3 text-sm text-slate-500">Kein Tasting geplant.</p>
	{:else}
		<ul class="mt-3 space-y-2">
			{#each summary.preview as t (t.id)}
				<li class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-sm">
					<span class="flex min-w-0 items-center gap-2">
						<span class="truncate font-medium">{t.name}</span>
						{#if t.isToday}
							<span
								class="shrink-0 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900"
							>
								heute
							</span>
						{/if}
					</span>
					<span class="shrink-0 text-slate-500">
						{formatTastingDate(t.tastingDate)}
						{#if t.phase === 'entry'}
							· {t.progress.entered}/{t.progress.total} Flaschen
						{/if}
					</span>
				</li>
			{/each}
		</ul>
	{/if}
</a>
