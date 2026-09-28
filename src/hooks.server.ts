import { redirect, type Handle } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { evaluateGuard } from '$lib/server/guard';
import { getSecurityHeaders } from '$lib/server/securityHeaders';

// Lets Better Auth own everything under /auth/* (sign-in, magic-link verify, …).
// For all other paths svelteKitHandler just calls resolve() and the chain
// continues to the session + guard handles below.
const authHandle: Handle = ({ event, resolve }) =>
	svelteKitHandler({ event, resolve, auth, building: false });

// Populates locals from the session cookie so downstream code (guard, layout,
// route loads) can read the current user without re-parsing the request.
const sessionHandle: Handle = async ({ event, resolve }) => {
	const result = await auth.api.getSession({ headers: event.request.headers });
	event.locals.user = result?.user ?? null;
	event.locals.session = result?.session ?? null;
	return resolve(event);
};

// Closed app: nothing is public except the login page, the health check, the
// Better Auth endpoints, static assets and – by exact route ID – the tasting
// participant link. The decision itself lives in evaluateGuard so it can be
// unit-tested without a full request. event.route.id is already set here,
// also for __data.json requests and action POSTs.
const guardHandle: Handle = ({ event, resolve }) => {
	const decision = evaluateGuard(event.url.pathname, {
		authenticated: Boolean(event.locals.user),
		routeId: event.route.id
	});

	switch (decision.action) {
		case 'redirect':
			throw redirect(302, decision.location);
		default:
			return resolve(event);
	}
};

// Route-specific security headers (see securityHeaders.ts). Set after
// resolve() so pages, __data.json, action responses and error pages get them.
const securityHeadersHandle: Handle = async ({ event, resolve }) => {
	const response = await resolve(event);
	for (const [name, value] of Object.entries(getSecurityHeaders(event.route.id))) {
		response.headers.set(name, value);
	}
	return response;
};

export const handle = sequence(authHandle, sessionHandle, guardHandle, securityHeadersHandle);
