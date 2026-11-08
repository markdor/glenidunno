<script lang="ts">
	import {
		CASK_GROUPS,
		CASKS,
		isRefillable,
		PEAT_LEVELS,
		type BottleFacts,
		type Cask,
		type Finish
	} from '$lib/tastingFacts';
	import {
		isCaskType,
		TASTING_CASK_INFLUENCE,
		TASTING_CASK_LABEL_LENGTH,
		TASTING_CASK_TYPES,
		TASTING_FINISH_MONTHS,
		TASTING_PRICE
	} from '$lib/validation';

	// The facts of a bottle in a `facts` tasting – what label and shop say –
	// instead of the sliders, inside the save form of TastingBottleForm. The
	// field names are the ones the save action reads (FACTS_FIELDS in
	// $lib/server/bottleForm.ts). A component of its own, so facts can be
	// entered elsewhere later (backtest).

	let {
		slot,
		facts,
		values = null,
		fieldError
	}: {
		slot: number;
		/** The saved facts, `null` for a new bottle. */
		facts: BottleFacts | null;
		/** The fields of a failed save, shown again instead of the saved ones. */
		values?: Record<string, string> | null;
		fieldError: (field: string) => string | null;
	} = $props();

	type Prefix = 'mainCask' | 'finish';

	function choice(cask: Cask | Finish): string {
		return cask.kind === 'known' ? cask.type : cask.kind;
	}

	/** A field's value as the form sends it: the sent value, the saved one or the default. */
	function initial(field: string): string {
		const sent = values?.[field];
		if (sent !== undefined) return sent;
		const saved = facts;
		if (!saved) return field === 'finish' ? 'none' : '';
		const caskOf = (prefix: Prefix) => (prefix === 'mainCask' ? saved.cask : saved.finish);
		switch (field) {
			case 'peat':
				return saved.peat;
			case 'priceUnknown':
				return saved.priceCents === null ? 'on' : '';
			case 'price':
				return saved.priceCents === null ? '' : String(saved.priceCents / 100);
			case 'finishMonths':
				return saved.finish.kind === 'known' || saved.finish.kind === 'other'
					? String(saved.finish.months ?? '')
					: '';
		}
		for (const prefix of ['mainCask', 'finish'] as const) {
			const cask = caskOf(prefix);
			if (field === prefix) return choice(cask);
			if (field === `${prefix}Refill`) return cask.kind === 'known' && cask.refill ? 'on' : '';
			if (field === `${prefix}Label`) return cask.kind === 'other' ? cask.label : '';
			if (field === `${prefix}Influence`)
				return cask.kind === 'other' ? String(cask.influence) : '';
		}
		return '';
	}

	// What decides which fields show is tracked locally on top of the saved
	// value, like the sliders' `moved` in TastingBottleForm.
	let picked = $state<Record<string, string>>({});
	const current = (field: string) => picked[field] ?? initial(field);
	const pick = (field: string, value: string) => (picked[field] = value);

	const priceUnknown = $derived(current('priceUnknown') === 'on');

	/** Influence of an other cask: the saved rating, "deutlich" for a new one. */
	const DEFAULT_INFLUENCE = 5;
	function influence(prefix: Prefix): number {
		const value = current(`${prefix}Influence`);
		return value === '' ? DEFAULT_INFLUENCE : Number(value);
	}

	const typesOf = (group: string) => TASTING_CASK_TYPES.filter((t) => CASKS[t].group === group);

	const id = (field: string) => `b${slot}-${field}`;
	const inputClass =
		'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 placeholder:text-slate-400';
</script>

<fieldset class="space-y-1">
	<legend class="text-sm font-medium text-slate-700">Torf *</legend>
	<div class="grid grid-cols-3 gap-2">
		{#each PEAT_LEVELS as level (level.key)}
			<label
				class="flex min-h-11 cursor-pointer items-center justify-center rounded-lg border border-slate-300 px-3 text-base font-medium text-slate-700 hover:bg-slate-50 has-[:checked]:border-brand has-[:checked]:bg-brand has-[:checked]:text-white has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand has-[:focus-visible]:ring-offset-1"
			>
				<input
					type="radio"
					name="peat"
					value={level.key}
					required
					checked={current('peat') === level.key}
					onchange={() => pick('peat', level.key)}
					aria-describedby={id('peat-hint')}
					class="sr-only"
				/>
				{level.answer}
			</label>
		{/each}
	</div>
	<p id={id('peat-hint')} class="text-xs text-slate-500">
		Wie Etikett oder Shop es angeben. Alles Getorfte kommt nach allem Ungetorften.
	</p>
	{#if fieldError('peat')}
		<p class="text-xs text-red-600">{fieldError('peat')}</p>
	{/if}
</fieldset>

{#snippet caskFields(prefix: Prefix, label: string)}
	{@const value = current(prefix)}
	<div class="space-y-2">
		<div class="space-y-1">
			<label for={id(prefix)} class="block text-sm font-medium text-slate-700">{label} *</label>
			<select
				id={id(prefix)}
				name={prefix}
				required
				{value}
				onchange={(event) => pick(prefix, event.currentTarget.value)}
				class={inputClass}
			>
				{#if prefix === 'mainCask'}
					<option value="" disabled>Bitte wählen</option>
				{:else}
					<option value="none">Keine</option>
				{/if}
				{#each CASK_GROUPS as group (group.key)}
					<optgroup label={group.label}>
						{#each typesOf(group.key) as type (type)}
							<option value={type}>{CASKS[type].label}</option>
						{/each}
					</optgroup>
				{/each}
				<option value="other">Sonstiges …</option>
				<option value="unknown">Unbekannt</option>
			</select>
			{#if fieldError(prefix)}
				<p class="text-xs text-red-600">{fieldError(prefix)}</p>
			{/if}
		</div>

		{#if isCaskType(value) && isRefillable(value)}
			<div class="space-y-1">
				<label class="flex min-h-11 items-center gap-2 text-sm text-slate-700">
					<input
						type="checkbox"
						name="{prefix}Refill"
						checked={current(`${prefix}Refill`) === 'on'}
						onchange={(event) => pick(`${prefix}Refill`, event.currentTarget.checked ? 'on' : '')}
						aria-describedby={id(`${prefix}Refill-hint`)}
						class="h-5 w-5 shrink-0 rounded border-slate-300"
					/>
					Refill
				</label>
				<p id={id(`${prefix}Refill-hint`)} class="text-xs text-slate-500">
					Ein Refill-Fass war schon mehrmals mit Whisky belegt und gibt weniger Aroma ab. Mit Haken
					rechnet die App mit weniger Fass-Einfluss. Nur ankreuzen, wenn Etikett oder Shop Refill
					nennen – wenn du es nicht weißt, frei lassen, dann gilt ein typisches Fass.
				</p>
				{#if fieldError(`${prefix}Refill`)}
					<p class="text-xs text-red-600">{fieldError(`${prefix}Refill`)}</p>
				{/if}
			</div>
		{:else if value === 'other'}
			<div class="space-y-1">
				<label for={id(`${prefix}Label`)} class="block text-sm font-medium text-slate-700">
					Bezeichnung *
				</label>
				<input
					id={id(`${prefix}Label`)}
					name="{prefix}Label"
					required
					maxlength={TASTING_CASK_LABEL_LENGTH.max}
					placeholder="z. B. Tequila"
					value={initial(`${prefix}Label`)}
					class={inputClass}
				/>
				{#if fieldError(`${prefix}Label`)}
					<p class="text-xs text-red-600">{fieldError(`${prefix}Label`)}</p>
				{/if}
			</div>
			<div class="space-y-1">
				<div class="flex items-baseline justify-between gap-3">
					<label for={id(`${prefix}Influence`)} class="text-sm font-medium text-slate-700">
						Fass-Einfluss *
					</label>
					<output for={id(`${prefix}Influence`)} class="text-sm font-semibold text-slate-900">
						{influence(prefix)}
					</output>
				</div>
				<input
					id={id(`${prefix}Influence`)}
					name="{prefix}Influence"
					type="range"
					min={TASTING_CASK_INFLUENCE.min}
					max={TASTING_CASK_INFLUENCE.max}
					step="1"
					value={influence(prefix)}
					oninput={(event) => pick(`${prefix}Influence`, event.currentTarget.value)}
					aria-describedby={id(`${prefix}Influence-hint`)}
					class="h-8 w-full accent-brand"
				/>
				<p id={id(`${prefix}Influence-hint`)} class="text-xs text-slate-500">
					2 = zart, 5 = deutlich, 8 = dominant. Zur Orientierung: Tequila/Calvados ≈ 4, Bier/Stout ≈
					5, Mizunara/Süßwein ≈ 6.
				</p>
				{#if fieldError(`${prefix}Influence`)}
					<p class="text-xs text-red-600">{fieldError(`${prefix}Influence`)}</p>
				{/if}
			</div>
		{:else if value === 'unknown'}
			<p class="text-xs text-slate-500">
				{prefix === 'mainCask'
					? 'Ohne Angabe rechnet die App mit einem Standardwert.'
					: 'Ohne Angabe rechnet die App wie ohne Nachreifung.'}
			</p>
		{/if}

		{#if prefix === 'finish' && (isCaskType(value) || value === 'other')}
			<div class="space-y-1">
				<label for={id('finishMonths')} class="block text-sm font-medium text-slate-700">
					Dauer in Monaten
				</label>
				<input
					id={id('finishMonths')}
					name="finishMonths"
					type="number"
					inputmode="numeric"
					min={TASTING_FINISH_MONTHS.min}
					max={TASTING_FINISH_MONTHS.max}
					step="1"
					value={initial('finishMonths')}
					aria-describedby={id('finishMonths-hint')}
					class={inputClass}
				/>
				<p id={id('finishMonths-hint')} class="text-xs text-slate-500">
					Leer lassen, wenn die Dauer unbekannt ist.
				</p>
				{#if fieldError('finishMonths')}
					<p class="text-xs text-red-600">{fieldError('finishMonths')}</p>
				{/if}
			</div>
		{/if}
	</div>
{/snippet}

{@render caskFields('mainCask', 'Hauptreifung')}
{@render caskFields('finish', 'Nachreifung')}

<div class="space-y-1">
	<label for={id('price')} class="block text-sm font-medium text-slate-700">
		Preis in €{priceUnknown ? '' : ' *'}
	</label>
	<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
		<input
			id={id('price')}
			name="price"
			type="number"
			inputmode="decimal"
			required={!priceUnknown}
			disabled={priceUnknown}
			min={TASTING_PRICE.min}
			max={TASTING_PRICE.max}
			step="0.01"
			value={initial('price')}
			aria-describedby={id('price-hint')}
			class="{inputClass} max-w-40 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
		/>
		<label class="flex min-h-11 items-center gap-2 text-sm text-slate-700">
			<input
				type="checkbox"
				name="priceUnknown"
				checked={priceUnknown}
				onchange={(event) => pick('priceUnknown', event.currentTarget.checked ? 'on' : '')}
				class="h-5 w-5 shrink-0 rounded border-slate-300"
			/>
			Preis unbekannt
		</label>
	</div>
	<p id={id('price-hint')} class="text-xs text-slate-500">
		Listenpreis pro 0,7 l ({TASTING_PRICE.min} bis {TASTING_PRICE.max} €), nicht der eigene Kaufpreis.
	</p>
	{#if fieldError('price')}
		<p class="text-xs text-red-600">{fieldError('price')}</p>
	{/if}
</div>
