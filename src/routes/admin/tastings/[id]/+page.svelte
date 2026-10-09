<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { confirmDialog, type ConfirmVariant } from '$lib/components/confirmDialogStore.svelte';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import TastingManualNotice from '$lib/components/TastingManualNotice.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import { formatTastingDate, TASTING_PHASE_LABEL } from '$lib/tasting';

	let { data, form } = $props();

	const detail = $derived(data.detail);

	$effect(() => {
		if (form?.userMessage) {
			// untrack: see login/+page.svelte for why this is needed around toast.show().
			untrack(() => toast.show('error', form.userMessage as string));
		}
	});

	$effect(() => {
		if (form?.updated) untrack(() => toast.show('success', 'Datum geändert.'));
	});

	$effect(() => {
		if (form?.phaseChanged) {
			const message = form.action === 'reveal' ? 'Tasting aufgelöst.' : 'Reihenfolge freigegeben.';
			untrack(() => toast.show('success', message));
		}
	});

	// The dialog can't gate use:enhance's cancel() (that must run
	// synchronously), so the button just re-submits its form once confirmed.
	// currentTarget is read before the await: the browser clears it once the
	// event has finished dispatching, i.e. before an async handler resumes.
	async function confirmSubmit(
		event: MouseEvent,
		question: string,
		options?: { variant?: ConfirmVariant; confirmLabel?: string }
	) {
		const formEl = (event.currentTarget as HTMLElement).closest('form');
		const ok = await confirmDialog.ask(question, options);
		if (ok) formEl?.requestSubmit();
	}

	const errorText: Record<string, string> = {
		required: 'Pflichtfeld',
		invalid: 'Ungültig oder in der Vergangenheit'
	};

	const dateError = $derived.by(() => {
		const code = form?.fieldErrors?.tastingDate;
		return code ? (errorText[code] ?? 'Ungültig') : null;
	});

	const secondaryButton =
		'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent';
</script>

<svelte:head>
	<title>{detail.tasting.name} · Glen Idunno</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-8 px-4 py-8">
	<div class="space-y-2">
		<SubHeader
			backHref={resolve('/admin/tastings')}
			backLabel="Alle Tastings"
			title={detail.tasting.name}
		/>
		<p class="flex flex-wrap items-center gap-2 text-sm text-slate-500">
			{formatTastingDate(detail.tasting.tastingDate)}
			<span class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
				{TASTING_PHASE_LABEL[detail.phase]}
			</span>
		</p>
	</div>

	<TastingManualNotice manual={detail.manual} />

	<p class="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
		Hier verwaltest du nur das Tasting. Reihenfolge und Auflösung siehst du wie alle anderen als
		Teilnehmer des Tastings.
	</p>

	{#if detail.phase === 'entry'}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Datum ändern</h2>
			<form
				method="POST"
				action="?/updateDate"
				use:enhance={() => {
					return async ({ update }) => update({ reset: false });
				}}
				class="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-4"
			>
				<div class="space-y-1">
					<label for="d-date" class="block text-sm font-medium text-slate-700">Datum</label>
					<input
						id="d-date"
						name="tastingDate"
						type="date"
						required
						min={data.today}
						value={form?.tastingDate ?? detail.tasting.tastingDate}
						class="rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900"
					/>
				</div>
				<button type="submit" class={secondaryButton}>Datum speichern</button>
				{#if dateError}
					<p class="w-full text-xs text-red-600">{dateError}</p>
				{/if}
			</form>
		</section>
	{/if}

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Vorzeitig freigeben</h2>
		<p class="text-sm text-slate-500">
			Überstimmt die Uhrzeit sofort für alle Teilnehmer: erst die Reihenfolge statt um 18 Uhr am
			Tasting-Tag, danach die Auflösung statt um 9 Uhr am Folgetag. Alle Teilnehmer sehen danach,
			wann du das getan hast. Lässt sich nicht rückgängig machen.
		</p>
		<div class="flex flex-wrap gap-2">
			<form method="POST" action="?/openOrder" use:enhance>
				<button
					type="button"
					disabled={detail.phase !== 'entry'}
					onclick={(e) =>
						confirmSubmit(
							e,
							'Reihenfolge jetzt für alle Teilnehmer freigeben? Danach kann niemand mehr Flaschen eintragen oder ändern.',
							{ confirmLabel: 'Freigeben' }
						)}
					class={secondaryButton}
				>
					Reihenfolge jetzt freigeben
				</button>
			</form>
			<form method="POST" action="?/reveal" use:enhance>
				<button
					type="button"
					disabled={detail.phase !== 'order'}
					onclick={(e) =>
						confirmSubmit(
							e,
							'Tasting jetzt für alle Teilnehmer komplett auflösen? Alle sehen dann Namen, Werte und Mitbringer.',
							{ confirmLabel: 'Auflösen' }
						)}
					class={secondaryButton}
				>
					Jetzt auflösen
				</button>
			</form>
		</div>
	</section>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Teilnehmer ({detail.participants.length})</h2>
		<ul class="space-y-2">
			{#each detail.participants as p (p.id)}
				<li class="rounded-xl border border-slate-200 bg-white p-4">
					<p class="truncate font-medium">{p.name}</p>
					<p class="text-sm text-slate-500">
						{p.progress.entered} von {p.progress.total} Flaschen
					</p>
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<form method="POST" action="?/delete" use:enhance>
			<button
				type="button"
				onclick={(e) =>
					confirmSubmit(
						e,
						`Tasting „${detail.tasting.name}“ wirklich löschen? Alle Eingaben gehen verloren.`,
						{ variant: 'danger', confirmLabel: 'Löschen' }
					)}
				class="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
			>
				Tasting löschen
			</button>
		</form>
	</section>
</div>
