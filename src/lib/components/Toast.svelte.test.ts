import { describe, test, expect, beforeEach } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page } from 'vitest/browser';
import Toast from './Toast.svelte';
import { toast } from './toastStore.svelte';

beforeEach(() => {
	for (const t of [...toast.toasts]) toast.dismiss(t.id);
});

describe('Toast', () => {
	test('renders an error toast with role=alert', async () => {
		render(Toast);
		toast.show('error', 'Eintrag konnte nicht gespeichert werden', 10_000);

		const alertToast = page.getByRole('alert');
		await expect.element(alertToast).toBeVisible();
		await expect.element(alertToast).toHaveTextContent('Eintrag konnte nicht gespeichert werden');
	});

	test('renders success and info toasts with role=status', async () => {
		render(Toast);
		toast.show('success', 'Gespeichert', 10_000);
		toast.show('info', 'Zur Info', 10_000);

		// role="status" has no accessible name from content per the ARIA spec, so
		// match on text and assert the role separately via element count.
		await expect.element(page.getByText('Gespeichert')).toBeVisible();
		await expect.element(page.getByText('Zur Info')).toBeVisible();
		expect(page.getByRole('status').elements()).toHaveLength(2);
	});

	test('removes the toast when the close button is clicked', async () => {
		render(Toast);
		toast.show('info', 'Schließbar', 10_000);
		await expect.element(page.getByText('Schließbar')).toBeVisible();

		await page.getByRole('button', { name: 'Schließen' }).click();
		await expect.element(page.getByText('Schließbar')).not.toBeInTheDocument();
	});

	test('shows multiple toasts stacked at once', async () => {
		render(Toast);
		toast.show('error', 'Erster Fehler', 10_000);
		toast.show('success', 'Zweiter Erfolg', 10_000);

		await expect.element(page.getByText('Erster Fehler')).toBeVisible();
		await expect.element(page.getByText('Zweiter Erfolg')).toBeVisible();
	});
});
