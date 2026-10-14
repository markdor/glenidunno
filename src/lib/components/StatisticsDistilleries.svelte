<script lang="ts">
	import { formatCount, formatDate, formatNameList, type Statistics } from '$lib/tasting';

	let { distilleries }: { distilleries: Statistics['distilleries'] } = $props();

	const MEDALS = ['🥇', '🥈', '🥉'];

	const total = $derived(distilleries.original + distilleries.independent);

	function percent(count: number): string {
		return `${total > 0 ? Math.round((count / total) * 100) : 0} %`;
	}

	const topBottlers = $derived.by(() => {
		const top = distilleries.topBottlers;
		if (!top) return null;
		const count = formatCount(top.count, 'Flasche', 'Flaschen');
		return `${formatNameList(top.names)} (${top.names.length > 1 ? `je ${count}` : count})`;
	});
</script>

<section class="space-y-3" aria-labelledby="statistics-distilleries">
	<h2 id="statistics-distilleries" class="text-lg font-semibold">Destillerien und Abfüller</h2>

	<div class="space-y-4 rounded-xl border border-slate-200 bg-white p-4 text-sm">
		<div class="space-y-2">
			<h3 class="text-base font-semibold">Podium</h3>
			{#if distilleries.podium.length === 0}
				<p class="text-slate-500">Noch keine Destillerie.</p>
			{:else}
				<!-- Places share a medal on a tie, so the list carries its own numbers. -->
				<ol class="space-y-2">
					{#each distilleries.podium as place (place.place)}
						<li class="flex items-start gap-3">
							<span class="text-2xl leading-none" aria-hidden="true">{MEDALS[place.place - 1]}</span
							>
							<div class="min-w-0">
								<p class="font-medium">
									Platz {place.place} · {formatCount(place.count, 'Flasche', 'Flaschen')}
								</p>
								<p class="break-words">{formatNameList(place.names)}</p>
							</div>
						</li>
					{/each}
				</ol>
			{/if}
		</div>

		<div class="space-y-1">
			<h3 class="text-base font-semibold">Wiederholungstäter</h3>
			<p class="break-words">
				{#if distilleries.repeaters.length === 0}
					<span class="text-slate-500">Noch keine Destillerie mit mehr als einer Flasche.</span>
				{:else}
					{formatNameList(distilleries.repeaters.map((r) => `${r.name} (${r.count})`))}
				{/if}
			</p>
		</div>

		<div class="space-y-1">
			<h3 class="text-base font-semibold">Abfüller</h3>
			<p>
				Originalabfüllung: {formatCount(distilleries.original, 'Flasche', 'Flaschen')}
				({percent(distilleries.original)}) · Unabhängige Abfüller:
				{formatCount(distilleries.independent, 'Flasche', 'Flaschen')}
				({percent(distilleries.independent)})
			</p>
			{#if topBottlers}
				<p class="break-words">Am häufigsten: {topBottlers}</p>
			{/if}
		</div>

		<div class="space-y-1">
			<h3 class="text-base font-semibold">Déjà-vu</h3>
			{#if distilleries.dejaVu.length === 0}
				<p class="text-slate-500">Bisher kam kein Whisky zweimal auf den Tisch.</p>
			{:else}
				<ul class="space-y-1">
					{#each distilleries.dejaVu as whisky, i (i)}
						<li class="break-words">
							<span class="font-medium">{whisky.name}</span>
							({formatNameList(whisky.dates.map(formatDate))})
						</li>
					{/each}
				</ul>
			{/if}
		</div>
	</div>
</section>
