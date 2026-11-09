<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import { TASTING_ALGORITHM_LABEL } from '$lib/tasting';
	import {
		TASTING_ALGORITHMS,
		TASTING_MOTTO_DESCRIPTION_LENGTH,
		TASTING_MOTTO_LENGTH,
		TASTING_PARTICIPANTS
	} from '$lib/validation';

	let { data, form } = $props();

	// After a failed submit the picked users stay ticked, the algorithm picked.
	const sentParticipants = $derived<string[]>(form?.values?.participants ?? []);
	const sentAlgorithm = $derived<string>(form?.values?.algorithm || 'taste');

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

	// A description only goes with a heading: its field stays disabled until one
	// is typed, and a disabled field isn't sent. The server checks it anyway.
	let motto = $derived(form?.values?.motto ?? '');

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
			<label for="t-motto" class="block text-sm font-medium text-slate-700">Motto</label>
			<input
				id="t-motto"
				name="motto"
				maxlength={TASTING_MOTTO_LENGTH.max}
				placeholder="optional, z. B. Islay gegen den Rest"
				aria-describedby="t-motto-hint"
				bind:value={motto}
				class="{inputClass} placeholder:text-slate-400"
			/>
			<p id="t-motto-hint" class="text-xs text-slate-500">
				Das Motto ist der Titel des Tastings. Ohne Motto heißt es nach seiner laufenden Nummer, z.
				B. „Tasting #18“.
			</p>
			{#if fieldError('motto')}
				<p class="text-xs text-red-600">{fieldError('motto')}</p>
			{/if}
		</div>

		<div class="space-y-1">
			<label for="t-motto-description" class="block text-sm font-medium text-slate-700">
				Erklärung
			</label>
			<textarea
				id="t-motto-description"
				name="mottoDescription"
				rows="4"
				maxlength={TASTING_MOTTO_DESCRIPTION_LENGTH.max}
				disabled={!motto.trim()}
				value={form?.values?.mottoDescription ?? ''}
				class="{inputClass} disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
			></textarea>
			{#if fieldError('mottoDescription')}
				<p class="text-xs text-red-600">{fieldError('mottoDescription')}</p>
			{/if}
		</div>

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

		<fieldset class="space-y-2">
			<legend class="text-sm font-medium text-slate-700">Reihenfolge nach *</legend>
			<p class="text-xs text-slate-500">Lässt sich nach dem Anlegen nicht mehr ändern.</p>
			<div class="grid gap-2 sm:grid-cols-2">
				{#each TASTING_ALGORITHMS as algorithm (algorithm)}
					<label
						class="flex min-h-14 cursor-pointer items-start gap-3 rounded-lg border border-slate-300 px-3 py-3 hover:bg-slate-50 has-[:checked]:border-brand has-[:checked]:bg-brand/5 has-[:checked]:ring-1 has-[:checked]:ring-brand"
					>
						<input
							type="radio"
							name="algorithm"
							value={algorithm}
							checked={sentAlgorithm === algorithm}
							class="mt-0.5 h-5 w-5 shrink-0 accent-brand"
						/>
						<span class="min-w-0">
							<span class="block text-base font-medium text-slate-900">
								{TASTING_ALGORITHM_LABEL[algorithm].label}
							</span>
							<span class="block text-sm text-slate-500">
								{TASTING_ALGORITHM_LABEL[algorithm].description}
							</span>
						</span>
					</label>
				{/each}
			</div>
			{#if fieldError('algorithm')}
				<p class="text-xs text-red-600">{fieldError('algorithm')}</p>
			{/if}
		</fieldset>

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
