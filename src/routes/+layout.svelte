<script lang="ts">
	import './layout.css';
	import Header from '$lib/components/Header.svelte';
	import Footer from '$lib/components/Footer.svelte';
	import Toast from '$lib/components/Toast.svelte';

	let { data, children } = $props();
</script>

<div class="flex min-h-screen flex-col bg-slate-50 text-slate-900">
	{#if data.user}
		<Header user={data.user} />
	{/if}
	<main class="flex-1">
		{@render children()}
	</main>
	<Footer />
</div>
<Toast />
