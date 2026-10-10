<script lang="ts">
	import type { DashboardLastTasting } from '$lib/tasting';
	import DashboardTastingShell from './DashboardTastingShell.svelte';

	let { tasting }: { tasting: DashboardLastTasting | null } = $props();
</script>

<!-- Title, motto and date only: the reveal itself stays on the participant page. -->
<DashboardTastingShell
	heading="Letztes Tasting"
	{tasting}
	linkLabel="Zur Auflösung"
	emptyText="Noch kein Tasting aufgelöst."
/>
