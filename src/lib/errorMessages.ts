/**
 * User-facing message for unexpected errors: every fail(500) payload (shown via
 * the global toast) and the error page (+error.svelte). Single source of truth
 * so it stays worded identically – the technical detail belongs in the pino
 * log, never in the response. Lives outside $lib/server because the error page
 * renders in the browser too.
 */
export const UNEXPECTED_ERROR_MESSAGE = 'Da ist etwas schiefgelaufen.';
