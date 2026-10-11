import type { PageServerLoad } from './$types';
import { redirectNotFound } from '$lib/server/authGuards';

// Every path no other route matches – among them the old token links
// (/tasting/<token>) the slug matcher rejects – lands on the dashboard like
// every other missing page, on direct calls and client-side navigation alike.
// It runs after the auth guard: anonymous users are on their way to /login
// already. Existing static files, missing /_app/* assets (answered by
// SvelteKit before routing) and Better Auth's /auth/* never get here.
//
// Deliberately no requireUser(): the guard lets the bare /auth through, and an
// anonymous visit there should follow the redirect on to /login rather than
// end on a 401 error page.
export const load: PageServerLoad = () => redirectNotFound();
