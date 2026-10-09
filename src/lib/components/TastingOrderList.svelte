<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import type { OrderEntry } from '$lib/tasting';

	let {
		order,
		presentationHref
	}: {
		order: OrderEntry[];
		/** Download URL of a bottle's presentation – runs through the tasting's link. */
		presentationHref: (bottleId: string) => ResolvedPathname;
	} = $props();
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
				<span class="min-w-0 flex-1 text-lg font-medium break-words">
					<span class="sr-only">{entry.position}.</span>
					{entry.alias}
				</span>
				{#if entry.presentation}
					<!-- Neutral label: the file name may reveal the whisky and waits for the
					     reveal. Served as an attachment, `download` keeps the client router out. -->
					<a
						href={presentationHref(entry.presentation.bottleId)}
						download
						class="shrink-0 py-2 text-sm font-medium text-brand underline hover:text-brand-hover"
					>
						Präsentation <span class="sr-only">zu {entry.alias}</span>
					</a>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
