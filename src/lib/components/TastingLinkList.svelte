<script lang="ts">
	import { Copy } from '@lucide/svelte';
	import { toast } from './toastStore.svelte';

	type Link = { name: string; url: string };
	let { links }: { links: Link[] } = $props();

	async function copy(link: Link) {
		try {
			await navigator.clipboard.writeText(link.url);
			toast.show('success', `Link für ${link.name} kopiert.`);
		} catch {
			toast.show('error', 'Kopieren hat nicht geklappt. Markiere den Link und kopiere ihn selbst.');
		}
	}
</script>

<!-- Shown exactly once (action response). The URLs are plain text on purpose,
     not links: the admin must not open other participants' entries by accident. -->
<div class="space-y-3 rounded-xl border border-sky-300 bg-sky-50 p-4">
	<p class="text-sm text-sky-900">
		Die Links werden nur jetzt angezeigt. Schick jeden Link einzeln an die jeweilige Person, nicht
		in die Gruppe. Wer einen Link hat, sieht dessen Eingaben.
	</p>
	<ul class="space-y-2">
		{#each links as link (link.url)}
			<li class="space-y-2 rounded-lg border border-slate-200 bg-white p-3">
				<div class="flex items-center justify-between gap-3">
					<p class="min-w-0 truncate font-medium">{link.name}</p>
					<button
						type="button"
						onclick={() => copy(link)}
						aria-label={`Link für ${link.name} kopieren`}
						class="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
					>
						<Copy size={16} strokeWidth={2} aria-hidden="true" />
						Kopieren
					</button>
				</div>
				<p class="font-mono text-xs break-all text-slate-600 select-all">{link.url}</p>
			</li>
		{/each}
	</ul>
</div>
