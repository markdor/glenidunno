<script lang="ts">
	import { untrack } from 'svelte';
	import { ChartColumn, Database, Earth, RotateCcwClock } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import DashboardLastTastingCard from '$lib/components/DashboardLastTastingCard.svelte';
	import DashboardTastingCard from '$lib/components/DashboardTastingCard.svelte';
	import DashboardTile from '$lib/components/DashboardTile.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import { NOTICES } from '$lib/notices';

	let { data } = $props();

	$effect(() => {
		const notice = data.notice;
		if (!notice) return;
		// untrack: see login/+page.svelte for why this is needed around toast.show().
		untrack(() => {
			toast.show('info', NOTICES[notice]);
			// Drops ?notice from the URL so a reload doesn't repeat the toast. A
			// real navigation rather than replaceState(): that one throws in dev
			// before the router has started (this effect runs during hydration),
			// and as shallow routing it keeps ?notice as the page URL, so the back
			// button would bring the toast back.
			void goto(resolve('/'), { replaceState: true, noScroll: true, keepFocus: true });
		});
	});
</script>

<svelte:head>
	<title>Dashboard · Glen Idunno</title>
</svelte:head>

<!-- A <div>, not <main>: the layout already wraps every page in one. -->
<div class="mx-auto max-w-3xl px-4 py-8">
	<h1 class="text-2xl font-semibold tracking-tight">Hallo {data.user?.username} 👋</h1>

	<div class="mt-6 space-y-4">
		<!-- auto-rows-fr: both cards get the same height, even if one has more
		     lines or shows its empty state. grid-cols-1 (minmax(0, 1fr)) rather
		     than the implicit auto column, which a long word would widen. -->
		<div class="grid auto-rows-fr grid-cols-1 gap-4">
			<DashboardTastingCard tasting={data.nextTasting} />
			<DashboardLastTastingCard tasting={data.lastTasting} />
		</div>

		<!-- A tile without a link would be a section still to come (none at the
		     moment). With an odd number of tiles the last one spans both columns
		     instead of leaving a gap. -->
		<div class="grid auto-rows-fr grid-cols-2 gap-4 [&>:last-child:nth-child(odd)]:col-span-2">
			<DashboardTile title="Tasting-Historie" icon={RotateCcwClock} href={resolve('/tastings')} />
			<DashboardTile title="Flaschen-Datenbank" icon={Database} href={resolve('/history')} />
			<DashboardTile title="Statistiken" icon={ChartColumn} href={resolve('/statistics')} />
			<DashboardTile title="Weltkarte" icon={Earth} href={resolve('/map')} />
		</div>
	</div>
</div>
