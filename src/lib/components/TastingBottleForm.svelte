<script lang="ts">
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import {
		formatSmokeGroupRange,
		smokeGroup,
		SMOKE_GROUPS,
		type TastingBottle
	} from '$lib/tasting';
	import {
		TASTING_ABV,
		TASTING_AGE,
		TASTING_ALIAS_LENGTH,
		TASTING_BOTTLER_LENGTH,
		TASTING_BOTTLING_LENGTH,
		TASTING_DISTILLERY_LENGTH,
		TASTING_PRESENTATION_MAX_BYTES,
		TASTING_PRESENTATION_NAME_LENGTH,
		TASTING_SCALE,
		TASTING_WHISKYBASE_URL_LENGTH
	} from '$lib/validation';
	import { toast } from './toastStore.svelte';

	/** Result of the last save action, if it concerned this slot. */
	type SaveResult = {
		values?: Record<string, string>;
		fieldErrors?: Record<string, string>;
	} | null;

	let {
		slot,
		bottle,
		result = null
	}: {
		slot: number;
		bottle: (TastingBottle & { presentationName?: string | null }) | null;
		result?: SaveResult;
	} = $props();

	const MAX_PRESENTATION_MB = TASTING_PRESENTATION_MAX_BYTES / (1024 * 1024);

	// Uploads of up to 30 MB take a while on a phone: show that something happens.
	let saving = $state(false);

	type Scale = 'smoke' | 'cask' | 'value';

	// The smoke hint lists the smoke groups, e.g. "0 = ungetorft, 1–3 = rauchig, …".
	const smokeHint = SMOKE_GROUPS.map((g, i) => `${formatSmokeGroupRange(i + 1)} = ${g.label}`).join(
		', '
	);

	const scales: Array<{ field: Scale; label: string; hint: string }> = [
		{ field: 'smoke', label: 'Rauch', hint: smokeHint },
		{
			field: 'cask',
			label: 'Fass',
			hint: "0 = kaum Holz- oder Fasseinfluss, 5 = Sherry-Bombe wie Aberlour A'bunadh"
		},
		{ field: 'value', label: 'Kaliber', hint: '0 = Alltagsflasche, 5 = Highlight des Abends' }
	];

	// Text fields stay uncontrolled: after a save elsewhere on the page the data
	// reloads, and Svelte only touches an input whose bound value changed, so
	// unsaved edits on this card survive. The sliders need their value on
	// screen, so moves are tracked locally on top of the saved value.
	let moved = $state<Partial<Record<Scale, number>>>({});

	function initial(field: keyof TastingBottle): string {
		const sent = result?.values?.[field];
		if (sent !== undefined) return sent;
		const saved = bottle?.[field];
		return saved === null || saved === undefined ? '' : String(saved);
	}

	function scaleValue(field: Scale): number {
		return moved[field] ?? (Number(initial(field)) || 0);
	}

	const errorText: Record<string, string> = {
		required: 'Pflichtfeld',
		invalid: 'Ungültig',
		taken: 'Schon vergeben, bitte ein anderes Synonym wählen'
	};

	const invalidText: Record<string, string> = {
		age: `Ganze Jahre von ${TASTING_AGE.min} bis ${TASTING_AGE.max}`,
		abv: `${TASTING_ABV.min} bis ${TASTING_ABV.max} %, höchstens eine Nachkommastelle`,
		whiskybaseUrl: 'Nur https-Links auf whiskybase.com',
		presentation: `Höchstens ${MAX_PRESENTATION_MB} MB und ein Dateiname mit höchstens ${TASTING_PRESENTATION_NAME_LENGTH.max} Zeichen`
	};

	// Checked in the browser before a large file travels to the server, which
	// checks again (and would refuse the request as too large anyway).
	function checkPresentationSize(event: Event & { currentTarget: HTMLInputElement }) {
		const input = event.currentTarget;
		const file = input.files?.[0];
		input.setCustomValidity(
			file && file.size > TASTING_PRESENTATION_MAX_BYTES
				? `Die Datei ist größer als ${MAX_PRESENTATION_MB} MB.`
				: ''
		);
		input.reportValidity();
	}

	function fieldError(field: string): string | null {
		const code = result?.fieldErrors?.[field];
		if (!code) return null;
		return (code === 'invalid' && invalidText[field]) || errorText[code] || 'Ungültig';
	}

	const submit: SubmitFunction = () => {
		saving = true;
		return async ({ result: actionResult, update, formElement }) => {
			saving = false;
			// reset: false – a reset would restore the stale server-rendered values.
			await update({ reset: false });
			if (actionResult.type === 'success') {
				// The upload is saved – don't send the same file again next time.
				const fileInput = formElement.querySelector<HTMLInputElement>('input[type="file"]');
				if (fileInput) fileInput.value = '';
				toast.show('success', `Flasche ${slot} gespeichert.`);
			} else if (actionResult.type === 'failure' && actionResult.data?.reload) {
				// The entry phase ended while the page was open: the error toast
				// comes from the page, reloading switches it to the pouring order.
				await invalidateAll();
			}
		};
	};

	const id = (field: string) => `b${slot}-${field}`;
	const inputClass =
		'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400';
</script>

<form
	method="POST"
	action="?/save"
	enctype="multipart/form-data"
	use:enhance={submit}
	aria-labelledby={id('title')}
	class="space-y-4 rounded-xl border border-slate-200 bg-white p-4"
>
	<h2 id={id('title')} class="text-lg font-semibold">Flasche {slot}</h2>
	<input type="hidden" name="slot" value={slot} />

	<div class="space-y-1">
		<label for={id('alias')} class="block text-sm font-medium text-slate-700">Synonym *</label>
		<input
			id={id('alias')}
			name="alias"
			required
			maxlength={TASTING_ALIAS_LENGTH.max}
			value={initial('alias')}
			aria-describedby={id('alias-hint')}
			class={inputClass}
		/>
		<p id={id('alias-hint')} class="text-xs text-slate-500">
			Steht auf der verhüllten Flasche, alle anderen sehen nur das.
		</p>
		{#if fieldError('alias')}
			<p class="text-xs text-red-600">{fieldError('alias')}</p>
		{/if}
	</div>

	<div class="space-y-1">
		<label for={id('distillery')} class="block text-sm font-medium text-slate-700">
			Distillery *
		</label>
		<input
			id={id('distillery')}
			name="distillery"
			required
			maxlength={TASTING_DISTILLERY_LENGTH.max}
			value={initial('distillery')}
			class={inputClass}
		/>
		{#if fieldError('distillery')}
			<p class="text-xs text-red-600">{fieldError('distillery')}</p>
		{/if}
	</div>

	<div class="grid gap-4 sm:grid-cols-2">
		<div class="space-y-1">
			<label for={id('bottler')} class="block text-sm font-medium text-slate-700">Abfüller</label>
			<input
				id={id('bottler')}
				name="bottler"
				maxlength={TASTING_BOTTLER_LENGTH.max}
				value={initial('bottler')}
				aria-describedby={id('bottler-hint')}
				class={inputClass}
			/>
			<p id={id('bottler-hint')} class="text-xs text-slate-500">
				Leer lassen bei Originalabfüllung.
			</p>
			{#if fieldError('bottler')}
				<p class="text-xs text-red-600">{fieldError('bottler')}</p>
			{/if}
		</div>

		<div class="space-y-1">
			<label for={id('bottling')} class="block text-sm font-medium text-slate-700">Abfüllung</label>
			<input
				id={id('bottling')}
				name="bottling"
				maxlength={TASTING_BOTTLING_LENGTH.max}
				value={initial('bottling')}
				class={inputClass}
			/>
			{#if fieldError('bottling')}
				<p class="text-xs text-red-600">{fieldError('bottling')}</p>
			{/if}
		</div>

		<div class="space-y-1">
			<label for={id('age')} class="block text-sm font-medium text-slate-700">
				Alter in Jahren
			</label>
			<input
				id={id('age')}
				name="age"
				type="number"
				inputmode="numeric"
				min={TASTING_AGE.min}
				max={TASTING_AGE.max}
				step="1"
				value={initial('age')}
				aria-describedby={id('age-hint')}
				class={inputClass}
			/>
			<p id={id('age-hint')} class="text-xs text-slate-500">
				Leer lassen, wenn der Whisky keine Altersangabe hat (NAS).
			</p>
			{#if fieldError('age')}
				<p class="text-xs text-red-600">{fieldError('age')}</p>
			{/if}
		</div>

		<div class="space-y-1">
			<label for={id('abv')} class="block text-sm font-medium text-slate-700">Alkohol in % *</label>
			<input
				id={id('abv')}
				name="abv"
				type="number"
				inputmode="decimal"
				required
				min={TASTING_ABV.min}
				max={TASTING_ABV.max}
				step={TASTING_ABV.step}
				value={initial('abv')}
				class={inputClass}
			/>
			{#if fieldError('abv')}
				<p class="text-xs text-red-600">{fieldError('abv')}</p>
			{/if}
		</div>
	</div>

	<div class="space-y-1">
		<label for={id('whiskybaseUrl')} class="block text-sm font-medium text-slate-700">
			Whiskybase-Link
		</label>
		<input
			id={id('whiskybaseUrl')}
			name="whiskybaseUrl"
			type="url"
			inputmode="url"
			maxlength={TASTING_WHISKYBASE_URL_LENGTH.max}
			placeholder="https://www.whiskybase.com/…"
			value={initial('whiskybaseUrl')}
			class={inputClass}
		/>
		{#if fieldError('whiskybaseUrl')}
			<p class="text-xs text-red-600">{fieldError('whiskybaseUrl')}</p>
		{/if}
	</div>

	{#each scales as scale (scale.field)}
		<div class="space-y-1">
			<div class="flex items-baseline justify-between gap-3">
				<label for={id(scale.field)} class="text-sm font-medium text-slate-700">
					{scale.label} *
				</label>
				<output for={id(scale.field)} class="text-sm font-semibold text-slate-900">
					{scaleValue(scale.field)}
					{#if scale.field === 'smoke'}
						<!-- The group decides the pouring block, so show where the value lands. -->
						<span class="font-normal text-slate-500">
							· {SMOKE_GROUPS[smokeGroup(scaleValue('smoke')) - 1].label}
						</span>
					{/if}
				</output>
			</div>
			<input
				id={id(scale.field)}
				name={scale.field}
				type="range"
				min={TASTING_SCALE.min}
				max={TASTING_SCALE.max}
				step="1"
				value={scaleValue(scale.field)}
				oninput={(e) => (moved[scale.field] = e.currentTarget.valueAsNumber)}
				aria-describedby={id(`${scale.field}-hint`)}
				class="h-8 w-full accent-brand"
			/>
			<p id={id(`${scale.field}-hint`)} class="text-xs text-slate-500">{scale.hint}</p>
			{#if fieldError(scale.field)}
				<p class="text-xs text-red-600">{fieldError(scale.field)}</p>
			{/if}
		</div>
	{/each}

	<div class="space-y-1">
		<label for={id('presentation')} class="block text-sm font-medium text-slate-700">
			Präsentation
		</label>
		<input
			id={id('presentation')}
			name="presentation"
			type="file"
			onchange={checkPresentationSize}
			aria-describedby={id('presentation-hint')}
			class="block w-full text-sm text-slate-700 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-sm file:font-medium file:text-slate-700"
		/>
		<p id={id('presentation-hint')} class="text-xs text-slate-500">
			Optional, z. B. PowerPoint, höchstens {MAX_PRESENTATION_MB} MB. Alle sehen sie erst bei der Auflösung.
		</p>
		{#if bottle?.presentationName}
			<p class="text-sm break-all text-slate-700">Hochgeladen: {bottle.presentationName}</p>
			<label class="flex items-center gap-2 py-1 text-sm text-slate-700">
				<input name="removePresentation" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
				Präsentation entfernen
			</label>
		{/if}
		{#if fieldError('presentation')}
			<p class="text-xs text-red-600">{fieldError('presentation')}</p>
		{/if}
	</div>

	<button
		type="submit"
		disabled={saving}
		class="w-full rounded-lg bg-brand px-4 py-3 text-base font-medium text-white hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
	>
		{saving ? 'Wird gespeichert …' : `Flasche ${slot} speichern`}
	</button>
</form>
