<script lang="ts">
	import { Copy, Share2, X } from '@lucide/svelte';
	import type { SubmitFunction } from '@sveltejs/kit';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';
	import type { OwnShare } from '$lib/tasting';
	import { confirmDialog } from './confirmDialogStore.svelte';
	import { toast } from './toastStore.svelte';

	// The share button of one of the user's own bottles after the reveal (issue
	// #58), with its popup: create the public link, copy it, revoke it. The
	// actions come from shareActions.ts, spread into every page that shows it.
	let { share, alias }: { share: OwnShare; alias: string } = $props();

	const uid = $props.id();
	let open = $state(false);
	let busy = $state(false);
	let dialogEl: HTMLDialogElement;
	let urlInput = $state<HTMLInputElement>();

	// Absolute, so it works outside the app. page.url.origin is the configured
	// ORIGIN (BASE_URL) behind the proxy.
	const url = $derived(
		share.token
			? new URL(resolve('/share/[token]', { token: share.token }), page.url.origin).href
			: null
	);

	// The one place that opens and closes the dialog, like ConfirmDialog.
	$effect(() => {
		if (open) {
			if (!dialogEl.open) dialogEl.showModal();
		} else if (dialogEl.open) {
			dialogEl.close();
		}
	});

	// Unmount safety: never leave a modal dialog open behind.
	$effect(() => () => {
		if (dialogEl?.open) dialogEl.close();
	});

	function onBackdropClick(event: MouseEvent) {
		if (event.target === dialogEl) open = false;
	}

	// Escape: close through the state, not natively.
	function onCancelEvent(event: Event) {
		event.preventDefault();
		open = false;
	}

	// Failures are shown here and not passed on to the page's `form`, which
	// some pages already turn into a toast – that would show it twice.
	function submit(success: string): SubmitFunction {
		return () => {
			busy = true;
			return async ({ result, update }) => {
				busy = false;
				if (result.type === 'failure') {
					const message = result.data?.userMessage;
					toast.show('error', typeof message === 'string' ? message : UNEXPECTED_ERROR_MESSAGE);
					return;
				}
				if (result.type === 'error') {
					toast.show('error', UNEXPECTED_ERROR_MESSAGE);
					return;
				}
				// The new state comes with the page's data, the popup stays open.
				await update({ reset: false });
				if (result.type === 'success') toast.show('success', success);
			};
		};
	}

	async function copy() {
		if (!url) return;
		try {
			// Missing outside a secure context – then the catch takes over.
			await navigator.clipboard.writeText(url);
			toast.show('success', 'Link kopiert.');
		} catch {
			urlInput?.select();
			toast.show('info', 'Kopieren nicht möglich. Markiere den Link und kopiere ihn selbst.');
		}
	}

	function revoke(event: MouseEvent) {
		confirmDialog.submit(
			event,
			`Link zu „${alias}“ widerrufen? Wer ihn kennt, sieht die Flasche danach nicht mehr. Ein neuer Link hat eine andere Adresse.`,
			{ variant: 'danger', confirmLabel: 'Widerrufen' }
		);
	}
</script>

<button
	type="button"
	onclick={() => (open = true)}
	aria-haspopup="dialog"
	aria-label={share.token ? `Geteilt: Link zu ${alias} verwalten` : `${alias} teilen`}
	class="inline-flex items-center gap-1 py-1 font-medium text-brand underline hover:text-brand-hover"
>
	<Share2 size={16} strokeWidth={2} aria-hidden="true" />
	{share.token ? 'Geteilt' : 'Teilen'}
</button>

<dialog
	bind:this={dialogEl}
	aria-labelledby="{uid}-title"
	oncancel={onCancelEvent}
	onclick={onBackdropClick}
	class="m-auto w-[calc(100%-2rem)] max-w-md rounded-xl border border-slate-200 bg-white p-0 text-left text-slate-900 shadow-xl backdrop:bg-slate-900/40"
>
	{#if open}
		<div class="flex flex-col gap-4 p-5 text-sm">
			<div class="flex items-start justify-between gap-3">
				<h2 id="{uid}-title" class="min-w-0 pt-1 text-base font-semibold break-words">
					„{alias}“ teilen
				</h2>
				<button
					type="button"
					onclick={() => (open = false)}
					aria-label="Schließen"
					class="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100"
				>
					<X size={16} strokeWidth={2} aria-hidden="true" />
				</button>
			</div>

			{#if url}
				<p class="text-slate-700">
					Jeder, der diesen Link kennt, sieht alle Details zu dieser Flasche und – falls vorhanden –
					die zum PDF umgewandelte Präsentation, auch ohne Anmeldung.
				</p>
				<div class="flex flex-wrap gap-2">
					<label for="{uid}-url" class="sr-only">Link zum Teilen</label>
					<input
						id="{uid}-url"
						bind:this={urlInput}
						type="text"
						readonly
						value={url}
						onfocus={(event) => event.currentTarget.select()}
						class="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-slate-50 px-3 py-2 text-slate-900"
					/>
					<button
						type="button"
						onclick={copy}
						class="inline-flex min-h-11 items-center gap-1 rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-hover"
					>
						<Copy size={16} strokeWidth={2} aria-hidden="true" />
						Kopieren
					</button>
				</div>
				<form method="POST" action="?/unshare" use:enhance={submit('Link widerrufen.')}>
					<input type="hidden" name="bottleId" value={share.bottleId} />
					<button
						type="button"
						onclick={revoke}
						disabled={busy}
						class="min-h-11 rounded-lg border border-red-300 px-4 py-2 font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
					>
						Link widerrufen
					</button>
				</form>
			{:else}
				<p class="text-slate-700">
					Jeder, der den Link kennt, sieht alle Details zu dieser Flasche, auch ohne Anmeldung:
					Destillerie, Abfüllung, Score samt Erklärung, die Position in der Reihenfolge, Titel und
					Datum des Tastings und – falls vorhanden – die zum PDF umgewandelte Präsentation. Wer die
					Flasche mitgebracht hat, steht nicht dabei.
				</p>
				<p class="text-slate-500">Du kannst den Link jederzeit widerrufen.</p>
				<form method="POST" action="?/share" use:enhance={submit('Link erzeugt.')}>
					<input type="hidden" name="bottleId" value={share.bottleId} />
					<button
						type="submit"
						disabled={busy}
						class="min-h-11 rounded-lg bg-brand px-4 py-2 font-medium text-white hover:bg-brand-hover disabled:opacity-50"
					>
						Link erzeugen
					</button>
				</form>
			{/if}
		</div>
	{/if}
</dialog>
