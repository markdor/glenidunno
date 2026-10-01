<script lang="ts">
	import glencairn from '$lib/assets/glencairn-glass.svg';

	const version = __APP_VERSION__;
</script>

<footer class="border-t border-slate-200 bg-white">
	<div class="mx-auto flex h-12 max-w-3xl items-center justify-between px-4 text-xs text-slate-500">
		<a
			href={`https://github.com/markdor/glenidunno/releases/tag/v${version}`}
			target="_blank"
			rel="noopener noreferrer"
			class="hover:text-slate-700 hover:underline"
		>
			v{version}
		</a>
		<!-- English on purpose; lang lets screen readers read "made with love and whisky" in English. -->
		<span lang="en" class="inline-flex items-center gap-1">
			made with <span role="img" aria-label="love">❤️</span> and
			<img src={glencairn} alt="whisky" width="13" height="18" class="h-4.5 w-auto" />
		</span>
	</div>
</footer>
