<script lang="ts">
	import { untrack } from 'svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import TastingBottleForm from '$lib/components/TastingBottleForm.svelte';
	import TastingManualNotice from '$lib/components/TastingManualNotice.svelte';
	import TastingOrderChart from '$lib/components/TastingOrderChart.svelte';
	import TastingOrderList from '$lib/components/TastingOrderList.svelte';
	import TastingReveal from '$lib/components/TastingReveal.svelte';
	import TastingScoreChart from '$lib/components/TastingScoreChart.svelte';
	import TastingScoreExplainer from '$lib/components/TastingScoreExplainer.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import { formatTastingDate, TASTING_ORDER_HOUR, TASTING_REVEAL_HOUR } from '$lib/tasting';

	let { data, form } = $props();

	const view = $derived(data.view);

	$effect(() => {
		if (form?.userMessage) {
			// untrack: see login/+page.svelte for why this is needed around toast.show().
			untrack(() => toast.show('error', form.userMessage as string));
		}
	});

	const slots = $derived(
		view.phase === 'entry'
			? Array.from({ length: view.tasting.bottlesPerParticipant }, (_, i) => i + 1)
			: []
	);

	// Downloads run through this link's own token (see presentation/[bottleId]).
	function presentationHref(bottleId: string) {
		return resolve('/tasting/[token=tastingToken]/presentation/[bottleId]', {
			token: page.params.token ?? '',
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
	</header>

	{#if view.phase === 'entry'}
		<p class="font-medium">Hallo {view.participant.name} 👋</p>
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
				result={form?.slot === slot ? form : null}
			/>
		{/each}
	{:else if view.phase === 'order'}
		<TastingManualNotice manual={view.manual} />
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Tastingreihenfolge</h2>
			<p class="text-sm text-slate-500">
				Die Auflösung erscheint am Tag danach ab {TASTING_REVEAL_HOUR} Uhr.
			</p>
			<TastingOrderList order={view.order} {presentationHref} />
		</section>
		<TastingOrderChart order={view.order} />
		<TastingScoreExplainer />
	{:else}
		<TastingManualNotice manual={view.manual} />
		<section class="space-y-3">
			<h2 class="text-lg font-semibold">Auflösung</h2>
			<TastingReveal bottles={view.bottles} {presentationHref} />
		</section>
		<TastingScoreChart bottles={view.bottles} />
		<TastingScoreExplainer />
	{/if}
</div>
