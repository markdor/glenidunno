<script lang="ts">
	import { untrack } from 'svelte';
	import { isValidEmail } from '$lib/validation';
	import { authClient } from '$lib/auth-client';
	import logo from '$lib/assets/glen-idunno-logo.svg';
	import { toast } from '$lib/components/toastStore.svelte';

	let { data } = $props();

	let email = $state('');
	let submitting = $state(false);
	let invalidEmail = $state(false);

	$effect(() => {
		if (data.error) {
			// untrack: toast.show() itself reads/writes the toast store's state, so
			// without untrack this effect would pick that up as a dependency and
			// re-run itself forever (data.error stays truthy across re-runs).
			untrack(() =>
				toast.show(
					'error',
					'Dieser Link ist abgelaufen oder wurde bereits verwendet. Gib deine E-Mail erneut ein, um einen neuen zu erhalten.'
				)
			);
		}
	});

	async function handleSubmit(event: SubmitEvent) {
		event.preventDefault();
		invalidEmail = false;

		const value = email.trim().toLowerCase();
		if (!isValidEmail(value)) {
			invalidEmail = true;
			return;
		}

		submitting = true;
		// Identical UX regardless of whitelist membership: we always show the same
		// message and never surface the result, so timing/response can't be used to
		// enumerate registered addresses.
		await authClient.signIn
			.magicLink({
				email: value,
				callbackURL: '/',
				errorCallbackURL: '/login?error=invalid'
			})
			.catch(() => {});
		submitting = false;
		toast.show('success', 'Wenn die Adresse registriert ist, wurde ein Link verschickt.');
	}
</script>

<svelte:head>
	<title>Anmelden · Glen Idunno</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-12">
	<header class="flex flex-col items-center gap-5 text-center">
		<!-- The logo contains the wordmark, so it replaces the text heading; its alt
		     text keeps the <h1> accessible name "Glen Idunno". -->
		<h1>
			<img src={logo} alt="Glen Idunno" width="628" height="546" class="h-auto w-66" />
		</h1>
		<p class="text-sm text-slate-500">Melde dich mit deiner E-Mail-Adresse an.</p>
	</header>

	<!-- novalidate: our JS validation is the single source of truth so we can
	     show a consistent, styled German message instead of the browser bubble. -->
	<form class="space-y-4" novalidate onsubmit={handleSubmit}>
		<div class="space-y-1.5">
			<label for="email" class="block text-sm font-medium text-slate-700">E-Mail</label>
			<input
				id="email"
				name="email"
				type="email"
				autocomplete="email"
				inputmode="email"
				required
				bind:value={email}
				placeholder="du@beispiel.de"
				class="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-base text-slate-900 placeholder:text-slate-400 focus:border-slate-900 focus:outline-none"
			/>
			{#if invalidEmail}
				<p class="text-xs text-red-700">Bitte gib eine gültige E-Mail-Adresse ein.</p>
			{/if}
		</div>
		<button
			type="submit"
			disabled={submitting}
			class="w-full rounded-xl bg-brand px-5 py-3 text-base font-medium text-white transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
		>
			{submitting ? 'Wird gesendet …' : 'Link anfordern'}
		</button>
	</form>
</main>
