import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';

// Only the job list's polling; everything else (enhance) stays real.
vi.mock('$app/navigation', async (importOriginal) => ({
	...(await importOriginal<typeof import('$app/navigation')>()),
	invalidate: vi.fn()
}));

import { invalidate } from '$app/navigation';
import Page from './+page.svelte';
import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
import { toast } from '$lib/components/toastStore.svelte';
import {
	STARTUP_JOBS_DEPENDENCY,
	STARTUP_JOBS_POLL_MS,
	type StartupJobOverview
} from '$lib/startupJobs';
import type { AdminDistillery, DistilleryVariantSuggestion } from '$lib/tasting';

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

const currentUser = { id: 'admin-id', username: 'admin', isAdmin: true };

const adminUser = {
	id: 'admin-id',
	email: 'admin@glenidunno.de',
	username: 'admin',
	isAdmin: true,
	createdAt: new Date('2026-01-01'),
	deactivated: false,
	hasParticipation: true
};

const kidUser = {
	id: 'u2',
	email: 'kid@glenidunno.de',
	username: 'kid',
	isAdmin: false,
	createdAt: new Date('2026-02-01'),
	deactivated: false,
	hasParticipation: false
};

function makeData(over: Partial<Record<string, unknown>> = {}) {
	return {
		user: currentUser,
		users: [adminUser, kidUser],
		startupJobs: [] as StartupJobOverview[],
		distilleries: [] as AdminDistillery[],
		researchCostMicroUsd: 0,
		researchPrompt: { text: 'Regeln', custom: false },
		variantSuggestions: [] as DistilleryVariantSuggestion[],
		variantSearchRunning: false,
		...over
	};
}

describe('Admin page', () => {
	test('lists the users', async () => {
		render(Page, { data: makeData(), form: null });

		await expect.element(page.getByRole('heading', { name: 'Admin' })).toBeVisible();
		await expect.element(page.getByText('Benutzer (2)')).toBeVisible();
		await expect.element(page.getByText('kid@glenidunno.de')).toBeVisible();
	});

	test('hides the delete button for the current admin (self)', async () => {
		render(Page, { data: makeData(), form: null });
		// One delete button (for "kid"), none for the admin themselves.
		expect(page.getByRole('button', { name: 'Löschen' }).elements()).toHaveLength(1);
	});

	test('reveals the inline edit form for a single user', async () => {
		// Only "kid" in the list so there is exactly one Bearbeiten button.
		render(Page, { data: makeData({ users: [kidUser] }), form: null });

		await page.getByRole('button', { name: 'Bearbeiten' }).click();
		await expect.element(page.getByRole('button', { name: 'Speichern' })).toBeVisible();
		await expect.element(page.getByRole('button', { name: 'Abbrechen' })).toBeVisible();
	});

	test('closes the inline edit form on cancel', async () => {
		render(Page, { data: makeData({ users: [kidUser] }), form: null });

		await page.getByRole('button', { name: 'Bearbeiten' }).click();
		await page.getByRole('button', { name: 'Abbrechen' }).click();

		await expect.element(page.getByRole('button', { name: 'Bearbeiten' })).toBeVisible();
		expect(page.getByRole('button', { name: 'Speichern' }).elements()).toHaveLength(0);
	});

	test('marks the own entry and locks its admin flag while editing', async () => {
		render(Page, { data: makeData({ users: [adminUser] }), form: null });

		await page.getByRole('button', { name: 'Bearbeiten' }).click();

		const adminFlag = page.getByRole('checkbox', { name: 'Admin (du selbst)' });
		await expect.element(adminFlag).toBeChecked();
		await expect.element(adminFlag).toBeDisabled();
	});

	test.each([
		{ field: 'email', code: 'invalid', text: 'Ungültig' },
		{ field: 'username', code: 'taken', text: 'Bereits vergeben' },
		{ field: 'username', code: 'unexpected', text: 'Ungültig' }
	])('shows the $code error on $field in the edit form', async ({ field, code, text }) => {
		render(Page, {
			data: makeData({ users: [kidUser] }),
			form: {
				action: 'update',
				id: 'u2',
				email: 'bad',
				username: 'kid',
				fieldErrors: { [field]: code }
			}
		});

		await page.getByRole('button', { name: 'Bearbeiten' }).click();

		await expect.element(page.getByText(text)).toBeVisible();
	});

	test('shows create validation errors from the form result', async () => {
		render(Page, {
			data: makeData(),
			form: {
				action: 'create',
				email: 'bad',
				username: '',
				fieldErrors: { email: 'invalid', username: 'required' }
			}
		});

		await expect.element(page.getByText('Ungültig')).toBeVisible();
		await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
	});

	test('shows the created confirmation and the self-delete warning', async () => {
		render(Page, { data: makeData(), form: { action: 'create', created: true } });
		await expect.element(page.getByText('Benutzer angelegt.')).toBeVisible();
	});

	test('warns when a self-delete was blocked', async () => {
		render(Page, {
			data: makeData(),
			form: { action: 'delete', userMessage: 'Du kannst deinen eigenen Eintrag nicht löschen.' }
		});
		// The +page.svelte itself no longer renders the warning inline - it now
		// triggers the global toast store, rendered separately by <Toast/> in
		// +layout.svelte.
		expect(
			toast.toasts.some(
				(t) => t.variant === 'error' && /eigenen Eintrag nicht löschen/.test(t.message)
			)
		).toBe(true);
	});

	test('shows a toast for any generic action failure carrying a userMessage', async () => {
		render(Page, {
			data: makeData(),
			form: {
				action: 'delete',
				userMessage:
					'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
			}
		});
		// Not a special-cased error like self_delete - proves the effect reacts
		// to any userMessage, not just the one hardcoded reason.
		expect(
			toast.toasts.some((t) => t.variant === 'error' && /wurde nicht gefunden/.test(t.message))
		).toBe(true);
	});

	describe('delete confirmation', () => {
		// Runs against the real enhance (no $app/forms mock): the point is that
		// SvelteKit's enhance itself honours a dismissed confirm, which a stub
		// would hide. Only the delete request is intercepted.
		let deleteRequests: string[];

		beforeEach(() => {
			deleteRequests = [];
			const passThrough = window.fetch.bind(window);
			vi.spyOn(window, 'fetch').mockImplementation((input, init) => {
				const url = input instanceof Request ? input.url : String(input);
				if (!url.includes('?/delete')) return passThrough(input, init);
				deleteRequests.push(url);
				// Never settles: the tests only care whether the request was sent.
				return new Promise<Response>(() => {});
			});
		});

		afterEach(() => {
			vi.restoreAllMocks();
		});

		test('sends no request when the confirm dialog is dismissed', async () => {
			render(Page, { data: makeData(), form: null });
			render(ConfirmDialog);

			await page.getByRole('button', { name: 'Löschen' }).click();
			const dialog = page.getByRole('dialog');
			await expect.element(dialog.getByText(/kid/)).toBeVisible();
			await dialog.getByRole('button', { name: 'Abbrechen' }).click();

			expect(deleteRequests).toHaveLength(0);
		});

		test('sends the delete request once confirmed', async () => {
			render(Page, { data: makeData(), form: null });
			render(ConfirmDialog);

			await page.getByRole('button', { name: 'Löschen' }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'Löschen' }).click();

			await expect.poll(() => deleteRequests).toHaveLength(1);
		});

		test('announces a deactivation for a user who took part in a tasting', async () => {
			render(Page, {
				data: makeData({ users: [adminUser, { ...kidUser, hasParticipation: true }] }),
				form: null
			});
			render(ConfirmDialog);

			await page.getByRole('button', { name: 'Löschen' }).click();
			const dialog = page.getByRole('dialog');
			await expect
				.element(dialog.getByText(/wird deshalb deaktiviert statt gelöscht/))
				.toBeVisible();
			await dialog.getByRole('button', { name: 'Deaktivieren' }).click();

			await expect.poll(() => deleteRequests).toHaveLength(1);
		});
	});

	describe('startup jobs', () => {
		const STARTED = new Date('2026-10-15T08:00:00Z');
		const job = (over: Partial<StartupJobOverview>): StartupJobOverview => ({
			id: 'job',
			title: 'Testjob',
			description: 'Macht etwas nach dem Deployment.',
			status: 'pending',
			startedAt: null,
			finishedAt: null,
			message: null,
			progress: null,
			manualOnly: false,
			batchSizes: [],
			...over
		});
		const running = job({
			id: 'running',
			title: 'PDFs',
			status: 'running',
			startedAt: STARTED,
			progress: { done: 12, total: 109 }
		});

		afterEach(() => {
			vi.useRealTimers();
			vi.restoreAllMocks();
		});

		test('lists every job with its status, progress and message', async () => {
			render(Page, {
				data: makeData({
					startupJobs: [
						running,
						job({
							id: 'failed',
							title: 'Länder',
							status: 'failed',
							startedAt: STARTED,
							finishedAt: STARTED,
							message: 'Gotenberg ist nicht erreichbar.'
						}),
						job({
							id: 'done',
							title: 'Alt',
							status: 'succeeded',
							startedAt: STARTED,
							finishedAt: STARTED,
							message: '3 Präsentationen umgewandelt.'
						}),
						job({ id: 'new', title: 'Neu' })
					]
				}),
				form: null
			});

			const jobs = page.getByRole('region', { name: 'Hintergrund-Jobs' });
			await expect.element(jobs.getByText('Läuft', { exact: true })).toBeVisible();
			await expect.element(jobs.getByText('Fehlgeschlagen', { exact: true })).toBeVisible();
			await expect.element(jobs.getByText('Erfolgreich', { exact: true })).toBeVisible();
			await expect.element(jobs.getByText('Ausstehend', { exact: true })).toBeVisible();
			await expect.element(jobs.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '12');
			await expect.element(jobs.getByText('12 von 109')).toBeVisible();
			await expect.element(jobs.getByText('Gotenberg ist nicht erreichbar.')).toBeVisible();
			await expect
				.element(jobs.getByRole('listitem').filter({ hasText: 'Länder' }))
				.toHaveTextContent(
					/Gestartet Do\., 15\.10\.2026 um 10:00 Uhr\s*·\s*beendet Do\., 15\.10\.2026 um 10:00 Uhr/
				);

			// A running job can't be started twice, every other one can.
			await expect.element(jobs.getByRole('button', { name: 'Neu starten: PDFs' })).toBeDisabled();
			await expect.element(jobs.getByRole('button', { name: 'Neu starten: Länder' })).toBeEnabled();
			await expect.element(jobs.getByRole('button', { name: 'Starten: Neu' })).toBeEnabled();
		});

		test('reloads the job list while a job runs, and only then', async () => {
			vi.useFakeTimers();
			const view = render(Page, { data: makeData({ startupJobs: [running] }), form: null });

			await vi.advanceTimersByTimeAsync(STARTUP_JOBS_POLL_MS);
			expect(invalidate).toHaveBeenCalledWith(STARTUP_JOBS_DEPENDENCY);

			vi.mocked(invalidate).mockClear();
			await view.rerender({
				data: makeData({ startupJobs: [{ ...running, status: 'succeeded' }] }),
				form: null
			});
			await vi.advanceTimersByTimeAsync(STARTUP_JOBS_POLL_MS * 2);
			expect(invalidate).not.toHaveBeenCalled();
		});

		test('restarts a job by its id', async () => {
			const restarts: string[] = [];
			const passThrough = window.fetch.bind(window);
			vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
				const url = input instanceof Request ? input.url : String(input);
				if (!url.includes('?/restartJob')) return passThrough(input, init);
				restarts.push(String((init?.body as FormData).get('id')));
				return new Promise<Response>(() => {});
			});
			render(Page, {
				data: makeData({ startupJobs: [job({ id: 'failed', status: 'failed' })] }),
				form: null
			});

			await page.getByRole('button', { name: 'Neu starten: Testjob' }).click();

			await expect.poll(() => restarts).toEqual(['failed']);
			expect(page.getByRole('combobox').elements()).toHaveLength(0);
		});

		test('offers the batch sizes of a manual job, the smallest first, and sends the choice', async () => {
			const limits: string[] = [];
			const passThrough = window.fetch.bind(window);
			vi.spyOn(window, 'fetch').mockImplementation(async (input, init) => {
				const url = input instanceof Request ? input.url : String(input);
				if (!url.includes('?/restartJob')) return passThrough(input, init);
				limits.push(String((init?.body as FormData).get('limit')));
				return new Promise<Response>(() => {});
			});
			render(Page, {
				data: makeData({
					startupJobs: [job({ title: 'Destillerien', manualOnly: true, batchSizes: [5, 10] })]
				}),
				form: null
			});

			await expect
				.element(page.getByText('Startet nur per Button, nie nach einem Deployment.'))
				.toBeVisible();
			const size = page.getByRole('combobox', { name: 'Umfang: Destillerien' });
			await expect.element(size).toHaveValue('5');
			expect(
				size
					.getByRole('option')
					.elements()
					.map((o) => o.textContent)
			).toEqual(['Nächste 5', 'Nächste 10', 'Alle']);

			await size.selectOptions('Alle');
			await page.getByRole('button', { name: 'Starten: Destillerien' }).click();

			await expect.poll(() => limits).toEqual(['']);
		});

		test('locks the batch size while the job runs', async () => {
			render(Page, {
				data: makeData({ startupJobs: [{ ...running, manualOnly: true, batchSizes: [5, 10] }] }),
				form: null
			});

			await expect.element(page.getByRole('combobox', { name: 'Umfang: PDFs' })).toBeDisabled();
		});
	});

	test('marks a deactivated user and offers no delete for them', async () => {
		render(Page, {
			data: makeData({
				users: [adminUser, { ...kidUser, deactivated: true, hasParticipation: true }]
			}),
			form: null
		});

		await expect.element(page.getByText('(inaktiv)')).toBeVisible();
		expect(page.getByRole('button', { name: 'Löschen' }).elements()).toHaveLength(0);
		await expect.element(page.getByRole('button', { name: 'Bearbeiten' }).nth(1)).toBeVisible();
	});

	describe('distilleries', () => {
		const ardbeg: AdminDistillery = {
			key: 'ardbeg',
			name: 'Ardbeg',
			country: { value: 'Schottland', state: 'found', source: 'https://example.com/ardbeg' },
			region: { value: 'Islay', state: 'found', source: null },
			capacity: { value: null, state: 'pending', source: null },
			costMicroUsd: 250_000,
			bottles: [{ age: 10, bottling: null, bottler: null }]
		};

		afterEach(() => {
			vi.useRealTimers();
		});

		test('shows the section below the startup jobs, with the costs', async () => {
			render(Page, {
				data: makeData({ distilleries: [ardbeg], researchCostMicroUsd: 2_500_000 }),
				form: null
			});

			const section = page.getByRole('region', { name: 'Destillerien' });
			await expect.element(section.getByText('2,50 $')).toBeVisible();
			await expect
				.element(section.getByRole('cell', { name: 'Ardbeg', exact: true }))
				.toBeVisible();
			const headings = [...document.querySelectorAll('h2')].map((h) => h.textContent?.trim());
			expect(headings.slice(-2)).toEqual(['Hintergrund-Jobs', 'Destillerien']);
		});

		test('shows the field errors of a failed edit at its row', async () => {
			const { rerender } = render(Page, { data: makeData({ distilleries: [ardbeg] }), form: null });
			await page.getByRole('button', { name: 'Ardbeg bearbeiten' }).first().click();

			await rerender({
				data: makeData({ distilleries: [ardbeg] }),
				form: {
					action: 'updateDistillery',
					key: 'ardbeg',
					fieldErrors: { capacity: 'invalid' }
				}
			});

			await expect.element(page.getByText('Ungültig')).toBeVisible();
		});

		test('shows the field errors of a failed rename at its row', async () => {
			const { rerender } = render(Page, { data: makeData({ distilleries: [ardbeg] }), form: null });
			await page.getByRole('button', { name: 'Ardbeg bearbeiten' }).first().click();
			await page.getByLabelText('Alten Namen als Marke in die Abfüllung übernehmen').click();

			await rerender({
				data: makeData({ distilleries: [ardbeg] }),
				form: {
					action: 'renameDistillery',
					key: 'ardbeg',
					fieldErrors: { name: 'required', prefix: 'bottlingTooLong' }
				}
			});

			await expect.element(page.getByText('Pflichtfeld')).toBeVisible();
			await expect
				.element(page.getByText('Mit dem Präfix würde eine Abfüllung länger als 120 Zeichen.'))
				.toBeVisible();
		});

		test('shows the open suggestions of the variant search', async () => {
			render(Page, {
				data: makeData({
					distilleries: [ardbeg],
					variantSuggestions: [
						{
							id: 1,
							variantKey: 'ardbeg',
							variantName: 'Ardbeg',
							targetName: 'Ardbeg Distillery',
							kind: 'spelling',
							prefix: null,
							bottles: 1
						}
					]
				}),
				form: null
			});

			await expect
				.element(
					page.getByRole('list', { name: 'Vorschläge' }).getByText('Ardbeg → Ardbeg Distillery')
				)
				.toBeVisible();
		});

		test('reloads while a variant search runs, and only then', async () => {
			vi.useFakeTimers();
			const data = makeData({ distilleries: [ardbeg], variantSearchRunning: true });
			const view = render(Page, { data, form: null });

			await expect.element(page.getByRole('button', { name: 'Suche läuft …' })).toBeDisabled();
			await vi.advanceTimersByTimeAsync(STARTUP_JOBS_POLL_MS);
			expect(invalidate).toHaveBeenCalledWith(STARTUP_JOBS_DEPENDENCY);

			vi.mocked(invalidate).mockClear();
			await view.rerender({ data: { ...data, variantSearchRunning: false }, form: null });
			await vi.advanceTimersByTimeAsync(STARTUP_JOBS_POLL_MS * 2);
			expect(invalidate).not.toHaveBeenCalled();
		});

		test('shows a too long research prompt at the text field', async () => {
			const { rerender } = render(Page, { data: makeData(), form: null });
			await page.getByText('Recherche-Prompt').click();
			await page
				.getByRole('region', { name: 'Destillerien' })
				.getByRole('button', { name: 'Bearbeiten' })
				.click();

			await rerender({
				data: makeData(),
				form: { action: 'saveResearchPrompt', fieldErrors: { prompt: 'tooLong' } }
			});

			await expect.element(page.getByText('Zu lang')).toBeVisible();
		});
	});
});
