<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { formatTastingDate, type AdminShare } from '$lib/tasting';
	import { confirmDialog } from './confirmDialogStore.svelte';

	// The admin's list of all share links (issue #58): open any of them, revoke
	// any of them. Errors of the revokeShare action come back as the page's
	// `form` and show as a toast there.
	let { shares }: { shares: AdminShare[] } = $props();

	function fmtDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('de-DE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric'
		});
	}

	function confirmRevoke(event: MouseEvent, share: AdminShare) {
		confirmDialog.submit(
			event,
			`Link zu „${share.alias}" von ${share.owner} widerrufen? Wer ihn kennt, sieht die Flasche danach nicht mehr.`,
			{ variant: 'danger', confirmLabel: 'Widerrufen' }
		);
	}
</script>

<section class="space-y-4" aria-labelledby="shared-links">
	<div class="space-y-1">
		<h2 id="shared-links" class="text-lg font-semibold">Geteilte Links ({shares.length})</h2>
		<p class="text-sm text-slate-500">
			Öffentliche Links auf einzelne Flaschen, ohne Anmeldung sichtbar, bis sie widerrufen werden.
		</p>
	</div>

	{#if shares.length === 0}
		<p class="text-sm text-slate-500">Keine geteilten Links.</p>
	{:else}
		<ul class="space-y-2">
			{#each shares as share (share.token)}
				<li class="rounded-xl border border-slate-200 bg-white p-4">
					<div class="flex flex-wrap items-start justify-between gap-3">
						<div class="min-w-0">
							<p class="font-medium break-words">{share.bottle}</p>
							<p class="text-sm break-words text-slate-500">
								„{share.alias}" · {share.tastingName} · {formatTastingDate(share.tastingDate)}
							</p>
							<p class="text-xs text-slate-400">
								von {share.owner}, geteilt am {fmtDate(share.createdAt)}
							</p>
						</div>
						<div class="flex shrink-0 gap-2">
							<a
								href={resolve('/share/[token]', { token: share.token })}
								aria-label="Link zu {share.alias} öffnen"
								class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
							>
								Öffnen
							</a>
							<form method="POST" action="?/revokeShare" use:enhance>
								<input type="hidden" name="token" value={share.token} />
								<button
									type="button"
									onclick={(e) => confirmRevoke(e, share)}
									aria-label="Link zu {share.alias} widerrufen"
									class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
								>
									Widerrufen
								</button>
							</form>
						</div>
					</div>
				</li>
			{/each}
		</ul>
	{/if}
</section>
