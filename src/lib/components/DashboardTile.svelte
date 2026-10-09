<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { LucideIcon } from '@lucide/svelte';

	// Without `href` the tile stands for a section still to come: a plain
	// <div>, neither a link nor focusable. ResolvedPathname (not string): callers
	// pass resolve(...) results, which keeps svelte/no-navigation-without-resolve
	// satisfied.
	let {
		title,
		icon: Icon,
		href
	}: { title: string; icon: LucideIcon; href?: ResolvedPathname } = $props();
</script>

{#if href}
	<a
		{href}
		class="flex min-h-24 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 font-semibold hover:bg-slate-100"
	>
		<Icon size={20} strokeWidth={2} class="text-brand" aria-hidden="true" />
		<span class="break-words hyphens-auto">{title}</span>
	</a>
{:else}
	<!-- slate-400 is tuned to AA on white, so the muted text stays readable. -->
	<div
		class="flex min-h-24 flex-col gap-2 rounded-xl border border-slate-200 bg-white p-4 font-semibold text-slate-400"
	>
		<Icon size={20} strokeWidth={2} aria-hidden="true" />
		<span class="break-words hyphens-auto">{title}</span>
		<span
			class="mt-auto self-start rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
		>
			Demnächst
		</span>
	</div>
{/if}
