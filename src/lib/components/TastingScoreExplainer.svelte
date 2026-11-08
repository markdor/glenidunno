<script lang="ts">
	import type { ScoreRules } from '$lib/tasting';
	import TastingFactsExplainer from './TastingFactsExplainer.svelte';
	import TastingTasteExplainer from './TastingTasteExplainer.svelte';

	// The explainer tile of either algorithm, told apart by the version of the
	// rules frozen with the order: a tasting keeps explaining the order it was
	// poured in, also after the current rules changed.
	let { rules }: { rules: ScoreRules } = $props();
</script>

{#if rules.version === 2}
	<TastingFactsExplainer {rules} />
{:else}
	<TastingTasteExplainer {rules} />
{/if}
