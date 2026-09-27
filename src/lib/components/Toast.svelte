<script lang="ts">
	import { CircleAlert, CircleCheck, Info, X } from '@lucide/svelte';
	import { fly } from 'svelte/transition';
	import { toast, type ToastVariant } from './toastStore.svelte';

	const icon = {
		error: CircleAlert,
		success: CircleCheck,
		info: Info
	} satisfies Record<ToastVariant, typeof CircleAlert>;

	const styles = {
		error: 'border-red-300 bg-red-50 text-red-900',
		success: 'border-emerald-300 bg-emerald-50 text-emerald-900',
		info: 'border-amber-300 bg-amber-50 text-amber-900'
	} satisfies Record<ToastVariant, string>;
</script>

<div
	class="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
>
	{#each toast.toasts as t (t.id)}
		{@const Icon = icon[t.variant]}
		<div
			role={t.variant === 'error' ? 'alert' : 'status'}
			class="pointer-events-auto flex w-full max-w-sm items-center gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg {styles[
				t.variant
			]}"
			transition:fly={{ y: 16, duration: 200 }}
		>
			<span class="shrink-0" aria-hidden="true">
				<Icon size={20} strokeWidth={2} />
			</span>
			<p class="flex-1">{t.message}</p>
			<button
				type="button"
				onclick={() => toast.dismiss(t.id)}
				aria-label="Schließen"
				class="shrink-0 rounded-md p-0.5 opacity-70 transition-opacity hover:opacity-100"
			>
				<X size={16} strokeWidth={2} />
			</button>
		</div>
	{/each}
</div>
