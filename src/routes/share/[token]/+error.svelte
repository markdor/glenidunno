<script lang="ts">
	import { page } from '$app/state';
	import { UNEXPECTED_ERROR_MESSAGE } from '$lib/errorMessages';

	// The error page of a share link, also for visitors without a login: one
	// text for every link that doesn't show a bottle (malformed, unknown,
	// revoked) – never which of them. No link to the start page, which would
	// only lead to the login.
</script>

<svelte:head>
	<title>Glen Idunno</title>
	<meta name="robots" content="noindex" />
</svelte:head>

<div class="mx-auto max-w-3xl space-y-2 px-4 py-16 text-center">
	{#if page.status === 404}
		<h1 class="text-xl font-semibold">Dieser Link ist nicht mehr gültig.</h1>
		<p class="text-sm text-slate-500">
			Wer ihn geteilt hat, hat ihn vielleicht widerrufen. Frag nach einem neuen Link.
		</p>
	{:else}
		<h1 class="text-xl font-semibold">{UNEXPECTED_ERROR_MESSAGE}</h1>
		<p class="text-sm text-slate-500">Fehler {page.status}</p>
	{/if}
</div>
