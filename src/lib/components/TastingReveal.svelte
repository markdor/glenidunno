<script lang="ts">
	import type { ResolvedPathname } from '$app/types';
	import { formatOneDecimal, type RevealedBottle } from '$lib/tasting';

	let {
		bottles,
		presentationHref
	}: {
		bottles: RevealedBottle[];
		/** Download URL of a bottle's presentation – runs through the link's own token. */
		presentationHref: (bottleId: string) => ResolvedPathname;
	} = $props();
</script>

{#if bottles.length === 0}
	<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
{:else}
	<ol class="space-y-3" aria-label="Auflösung">
		{#each bottles as b (b.position)}
			<li class="rounded-xl border border-slate-200 bg-white p-4">
				<div class="flex items-start gap-3">
					<span
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white"
						aria-hidden="true"
					>
						{b.position}
					</span>
					<div class="min-w-0 flex-1 space-y-3">
						<div class="flex items-baseline justify-between gap-3">
							<h3 class="min-w-0 text-lg font-semibold break-words">
								<span class="sr-only">{b.position}.</span>
								{b.alias}
							</h3>
							<p class="shrink-0 text-sm text-slate-500">
								Score <span class="font-semibold text-slate-900">{formatOneDecimal(b.score)}</span>
							</p>
						</div>

						<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
							<dt class="text-slate-500">Distillery</dt>
							<dd class="break-words">{b.distillery}</dd>
							{#if b.bottling}
								<dt class="text-slate-500">Abfüllung</dt>
								<dd class="break-words">{b.bottling}</dd>
							{/if}
							<dt class="text-slate-500">Alter</dt>
							<dd>{b.age === null ? 'NAS' : `${b.age} Jahre`}</dd>
							<dt class="text-slate-500">Abfüller</dt>
							<dd class="break-words">{b.bottler ?? 'Originalabfüllung'}</dd>
							<dt class="text-slate-500">Mitgebracht von</dt>
							<dd class="break-words">{b.broughtBy}</dd>
							<dt class="text-slate-500">Werte</dt>
							<dd>
								Rauch {b.smoke} · Fass {b.cask} · {formatOneDecimal(b.abv)} % · Wertigkeit {b.value}
							</dd>
						</dl>

						{#if b.whiskybaseUrl}
							<!-- rel="external": required by svelte/no-navigation-without-resolve for
							     a dynamic external href (also makes SvelteKit skip client routing). -->
							<a
								href={b.whiskybaseUrl}
								target="_blank"
								rel="external noopener noreferrer"
								class="inline-block py-1 text-sm font-medium text-brand underline hover:text-brand-hover"
							>
								Auf Whiskybase ansehen
							</a>
						{/if}

						{#if b.presentation}
							<!-- Served as an attachment by a +server.ts route: `download` keeps the
							     client router out of it. -->
							<p class="text-sm">
								<a
									href={presentationHref(b.presentation.bottleId)}
									download
									class="inline-block py-1 font-medium break-all text-brand underline hover:text-brand-hover"
								>
									Präsentation: {b.presentation.name}
								</a>
							</p>
						{/if}
					</div>
				</div>
			</li>
		{/each}
	</ol>
{/if}
