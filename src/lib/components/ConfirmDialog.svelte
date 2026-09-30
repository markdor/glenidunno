<script lang="ts">
	import { TriangleAlert } from '@lucide/svelte';
	import { confirmDialog } from './confirmDialogStore.svelte';

	let dialogEl: HTMLDialogElement;

	// This effect is the only place that opens/closes the dialog - handlers
	// below only ever change confirmDialog.request, never call show/close
	// directly, so this stays the single source of truth for its DOM state.
	$effect(() => {
		if (confirmDialog.request) {
			if (!dialogEl.open) dialogEl.showModal();
		} else if (dialogEl.open) {
			dialogEl.close();
		}
	});

	// Safety net independent of the effect above: if this component is torn
	// down while still open (e.g. a test unmounts right after cancel(), before
	// the effect above has flushed), an unclosed <dialog> leaves the rest of
	// the page permanently inert for whatever renders next.
	$effect(() => () => {
		if (dialogEl.open) dialogEl.close();
	});

	function onBackdropClick(event: MouseEvent) {
		if (event.target === dialogEl) confirmDialog.cancel();
	}

	// Escape fires 'cancel' then closes natively; go through confirmDialog
	// instead so the effect above stays the only thing calling close().
	function onCancelEvent(event: Event) {
		event.preventDefault();
		confirmDialog.cancel();
	}
</script>

<dialog
	bind:this={dialogEl}
	aria-label="Bestätigung erforderlich"
	oncancel={onCancelEvent}
	onclick={onBackdropClick}
	class="m-auto w-[calc(100%-2rem)] max-w-sm rounded-xl border border-slate-200 bg-white p-0 shadow-xl backdrop:bg-slate-900/40"
>
	{#if confirmDialog.request}
		{@const req = confirmDialog.request}
		<div class="flex flex-col gap-4 p-5">
			<div class="flex items-start gap-3">
				<span
					class="shrink-0 rounded-full p-1.5 {req.variant === 'danger'
						? 'bg-red-50 text-red-600'
						: 'bg-brand/10 text-brand'}"
					aria-hidden="true"
				>
					<TriangleAlert size={20} strokeWidth={2} />
				</span>
				<p class="pt-1 text-sm text-slate-700">{req.message}</p>
			</div>
			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					onclick={() => confirmDialog.confirm()}
					class="rounded-lg px-4 py-2 text-sm font-medium text-white {req.variant === 'danger'
						? 'bg-red-600 hover:bg-red-700'
						: 'bg-brand hover:bg-brand-hover'}"
				>
					{req.confirmLabel}
				</button>
				<button
					type="button"
					onclick={() => confirmDialog.cancel()}
					class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
				>
					{req.cancelLabel}
				</button>
			</div>
		</div>
	{/if}
</dialog>
