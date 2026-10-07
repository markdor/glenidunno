<script lang="ts">
	import { formatTastingTimestamp, type ManualPhaseChanges } from '$lib/tasting';

	// Shown to every participant (and on the admin page) once the admin pressed
	// the 18:00 or 9:00 button, so nobody wonders why the phase changed early.
	let { manual }: { manual: ManualPhaseChanges } = $props();
</script>

{#if manual.orderOpenedAt || manual.revealedAt}
	<div class="space-y-1 rounded-lg border border-sky-300 bg-sky-50 px-4 py-3 text-sm text-sky-900">
		{#if manual.orderOpenedAt}
			<p>
				Der Admin hat die Reihenfolge am {formatTastingTimestamp(manual.orderOpenedAt)} vorzeitig freigegeben.
			</p>
		{/if}
		{#if manual.revealedAt}
			<p>
				Der Admin hat das Tasting am {formatTastingTimestamp(manual.revealedAt)} vorzeitig aufgelöst.
			</p>
		{/if}
	</div>
{/if}
