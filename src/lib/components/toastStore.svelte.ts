export type ToastVariant = 'error' | 'success' | 'info';

interface ToastEntry {
	id: string;
	variant: ToastVariant;
	message: string;
}

const DEFAULT_DURATION_MS = 5000;

let toasts = $state<ToastEntry[]>([]);

function dismiss(id: string) {
	toasts = toasts.filter((t) => t.id !== id);
}

function show(variant: ToastVariant, message: string, durationMs = DEFAULT_DURATION_MS) {
	const id = crypto.randomUUID();
	toasts = [...toasts, { id, variant, message }];
	setTimeout(() => dismiss(id), durationMs);
	return id;
}

export const toast = {
	get toasts() {
		return toasts;
	},
	show,
	dismiss
};
