<script lang="ts">
	import { onMount, untrack } from 'svelte';
	import { Earth, LocateFixed, Minus, Plus } from '@lucide/svelte';
	import geometryUrl from '$lib/assets/world-map.json?url';
	import { countryName } from '$lib/countries';
	import { formatCount } from '$lib/tasting';
	import { SCOTTISH_REGIONS, type ScottishRegion } from '$lib/validation';
	import {
		BADGE_NAME_MIN_PX,
		BUTTON_ZOOM,
		clampToMap,
		clampView,
		COUNTRY_LEVELS,
		countryBadgeSize,
		countryView,
		DOUBLE_TAP_MS,
		DOUBLE_TAP_PX,
		DOUBLE_TAP_ZOOM,
		DRAG_THRESHOLD_PX,
		easeInOutCubic,
		FLIGHT_DURATION_MS,
		interpolateView,
		isBoxOnScreen,
		LEVEL_BG_CLASSES,
		LEVEL_FILL_CLASSES,
		levelLabels,
		mapLevel,
		panBy,
		REGION_INTERACTIVE_OPACITY,
		REGION_LEVELS,
		regionOpacity,
		regionsView,
		resolveBadges,
		SCOTLAND_CODE,
		scotlandFraction,
		stackApart,
		scotlandView,
		START_FRACTION,
		toScreen,
		wheelZoomFactor,
		worldView,
		ZOOM_DURATION_MS,
		zoomAt,
		zoomLimits,
		type MapPoint,
		type Size,
		type View,
		type WorldMapCountry,
		type WorldMapGeometry,
		type WorldMapRegion,
		type WorldMapSelection
	} from '$lib/worldMap';

	let {
		countries,
		regions,
		selection,
		onselect
	}: {
		/** The countries with whiskies (the others are drawn as plain land). */
		countries: WorldMapCountry[];
		regions: WorldMapRegion[];
		selection: WorldMapSelection | null;
		/** A country with whiskies or a region tapped, `null` for a tap at sea. */
		onselect: (selection: WorldMapSelection | null) => void;
	} = $props();

	/** Map size before the first measurement: about a phone's. */
	const FALLBACK_SIZE: Size = { width: 360, height: 480 };
	/** Badges whose anchor is farther outside the map are left out. */
	const BADGE_MARGIN_PX = 24;
	/** Half a region badge: it always stays on the map, its line points to the land. */
	const REGION_BADGE_HALF: Size = { width: 40, height: 30 };

	let status = $state<'loading' | 'ready' | 'error'>('loading');
	// Raw: the geometry is large and never changes, the view is replaced as a whole.
	let geometry = $state.raw<WorldMapGeometry | null>(null);
	let view = $state.raw<View | null>(null);
	let hovered = $state.raw<WorldMapSelection | null>(null);
	let dragging = $state(false);
	let measuredWidth = $state(0);
	let measuredHeight = $state(0);
	let root = $state<HTMLDivElement>();
	let surface = $state<HTMLDivElement>();

	const size = $derived<Size>(
		measuredWidth > 0 && measuredHeight > 0
			? { width: measuredWidth, height: measuredHeight }
			: FALLBACK_SIZE
	);

	// Fetched only after the mount: the geometry is a static asset (1.4 MB, no
	// user data), not part of the load and its __data.json.
	onMount(() => {
		const controller = new AbortController();
		void (async () => {
			try {
				const response = await fetch(geometryUrl, { signal: controller.signal });
				if (!response.ok) throw new Error(`world map geometry answered ${response.status}`);
				geometry = (await response.json()) as WorldMapGeometry;
				status = 'ready';
			} catch {
				if (!controller.signal.aborted) status = 'error';
			}
		})();
		return () => {
			controller.abort();
			stopAnimation();
			if (frame !== null) cancelAnimationFrame(frame);
		};
	});

	// The start view once the geometry is there, again for every new size
	// (rotation, the first measurement) until the map is moved; from then on a
	// new size keeps the map point in the middle and the zoom.
	let viewSize: Size | null = null;
	let moved = false;
	$effect(() => {
		const g = geometry;
		const s = size;
		if (!g) return;
		untrack(() => {
			if (!view || !viewSize || !moved) {
				view = scotlandView(START_FRACTION, s, g);
			} else if (s.width !== viewSize.width || s.height !== viewSize.height) {
				const cx = (viewSize.width / 2 - view.x) / view.k;
				const cy = (viewSize.height / 2 - view.y) / view.k;
				view = clampView(
					{ k: view.k, x: s.width / 2 - cx * view.k, y: s.height / 2 - cy * view.k },
					s,
					g
				);
			}
			viewSize = s;
		});
	});

	const byCode = $derived(new Map(countries.map((c) => [c.code, c])));
	const byRegion = $derived(new Map(regions.map((r) => [r.region, r])));

	const countryShapes = $derived(
		geometry
			? Object.entries(geometry.countries).map(([code, shape]) => ({
					code,
					path: shape.path,
					level: mapLevel(byCode.get(code)?.bottles.length ?? 0, COUNTRY_LEVELS)
				}))
			: []
	);
	const regionShapes = $derived(
		geometry
			? SCOTTISH_REGIONS.map((region) => ({
					region,
					path: geometry!.regions[region].path,
					level: mapLevel(byRegion.get(region)?.distilleries.length ?? 0, REGION_LEVELS)
				}))
			: []
	);

	// The layers cross-fade with the zoom (not with time, so reduced motion
	// keeps it): the regions take over from REGION_INTERACTIVE_OPACITY on.
	const regionAlpha = $derived(
		geometry && view ? regionOpacity(scotlandFraction(view, size, geometry)) : 0
	);
	const regionsActive = $derived(regionAlpha >= REGION_INTERACTIVE_OPACITY);
	const limits = $derived(geometry ? zoomLimits(size, geometry) : null);

	const countryBadges = $derived.by(() => {
		if (!geometry || !view) return [];
		const g = geometry;
		const v = view;
		const badges = countries.flatMap((country) => {
			const shape = g.countries[country.code];
			if (!shape) return [];
			const [x, y] = toScreen(shape.anchor, v);
			if (
				x < -BADGE_MARGIN_PX ||
				y < -BADGE_MARGIN_PX ||
				x > size.width + BADGE_MARGIN_PX ||
				y > size.height + BADGE_MARGIN_PX
			) {
				return [];
			}
			const large = country.code === SCOTLAND_CODE;
			const name =
				(shape.box[2] - shape.box[0]) * v.k > BADGE_NAME_MIN_PX ? countryName(country.code) : null;
			const count = country.bottles.length;
			return [
				{
					country,
					x,
					y,
					name,
					large,
					...countryBadgeSize(name ? `${name} ${count}` : String(count), large)
				}
			];
		});
		// Scotland's badge leaves the competition once the regions have taken over.
		const full = resolveBadges(
			badges
				.filter((badge) => !(badge.large && regionsActive))
				.map((badge) => ({
					id: badge.country.code,
					count: badge.country.bottles.length,
					x: badge.x,
					y: badge.y,
					width: badge.width,
					height: badge.height
				}))
		);
		return badges.map((badge) => ({ ...badge, full: full.has(badge.country.code) }));
	});

	const regionBadges = $derived.by(() => {
		if (!geometry || !view) return [];
		const g = geometry;
		const v = view;
		const badges = SCOTTISH_REGIONS.map((region) => {
			const shape = g.regions[region];
			return {
				region,
				distilleries: byRegion.get(region)?.distilleries.length ?? 0,
				anchor: toScreen(shape.anchor, v),
				label: shape.label ? toScreen(shape.label, v) : null
			};
		});
		// On the map and apart; the dashed line still points to the land.
		const positions = stackApart(
			badges.map((badge) => clampToMap(badge.label ?? badge.anchor, size, REGION_BADGE_HALF)),
			REGION_BADGE_HALF
		);
		return badges.map((badge, i) => ({ ...badge, position: positions[i] }));
	});

	const showHint = $derived(
		!!geometry && !!view && !regionsActive && isBoxOnScreen(geometry.scotlandMainland, view, size)
	);

	const info = $derived.by(() => {
		if (!hovered) return null;
		if (hovered.kind === 'country') {
			const name = countryName(hovered.code);
			const country = byCode.get(hovered.code);
			return country
				? `${name}: ${formatCount(country.bottles.length, 'Whisky', 'Whiskys')} · ${formatCount(country.distilleries, 'Brennerei', 'Brennereien')}`
				: `${name}: Noch kein Whisky von hier`;
		}
		const region = byRegion.get(hovered.region);
		return region && region.distilleries.length > 0
			? `${hovered.region}: ${formatCount(region.distilleries.length, 'Brennerei', 'Brennereien')} · ${formatCount(region.bottles, 'Whisky', 'Whiskys')}`
			: `${hovered.region}: Noch kein Whisky von hier`;
	});

	const outline = (feature: WorldMapSelection | null): string | null => {
		if (!feature || !geometry) return null;
		return feature.kind === 'country'
			? (geometry.countries[feature.code]?.path ?? null)
			: geometry.regions[feature.region].path;
	};
	const selectedPath = $derived(outline(selection));
	const hoveredPath = $derived(outline(hovered));

	// ── Animation ────────────────────────────────────────────────────────────

	let animation: number | null = null;

	function stopAnimation() {
		if (animation !== null) cancelAnimationFrame(animation);
		animation = null;
	}

	/** Before the user or a flight moves the view: it is theirs now. */
	function takeOver() {
		moved = true;
		stopAnimation();
	}

	function prefersReducedMotion(): boolean {
		return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
	}

	/** Animated to the target – at once with reduced motion. */
	function animateTo(target: View, duration: number) {
		takeOver();
		if (!view || prefersReducedMotion()) {
			view = target;
			return;
		}
		const from = view;
		const flightSize = size;
		const start = performance.now();
		const step = (now: number) => {
			const t = Math.min(1, (now - start) / duration);
			view = t < 1 ? interpolateView(from, target, easeInOutCubic(t), flightSize) : target;
			animation = t < 1 ? requestAnimationFrame(step) : null;
		};
		animation = requestAnimationFrame(step);
	}

	function center(): MapPoint {
		return [size.width / 2, size.height / 2];
	}

	function zoomBy(factor: number, point: MapPoint = center()) {
		if (!geometry || !view) return;
		animateTo(zoomAt(view, factor, point, size, geometry), ZOOM_DURATION_MS);
	}

	/** Flies to a country of the list: its box at about 42 % of the map. */
	export function flyToCountry(code: string) {
		const shape = geometry?.countries[code];
		if (!geometry || !shape) return;
		animateTo(countryView(shape.box, size, geometry), FLIGHT_DURATION_MS);
	}

	/** Flies to Scotland, close enough for the regions. */
	export function flyToRegions() {
		if (!geometry) return;
		animateTo(regionsView(size, geometry), FLIGHT_DURATION_MS);
	}

	function flyToScotland() {
		if (!geometry) return;
		animateTo(scotlandView(START_FRACTION, size, geometry), FLIGHT_DURATION_MS);
	}

	function flyToWorld() {
		if (!geometry) return;
		animateTo(worldView(size, geometry), FLIGHT_DURATION_MS);
	}

	// ── Gestures ─────────────────────────────────────────────────────────────
	// Pointer positions relative to the map; moves are applied once per frame.
	// Deliberately not reactive: nothing renders them, only the view they move.

	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const pointers = new Map<number, MapPoint>();
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	let applied = new Map<number, MapPoint>();
	let press: { id: number; point: MapPoint; multi: boolean } | null = null;
	let lastTap: { time: number; point: MapPoint } | null = null;
	let frame: number | null = null;

	function local(event: { clientX: number; clientY: number }): MapPoint {
		const rect = surface!.getBoundingClientRect();
		return [event.clientX - rect.left, event.clientY - rect.top];
	}

	/** The feature under a point of the page: a badge, a region (only while active), a country. */
	function featureAt(element: Element | null): WorldMapSelection | 'land' | null {
		const target = element?.closest<HTMLElement | SVGElement>(
			'[data-code], [data-region], [data-land]'
		);
		if (!target) return null;
		if (target.dataset.region)
			return { kind: 'region', region: target.dataset.region as ScottishRegion };
		if (target.dataset.code) return { kind: 'country', code: target.dataset.code };
		return 'land';
	}

	function applyFrame() {
		frame = null;
		if (!geometry || !view) return;
		const ids = [...pointers.keys()];
		let next = view;
		if (ids.length === 1 && dragging) {
			const [x, y] = pointers.get(ids[0])!;
			const [px, py] = applied.get(ids[0]) ?? [x, y];
			next = panBy(next, x - px, y - py, size, geometry);
		} else if (ids.length >= 2) {
			// Pinch: the distance of the first two pointers zooms, their middle pans.
			const [a, b] = ids;
			const [ax, ay] = pointers.get(a)!;
			const [bx, by] = pointers.get(b)!;
			const [pax, pay] = applied.get(a) ?? [ax, ay];
			const [pbx, pby] = applied.get(b) ?? [bx, by];
			const distance = Math.hypot(ax - bx, ay - by);
			const before = Math.hypot(pax - pbx, pay - pby);
			const middle: MapPoint = [(ax + bx) / 2, (ay + by) / 2];
			if (before > 0) next = zoomAt(next, distance / before, middle, size, geometry);
			next = panBy(next, middle[0] - (pax + pbx) / 2, middle[1] - (pay + pby) / 2, size, geometry);
		}
		view = next;
		applied = new Map(pointers);
	}

	function scheduleFrame() {
		if (frame === null) frame = requestAnimationFrame(applyFrame);
	}

	function onpointerdown(event: PointerEvent) {
		if (event.button !== 0) return;
		takeOver();
		const point = local(event);
		pointers.set(event.pointerId, point);
		applied.set(event.pointerId, point);
		if (pointers.size === 1) {
			press = { id: event.pointerId, point, multi: false };
			dragging = false;
		} else if (press) {
			press.multi = true;
		}
		try {
			surface!.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointers (no active pointer) can't be captured.
		}
	}

	function onpointermove(event: PointerEvent) {
		if (!pointers.has(event.pointerId)) {
			if (event.pointerType === 'mouse') {
				const feature = featureAt(event.target as Element);
				hovered = feature === 'land' ? null : feature;
			}
			return;
		}
		const point = local(event);
		pointers.set(event.pointerId, point);
		if (press && !dragging) {
			const [sx, sy] = press.point;
			if (Math.hypot(point[0] - sx, point[1] - sy) >= DRAG_THRESHOLD_PX) dragging = true;
		}
		if (dragging || pointers.size >= 2) scheduleFrame();
	}

	function onpointerup(event: PointerEvent) {
		if (!pointers.has(event.pointerId)) return;
		const tap = press?.id === event.pointerId && !press.multi && !dragging;
		const point = pointers.get(event.pointerId)!;
		pointers.delete(event.pointerId);
		applied.delete(event.pointerId);
		if (pointers.size === 0) {
			press = null;
			dragging = false;
		}
		// With the capture the click would land on the map itself: the element
		// tapped is the one under the pointer.
		if (tap) onTap(document.elementFromPoint(event.clientX, event.clientY), point, event);
	}

	function onpointercancel(event: PointerEvent) {
		pointers.delete(event.pointerId);
		applied.delete(event.pointerId);
		if (pointers.size === 0) {
			press = null;
			dragging = false;
		}
	}

	function onTap(element: Element | null, point: MapPoint, event: PointerEvent) {
		const badge = element?.closest('button');
		const feature = featureAt(element);
		if (!badge) {
			// A second tap close by: zoom in there, no second selection.
			if (
				lastTap &&
				event.timeStamp - lastTap.time < DOUBLE_TAP_MS &&
				Math.hypot(point[0] - lastTap.point[0], point[1] - lastTap.point[1]) < DOUBLE_TAP_PX
			) {
				lastTap = null;
				zoomBy(DOUBLE_TAP_ZOOM, point);
				return;
			}
			lastTap = { time: event.timeStamp, point };
		}
		// Touch has no hover: the tap shows the same information.
		if (event.pointerType !== 'mouse') hovered = feature === 'land' ? null : feature;
		if (feature === 'land') return;
		if (feature?.kind === 'country' && !byCode.has(feature.code)) return;
		onselect(feature);
	}

	// Not passive, so the page doesn't scroll – on the map only, nowhere else.
	$effect(() => {
		const element = root;
		if (!element || status !== 'ready') return;
		const onwheel = (event: WheelEvent) => {
			if (!geometry || !view) return;
			event.preventDefault();
			takeOver();
			const rect = element.getBoundingClientRect();
			view = zoomAt(
				view,
				wheelZoomFactor(event),
				[event.clientX - rect.left, event.clientY - rect.top],
				size,
				geometry
			);
		};
		element.addEventListener('wheel', onwheel, { passive: false });
		return () => element.removeEventListener('wheel', onwheel);
	});

	/** Keyboard only: a pointer's click reaches the map, see onpointerup. */
	function onBadgeKey(event: MouseEvent, feature: WorldMapSelection) {
		if (event.detail === 0) onselect(feature);
	}

	const isSelected = (feature: WorldMapSelection) =>
		selection?.kind === feature.kind &&
		(feature.kind === 'country'
			? selection.kind === 'country' && selection.code === feature.code
			: selection.kind === 'region' && selection.region === feature.region);

	const legendTitle = $derived(regionsActive ? 'Brennereien pro Region' : 'Whiskys pro Land');
	const legendLabels = $derived(levelLabels(regionsActive ? REGION_LEVELS : COUNTRY_LEVELS));

	const controlClass =
		'flex h-11 w-11 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';
</script>

<!-- Inline position and height: the layers below depend on them, also without
     Tailwind (component tests). Never smaller than 16rem (a phone held
     sideways), like the page's min-h-64. The map is an image to assistive technology;
     the details next to it hold all of its information. -->
<div
	bind:this={root}
	class="overflow-hidden rounded-xl border border-slate-200 bg-white select-none"
	style:position="relative"
	style:height="100%"
	style:min-height="16rem"
>
	<!-- Measures an empty layer: drawing the map can't resize it. -->
	<div
		bind:clientWidth={measuredWidth}
		bind:clientHeight={measuredHeight}
		aria-hidden="true"
		style:position="absolute"
		style:inset="0"
		style:pointer-events="none"
	></div>

	{#if status === 'ready' && geometry && view}
		<div
			bind:this={surface}
			class={dragging ? 'cursor-grabbing' : 'cursor-grab'}
			style:position="absolute"
			style:inset="0"
			style:touch-action="none"
			{onpointerdown}
			{onpointermove}
			{onpointerup}
			{onpointercancel}
			onpointerleave={(event) => {
				// A finger leaves on every lift: its tap keeps showing the information.
				if (event.pointerType === 'mouse') hovered = null;
			}}
			role="presentation"
		>
			<svg
				width={size.width}
				height={size.height}
				aria-hidden="true"
				style:position="absolute"
				style:inset="0"
			>
				<g transform="translate({view.x} {view.y}) scale({view.k})" data-testid="map-view">
					<path d={geometry.sphere} class="fill-map-sea" />
					<path
						d={geometry.graticule}
						fill="none"
						class="stroke-white"
						stroke-width="0.75"
						vector-effect="non-scaling-stroke"
					/>
					{#each countryShapes as shape (shape.code)}
						<path
							d={shape.path}
							data-code={shape.code}
							class={['stroke-slate-300', LEVEL_FILL_CLASSES[shape.level]]}
							stroke-width="0.6"
							vector-effect="non-scaling-stroke"
						/>
					{/each}
					<path
						d={geometry.land}
						data-land=""
						class="fill-map-land stroke-slate-300"
						stroke-width="0.6"
						vector-effect="non-scaling-stroke"
					/>
					<!-- The regions over Scotland, separated by a line in the sea's colour
					     so neighbours of the same level (Highlands, Speyside) stay apart. -->
					<g
						opacity={regionAlpha}
						visibility={regionAlpha > 0 ? 'visible' : 'hidden'}
						pointer-events={regionsActive ? 'auto' : 'none'}
						data-testid="map-regions"
					>
						{#each regionShapes as shape (shape.region)}
							<path
								d={shape.path}
								data-region={shape.region}
								class={['stroke-map-sea', LEVEL_FILL_CLASSES[shape.level]]}
								stroke-width="1.5"
								vector-effect="non-scaling-stroke"
							/>
						{/each}
					</g>
					<path
						d={geometry.sphere}
						fill="none"
						class="stroke-slate-300"
						stroke-width="1"
						vector-effect="non-scaling-stroke"
					/>
					{#if hoveredPath && hoveredPath !== selectedPath}
						<path
							d={hoveredPath}
							fill="none"
							class="stroke-slate-900"
							stroke-width="1.2"
							vector-effect="non-scaling-stroke"
							pointer-events="none"
						/>
					{/if}
					{#if selectedPath}
						<path
							d={selectedPath}
							fill="none"
							class="stroke-slate-900"
							stroke-width="2.4"
							vector-effect="non-scaling-stroke"
							pointer-events="none"
							data-testid="map-selected"
						/>
					{/if}
				</g>
			</svg>

			<!-- Islay, Campbeltown and Inseln sit at sea, a dashed line points to their land. -->
			<svg
				width={size.width}
				height={size.height}
				aria-hidden="true"
				style:position="absolute"
				style:inset="0"
				style:pointer-events="none"
				opacity={regionAlpha}
				visibility={regionAlpha > 0 ? 'visible' : 'hidden'}
			>
				{#each regionBadges as badge (badge.region)}
					{#if badge.label}
						<line
							x1={badge.position[0]}
							y1={badge.position[1]}
							x2={badge.anchor[0]}
							y2={badge.anchor[1]}
							class="stroke-slate-700"
							stroke-width="1.5"
							stroke-dasharray="4 3"
						/>
						<circle cx={badge.anchor[0]} cy={badge.anchor[1]} r="3" class="fill-slate-700" />
					{/if}
				{/each}
			</svg>

			<!-- Badges at their anchors, not scaled with the map. -->
			{#each countryBadges as badge (badge.country.code)}
				{@const feature = { kind: 'country' as const, code: badge.country.code }}
				{@const hidden = badge.large && regionsActive}
				<button
					type="button"
					data-code={badge.country.code}
					aria-label="{countryName(badge.country.code)}: {formatCount(
						badge.country.bottles.length,
						'Whisky',
						'Whiskys'
					)}"
					aria-pressed={isSelected(feature)}
					inert={hidden}
					onclick={(event) => onBadgeKey(event, feature)}
					class="flex min-h-11 min-w-11 items-center justify-center"
					style:position="absolute"
					style:left="{badge.x}px"
					style:top="{badge.y}px"
					style:transform="translate(-50%, -50%)"
					style:opacity={badge.large ? 1 - regionAlpha : null}
					style:visibility={hidden && regionAlpha >= 1 ? 'hidden' : null}
					style:pointer-events={hidden ? 'none' : null}
				>
					{#if badge.full}
						<span
							class={[
								'flex items-center gap-1.5 rounded-full bg-white font-semibold whitespace-nowrap text-slate-900 shadow-sm',
								badge.large ? 'h-9 px-3 text-sm' : 'h-7 px-2 text-xs',
								isSelected(feature) ? 'ring-2 ring-slate-900' : 'ring-1 ring-slate-300'
							]}
						>
							<span
								class={[
									'size-2.5 shrink-0 rounded-full',
									LEVEL_BG_CLASSES[mapLevel(badge.country.bottles.length, COUNTRY_LEVELS)]
								]}
							></span>
							{#if badge.name}<span>{badge.name}</span>{/if}
							<span class="tabular-nums">{badge.country.bottles.length}</span>
						</span>
					{:else}
						<span
							class={[
								'size-3 rounded-full ring-2 ring-white',
								LEVEL_BG_CLASSES[mapLevel(badge.country.bottles.length, COUNTRY_LEVELS)]
							]}
						></span>
					{/if}
				</button>
			{/each}

			{#each regionBadges as badge (badge.region)}
				{@const feature = { kind: 'region' as const, region: badge.region }}
				<button
					type="button"
					data-region={badge.region}
					aria-label="{badge.region}: {formatCount(badge.distilleries, 'Brennerei', 'Brennereien')}"
					aria-pressed={isSelected(feature)}
					inert={!regionsActive}
					onclick={(event) => onBadgeKey(event, feature)}
					class={[
						'flex min-w-11 flex-col items-center rounded-lg bg-white px-2 py-1 text-slate-900 shadow-sm',
						isSelected(feature) ? 'ring-2 ring-slate-900' : 'ring-1 ring-slate-300'
					]}
					style:position="absolute"
					style:left="{badge.position[0]}px"
					style:top="{badge.position[1]}px"
					style:transform="translate(-50%, -50%)"
					style:opacity={regionAlpha}
					style:visibility={regionAlpha > 0 ? 'visible' : 'hidden'}
					style:pointer-events={regionsActive ? null : 'none'}
				>
					<span class="text-[10px] font-semibold tracking-wider text-slate-500 uppercase">
						{badge.region}
					</span>
					<span class="text-lg leading-tight font-semibold tabular-nums">{badge.distilleries}</span>
					<span class="text-[10px] text-slate-500">
						{badge.distilleries === 1 ? 'Brennerei' : 'Brennereien'}
					</span>
				</button>
			{/each}
		</div>

		<!-- Hint or hover information above the legend, both out of the controls' way. -->
		<div
			class="flex flex-col items-start gap-2 p-2 pr-16"
			style:position="absolute"
			style:left="0"
			style:right="0"
			style:bottom="0"
			style:pointer-events="none"
		>
			{#if info}
				<p
					class="self-center rounded-full bg-white px-3 py-1.5 text-center text-sm text-slate-900 shadow-sm ring-1 ring-slate-300"
					role="status"
				>
					{info}
				</p>
			{:else if showHint}
				<div
					style:pointer-events="auto"
					class="flex flex-wrap items-center justify-center gap-x-3 self-center rounded-2xl bg-white py-1 pr-1 pl-3 text-sm text-slate-700 shadow-sm ring-1 ring-slate-300"
				>
					<span class="text-xs sm:text-sm">Weiter hineinzoomen für die Regionen</span>
					<button
						type="button"
						onclick={flyToRegions}
						class="min-h-11 rounded-xl px-3 font-medium text-brand hover:bg-slate-100"
					>
						Regionen zeigen
					</button>
				</div>
			{/if}
			<div class="rounded-lg bg-white/90 px-2 py-1.5 text-xs text-slate-700 shadow-sm">
				<p class="font-medium">{legendTitle}</p>
				<ul class="mt-1 flex gap-2">
					{#each legendLabels as label, i (label)}
						<li class="flex items-center gap-1">
							<span class={['size-3 rounded-sm', LEVEL_BG_CLASSES[i + 1]]}></span>
							<span class="tabular-nums">{label}</span>
						</li>
					{/each}
				</ul>
			</div>
		</div>

		<div
			class="flex flex-col gap-1"
			style:position="absolute"
			style:right="0.5rem"
			style:bottom="0.5rem"
		>
			<button
				type="button"
				onclick={() => zoomBy(BUTTON_ZOOM)}
				disabled={!limits || view.k >= limits.max}
				aria-label="Hineinzoomen"
				title="Hineinzoomen"
				class={controlClass}
			>
				<Plus size={20} strokeWidth={2} aria-hidden="true" />
			</button>
			<button
				type="button"
				onclick={() => zoomBy(1 / BUTTON_ZOOM)}
				disabled={!limits || view.k <= limits.min}
				aria-label="Herauszoomen"
				title="Herauszoomen"
				class={controlClass}
			>
				<Minus size={20} strokeWidth={2} aria-hidden="true" />
			</button>
			<button
				type="button"
				onclick={flyToScotland}
				aria-label="Schottland"
				title="Schottland"
				class={controlClass}
			>
				<LocateFixed size={20} strokeWidth={2} aria-hidden="true" />
			</button>
			<button
				type="button"
				onclick={flyToWorld}
				aria-label="Welt"
				title="Welt"
				class={controlClass}
			>
				<Earth size={20} strokeWidth={2} aria-hidden="true" />
			</button>
		</div>
	{:else if status === 'error'}
		<p class="flex h-full items-center justify-center p-4 text-center text-sm text-red-900">
			Die Karte konnte nicht geladen werden.
		</p>
	{:else}
		<p
			role="status"
			class="flex h-full items-center justify-center p-4 text-center text-sm text-slate-500"
		>
			Karte wird geladen …
		</p>
	{/if}
</div>
