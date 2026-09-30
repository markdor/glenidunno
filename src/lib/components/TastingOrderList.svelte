<script lang="ts">
	import type { OrderEntry } from '$lib/tasting';

	let { order }: { order: OrderEntry[] } = $props();
</script>

{#if order.length === 0}
	<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
{:else}
	<ol class="space-y-2" aria-label="Tastingreihenfolge">
		{#each order as entry (entry.position)}
			<li class="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4">
				<span
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white"
					aria-hidden="true"
				>
					{entry.position}
				</span>
				<span class="min-w-0 text-lg font-medium break-words">
					<span class="sr-only">{entry.position}.</span>
					{entry.alias}
				</span>
			</li>
		{/each}
	</ol>
{/if}
