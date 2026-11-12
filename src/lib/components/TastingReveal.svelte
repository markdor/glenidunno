<script lang="ts">
	import { Eye } from '@lucide/svelte';
	import type { ResolvedPathname } from '$app/types';
	import {
		formatOneDecimal,
		type ArchivedRevealedBottle,
		type Reveal,
		type RevealedBottle,
		type RevealedFactsBottle
	} from '$lib/tasting';
	import {
		formatCask,
		formatFinish,
		formatPrice,
		formatRange,
		peatLevel,
		uncertainPositions
	} from '$lib/tastingFacts';
	import ShareButton from './ShareButton.svelte';

	let {
		reveal,
		presentationHref,
		viewHref
	}: {
		reveal: Reveal;
		/** Download URL of a bottle's presentation – runs through the tasting's link. */
		presentationHref: (bottleId: string) => ResolvedPathname;
		/** The presentation viewer of a bottle – also through the tasting's link. */
		viewHref: (bottleId: string) => ResolvedPathname;
	} = $props();

	type AnyBottle = RevealedBottle | RevealedFactsBottle | ArchivedRevealedBottle;

	// Facts tasting: bottles whose range overlaps a neighbor of the same peat group.
	const uncertain = $derived(
		!reveal.archived && reveal.algorithm === 'facts'
			? uncertainPositions(
					reveal.bottles.map((b) => ({
						position: b.position,
						peat: b.facts.peat,
						score: b.score,
						range: b.range
					}))
				)
			: new Set<number>()
	);
</script>

<!-- Everything a bottle shows with or without its factors. -->
{#snippet details(b: AnyBottle)}
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
{/snippet}

{#snippet links(b: AnyBottle)}
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
		<!-- The download is served as an attachment by a +server.ts route:
		     `download` keeps the client router out of it. -->
		<p class="flex flex-wrap items-center gap-x-3 text-sm">
			<a
				href={presentationHref(b.presentation.bottleId)}
				download
				class="inline-block py-1 font-medium break-all text-brand underline hover:text-brand-hover"
			>
				Präsentation: {b.presentation.name}
			</a>
			{#if b.presentation.viewable}
				<a
					href={viewHref(b.presentation.bottleId)}
					aria-label="Präsentation zu {b.alias} ansehen"
					class="inline-flex items-center gap-1 py-1 font-medium text-brand underline hover:text-brand-hover"
				>
					<Eye size={16} strokeWidth={2} aria-hidden="true" />
					Ansehen
				</a>
			{/if}
		</p>
	{/if}

	{#if b.share}
		<!-- Only the viewer's own bottles carry a share link (see OwnShare). A
		     div, not a p: the popup's <dialog> isn't phrasing content. -->
		<div class="text-sm">
			<ShareButton share={b.share} alias={b.alias} />
		</div>
	{/if}
{/snippet}

{#if reveal.bottles.length === 0}
	<p class="text-sm text-slate-500">Es wurden keine Flaschen eingetragen.</p>
{:else if reveal.archived}
	<!-- Without smoke, cask and value there is no score and no order: no
	     position, a list by bringer, of the factors only the ABV. -->
	<ul class="space-y-3" aria-label="Auflösung">
		{#each reveal.bottles as b (b.id)}
			<li class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
				<h3 class="text-lg font-semibold break-words">{b.alias}</h3>
				<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
					{@render details(b)}
					<dt class="text-slate-500">Alkohol</dt>
					<dd>{formatOneDecimal(b.abv)} % vol.</dd>
				</dl>
				{@render links(b)}
			</li>
		{/each}
	</ul>
{:else if reveal.algorithm === 'facts'}
	<!-- Facts instead of the sliders, "Wucht" instead of the score. Labels of
	     other casks are plain text, never {@html}. -->
	<ol class="space-y-3" aria-label="Auflösung">
		{#each reveal.bottles as b (b.position)}
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
								Wucht
								<span class="font-semibold text-slate-900">
									{#if b.range}<span aria-hidden="true">~</span><span class="sr-only">ungefähr</span
										>{/if}{formatOneDecimal(b.score)}
								</span>
							</p>
						</div>

						<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
							{@render details(b)}
							<dt class="text-slate-500">Torf</dt>
							<dd>{peatLevel(b.facts.peat).group}</dd>
							<dt class="text-slate-500">Fass</dt>
							<dd class="break-words">{formatCask(b.facts.cask)}</dd>
							<dt class="text-slate-500">Nachreifung</dt>
							<dd class="break-words">{formatFinish(b.facts.finish)}</dd>
							<dt class="text-slate-500">Alkohol</dt>
							<dd>{formatOneDecimal(b.abv)} % vol.</dd>
							<dt class="text-slate-500">Preis</dt>
							<dd>{formatPrice(b.facts.priceCents)}</dd>
							{#if b.range}
								<dt class="text-slate-500">Spanne</dt>
								<dd>{formatRange(b.range)} (Fass unbekannt)</dd>
							{/if}
						</dl>

						{#if uncertain.has(b.position)}
							<p class="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
								Reihenfolge unsicher: Die Spanne überschneidet sich mit der Nachbarflasche.
							</p>
						{/if}

						{@render links(b)}
					</div>
				</div>
			</li>
		{/each}
	</ol>
{:else}
	<ol class="space-y-3" aria-label="Auflösung">
		{#each reveal.bottles as b (b.position)}
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
							{@render details(b)}
							<dt class="text-slate-500">Werte</dt>
							<dd>
								Rauch {b.smoke} · Fass {b.cask} · {formatOneDecimal(b.abv)} % · Kaliber {b.value}
							</dd>
						</dl>

						{@render links(b)}
					</div>
				</div>
			</li>
		{/each}
	</ol>
{/if}
