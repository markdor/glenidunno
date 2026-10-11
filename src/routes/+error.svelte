<script lang="ts">
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';

	// Missing pages and missing admin rights never get here – they redirect to
	// the dashboard (redirectNotFound). What's left is mostly a 500. Fixed text
	// only: page.error.message is never shown, it may carry internals.
</script>

<svelte:head>
	<title>Fehler · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. -->
<div class="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-16 text-center">
	<h1 class="text-2xl font-semibold tracking-tight">{UNEXPECTED_ERROR_MESSAGE}</h1>
	<p class="text-sm text-slate-500">Fehlercode {page.status}</p>
	<a
		href={resolve('/')}
		class="mt-4 inline-flex rounded-xl bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-hover"
	>
		Zur Startseite
	</a>
</div>
