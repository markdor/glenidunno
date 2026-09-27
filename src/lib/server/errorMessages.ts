/**
 * User-facing message for unexpected server errors, shown via the global toast.
 * Single source of truth so every fail(500) payload stays worded identically –
 * the technical detail belongs in the pino log, never in the response.
 */
export const UNEXPECTED_ERROR_MESSAGE = 'Da ist etwas schiefgelaufen.';
