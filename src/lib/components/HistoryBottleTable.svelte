<script lang="ts">
	import { ArrowDown, ArrowUp, ArrowUpDown, Eye } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		bottleAnchor,
		bottleCells,
		COLUMN_LABELS,
		filterBottles,
		filterOptions,
		parseTableQuery,
		SEARCH_MAX_LENGTH,
		SEARCH_MIN_LENGTH,
		SORT_KEYS,
		sortBottles,
		tableQueryString,
		type SortKey,
		type TableQuery
	} from '$lib/historyTable';
	import type { HistoryBottle } from '$lib/tasting';

	let { bottles }: { bottles: HistoryBottle[] } = $props();

	// The state lives in the query string only, so a shared link keeps it. A
	// navigation superseded by the next keystroke is dropped by the router, so
	// the search field never jumps back while typing.
	const options = $derived(filterOptions(bottles));
	const query = $derived(parseTableQuery(page.url.searchParams, options));
	const shown = $derived(sortBottles(filterBottles(bottles, query), query.sort, query.dir));
	// The row a record link jumped to. Not decoded: the anchors are ASCII, and
	// decodeURIComponent() throws on a malformed hash such as "#%".
	const target = $derived(page.url.hash.slice(1));

	function update(change: Partial<TableQuery>) {
		const qs = tableQueryString({ ...query, ...change });
		// keepFocus: the search field would lose the focus on every character.
		void goto(qs ? resolve(`/history?${qs}`) : resolve('/history'), {
			replaceState: true,
			noScroll: true,
			keepFocus: true
		});
	}

	function sortBy(key: SortKey) {
		update(
			key === query.sort ? { dir: query.dir === 'asc' ? 'desc' : 'asc' } : { sort: key, dir: 'asc' }
		);
	}

	function ariaSort(key: SortKey) {
		if (key !== query.sort) return undefined;
		return query.dir === 'asc' ? 'ascending' : 'descending';
	}

	// Below lg only these are columns, the rest goes to the tile below the row.
	const MAIN_COLUMNS: SortKey[] = ['whisky', 'date', 'broughtBy'];
	const DETAIL_COLUMNS: SortKey[] = ['alias', 'bottler', 'age', 'abv'];

	// Downloads run through the tasting's link (see presentation/[bottleId]).
	function presentationHref(slug: string, bottleId: string) {
		return resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]', { slug, bottleId });
	}

	// The viewer's back link returns here (without the table's filters).
	function viewHref(slug: string, bottleId: string) {
		return resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]/view?from=history', {
			slug,
			bottleId
		});
	}

	const controlClass =
		'mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none';
</script>

{#snippet sortIcon(key: SortKey)}
	{#if key !== query.sort}
		<ArrowUpDown size={16} strokeWidth={2} class="shrink-0 text-slate-400" aria-hidden="true" />
	{:else if query.dir === 'asc'}
		<ArrowUp size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />
	{:else}
		<ArrowDown size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />
	{/if}
{/snippet}

{#snippet heading(key: SortKey, extraClass: string)}
	<th scope="col" aria-sort={ariaSort(key)} class={['p-0 text-left align-bottom', extraClass]}>
		<button
			type="button"
			onclick={() => sortBy(key)}
			class="flex min-h-11 w-full items-center gap-1 px-2 py-2 text-left font-semibold hover:bg-slate-100"
		>
			{#if key === 'broughtBy'}
				<!-- Short below lg, so the whisky keeps its room; the full name for screen readers. -->
				<span class="min-w-0 break-words lg:hidden" aria-hidden="true">Von</span>
				<span class="sr-only min-w-0 break-words lg:not-sr-only">{COLUMN_LABELS[key]}</span>
			{:else}
				<span class="min-w-0 break-words">{COLUMN_LABELS[key]}</span>
			{/if}
			{@render sortIcon(key)}
		</button>
	</th>
{/snippet}

{#snippet links(bottle: HistoryBottle)}
	{#if bottle.whiskybaseUrl}
		<!-- rel="external": required by svelte/no-navigation-without-resolve for
		     a dynamic external href (also makes SvelteKit skip client routing). -->
		<a
			href={bottle.whiskybaseUrl}
			target="_blank"
			rel="external noopener noreferrer"
			class="inline-block py-1 font-medium text-brand underline hover:text-brand-hover"
		>
			Whiskybase <span class="sr-only">zu {bottle.alias}</span>
		</a>
	{/if}
	{#if bottle.presentation && bottle.slug}
		<!-- Neutral label like in the pouring order; the download names the file.
		     Served as an attachment, `download` keeps the client router out. -->
		<a
			href={presentationHref(bottle.slug, bottle.presentation.bottleId)}
			download
			class="inline-block py-1 font-medium text-brand underline hover:text-brand-hover"
		>
			Präsentation <span class="sr-only">zu {bottle.alias}</span>
		</a>
		{#if bottle.presentation.viewable}
			<a
				href={viewHref(bottle.slug, bottle.presentation.bottleId)}
				aria-label="Präsentation zu {bottle.alias} ansehen"
				class="inline-flex items-center gap-1 py-1 font-medium text-brand underline hover:text-brand-hover"
			>
				<Eye size={16} strokeWidth={2} aria-hidden="true" />
				Ansehen
			</a>
		{/if}
	{/if}
{/snippet}

<section class="space-y-3" aria-labelledby="history-bottles">
	<h2 id="history-bottles" class="text-lg font-semibold">Alle Flaschen</h2>

	<div class="grid grid-cols-2 gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
		<label class="col-span-2 block text-sm font-medium text-slate-700 lg:col-span-1">
			Suche
			<input
				type="search"
				value={query.q}
				maxlength={SEARCH_MAX_LENGTH}
				placeholder={`Ab ${SEARCH_MIN_LENGTH} Zeichen`}
				oninput={(event) => update({ q: event.currentTarget.value })}
				class={controlClass}
			/>
		</label>
		<label class="block text-sm font-medium text-slate-700">
			Teilnehmer
			<select
				value={query.by ?? ''}
				onchange={(event) => update({ by: event.currentTarget.value || null })}
				class={controlClass}
			>
				<option value="">Alle</option>
				{#each options.people as person (person)}
					<option value={person}>{person}</option>
				{/each}
			</select>
		</label>
		<label class="block text-sm font-medium text-slate-700">
			Jahr
			<select
				value={query.year ?? ''}
				onchange={(event) => update({ year: event.currentTarget.value || null })}
				class={controlClass}
			>
				<option value="">Alle</option>
				{#each options.years as year (year)}
					<option value={year}>{year}</option>
				{/each}
			</select>
		</label>

		<!-- The values in the tiles have no column heading to tap. -->
		<label class="block text-sm font-medium text-slate-700 lg:hidden">
			Sortieren nach
			<select
				value={query.sort}
				onchange={(event) => update({ sort: event.currentTarget.value as SortKey, dir: 'asc' })}
				class={controlClass}
			>
				{#each SORT_KEYS as key (key)}
					<option value={key}>{COLUMN_LABELS[key]}</option>
				{/each}
			</select>
		</label>
		<div class="flex items-end lg:hidden">
			<button
				type="button"
				onclick={() => update({ dir: query.dir === 'asc' ? 'desc' : 'asc' })}
				class="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50"
			>
				{#if query.dir === 'asc'}
					<ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
					Aufsteigend
				{:else}
					<ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
					Absteigend
				{/if}
			</button>
		</div>
	</div>

	<p class="text-sm text-slate-500" aria-live="polite">
		{shown.length === bottles.length
			? `${bottles.length} Flaschen`
			: `${shown.length} von ${bottles.length} Flaschen`}
	</p>

	<div class="rounded-xl border border-slate-200 bg-white">
		<!-- table-fixed ignores min-width: each width fits its heading, sort icon
		     included, on one line – also in DejaVu Sans (Linux, CI), the widest
		     usual system font. The whisky column takes the rest: about 110 px on a
		     320 px screen, 140 px at the start of lg. -->
		<table class="w-full table-fixed text-sm">
			<thead class="border-b border-slate-200">
				<tr>
					{@render heading('whisky', '')}
					{@render heading('date', 'w-24')}
					{@render heading('broughtBy', 'w-20 lg:w-44')}
					{@render heading('alias', 'hidden w-28 lg:table-cell')}
					{@render heading('bottler', 'hidden w-36 lg:table-cell')}
					{@render heading('age', 'hidden w-24 lg:table-cell')}
					{@render heading('abv', 'hidden w-28 lg:table-cell')}
					<th scope="col" class="hidden w-28 px-2 py-2 text-left font-semibold lg:table-cell">
						Links
					</th>
				</tr>
			</thead>
			{#each shown as bottle (bottle.number)}
				{@const cells = bottleCells(bottle)}
				{@const id = bottleAnchor(bottle.number)}
				<!-- One tbody per bottle: the anchor and the highlight cover row and tile. -->
				<tbody
					{id}
					class={[
						'scroll-mt-4 border-t border-slate-200 first-of-type:border-t-0',
						target === id && 'bg-slate-100'
					]}
				>
					<tr class="align-top">
						<td class="px-2 pt-3 pb-1 font-medium break-words hyphens-auto lg:pb-3">
							{cells.whisky}
						</td>
						<td class="px-2 pt-3 pb-1 whitespace-nowrap lg:pb-3">
							{#if bottle.slug}
								<a
									href={resolve('/tasting/[slug=tastingSlug]', { slug: bottle.slug })}
									class="text-brand underline hover:text-brand-hover"
								>
									{cells.date}
								</a>
							{:else}
								{cells.date}
							{/if}
						</td>
						<td class="px-2 pt-3 pb-1 break-words lg:pb-3">{cells.broughtBy}</td>
						{#each DETAIL_COLUMNS as key (key)}
							<td class="hidden px-2 py-3 break-words lg:table-cell">{cells[key]}</td>
						{/each}
						<td class="hidden px-2 py-1.5 lg:table-cell">
							<div class="flex flex-col items-start">{@render links(bottle)}</div>
						</td>
					</tr>
					<tr class="lg:hidden">
						<td colspan={MAIN_COLUMNS.length} class="px-2 pb-3">
							<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-slate-600">
								{#each DETAIL_COLUMNS as key (key)}
									<dt class="text-slate-500">{COLUMN_LABELS[key]}</dt>
									<dd class="break-words">{cells[key]}</dd>
								{/each}
								{#if bottle.whiskybaseUrl || (bottle.presentation && bottle.slug)}
									<dt class="self-center text-slate-500">Links</dt>
									<dd class="flex flex-wrap gap-x-3">{@render links(bottle)}</dd>
								{/if}
							</dl>
						</td>
					</tr>
				</tbody>
			{/each}
		</table>
		{#if shown.length === 0}
			<!-- Outside the table: a cell spanning all eight columns would add five
			     empty columns below lg and squeeze the whisky column. -->
			<p class="px-2 py-6 text-center text-sm text-slate-500">Keine Flasche gefunden.</p>
		{/if}
	</div>
</section>
