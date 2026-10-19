<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Plus } from '@lucide/svelte';
	import TastingBottleForm from '$lib/components/TastingBottleForm.svelte';
	import TastingManualNotice from '$lib/components/TastingManualNotice.svelte';
	import TastingOrderChart from '$lib/components/TastingOrderChart.svelte';
	import TastingOrderList from '$lib/components/TastingOrderList.svelte';
	import TastingReveal from '$lib/components/TastingReveal.svelte';
	import TastingScoreChart from '$lib/components/TastingScoreChart.svelte';
	import TastingScoreExplainer from '$lib/components/TastingScoreExplainer.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import { formatTastingDate, TASTING_ORDER_HOUR, TASTING_REVEAL_HOUR } from '$lib/tasting';
	import { TASTING_BOTTLE_SLOTS } from '$lib/validation';

	let { data, form } = $props();

	const view = $derived(data.view);

	$effect(() => {
		if (form?.userMessage) {
			// untrack: see login/+page.svelte for why this is needed around toast.show().
			untrack(() => toast.show('error', form.userMessage as string));
		}
	});

	// Further slots added with "Weitere Flasche" that may not be saved yet.
	let added = $state<number[]>([]);

	// The base slots are always there, plus every saved and every added slot.
	const slots = $derived.by(() => {
		if (view.phase !== 'entry') return [];
		const base = Array.from({ length: TASTING_BOTTLE_SLOTS.base }, (_, i) => i + 1);
		const shown = new Set([...base, ...view.bottles.map((b) => b.slot), ...added]);
		return [...shown].sort((a, b) => a - b);
	});

	// The smallest free slot, none once all are shown. Slots aren't renumbered:
	// a removed bottle 3 next to a kept bottle 4 frees slot 3 again.
	const nextSlot = $derived(
		Array.from({ length: TASTING_BOTTLE_SLOTS.max }, (_, i) => i + 1).find(
			(slot) => !slots.includes(slot)
		)
	);

	// The action result of a card that was hidden. A failed save keeps its
	// values and field errors in `form`, so a re-added slot would show them
	// again instead of an empty card. Raw: a proxy would never equal `form`.
	let dismissed = $state.raw<typeof form>(null);

	// Also after the server removed a saved bottle: an added slot would stay
	// as an empty card otherwise.
	function hideSlot(slot: number) {
		added = added.filter((s) => s !== slot);
		// Only this slot's result: another card may still show its own errors.
		if (form?.slot === slot) dismissed = form;
	}

	// Downloads and the viewer run through this tasting's link (see
	// presentation/[bottleId]); the viewer's back link returns here.
	function presentationHref(bottleId: string) {
		return resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]', {
			slug: page.params.slug ?? '',
			bottleId
		});
	}

	function viewHref(bottleId: string) {
		return resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]/view', {
			slug: page.params.slug ?? '',
			bottleId
		});
	}
</script>

<svelte:head>
	<!-- Neutral on purpose: messengers show the title in link previews, so no
	     tasting, participant or bottle names here or in meta tags. -->
	<title>Whisky-Tasting</title>
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<header class="space-y-1">
		<p class="text-sm text-slate-500">
			Whisky-Tasting · {formatTastingDate(view.tasting.tastingDate)}
		</p>
		<h1 class="text-2xl font-semibold tracking-tight break-words">{view.tasting.name}</h1>
		<!-- Plain text, never {@html}: line breaks of the description only via CSS. -->
		{#if view.tasting.motto}
			<p class="pt-1 text-lg font-medium break-words text-slate-800">{view.tasting.motto}</p>
		{/if}
		{#if view.tasting.mottoDescription}
			<p class="break-words whitespace-pre-line text-slate-600">{view.tasting.mottoDescription}</p>
		{/if}
	</header>

	{#if view.phase === 'entry'}
		<p class="font-medium">Hallo {view.participant.username} 👋</p>
		<p class="rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
			Schreib das Synonym auf deine verhüllte Flasche. Die Reihenfolge erscheint am
			{formatTastingDate(view.tasting.tastingDate)} ab {TASTING_ORDER_HOUR} Uhr, die Auflösung am Tag
			danach ab {TASTING_REVEAL_HOUR} Uhr. Bis dahin kann niemand außer dir deine Flaschen sehen – auch
			nicht der Admin.
		</p>
		{#each slots as slot (slot)}
			<TastingBottleForm
				{slot}
				bottle={view.bottles.find((b) => b.slot === slot) ?? null}
				result={form?.action === 'save' && form.slot === slot && form !== dismissed ? form : null}
				onremove={hideSlot}
				distilleryNames={view.distilleryNames}
			/>
		{/each}
		{#if nextSlot !== undefined}
			<button
				type="button"
				onclick={() => (added = [...added, nextSlot])}
				class="flex min-h-12 w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-3 text-base font-medium text-slate-700 hover:bg-slate-50"
			>
				<Plus size={20} strokeWidth={2} aria-hidden="true" />
				Weitere Flasche
			</button>
		{/if}
	{:else if view.phase === 'order'}
		<TastingManualNotice manual={view.manual} />
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Tastingreihenfolge</h2>
			<p class="text-sm text-slate-500">
				Die Auflösung erscheint am Tag danach ab {TASTING_REVEAL_HOUR} Uhr.
			</p>
			<TastingOrderList order={view.order} {presentationHref} {viewHref} />
		</section>
		<TastingOrderChart order={view.order} smokeGroups={view.rules.smokeGroups.length > 0} />
		<TastingScoreExplainer rules={view.rules} />
	{:else}
		<TastingManualNotice manual={view.manual} />
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Auflösung</h2>
			<TastingReveal reveal={view} {presentationHref} {viewHref} />
		</section>
		<!-- Archived bottles have no factors: no score to chart, no order to explain. -->
		{#if !view.archived}
			<TastingScoreChart bottles={view.bottles} />
			<TastingScoreExplainer rules={view.rules} />
		{/if}
	{/if}
</div>
