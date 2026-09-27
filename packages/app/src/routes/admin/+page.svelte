<script lang="ts">
	import { untrack } from 'svelte';
	import { enhance } from '$app/forms';
	import { toast } from '$lib/components/toastStore.svelte';

	let { data, form } = $props();

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
		taken: 'Bereits vergeben'
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
</script>

<svelte:head>
	<title>Admin · Dahamm</title>
</svelte:head>

<main class="mx-auto max-w-3xl space-y-10 px-4 py-8">
	<h1 class="text-2xl font-semibold tracking-tight">Admin</h1>

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
								{#if u.id !== data.user?.id}
									<!-- cancel(), not preventDefault() in onsubmit: enhance ignores
									     defaultPrevented and would send the request anyway. -->
									<form
										method="POST"
										action="?/delete"
										use:enhance={({ cancel }) => {
											if (!confirm(`Benutzer „${u.username}" wirklich löschen?`)) cancel();
										}}
									>
										<input type="hidden" name="id" value={u.id} />
										<button
											type="submit"
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
</main>
