<script lang="ts">
	import {
		formatOneDecimal,
		type NormalizedScoreFactors,
		type FactsShares,
		type SharedBottleView
	} from '$lib/tasting';
	import { formatCask, formatFinish, formatPrice, formatRange, peatLevel } from '$lib/tastingFacts';

	// The card of a shared bottle's public page (/share/<token>): like a card of
	// the reveal (TastingReveal), but without the bringer, and with the factor
	// shares as text – a chart would need the other bottles, which the page
	// doesn't get.
	let { view }: { view: SharedBottleView } = $props();

	const percent = (share: number) => `${Math.round(share * 100)} %`;

	function tasteFactors(shares: NormalizedScoreFactors): string {
		return [
			`Rauch ${percent(shares.smoke)}`,
			`Fass ${percent(shares.cask)}`,
			`Alkohol ${percent(shares.abv)}`,
			`Kaliber ${percent(shares.value)}`
		].join(' · ');
	}

	function factsFactors(shares: FactsShares): string {
		return [
			`Fass ${percent(shares.cask)}`,
			`Alkohol ${percent(shares.abv)}`,
			`Preis ${shares.price === null ? 'unbekannt' : percent(shares.price)}`
		].join(' · ');
	}
</script>

<article class="space-y-3 rounded-xl border border-slate-200 bg-white p-4" aria-label="Whisky">
	{#if !view.archived}
		<div
			class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-slate-500"
		>
			<p>Flasche {view.position} von {view.total}</p>
			{#if view.algorithm === 'facts'}
				<p>
					Wucht
					<span class="font-semibold text-slate-900">
						{#if view.bottle.range}<span aria-hidden="true">~</span><span class="sr-only"
								>ungefähr</span
							>{/if}{formatOneDecimal(view.bottle.score)}
					</span>
				</p>
			{:else}
				<p>
					Score <span class="font-semibold text-slate-900"
						>{formatOneDecimal(view.bottle.score)}</span
					>
				</p>
			{/if}
		</div>
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
			{#if view.bottle.range}
				<dt class="text-slate-500">Spanne</dt>
				<dd>{formatRange(view.bottle.range)} (Fass unbekannt)</dd>
			{/if}
			<dt class="text-slate-500">Faktoren</dt>
			<dd>{factsFactors(view.bottle.shares)}</dd>
		{:else}
			<dt class="text-slate-500">Werte</dt>
			<dd>
				Rauch {view.bottle.smoke} · Fass {view.bottle.cask} · {formatOneDecimal(view.bottle.abv)} % ·
				Kaliber {view.bottle.value}
			</dd>
			<dt class="text-slate-500">Faktoren</dt>
			<dd>{tasteFactors(view.bottle.shares)}</dd>
		{/if}
	</dl>

	{#if !view.archived && view.algorithm === 'facts' && view.bottle.uncertain}
		<p class="rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs text-sky-900">
			Reihenfolge unsicher: Die Spanne überschneidet sich mit der Nachbarflasche.
		</p>
	{/if}

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
