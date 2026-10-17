<script lang="ts">
	import { ArrowDown, ArrowUp, ArrowUpDown, CircleAlert } from '@lucide/svelte';
	import { tick } from 'svelte';
	import { MediaQuery } from 'svelte/reactivity';
	import { enhance } from '$app/forms';
	import type { SubmitFunction } from '@sveltejs/kit';
	import ResearchPromptEditor from '$lib/components/ResearchPromptEditor.svelte';
	import { countryCode } from '$lib/countries';
	import { confirmDialog } from '$lib/components/confirmDialogStore.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import {
		BOTTLING_TOO_LONG,
		DISTILLERY_COLUMN_LABELS,
		DISTILLERY_SORT_KEYS,
		formatUsd,
		previewRename,
		renameMessage,
		sortDistilleries,
		VARIANT_KIND_LABELS,
		type DistillerySortKey,
		type RenameKind,
		type RenamePreview
	} from '$lib/distilleryTable';
	import type { SortDirection } from '$lib/historyTable';
	import {
		formatCapacity,
		formatCount,
		formatInteger,
		type AdminDistillery,
		type DistilleryFact,
		type DistilleryVariantSuggestion
	} from '$lib/tasting';
	import {
		DISTILLERY_CAPACITY,
		DISTILLERY_COUNTRY_LENGTH,
		isHttpUrl,
		SCOTLAND,
		SCOTTISH_REGIONS,
		TASTING_BOTTLING_LENGTH,
		TASTING_DISTILLERY_LENGTH
	} from '$lib/validation';

	type FieldErrors = {
		country: string | null;
		region: string | null;
		capacity: string | null;
		name: string | null;
		prefix: string | null;
	};

	let {
		distilleries,
		costMicroUsd,
		prompt,
		suggestions = [],
		searchRunning = false,
		editErrors = null,
		promptError = null
	}: {
		/** Only distilleries of revealed tastings (see getAdminDistilleries). */
		distilleries: AdminDistillery[];
		/** All calls so far – research and variant search –, the hidden distilleries included. */
		costMicroUsd: number;
		prompt: { text: string; custom: boolean };
		/** Open suggestions of the variant search. */
		suggestions?: DistilleryVariantSuggestion[];
		/** A variant search is going on (maybe from before a reload). */
		searchRunning?: boolean;
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
	let editName = $state('');
	let withPrefix = $state(false);
	let editPrefix = $state('');
	let editCountry = $state('');
	let editRegion = $state('');
	let editCapacity = $state('');
	let nameInput = $state<HTMLInputElement>();

	/** Opens the edit of a row, from a suggestion with its target and brand prefix. */
	function edit(
		distillery: AdminDistillery,
		preset: { name: string; prefix: string | null } | null = null
	) {
		editingKey = distillery.key;
		editName = preset?.name ?? distillery.name;
		withPrefix = (preset?.prefix ?? null) !== null;
		// The old name, changeable: "Bunnahabhain Stoisha" becomes "Stoisha".
		editPrefix = preset?.prefix ?? distillery.name;
		editCountry = distillery.country.value ?? '';
		editRegion = distillery.region?.value ?? '';
		editCapacity = distillery.capacity.value === null ? '' : String(distillery.capacity.value);
	}

	// "Übernehmen": the row may be anywhere in the table – focusing scrolls to it.
	async function take(suggestion: DistilleryVariantSuggestion) {
		const distillery = distilleries.find((d) => d.key === suggestion.variantKey);
		if (!distillery) return;
		edit(distillery, { name: suggestion.targetName, prefix: suggestion.prefix });
		await tick();
		nameInput?.focus();
	}

	const RENAMED: Record<Exclude<RenameKind, 'unchanged'>, string> = {
		renamed: 'Destillerie umbenannt',
		merged: 'Destillerien zusammengeführt',
		placeholder: 'Als Platzhalter eingetragen',
		respelled: 'Flaschen geändert'
	};

	// The same form saves the values (updateDistillery) or, with another name or
	// a brand prefix, renames (renameDistillery) – see previewRename.
	const submitEdit: SubmitFunction = () => {
		return async ({ update, result }) => {
			await update({ reset: false });
			if (result.type !== 'success') return;
			editingKey = null;
			const renamed = result.data?.renamed as Exclude<RenameKind, 'unchanged'> | undefined;
			toast.show(
				'success',
				renamed
					? `${RENAMED[renamed]} (${formatCount(Number(result.data?.bottles), 'Flasche', 'Flaschen')}).`
					: 'Werte gespeichert.'
			);
		};
	};

	// Never without the admin's confirmation, and not with a bottling too long
	// (the error shows at the prefix field) or a field the browser rejects.
	function confirmRename(event: MouseEvent, distillery: AdminDistillery, preview: RenamePreview) {
		const form = (event.currentTarget as HTMLElement).closest('form');
		if (preview.tooLong || !form?.reportValidity()) return;
		confirmDialog.submit(event, renameMessage(distillery, preview), {
			details: preview.bottleNames,
			variant: 'danger',
			confirmLabel: preview.kind === 'merged' ? 'Zusammenführen' : 'Umbenennen'
		});
	}

	let searching = $state(false);

	// Waits for Claude; failures come as a toast from the page (form.userMessage).
	const submitSearch: SubmitFunction = () => {
		searching = true;
		return async ({ update, result }) => {
			await update({ reset: false });
			searching = false;
			if (result.type !== 'success') return;
			const added = Number(result.data?.added);
			if (added > 0) {
				toast.show('success', `${formatCount(added, 'neuer Vorschlag', 'neue Vorschläge')}.`);
			} else toast.show('info', 'Keine neuen Vorschläge.');
		};
	};

	const submitReject: SubmitFunction = () => {
		return async ({ update, result }) => {
			await update({ reset: false });
			if (result.type === 'success') toast.show('success', 'Vorschlag verworfen.');
		};
	};

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
	const saveClass =
		'min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover';
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

<!-- A known country the world map has no code for counts for no country
     there nor in the statistics: corrected with the edit, or a synonym in
     src/lib/countries.ts. -->
{#snippet country(d: AdminDistillery)}
	{@render fact(d.country, d.country.value ?? '')}
	{#if d.country.value !== null && countryCode(d.country.value) === null}
		<span class="mt-1 flex items-start gap-1 text-xs font-medium text-red-700">
			<CircleAlert size={14} strokeWidth={2} class="mt-px shrink-0" aria-hidden="true" />
			Land unbekannt – auf der Karte nicht sichtbar
		</span>
	{/if}
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
	{@const preview = previewRename(distilleries, d, editName, withPrefix ? editPrefix : null)}
	{@const prefixError = errors?.prefix ?? (preview.tooLong ? BOTTLING_TOO_LONG : null)}
	<form
		method="POST"
		action={preview.kind === 'unchanged' ? '?/updateDistillery' : '?/renameDistillery'}
		use:enhance={submitEdit}
		class="space-y-3"
	>
		<input type="hidden" name="key" value={d.key} />
		<div class="space-y-2">
			<label class="block text-sm font-medium text-slate-700">
				Name
				<input
					bind:this={nameInput}
					name="name"
					bind:value={editName}
					required
					maxlength={TASTING_DISTILLERY_LENGTH.max}
					list="distillery-name-options"
					class={controlClass}
				/>
				{#if errors?.name}
					<span class="text-xs text-red-600">{errors.name}</span>
				{/if}
			</label>
			<label class="flex min-h-11 items-center gap-2 text-sm text-slate-700">
				<input
					type="checkbox"
					name="withPrefix"
					bind:checked={withPrefix}
					class="h-4 w-4 rounded border-slate-300"
				/>
				Alten Namen als Marke in die Abfüllung übernehmen
			</label>
			{#if withPrefix}
				<label class="block text-sm font-medium text-slate-700">
					Präfix der Abfüllung
					<input
						name="prefix"
						bind:value={editPrefix}
						required
						maxlength={TASTING_BOTTLING_LENGTH.max}
						class={controlClass}
					/>
					{#if prefixError}
						<span class="text-xs text-red-600">{prefixError}</span>
					{/if}
				</label>
			{/if}
			<p class="text-xs text-slate-500">
				Ein anderer Name gilt für alle Flaschen aufgelöster Tastings. Gibt es ihn schon, werden
				beide Destillerien zusammengeführt.
			</p>
		</div>
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
			{#if preview.kind === 'unchanged'}
				<button type="submit" class={saveClass}>Speichern</button>
			{:else}
				<button
					type="button"
					onclick={(event) => confirmRename(event, d, preview)}
					class={saveClass}
				>
					Speichern
				</button>
			{/if}
			<button type="button" onclick={() => (editingKey = null)} class={buttonClass}>
				Abbrechen
			</button>
		</div>
	</form>
{/snippet}

{#snippet variants()}
	<div class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
		<div class="flex flex-wrap items-start justify-between gap-3">
			<div class="min-w-0 flex-1 space-y-1">
				<h3 class="font-medium">Schreibvarianten</h3>
				<p class="text-xs text-slate-500">
					Claude sucht unter den Namen nach Schreibvarianten und Marken. Zusammengeführt wird nur,
					was du bestätigst.
				</p>
			</div>
			<form method="POST" action="?/suggestVariants" use:enhance={submitSearch}>
				<button
					type="submit"
					disabled={searching || searchRunning}
					class="{buttonClass} disabled:cursor-not-allowed disabled:opacity-40"
				>
					{searching || searchRunning ? 'Suche läuft …' : 'Varianten suchen'}
				</button>
			</form>
		</div>
		{#if suggestions.length > 0}
			<ul class="divide-y divide-slate-200 border-t border-slate-200" aria-label="Vorschläge">
				{#each suggestions as suggestion (suggestion.id)}
					{@const pair = `${suggestion.variantName} → ${suggestion.targetName}`}
					<li class="flex flex-wrap items-center justify-between gap-2 py-3 last:pb-0">
						<div class="min-w-0 flex-1 text-sm">
							<p class="font-medium break-words">{pair}</p>
							<p class="text-xs text-slate-500">
								{[
									VARIANT_KIND_LABELS[suggestion.kind],
									suggestion.prefix && `Präfix „${suggestion.prefix}“`,
									formatCount(suggestion.bottles, 'Flasche', 'Flaschen')
								]
									.filter(Boolean)
									.join(' · ')}
							</p>
						</div>
						<div class="flex gap-2">
							<button
								type="button"
								onclick={() => take(suggestion)}
								aria-label="{pair} übernehmen"
								class={buttonClass}
							>
								Übernehmen
							</button>
							<form method="POST" action="?/rejectVariant" use:enhance={submitReject}>
								<input type="hidden" name="id" value={suggestion.id} />
								<button type="submit" aria-label="{pair} verwerfen" class={buttonClass}>
									Verwerfen
								</button>
							</form>
						</div>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
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
		{@render variants()}

		<!-- The names of the table for the name field of the edit: merging without typos. -->
		<datalist id="distillery-name-options">
			{#each distilleries as d (d.key)}
				<option value={d.name}></option>
			{/each}
		</datalist>

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
