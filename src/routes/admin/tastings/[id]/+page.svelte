<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import TastingLinkList from '$lib/components/TastingLinkList.svelte';
	import TastingOrderList from '$lib/components/TastingOrderList.svelte';
	import TastingReveal from '$lib/components/TastingReveal.svelte';
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

	const errorText: Record<string, string> = {
		required: 'Pflichtfeld',
		invalid: 'Ungültig oder in der Vergangenheit'
	};

	const dateError = $derived.by(() => {
		const code = form?.fieldErrors?.tastingDate;
		return code ? (errorText[code] ?? 'Ungültig') : null;
	});

	const secondaryButton =
		'rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50';
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

	{#if detail.phase === 'entry'}
		<p class="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
			Die Inhalte siehst du wie alle anderen erst am Tasting-Tag ab 18 Uhr.
		</p>

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
	{:else if detail.phase === 'order'}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Reihenfolge</h2>
			<TastingOrderList order={detail.order} />
		</section>
	{:else}
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Auflösung</h2>
			<TastingReveal bottles={detail.bottles} showBreakdown />
		</section>
	{/if}

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Teilnehmer ({detail.participants.length})</h2>
		<ul class="space-y-2">
			{#each detail.participants as p (p.id)}
				<li class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
					<div class="flex flex-wrap items-center justify-between gap-3">
						<div class="min-w-0">
							<p class="truncate font-medium">{p.name}</p>
							<p class="text-sm text-slate-500">
								{p.progress.entered} von {p.progress.total} Flaschen
							</p>
						</div>
						<form method="POST" action="?/regenerate" use:enhance>
							<input type="hidden" name="participantId" value={p.id} />
							<button type="submit" class={secondaryButton}>Link neu generieren</button>
						</form>
					</div>
					{#if form?.regenerated?.participantId === p.id}
						<TastingLinkList links={[form.regenerated.link]} />
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<section>
		<!-- cancel(), not preventDefault() in onsubmit: enhance ignores
		     defaultPrevented and would send the request anyway. -->
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (
					!confirm(
						`Tasting „${detail.tasting.name}“ wirklich löschen? Alle Eingaben gehen verloren.`
					)
				)
					cancel();
			}}
		>
			<button
				type="submit"
				class="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50"
			>
				Tasting löschen
			</button>
		</form>
	</section>
</div>
