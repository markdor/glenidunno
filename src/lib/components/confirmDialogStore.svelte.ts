export type ConfirmVariant = 'default' | 'danger';

interface ConfirmRequest {
	message: string;
	details: string[];
	confirmLabel: string;
	cancelLabel: string;
	variant: ConfirmVariant;
	resolve: (value: boolean) => void;
}

interface ConfirmOptions {
	/** Lines listed below the message, e.g. what an action is going to change. */
	details?: string[];
	confirmLabel?: string;
	cancelLabel?: string;
	variant?: ConfirmVariant;
}

let request = $state<ConfirmRequest | null>(null);

// Resolves once the user picks an option. `use:enhance` can't await this
// directly (its cancel() must run synchronously) - to gate a form, use
// submit() from a plain button onclick instead.
function ask(message: string, options: ConfirmOptions = {}): Promise<boolean> {
	return new Promise((resolve) => {
		request = {
			message,
			details: options.details ?? [],
			confirmLabel: options.confirmLabel ?? 'Bestätigen',
			cancelLabel: options.cancelLabel ?? 'Abbrechen',
			variant: options.variant ?? 'default',
			resolve
		};
	});
}

// Submits the form of a type="button" once the user confirms - the dialog
// can't gate use:enhance's cancel(), which must run synchronously. The form is
// looked up before the dialog opens: the browser clears currentTarget once the
// event has finished dispatching, long before the answer comes in. Not async
// on purpose, so a button outside a form throws right in its onclick instead
// of ending up as an unhandled rejection (or silently doing nothing).
function submit(event: Event, message: string, options?: ConfirmOptions): Promise<void> {
	const target = event.currentTarget;
	const form = target instanceof Element ? target.closest('form') : null;
	if (!form) throw new Error('confirmDialog.submit() needs a button inside a form');
	return ask(message, options).then((ok) => {
		if (ok) form.requestSubmit();
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
	submit,
	confirm: () => settle(true),
	cancel: () => settle(false)
};
