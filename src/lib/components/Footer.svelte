<script lang="ts">
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
		<span>Gemacht mit <span role="img" aria-label="Liebe">❤️</span></span>
	</div>
</footer>
