import type { ParamMatcher } from '@sveltejs/kit';
import { TASTING_SLUG_RE } from '$lib/validation';

// Only the format: whether the tasting exists and the user takes part in it
// is decided by the route. A malformed slug (e.g. an old token link) falls
// through to the catch-all route [...rest], which redirects to the dashboard
// like any other missing page. Runs in the browser too (client-side routing),
// so no $lib/server imports here.
export const match = ((param: string): param is string =>
	TASTING_SLUG_RE.test(param)) satisfies ParamMatcher;
