<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { formatTastingDate } from '$lib/tasting';

	// One tasting in a list: the admin's tasting management and the tasting
	// history look the same. Management data only, the motto heading without
	// its description.
	let {
		href,
		name,
		motto,
		tastingDate,
		badge,
		children
	}: {
		href: ResolvedPathname;
		name: string;
		motto: string | null;
		tastingDate: string;
		badge: string;
		/** An optional line below, e.g. the entry progress. */
		children?: Snippet;
	} = $props();
</script>

<a {href} class="block rounded-xl border border-slate-200 bg-white p-4 hover:bg-slate-100">
	<div class="flex items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="truncate font-medium">{name}</p>
			{#if motto}
				<p class="truncate text-sm text-slate-700">{motto}</p>
			{/if}
			<p class="text-sm text-slate-500">{formatTastingDate(tastingDate)}</p>
		</div>
		<span
			class="shrink-0 rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
		>
			{badge}
		</span>
	</div>
	{#if children}
		<p class="mt-2 text-sm text-slate-500">{@render children()}</p>
	{/if}
</a>
