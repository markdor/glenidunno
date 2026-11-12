<script lang="ts">
	import { formatOneDecimal, type SharedBottleView } from '$lib/tasting';
	import { formatCask, formatFinish, formatPrice, peatLevel } from '$lib/tastingFacts';

	// The card of a shared bottle's public page (/share/<token>): like a card of
	// the reveal (TastingReveal), but without the bringer and without anything
	// about how the order came about – no score, no factor shares.
	let { view }: { view: SharedBottleView } = $props();
</script>

<article class="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Whisky">
	{#if !view.archived}
		<p class="text-sm text-slate-500">Flasche {view.position} von {view.total}</p>
	{/if}

	<dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
		<dt class="text-slate-500">Destillerie</dt>
		<dd class="break-words">{view.bottle.distillery}</dd>
		{#if view.bottle.bottling}
			<dt class="text-slate-500">Abfüllung</dt>
			<dd class="break-words">{view.bottle.bottling}</dd>
		{/if}
		<dt class="text-slate-500">Alter</dt>
		<dd>{view.bottle.age === null ? 'NAS' : `${view.bottle.age} Jahre`}</dd>
		<dt class="text-slate-500">Abfüller</dt>
		<dd class="break-words">{view.bottle.bottler ?? 'Originalabfüllung'}</dd>

		{#if view.archived}
			<dt class="text-slate-500">Alkohol</dt>
			<dd>{formatOneDecimal(view.bottle.abv)} % vol.</dd>
		{:else if view.algorithm === 'facts'}
			<dt class="text-slate-500">Torf</dt>
			<dd>{peatLevel(view.bottle.facts.peat).group}</dd>
			<dt class="text-slate-500">Fass</dt>
			<dd class="break-words">{formatCask(view.bottle.facts.cask)}</dd>
			<dt class="text-slate-500">Nachreifung</dt>
			<dd class="break-words">{formatFinish(view.bottle.facts.finish)}</dd>
			<dt class="text-slate-500">Alkohol</dt>
			<dd>{formatOneDecimal(view.bottle.abv)} % vol.</dd>
			<dt class="text-slate-500">Preis</dt>
			<dd>{formatPrice(view.bottle.facts.priceCents)}</dd>
		{:else}
			<dt class="text-slate-500">Werte</dt>
			<dd>
				Rauch {view.bottle.smoke} · Fass {view.bottle.cask} · {formatOneDecimal(view.bottle.abv)} % ·
				Kaliber {view.bottle.value}
			</dd>
		{/if}
	</dl>

	{#if view.bottle.whiskybaseUrl}
		<!-- rel="external": required by svelte/no-navigation-without-resolve for
		     a dynamic external href. No referrer leaves the page (token in the URL). -->
		<a
			href={view.bottle.whiskybaseUrl}
			target="_blank"
			rel="external noopener noreferrer"
			class="inline-block py-1 text-sm font-medium text-brand underline hover:text-brand-hover"
		>
			Auf Whiskybase ansehen
		</a>
	{/if}
</article>
