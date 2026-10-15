<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { Download } from '@lucide/svelte';
	import PresentationViewer from '$lib/components/PresentationViewer.svelte';
	import SubHeader from '$lib/components/SubHeader.svelte';

	let { data } = $props();

	// PDF, download and back link run through the tasting's link like on the
	// participant page; the history's filters are not restored (the browser's
	// back button does that).
	const params = $derived({ slug: page.params.slug ?? '', bottleId: page.params.bottleId ?? '' });
	const pdfHref = $derived(
		resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]/pdf', params)
	);
	const downloadHref = $derived(
		resolve('/tasting/[slug=tastingSlug]/presentation/[bottleId]', params)
	);
	const backHref = $derived(
		data.back === 'history'
			? resolve('/history')
			: resolve('/tasting/[slug=tastingSlug]', { slug: params.slug })
	);
</script>

<svelte:head>
	<!-- Neutral on purpose like the participant page: messengers show the title
	     in link previews, so no tasting, participant or bottle names. -->
	<title>Whisky-Tasting</title>
</svelte:head>

<div class="mx-auto max-w-5xl space-y-6 px-4 py-8">
	<SubHeader
		{backHref}
		backLabel={data.back === 'history' ? 'Historie' : 'Tasting'}
		title="Präsentation"
	>
		{#snippet action()}
			<!-- Served as an attachment by a +server.ts route: `download` keeps the
			     client router out of it. -->
			<a
				href={downloadHref}
				download
				class="flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
			>
				<Download size={16} strokeWidth={2} aria-hidden="true" />
				Herunterladen
			</a>
		{/snippet}
	</SubHeader>

	<!-- Keyed: another presentation is a fresh viewer, not the old one's state. -->
	{#key pdfHref}
		<PresentationViewer {pdfHref} {downloadHref} />
	{/key}
</div>
