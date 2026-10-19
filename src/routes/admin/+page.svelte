<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import AdminDistilleryTable from '$lib/components/AdminDistilleryTable.svelte';
	import TastingCard from '$lib/components/TastingCard.svelte';
	import { confirmDialog } from '$lib/components/confirmDialogStore.svelte';
	import { toast } from '$lib/components/toastStore.svelte';
	import { BOTTLING_TOO_LONG } from '$lib/distilleryTable';
	import {
		STARTUP_JOBS_DEPENDENCY,
		STARTUP_JOBS_POLL_MS,
		type StartupJobStatus
	} from '$lib/startupJobs';
	import { formatTastingTimestamp } from '$lib/tasting';

	let { data, form } = $props();

	// Live while a job or a variant search runs: reload until none does any more.
	$effect(() => {
		const running =
			data.startupJobs.some((job) => job.status === 'running') || data.variantSearchRunning;
		if (!running) return;
		const timer = setInterval(() => void invalidate(STARTUP_JOBS_DEPENDENCY), STARTUP_JOBS_POLL_MS);
		return () => clearInterval(timer);
	});

	const JOB_STATUS: Record<StartupJobStatus, { label: string; class: string }> = {
		pending: { label: 'Ausstehend', class: 'bg-slate-100 text-slate-700' },
		running: { label: 'Läuft', class: 'bg-sky-100 text-sky-900' },
		succeeded: { label: 'Erfolgreich', class: 'bg-emerald-100 text-emerald-900' },
		failed: { label: 'Fehlgeschlagen', class: 'bg-red-100 text-red-900' }
	};

	let editingId = $state<string | null>(null);

	$effect(() => {
		if (form?.userMessage) {
			// untrack: see login/+page.svelte for why this is needed around toast.show().
			untrack(() => toast.show('error', form.userMessage as string));
		}
	});

	const errorText: Record<string, string> = {
		required: 'Pflichtfeld',
		invalid: 'Ungültig',
		taken: 'Bereits vergeben',
		tooLong: 'Zu lang',
		bottlingTooLong: BOTTLING_TOO_LONG
	};

	function fieldError(field: string): string | null {
		const code = form?.fieldErrors?.[field as keyof typeof form.fieldErrors];
		return code ? (errorText[code] ?? 'Ungültig') : null;
	}

	function fmtDate(d: Date | string): string {
		return new Date(d).toLocaleDateString('de-DE', {
			day: '2-digit',
			month: '2-digit',
			year: 'numeric'
		});
	}

	// A user who took part in a tasting is deactivated instead of deleted (their
	// bottles stay in the tasting) – the dialog says so up front.
	function confirmDelete(event: MouseEvent, u: { username: string; hasParticipation: boolean }) {
		const message = u.hasParticipation
			? `Benutzer „${u.username}" hat an Tastings teilgenommen und wird deshalb deaktiviert statt gelöscht: Er kann sich nicht mehr anmelden, bleibt in seinen Tastings aber als „${u.username} (inaktiv)" sichtbar.`
			: `Benutzer „${u.username}" wirklich löschen?`;
		const confirmLabel = u.hasParticipation ? 'Deaktivieren' : 'Löschen';
		confirmDialog.submit(event, message, { variant: 'danger', confirmLabel });
	}
</script>

<svelte:head>
	<title>Admin · Glen Idunno</title>
</svelte:head>

<main class="mx-auto max-w-3xl space-y-10 px-4 py-8">
	<h1 class="text-2xl font-semibold tracking-tight">Admin</h1>

	<!-- The only way into the tasting management. -->
	<TastingCard summary={data.tastingSummary} />

	<!-- ── Create user ───────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="text-lg font-semibold">Benutzer anlegen</h2>

		{#if form?.action === 'create' && form?.created}
			<p class="rounded-lg bg-emerald-50 px-4 py-2 text-sm text-emerald-900">Benutzer angelegt.</p>
		{/if}

		<form
			method="POST"
			action="?/create"
			use:enhance
			class="space-y-3 rounded-xl border border-slate-200 bg-white p-4"
		>
			<div class="grid gap-3 sm:grid-cols-2">
				<div class="space-y-1">
					<label for="c-email" class="block text-sm font-medium text-slate-700">E-Mail *</label>
					<input
						id="c-email"
						name="email"
						type="email"
						required
						value={form?.action === 'create' ? (form?.email ?? '') : ''}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
					/>
					{#if form?.action === 'create' && fieldError('email')}
						<p class="text-xs text-red-600">{fieldError('email')}</p>
					{/if}
				</div>
				<div class="space-y-1">
					<label for="c-username" class="block text-sm font-medium text-slate-700"
						>Benutzername *</label
					>
					<input
						id="c-username"
						name="username"
						required
						value={form?.action === 'create' ? (form?.username ?? '') : ''}
						class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
					/>
					{#if form?.action === 'create' && fieldError('username')}
						<p class="text-xs text-red-600">{fieldError('username')}</p>
					{/if}
				</div>
				<label class="flex items-center gap-2 py-2 text-sm text-slate-700 sm:col-span-2">
					<input name="isAdmin" type="checkbox" class="h-4 w-4 rounded border-slate-300" />
					Admin
				</label>
			</div>
			<button
				type="submit"
				class="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
			>
				Anlegen
			</button>
		</form>
	</section>

	<!-- ── User list ─────────────────────────────────────────────── -->
	<section class="space-y-4">
		<h2 class="text-lg font-semibold">Benutzer ({data.users.length})</h2>

		<ul class="space-y-2">
			{#each data.users as u (u.id)}
				<li class="rounded-xl border border-slate-200 bg-white p-4">
					{#if editingId === u.id}
						<!-- Inline editing -->
						<form
							method="POST"
							action="?/update"
							use:enhance={() => {
								return async ({ update, result }) => {
									await update();
									if (result.type === 'success') editingId = null;
								};
							}}
							class="space-y-3"
						>
							<input type="hidden" name="id" value={u.id} />
							<div class="grid gap-3 sm:grid-cols-2">
								<input
									name="email"
									type="email"
									required
									value={form?.action === 'update' && form?.id === u.id ? form.email : u.email}
									class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
								/>
								<input
									name="username"
									required
									value={form?.action === 'update' && form?.id === u.id
										? form.username
										: u.username}
									class="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
								/>
								<label class="flex items-center gap-2 text-sm text-slate-700 sm:col-span-2">
									<input
										name="isAdmin"
										type="checkbox"
										checked={u.isAdmin}
										disabled={u.id === data.user?.id}
										class="h-4 w-4 rounded border-slate-300"
									/>
									Admin
									{#if u.id === data.user?.id}
										<span class="text-xs text-slate-400">(du selbst)</span>
									{/if}
								</label>
							</div>
							{#if form?.action === 'update' && form?.id === u.id && form?.fieldErrors}
								<p class="text-xs text-red-600">
									{fieldError('email') ?? fieldError('username')}
								</p>
							{/if}
							<div class="flex gap-2">
								<button
									type="submit"
									class="rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-hover"
								>
									Speichern
								</button>
								<button
									type="button"
									onclick={() => (editingId = null)}
									class="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
								>
									Abbrechen
								</button>
							</div>
						</form>
					{:else}
						<!-- Display -->
						<div class="flex items-start justify-between gap-3">
							<div class="min-w-0">
								<p class="flex items-center gap-2 font-medium">
									{u.username}
									{#if u.deactivated}
										<span class="text-sm font-normal text-slate-500">(inaktiv)</span>
									{/if}
									{#if u.isAdmin}
										<span
											class="rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase"
										>
											Admin
										</span>
									{/if}
								</p>
								<p class="truncate text-sm text-slate-500">{u.email}</p>
								<p class="text-xs text-slate-400">seit {fmtDate(u.createdAt)}</p>
							</div>
							<div class="flex shrink-0 gap-2">
								<button
									type="button"
									onclick={() => (editingId = u.id)}
									class="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
								>
									Bearbeiten
								</button>
								<!-- Deactivated users have nothing left to delete (no reactivation yet). -->
								{#if u.id !== data.user?.id && !u.deactivated}
									<form method="POST" action="?/delete" use:enhance>
										<input type="hidden" name="id" value={u.id} />
										<button
											type="button"
											onclick={(e) => confirmDelete(e, u)}
											class="rounded-lg border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50"
										>
											Löschen
										</button>
									</form>
								{/if}
							</div>
						</div>
					{/if}
				</li>
			{/each}
		</ul>
	</section>

	<!-- ── Startup jobs ──────────────────────────────────────────── -->
	<section class="space-y-4" aria-labelledby="startup-jobs">
		<div class="space-y-1">
			<h2 id="startup-jobs" class="text-lg font-semibold">Hintergrund-Jobs</h2>
			<p class="text-sm text-slate-500">
				Laufen einmal nach einem Deployment. Fehlgeschlagene und unterbrochene Jobs starten beim
				nächsten Start der App erneut – außer denen, die nur per Button starten.
			</p>
		</div>

		<ul class="space-y-2">
			{#each data.startupJobs as job (job.id)}
				{@const restartLabel = job.status === 'pending' ? 'Starten' : 'Neu starten'}
				<li class="space-y-3 rounded-xl border border-slate-200 bg-white p-4">
					<div class="flex items-start justify-between gap-3">
						<div class="min-w-0 space-y-1">
							<h3 class="font-medium break-words">{job.title}</h3>
							<p class="text-sm text-slate-500">{job.description}</p>
							{#if job.manualOnly}
								<p class="text-sm font-medium text-slate-700">
									Startet nur per Button, nie nach einem Deployment.
								</p>
							{/if}
						</div>
						<span
							class={[
								'shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium',
								JOB_STATUS[job.status].class
							]}
						>
							{JOB_STATUS[job.status].label}
						</span>
					</div>

					{#if job.status === 'running' && job.progress}
						<div class="space-y-1">
							<div
								role="progressbar"
								aria-label="Fortschritt"
								aria-valuemin={0}
								aria-valuemax={job.progress.total}
								aria-valuenow={job.progress.done}
								class="h-2 overflow-hidden rounded-full bg-slate-100"
							>
								<div
									class="h-full bg-brand"
									style:width="{job.progress.total > 0
										? (job.progress.done / job.progress.total) * 100
										: 0}%"
								></div>
							</div>
							<p class="text-sm text-slate-700">
								{job.progress.done} von {job.progress.total}
							</p>
						</div>
					{/if}
					{#if job.message}
						<p class={['text-sm', job.status === 'failed' ? 'text-red-700' : 'text-slate-700']}>
							{job.message}
						</p>
					{/if}
					{#if job.startedAt}
						<p class="text-xs text-slate-400">
							Gestartet {formatTastingTimestamp(job.startedAt)}{#if job.finishedAt}
								· beendet {formatTastingTimestamp(job.finishedAt)}{/if}
						</p>
					{/if}

					<form method="POST" action="?/restartJob" use:enhance class="flex gap-2">
						<input type="hidden" name="id" value={job.id} />
						{#if job.batchSizes.length > 0}
							<!-- The smallest batch preselected: every run of a paid job costs money.
								Explicitly, the client render inserts "Alle" before the sizes. -->
							<select
								name="limit"
								value={job.batchSizes[0]}
								disabled={job.status === 'running'}
								aria-label="Umfang: {job.title}"
								class="min-h-11 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-base text-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
							>
								{#each job.batchSizes as size (size)}
									<option value={size}>Nächste {size}</option>
								{/each}
								<option value="">Alle</option>
							</select>
						{/if}
						<button
							type="submit"
							disabled={job.status === 'running'}
							aria-label="{restartLabel}: {job.title}"
							class="min-h-11 rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
						>
							{restartLabel}
						</button>
					</form>
				</li>
			{/each}
		</ul>
	</section>

	<!-- ── Distilleries ──────────────────────────────────────────── -->
	<AdminDistilleryTable
		distilleries={data.distilleries}
		costMicroUsd={data.researchCostMicroUsd}
		prompt={data.researchPrompt}
		suggestions={data.variantSuggestions}
		searchRunning={data.variantSearchRunning}
		editErrors={(form?.action === 'updateDistillery' || form?.action === 'renameDistillery') &&
		form.key &&
		form.fieldErrors
			? {
					key: form.key,
					country: fieldError('country'),
					region: fieldError('region'),
					capacity: fieldError('capacity'),
					name: fieldError('name'),
					prefix: fieldError('prefix')
				}
			: null}
		promptError={form?.action === 'saveResearchPrompt' ? fieldError('prompt') : null}
	/>
</main>
