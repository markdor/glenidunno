<script lang="ts">
	import { Download } from '@lucide/svelte';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import mark from '$lib/assets/glen-idunno-mark.svg';
	import PresentationViewer from '$lib/components/PresentationViewer.svelte';
	import SharedBottle from '$lib/components/SharedBottle.svelte';
	import TastingScoreExplainer from '$lib/components/TastingScoreExplainer.svelte';
	import { formatBottleName, formatTastingDate } from '$lib/tasting';

	let { data } = $props();
	const view = $derived(data.view);

	// Viewer and download both get the PDF – the original file is never shared.
	const pdfHref = $derived(resolve('/share/[token]/pdf', { token: page.params.token ?? '' }));
</script>

<svelte:head>
	<!-- Neutral on purpose: messengers show the title in link previews, so no
	     whisky, alias or tasting. Not for search engines either (the response
	     also says so in X-Robots-Tag). -->
	<title>Whisky bei Glen Idunno</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-6 px-4 py-8">
	{#if !data.user}
		<!-- Without a login there is no app header: the brand alone, no link (it
		     would only lead to the login). -->
		<p class="flex items-center gap-2 text-lg font-semibold tracking-tight text-slate-900">
			<img src={mark} alt="" width="32" height="32" class="h-8 w-8" />
			Glen Idunno
		</p>
	{/if}

	<header class="space-y-1">
		<p class="text-sm text-slate-500">{formatTastingDate(view.tasting.tastingDate)}</p>
		<h1 class="text-2xl font-semibold break-words">{view.bottle.alias}</h1>
		<p class="break-words text-slate-700">{formatBottleName(view.bottle)}</p>
		<p class="text-sm break-words text-slate-500">
			Tasting „{view.tasting.name}“{#if view.tasting.subtitle}&nbsp;· {view.tasting.subtitle}{/if}
		</p>
	</header>

	<SharedBottle {view} />

	{#if !view.archived}
		<TastingScoreExplainer rules={view.rules} />
	{/if}

	{#if view.presentation}
		<section class="space-y-3" aria-labelledby="shared-presentation">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 id="shared-presentation" class="text-lg font-semibold">Präsentation</h2>
				<!-- Served as an attachment by a +server.ts route: `download` keeps the
				     client router out of it. -->
				<a
					href={pdfHref}
					download
					class="flex min-h-11 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
				>
					<Download size={16} strokeWidth={2} aria-hidden="true" />
					PDF herunterladen
				</a>
			</div>
			<!-- No hint about animations: the download is the PDF, not the original. -->
			<PresentationViewer {pdfHref} downloadHref={pdfHref} animationsHint={false} />
		</section>
	{/if}
</div>
