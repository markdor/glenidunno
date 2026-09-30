<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import TastingLinkList from '$lib/components/TastingLinkList.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import {
		TASTING_BOTTLES_PER_PARTICIPANT,
		TASTING_NAME_LENGTH,
		TASTING_PARTICIPANT_NAME_LENGTH,
		TASTING_PARTICIPANTS
	} from '$lib/validation';

	let { data, form } = $props();

	let fieldCount = $state<number>(TASTING_PARTICIPANTS.default);
	// After a failed submit keep every field that was sent, including extra ones.
	const sentParticipants = $derived(form?.values?.participants ?? []);
	const shownFields = $derived(Math.max(fieldCount, sentParticipants.length));

	$effect(() => {
		if (form?.userMessage) {
			// untrack: see login/+page.svelte for why this is needed around toast.show().
			untrack(() => toast.show('error', form.userMessage as string));
		}
	});

	const errorText: Record<string, string> = {
		required: 'Pflichtfeld',
		invalid: 'Ungültig',
		taken: 'Bereits vergeben'
	};

	function fieldError(field: string): string | null {
		const code = form?.fieldErrors?.[field];
		return code ? (errorText[code] ?? 'Ungültig') : null;
	}

	const inputClass =
		'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900';
</script>

<svelte:head>
	<title>Neues Tasting · Glen Idunno</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<SubHeader
		backHref={resolve('/admin/tastings')}
		backLabel="Alle Tastings"
		title="Neues Tasting"
	/>

	{#if form?.created}
		<section class="space-y-4">
			<h2 class="text-lg font-semibold">Tasting angelegt</h2>
			<TastingLinkList links={form.created.links} />
			<a
				href={resolve('/admin/tastings/[id]', { id: form.created.tastingId })}
				class="inline-block rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
			>
				Zum Tasting
			</a>
		</section>
	{:else}
		<form
			method="POST"
			action="?/create"
			use:enhance
			class="space-y-5 rounded-xl border border-slate-200 bg-white p-4"
		>
			<div class="space-y-1">
				<label for="t-name" class="block text-sm font-medium text-slate-700">Name *</label>
				<input
					id="t-name"
					name="name"
					required
					maxlength={TASTING_NAME_LENGTH.max}
					placeholder="z. B. Herbst-Tasting"
					value={form?.values?.name ?? ''}
					class="{inputClass} placeholder:text-slate-400"
				/>
				{#if fieldError('name')}
					<p class="text-xs text-red-600">{fieldError('name')}</p>
				{/if}
			</div>

			<div class="grid gap-5 sm:grid-cols-2">
				<div class="space-y-1">
					<label for="t-date" class="block text-sm font-medium text-slate-700">Datum *</label>
					<input
						id="t-date"
						name="tastingDate"
						type="date"
						required
						min={data.today}
						value={form?.values?.tastingDate ?? ''}
						class={inputClass}
					/>
					{#if fieldError('tastingDate')}
						<p class="text-xs text-red-600">{fieldError('tastingDate')}</p>
					{/if}
				</div>
				<div class="space-y-1">
					<label for="t-bottles" class="block text-sm font-medium text-slate-700">
						Flaschen pro Person *
					</label>
					<input
						id="t-bottles"
						name="bottlesPerParticipant"
						type="number"
						inputmode="numeric"
						required
						min={TASTING_BOTTLES_PER_PARTICIPANT.min}
						max={TASTING_BOTTLES_PER_PARTICIPANT.max}
						value={form?.values?.bottlesPerParticipant ?? TASTING_BOTTLES_PER_PARTICIPANT.default}
						class={inputClass}
					/>
					{#if fieldError('bottlesPerParticipant')}
						<p class="text-xs text-red-600">{fieldError('bottlesPerParticipant')}</p>
					{/if}
				</div>
			</div>

			<fieldset class="space-y-2">
				<legend class="text-sm font-medium text-slate-700">Teilnehmer *</legend>
				<p class="text-xs text-slate-500">
					{TASTING_PARTICIPANTS.min} bis {TASTING_PARTICIPANTS.max} Personen, dich selbst eingeschlossen.
					Leere Felder werden ignoriert.
				</p>
				{#each Array.from({ length: shownFields }) as _, i (i)}
					<input
						name="participant"
						aria-label={`Teilnehmer ${i + 1}`}
						maxlength={TASTING_PARTICIPANT_NAME_LENGTH.max}
						value={sentParticipants[i] ?? ''}
						class={inputClass}
					/>
				{/each}
				{#if fieldError('participants')}
					<p class="text-xs text-red-600">{fieldError('participants')}</p>
				{/if}
				{#if shownFields < TASTING_PARTICIPANTS.max}
					<button
						type="button"
						onclick={() => (fieldCount = shownFields + 1)}
						class="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						Teilnehmer hinzufügen
					</button>
				{/if}
			</fieldset>

			<button
				type="submit"
				class="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
			>
				Tasting anlegen
			</button>
		</form>
	{/if}
</div>
