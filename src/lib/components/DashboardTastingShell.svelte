<script lang="ts" generics="T extends DashboardLastTasting">
	import type { Snippet } from 'svelte';
	import { resolve } from '$app/paths';
	import { ChevronRight, GlassWater } from '@lucide/svelte';
	import { formatTastingDate, type DashboardLastTasting } from '$lib/tasting';

	// The look both tasting cards of the start page share. With a tasting the
	// whole card links to the participant page (no nested controls, so a plain
	// <a>); without one it is a plain <div>, neither hoverable nor focusable.
	// The root element is the grid item, so the start page's auto-rows-fr gives
	// both cards one height; mt-auto keeps the link label at the bottom of the
	// stretched card. The snippets get the tasting, so they need no null checks.
	let {
		heading,
		tasting,
		linkLabel,
		emptyText,
		badge,
		details
	}: {
		heading: string;
		tasting: T | null;
		linkLabel: string;
		emptyText: string;
		/** Next to the name, e.g. "heute". */
		badge?: Snippet<[T]>;
		/** Further lines below the date. */
		details?: Snippet<[T]>;
	} = $props();
</script>

{#snippet title()}
	<h2 class="flex items-center gap-2 font-semibold text-brand">
		<GlassWater size={20} strokeWidth={2} aria-hidden="true" />
		{heading}
	</h2>
{/snippet}

{#if tasting}
	<a
		href={resolve('/tasting/[slug=tastingSlug]', { slug: tasting.slug })}
		class="flex flex-col rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-100"
	>
		{@render title()}
		<div class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
			<p class="min-w-0 text-xl font-semibold break-words">{tasting.name}</p>
			{@render badge?.(tasting)}
		</div>
		{#if tasting.motto}
			<p class="break-words text-slate-700">{tasting.motto}</p>
		{/if}
		<p class="text-sm text-slate-500">{formatTastingDate(tasting.tastingDate)}</p>
		{@render details?.(tasting)}

		<span class="mt-auto flex items-center justify-end gap-1 pt-3 text-sm font-medium text-brand">
			{linkLabel}
			<ChevronRight size={16} strokeWidth={2} aria-hidden="true" />
		</span>
	</a>
{:else}
	<div class="rounded-xl border border-slate-200 bg-white p-4">
		{@render title()}
		<p class="mt-2 text-sm text-slate-500">{emptyText}</p>
	</div>
{/if}
