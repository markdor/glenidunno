export type ConfirmVariant = 'default' | 'danger';

interface ConfirmRequest {
	message: string;
	confirmLabel: string;
	cancelLabel: string;
	variant: ConfirmVariant;
	resolve: (value: boolean) => void;
}

interface ConfirmOptions {
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: ConfirmVariant;
}

let request = $state<ConfirmRequest | null>(null);

// Resolves once the user picks an option. `use:enhance` can't await this
// directly (its cancel() must run synchronously) - callers show the dialog
// from a plain button onclick and re-submit the form themselves on true.
function ask(message: string, options: ConfirmOptions = {}): Promise<boolean> {
	return new Promise((resolve) => {
		request = {
			message,
			confirmLabel: options.confirmLabel ?? 'Bestätigen',
			cancelLabel: options.cancelLabel ?? 'Abbrechen',
			variant: options.variant ?? 'default',
			resolve
		};
	});
}

function settle(result: boolean) {
	request?.resolve(result);
	request = null;
}

export const confirmDialog = {
	get request() {
		return request;
	},
	ask,
	confirm: () => settle(true),
	cancel: () => settle(false)
};
