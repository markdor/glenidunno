import { redirect, type ServerLoad } from '@sveltejs/kit';

// Our own codes plus the ones Better Auth's magic-link plugin emits on a failed
// verification. They all render the same generic message — keeping them
// indistinguishable avoids leaking why verification failed.
const KNOWN_ERRORS = new Set(['expired', 'invalid', 'used', 'INVALID_TOKEN', 'EXPIRED_TOKEN']);

export const load: ServerLoad = ({ locals, url }) => {
	if (locals.user) throw redirect(303, '/');
	const errorParam = url.searchParams.get('error');
	const error = errorParam && KNOWN_ERRORS.has(errorParam) ? errorParam : null;
	return { error };
};
