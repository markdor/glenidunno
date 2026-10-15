<script lang="ts">
	import { Eye } from '@lucide/svelte';
	import type { ResolvedPathname } from '$app/types';
	import type { OrderEntry } from '$lib/tasting';

	let {
		order,
		presentationHref,
		viewHref
	}: {
		order: OrderEntry[];
		/** Download URL of a bottle's presentation – runs through the tasting's link. */
		presentationHref: (bottleId: string) => ResolvedPathname;
		/** The presentation viewer of a bottle – also through the tasting's link. */
		viewHref: (bottleId: string) => ResolvedPathname;
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
					<!-- Neutral labels: the file name may reveal the whisky and waits for
					     the reveal. The download is served as an attachment, `download`
					     keeps the client router out. Stacked on a phone, so the alias
					     keeps its room. -->
					<div class="flex shrink-0 flex-col items-end sm:flex-row sm:gap-x-3">
						<a
							href={presentationHref(entry.presentation.bottleId)}
							download
							class="py-2 text-sm font-medium text-brand underline hover:text-brand-hover"
						>
							Präsentation <span class="sr-only">zu {entry.alias}</span>
						</a>
						{#if entry.presentation.viewable}
							<!-- aria-label: an sr-only part would get an extra space in the
							     name (absolutely positioned); it keeps the visible word. -->
							<a
								href={viewHref(entry.presentation.bottleId)}
								aria-label="Präsentation zu {entry.alias} ansehen"
								class="inline-flex items-center gap-1 py-2 text-sm font-medium text-brand underline hover:text-brand-hover"
							>
								<Eye size={16} strokeWidth={2} aria-hidden="true" />
								Ansehen
							</a>
						{/if}
					</div>
				{/if}
			</li>
		{/each}
	</ol>
{/if}
