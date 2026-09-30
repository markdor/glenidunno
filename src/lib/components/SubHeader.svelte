<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { ResolvedPathname } from '$app/types';
	import { ChevronLeft } from '@lucide/svelte';

	// ResolvedPathname (not string): callers pass resolve(...) results, which
	// keeps svelte/no-navigation-without-resolve satisfied for the back link.
	let {
		backHref,
		backLabel,
		title,
		action
	}: { backHref: ResolvedPathname; backLabel: string; title: string; action?: Snippet } = $props();
</script>

<div class="space-y-1">
	<a
		href={backHref}
		class="-ml-1 inline-flex items-center gap-1 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
	>
		<ChevronLeft size={16} strokeWidth={2} aria-hidden="true" />
		{backLabel}
	</a>
	<div class="flex flex-wrap items-center justify-between gap-3">
		<h1 class="min-w-0 text-2xl font-semibold tracking-tight break-words">{title}</h1>
		{@render action?.()}
	</div>
</div>
