<script lang="ts">
	import { resolve } from '$app/paths';
	import { ChevronDown } from '@lucide/svelte';
	import mark from '$lib/assets/glen-idunno-mark.svg';

	type HeaderUser = { username: string; isAdmin: boolean };
	let { user }: { user: HeaderUser } = $props();

	let open = $state(false);
</script>

<header class="border-b border-slate-200 bg-white">
	<div class="mx-auto flex h-14 max-w-3xl items-center justify-between px-4">
		<a
			href={resolve('/')}
			class="flex items-center gap-2 py-1.5 text-lg font-semibold tracking-tight text-slate-900"
		>
			<!-- Decorative: the text next to it is the link's accessible name. -->
			<img src={mark} alt="" width="32" height="32" class="h-8 w-8" />
			Glen Idunno
		</a>

		<div class="relative">
			<button
				type="button"
				aria-haspopup="menu"
				aria-expanded={open}
				onclick={() => (open = !open)}
				class="flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
			>
				<span>{user.username}</span>
				<ChevronDown size={16} strokeWidth={2} class="text-slate-400" aria-hidden="true" />
			</button>

			{#if open}
				<!-- Click-away backdrop -->
				<button
					type="button"
					tabindex="-1"
					aria-label="Menü schließen"
					class="fixed inset-0 z-10 cursor-default"
					onclick={() => (open = false)}
				></button>

				<div
					role="menu"
					class="absolute right-0 z-20 mt-2 w-44 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg"
				>
					{#if user.isAdmin}
						<a
							href={resolve('/admin')}
							role="menuitem"
							class="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-100"
							onclick={() => (open = false)}
						>
							Admin
						</a>
					{/if}
					<form method="POST" action="/logout">
						<button
							type="submit"
							role="menuitem"
							class="block w-full px-4 py-2 text-left text-sm text-slate-700 hover:bg-slate-100"
						>
							Abmelden
						</button>
					</form>
				</div>
			{/if}
		</div>
	</div>
</header>
