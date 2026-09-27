import { describe, test, expect } from 'vitest';
import { toast } from './toastStore.svelte';

describe('toast store', () => {
	test('show() adds a toast with the given variant and message', () => {
		toast.show('error', 'Etwas ist schiefgelaufen', 10_000);
		const entry = toast.toasts.at(-1)!;
		expect(entry.variant).toBe('error');
		expect(entry.message).toBe('Etwas ist schiefgelaufen');
		toast.dismiss(entry.id);
	});

	test('multiple simultaneous toasts stack', () => {
		const before = toast.toasts.length;
		const id1 = toast.show('success', 'Erster', 10_000);
		const id2 = toast.show('info', 'Zweiter', 10_000);
		expect(toast.toasts.length).toBe(before + 2);
		toast.dismiss(id1);
		toast.dismiss(id2);
	});

	test('dismiss() removes a toast manually', () => {
		const id = toast.show('info', 'Wird geschlossen', 10_000);
		expect(toast.toasts.some((t) => t.id === id)).toBe(true);
		toast.dismiss(id);
		expect(toast.toasts.some((t) => t.id === id)).toBe(false);
	});

	test('auto-dismisses after the given duration', async () => {
		const id = toast.show('success', 'Verschwindet bald', 20);
		expect(toast.toasts.some((t) => t.id === id)).toBe(true);
		await new Promise((r) => setTimeout(r, 60));
		expect(toast.toasts.some((t) => t.id === id)).toBe(false);
	});
});
