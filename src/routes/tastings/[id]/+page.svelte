<script lang="ts">
	import { resolve } from '$app/paths';
	import SubHeader from '$lib/components/SubHeader.svelte';
	import TastingReveal from '$lib/components/TastingReveal.svelte';
	import TastingFactsChart from '$lib/components/TastingFactsChart.svelte';
	import TastingScoreChart from '$lib/components/TastingScoreChart.svelte';
	import TastingScoreExplainer from '$lib/components/TastingScoreExplainer.svelte';
	import { formatTastingDate } from '$lib/tasting';

	let { data } = $props();

	const detail = $derived(data.detail);

	// Presentations only come with an own participation, and with them the
	// slug: download and viewer run through the participant's link like on the
	// participant page; the viewer's back link returns here.
	function presentationHref(bottleId: string) {
		return resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]', {
			slug: detail.slug ?? '',
			bottleId
		});
	}

	function viewHref(bottleId: string) {
		return resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]/view?from=tastings', {
			slug: detail.slug ?? '',
			bottleId
		});
	}
</script>

<svelte:head>
	<!-- Neutral like the participant page: no tasting or bottle names. -->
	<title>Tasting · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. -->
<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	<div class="space-y-1">
		<SubHeader
			backHref={resolve('/tastings')}
			backLabel="Tasting-Historie"
			title={detail.tasting.name}
		/>
		{#if detail.tasting.subtitle}
			<p class="text-lg text-slate-700">{detail.tasting.subtitle}</p>
		{/if}
		<p class="text-sm text-slate-500">{formatTastingDate(detail.tasting.tastingDate)}</p>
		<!-- The motto is the title. Its description as plain text, never {@html}:
		     line breaks only via CSS. -->
		{#if detail.tasting.mottoDescription}
			<p class="pt-1 break-words whitespace-pre-line text-slate-600">
				{detail.tasting.mottoDescription}
			</p>
		{/if}
	</div>

	<section class="space-y-3">
		<h2 class="text-lg font-semibold">Auflösung</h2>
		<TastingReveal reveal={detail} {presentationHref} {viewHref} />
	</section>
	<!-- Archived bottles have no factors: no score to chart, no order to explain. -->
	{#if !detail.archived}
		{#if detail.algorithm === 'facts'}
			<TastingFactsChart bottles={detail.bottles} />
		{:else}
			<TastingScoreChart bottles={detail.bottles} />
		{/if}
		<TastingScoreExplainer rules={detail.rules} />
	{/if}
</div>
