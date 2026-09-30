import type { ParamMatcher } from '@sveltejs/kit';
import { TASTING_TOKEN_RE } from '$lib/validation';

// Malformed tokens never reach the public route: without a match there is no
// route (event.route.id === null), so the closed-app guard redirects anonymous
// visitors to /login. Runs in the browser too (client-side routing), so no
// $lib/server imports here.
export const match = ((param: string): param is string =>
	TASTING_TOKEN_RE.test(param)) satisfies ParamMatcher;
