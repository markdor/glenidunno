<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import {
		TASTING_BOTTLES_PER_PARTICIPANT,
		TASTING_MOTTO_LENGTH,
		TASTING_NAME_LENGTH,
		TASTING_PARTICIPANTS
	} from '$lib/validation';

	let { data, form } = $props();

	// After a failed submit the picked users stay ticked.
	const sentParticipants = $derived<string[]>(form?.values?.participants ?? []);

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

		<div class="space-y-1">
			<label for="t-motto" class="block text-sm font-medium text-slate-700">Motto</label>
			<input
				id="t-motto"
				name="motto"
				maxlength={TASTING_MOTTO_LENGTH.max}
				placeholder="optional, z. B. Islay gegen den Rest"
				value={form?.values?.motto ?? ''}
				class="{inputClass} placeholder:text-slate-400"
			/>
			{#if fieldError('motto')}
				<p class="text-xs text-red-600">{fieldError('motto')}</p>
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
				Wer fehlt, legst du vorher unter
				<a href={resolve('/admin')} class="font-medium text-brand underline hover:text-brand-hover"
					>Admin</a
				> an.
			</p>
			<ul class="divide-y divide-slate-200 rounded-lg border border-slate-300">
				{#each data.users as u (u.id)}
					<li>
						<label
							class="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 text-base text-slate-900 hover:bg-slate-50"
						>
							<input
								type="checkbox"
								name="participant"
								value={u.id}
								checked={sentParticipants.includes(u.id)}
								class="h-5 w-5 shrink-0 rounded border-slate-300"
							/>
							<span class="min-w-0 truncate">{u.username}</span>
						</label>
					</li>
				{/each}
			</ul>
			{#if fieldError('participants')}
				<p class="text-xs text-red-600">{fieldError('participants')}</p>
			{/if}
		</fieldset>

		<button
			type="submit"
			class="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
		>
			Tasting anlegen
		</button>
	</form>
</div>
