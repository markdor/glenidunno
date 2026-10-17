<script lang="ts">
	import { enhance } from '$app/forms';
	import { confirmDialog } from '$lib/components/confirmDialogStore.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import { DISTILLERY_PROMPT_LENGTH } from '$lib/validation';

	let {
		prompt,
		error = null
	}: {
		/** The rules in effect: the admin's deviation or the default of the code. */
		prompt: { text: string; custom: boolean };
		/** Text of a field error of the last save, if any. */
		error?: string | null;
	} = $props();

	let editing = $state(false);
	let text = $state('');

	function edit() {
		text = prompt.text;
		editing = true;
	}

	function confirmReset(event: MouseEvent) {
		void confirmDialog.submit(
			event,
			'Den Recherche-Prompt auf den Standard zurücksetzen? Deine Änderungen gehen verloren.',
			{ confirmLabel: 'Zurücksetzen' }
		);
	}

	const buttonClass =
		'min-h-11 rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
</script>

<details class="rounded-xl border border-slate-200 bg-white">
	<summary class="flex min-h-11 cursor-pointer items-center gap-2 px-4 py-2 font-medium">
		Recherche-Prompt
		{#if prompt.custom}
			<span class="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
				Angepasst
			</span>
		{/if}
	</summary>
	<div class="space-y-3 border-t border-slate-200 p-4">
		{#if prompt.custom}
			<p class="rounded-lg bg-sky-50 px-3 py-2 text-sm text-sky-900">
				Der Prompt weicht vom Standard ab. Verbesserungen am Standard kommen erst nach dem
				Zurücksetzen an.
			</p>
		{/if}
		<p class="text-sm text-slate-500">
			Bearbeitbar sind nur die Fachregeln. Belegpflicht, Quellen-Stufen und das Ergebnisformat
			bleiben fest im Code. Eine Änderung wirkt nur auf künftige Recherchen, ermittelte Werte
			bleiben.
		</p>

		{#if editing}
			<form
				method="POST"
				action="?/saveResearchPrompt"
				use:enhance={() => {
					return async ({ update, result }) => {
						await update({ reset: false });
						if (result.type === 'success') {
							editing = false;
							toast.show('success', 'Recherche-Prompt gespeichert.');
						}
					};
				}}
				class="space-y-3"
			>
				<label for="research-prompt" class="sr-only">Recherche-Prompt</label>
				<textarea
					id="research-prompt"
					name="prompt"
					rows="18"
					required
					maxlength={DISTILLERY_PROMPT_LENGTH.max}
					bind:value={text}
					class="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"></textarea>
				{#if error}
					<p class="text-xs text-red-600">{error}</p>
				{/if}
				<div class="flex flex-wrap gap-2">
					<button
						type="submit"
						class="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
					>
						Speichern
					</button>
					<button type="button" onclick={() => (editing = false)} class={buttonClass}>
						Abbrechen
					</button>
				</div>
			</form>
			{#if prompt.custom}
				<form
					method="POST"
					action="?/resetResearchPrompt"
					use:enhance={() => {
						return async ({ update, result }) => {
							await update();
							if (result.type === 'success') {
								editing = false;
								toast.show('success', 'Recherche-Prompt zurückgesetzt.');
							}
						};
					}}
				>
					<button type="button" onclick={confirmReset} class={buttonClass}>
						Auf Standard zurücksetzen
					</button>
				</form>
			{/if}
		{:else}
			<pre
				class="max-h-96 overflow-y-auto rounded-lg bg-slate-50 p-3 font-mono text-sm break-words whitespace-pre-wrap text-slate-700">{prompt.text}</pre>
			<button type="button" onclick={edit} class={buttonClass}>Bearbeiten</button>
		{/if}
	</div>
</details>
