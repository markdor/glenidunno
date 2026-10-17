<script lang="ts">
	import { ArrowDown, ArrowUp, ArrowUpDown } from '@lucide/svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import ResearchPromptEditor from '$lib/components/ResearchPromptEditor.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import {
		DISTILLERY_COLUMN_LABELS,
		DISTILLERY_SORT_KEYS,
		formatUsd,
		sortDistilleries,
		type DistillerySortKey
	} from '$lib/distilleryTable';
	import type { SortDirection } from '$lib/historyTable';
	import {
		formatCapacity,
		formatInteger,
		type AdminDistillery,
		type DistilleryFact
	} from '$lib/tasting';
	import {
		DISTILLERY_CAPACITY,
		DISTILLERY_COUNTRY_LENGTH,
		isHttpUrl,
		SCOTLAND,
		SCOTTISH_REGIONS
	} from '$lib/validation';

	type FieldErrors = { country: string | null; region: string | null; capacity: string | null };

	let {
		distilleries,
		costMicroUsd,
		prompt,
		editErrors = null,
		promptError = null
	}: {
		/** Only distilleries of revealed tastings (see getAdminDistilleries). */
		distilleries: AdminDistillery[];
		/** All research calls so far, the hidden distilleries included. */
		costMicroUsd: number;
		prompt: { text: string; custom: boolean };
		/** Field errors of the last failed edit and the row it belongs to. */
		editErrors?: ({ key: string } & FieldErrors) | null;
		promptError?: string | null;
	} = $props();

	// Local state, not the query string: the admin page has no table to share.
	let sort = $state<DistillerySortKey>('name');
	let dir = $state<SortDirection>('asc');
	const shown = $derived(sortDistilleries(distilleries, sort, dir));

	function sortBy(key: DistillerySortKey) {
		if (key === sort) dir = dir === 'asc' ? 'desc' : 'asc';
		else {
			sort = key;
			dir = 'asc';
		}
	}

	function ariaSort(key: DistillerySortKey) {
		if (key !== sort) return undefined;
		return dir === 'asc' ? 'ascending' : 'descending';
	}

	// Inline editing of one row, like the user list (editingId).
	let editingKey = $state<string | null>(null);
	let editCountry = $state('');
	let editRegion = $state('');
	let editCapacity = $state('');

	function edit(distillery: AdminDistillery) {
		editingKey = distillery.key;
		editCountry = distillery.country.value ?? '';
		editRegion = distillery.region?.value ?? '';
		editCapacity = distillery.capacity.value === null ? '' : String(distillery.capacity.value);
	}

	function errorsFor(key: string): FieldErrors | null {
		return editErrors?.key === key ? editErrors : null;
	}

	const STATE_TEXT = { pending: 'noch nicht recherchiert', empty: 'nicht gefunden' } as const;

	// Below lg only name and country are columns, the rest goes to the tile
	// below the row. A cell spanning all six columns there would add four empty
	// ones and squeeze the name (see HistoryBottleTable), so the edit row spans
	// what is shown. Tailwind's lg breakpoint.
	const MAIN_COLUMNS = 2;
	const ALL_COLUMNS = 6;
	const wide = new MediaQuery('min-width: 64rem', false);

	const controlClass =
		'mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base focus:border-brand focus:ring-1 focus:ring-brand focus:outline-none disabled:bg-slate-100 disabled:text-slate-400';
	const buttonClass =
		'min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
</script>

{#snippet sortIcon(key: DistillerySortKey)}
	{#if key !== sort}
		<ArrowUpDown size={16} strokeWidth={2} class="shrink-0 text-slate-400" aria-hidden="true" />
	{:else if dir === 'asc'}
		<ArrowUp size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />
	{:else}
		<ArrowDown size={16} strokeWidth={2} class="shrink-0" aria-hidden="true" />
	{/if}
{/snippet}

{#snippet heading(key: DistillerySortKey, extraClass: string)}
	<th scope="col" aria-sort={ariaSort(key)} class={['p-0 text-left align-bottom', extraClass]}>
		<button
			type="button"
			onclick={() => sortBy(key)}
			class="flex min-h-11 w-full items-center gap-1 px-2 py-2 text-left font-semibold hover:bg-slate-100"
		>
			<span class="min-w-0 break-words">{DISTILLERY_COLUMN_LABELS[key]}</span>
			{@render sortIcon(key)}
		</button>
	</th>
{/snippet}

<!-- A value with its state: never researched and not found in slate-400, a
     researched value links its source, an admin's value says so. -->
{#snippet fact(value: DistilleryFact<unknown>, label: string)}
	{#if value.state === 'pending' || value.state === 'empty'}
		<span class="text-slate-400">{STATE_TEXT[value.state]}</span>
	{:else if value.state === 'found' && value.source && isHttpUrl(value.source)}
		<!-- rel="external": required by svelte/no-navigation-without-resolve for
		     a dynamic external href (also makes SvelteKit skip client routing). -->
		<a
			href={value.source}
			target="_blank"
			rel="external noopener noreferrer"
			class="text-brand underline hover:text-brand-hover"
		>
			{label} <span class="sr-only">(Quelle)</span>
		</a>
	{:else}
		{label}
		{#if value.state === 'admin'}
			<span class="text-xs text-slate-500">(vom Admin gesetzt)</span>
		{/if}
	{/if}
{/snippet}

{#snippet country(d: AdminDistillery)}
	{@render fact(d.country, d.country.value ?? '')}
{/snippet}

<!-- Empty for any other country: there is no region, not even a state. -->
{#snippet region(d: AdminDistillery)}
	{#if d.region}
		{@render fact(d.region, d.region.value ?? '')}
	{/if}
{/snippet}

{#snippet capacity(d: AdminDistillery)}
	{@render fact(d.capacity, d.capacity.value === null ? '' : formatCapacity(d.capacity.value))}
{/snippet}

{#snippet editButton(d: AdminDistillery)}
	<button
		type="button"
		onclick={() => edit(d)}
		aria-label="{d.name} bearbeiten"
		class="min-h-11 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
	>
		Bearbeiten
	</button>
{/snippet}

{#snippet editForm(d: AdminDistillery)}
	{@const errors = errorsFor(d.key)}
	<form
		method="POST"
		action="?/updateDistillery"
		use:enhance={() => {
			return async ({ update, result }) => {
				await update({ reset: false });
				if (result.type === 'success') {
					editingKey = null;
					toast.show('success', 'Werte gespeichert.');
				}
			};
		}}
		class="space-y-3"
	>
		<input type="hidden" name="key" value={d.key} />
		<div class="grid gap-3 sm:grid-cols-3">
			<label class="block text-sm font-medium text-slate-700">
				Land
				<input
					name="country"
					bind:value={editCountry}
					maxlength={DISTILLERY_COUNTRY_LENGTH.max}
					class={controlClass}
				/>
				{#if errors?.country}
					<span class="text-xs text-red-600">{errors.country}</span>
				{/if}
			</label>
			<label class="block text-sm font-medium text-slate-700">
				Region
				<!-- Disabled fields aren't submitted: no region outside Scotland. -->
				<select
					name="region"
					bind:value={editRegion}
					disabled={editCountry.trim() !== SCOTLAND}
					class={controlClass}
				>
					<option value="">–</option>
					{#each SCOTTISH_REGIONS as option (option)}
						<option value={option}>{option}</option>
					{/each}
				</select>
				{#if errors?.region}
					<span class="text-xs text-red-600">{errors.region}</span>
				{/if}
			</label>
			<label class="block text-sm font-medium text-slate-700">
				Kapazität (l A/Jahr)
				<input
					name="capacity"
					inputmode="numeric"
					bind:value={editCapacity}
					placeholder={`höchstens ${formatInteger(DISTILLERY_CAPACITY.max)}`}
					class={controlClass}
				/>
				{#if errors?.capacity}
					<span class="text-xs text-red-600">{errors.capacity}</span>
				{/if}
			</label>
		</div>
		<p class="text-xs text-slate-500">
			Ein gesetzter Wert bleibt. Ein geleerter gilt als „nicht gefunden“: Der Job
			„Destillerie-Daten“ sucht ihn erneut, aber erst nach den noch nie recherchierten Werten.
		</p>
		<div class="flex gap-2">
			<button
				type="submit"
				class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
			>
				Speichern
			</button>
			<button type="button" onclick={() => (editingKey = null)} class={buttonClass}>
				Abbrechen
			</button>
		</div>
	</form>
{/snippet}

<section class="space-y-4" aria-labelledby="distilleries">
	<div class="space-y-1">
		<h2 id="distilleries" class="text-lg font-semibold">Destillerien</h2>
		<p class="text-sm text-slate-500">
			Land, Region und Kapazität, einmalig per Claude API recherchiert. Nur Destillerien aus
			aufgelösten Tastings.
		</p>
	</div>

	<p class="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-700">
		API-Kosten bisher: <strong class="font-semibold">{formatUsd(costMicroUsd)}</strong>
		<span class="block text-xs text-slate-500">
			Schätzung, maßgeblich ist die Abrechnung in der Anthropic Console.
		</span>
	</p>

	<ResearchPromptEditor {prompt} error={promptError} />

	{#if distilleries.length === 0}
		<p class="text-sm text-slate-500">Noch keine Destillerie aus einem aufgelösten Tasting.</p>
	{:else}
		<!-- The values in the tiles have no column heading to tap. -->
		<div class="grid grid-cols-2 gap-3 lg:hidden">
			<label class="block text-sm font-medium text-slate-700">
				Sortieren nach
				<select
					value={sort}
					onchange={(event) => {
						sort = event.currentTarget.value as DistillerySortKey;
						dir = 'asc';
					}}
					class={controlClass}
				>
					{#each DISTILLERY_SORT_KEYS as key (key)}
						<option value={key}>{DISTILLERY_COLUMN_LABELS[key]}</option>
					{/each}
				</select>
			</label>
			<div class="flex items-end">
				<button
					type="button"
					onclick={() => (dir = dir === 'asc' ? 'desc' : 'asc')}
					class="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-base font-medium text-slate-700 hover:bg-slate-50"
				>
					{#if dir === 'asc'}
						<ArrowUp size={16} strokeWidth={2} aria-hidden="true" />
						Aufsteigend
					{:else}
						<ArrowDown size={16} strokeWidth={2} aria-hidden="true" />
						Absteigend
					{/if}
				</button>
			</div>
		</div>

		<div class="rounded-xl border border-slate-200 bg-white">
			<table class="w-full table-fixed text-sm">
				<thead class="border-b border-slate-200">
					<tr>
						{@render heading('name', '')}
						{@render heading('country', 'w-32')}
						{@render heading('region', 'hidden w-28 lg:table-cell')}
						{@render heading('capacity', 'hidden w-36 lg:table-cell')}
						{@render heading('cost', 'hidden w-24 lg:table-cell')}
						<th scope="col" class="hidden w-32 lg:table-cell">
							<span class="sr-only">Aktion</span>
						</th>
					</tr>
				</thead>
				{#each shown as d (d.key)}
					<tbody class="border-t border-slate-200 first-of-type:border-t-0">
						<tr class="align-top">
							<td class="px-2 pt-3 pb-1 font-medium break-words hyphens-auto lg:pb-3">{d.name}</td>
							<td class="px-2 pt-3 pb-1 break-words lg:pb-3">{@render country(d)}</td>
							<td class="hidden px-2 py-3 break-words lg:table-cell">{@render region(d)}</td>
							<td class="hidden px-2 py-3 break-words lg:table-cell">{@render capacity(d)}</td>
							<td class="hidden px-2 py-3 whitespace-nowrap lg:table-cell">
								{formatUsd(d.costMicroUsd)}
							</td>
							<td class="hidden px-2 py-1.5 lg:table-cell">
								{#if editingKey !== d.key}{@render editButton(d)}{/if}
							</td>
						</tr>
						<tr class="lg:hidden">
							<td colspan={MAIN_COLUMNS} class="px-2 pb-3">
								<dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-slate-600">
									{#if d.region}
										<dt class="text-slate-500">{DISTILLERY_COLUMN_LABELS.region}</dt>
										<dd class="break-words">{@render region(d)}</dd>
									{/if}
									<dt class="text-slate-500">{DISTILLERY_COLUMN_LABELS.capacity}</dt>
									<dd class="break-words">{@render capacity(d)}</dd>
									<dt class="text-slate-500">{DISTILLERY_COLUMN_LABELS.cost}</dt>
									<dd>{formatUsd(d.costMicroUsd)}</dd>
								</dl>
								{#if editingKey !== d.key}
									<div class="mt-2">{@render editButton(d)}</div>
								{/if}
							</td>
						</tr>
						{#if editingKey === d.key}
							<tr>
								<td colspan={wide.current ? ALL_COLUMNS : MAIN_COLUMNS} class="px-2 pb-4">
									{@render editForm(d)}
								</td>
							</tr>
						{/if}
					</tbody>
				{/each}
			</table>
		</div>
	{/if}
</section>
