import { redirect, type Handle, type ServerInit } from '@sveltejs/kit';
import { sequence } from '@sveltejs/kit/hooks';
import { svelteKitHandler } from 'better-auth/svelte-kit';
import { auth } from '$lib/server/auth';
import { exceedsBodyLimit } from '$lib/server/bodyLimit';
import { db } from '$lib/server/db';
import { startDailyTimer } from '$lib/server/dailyTimer';
import { researchDistilleriesInBackground } from '$lib/server/distilleryResearchJob';
import { evaluateGuard } from '$lib/server/guard';
import { logger } from '$lib/server/logger';
import { getSecurityHeaders } from '$lib/server/securityHeaders';
import { STARTUP_JOBS } from '$lib/server/startupJobList';
import { runPendingStartupJobs } from '$lib/server/startupJobs';
import { freezeDueOrders } from '$lib/server/tastings';
import { TASTING_ORDER_HOUR, TASTING_RELEASE_HOUR } from '$lib/tasting';

// Freezes every pouring order that is out (see freezeDueOrders). Never throws:
// the timer would stop re-arming.
function freezeOrders() {
	try {
		const frozen = freezeDueOrders(db);
		if (frozen > 0) logger.info({ tastings: frozen }, 'pouring orders frozen');
	} catch (err: unknown) {
		logger.error({ err }, 'freezing the pouring orders failed');
	}
}

// After migrations and the admin bootstrap (db/index.ts): the pouring orders
// that came out while the app was down are frozen before the first request;
// then the startup jobs that haven't succeeded yet and aren't manual, in the
// background – not awaited, the app serves meanwhile (see startupJobs.ts).
// Daily at Berlin time: freezing the orders at 18:00 and the distillery
// research at 21:00 (a no-op without ANTHROPIC_API_KEY).
export const init: ServerInit = () => {
	freezeOrders();
	runPendingStartupJobs(db, STARTUP_JOBS).catch((err: unknown) => {
		logger.error({ err }, 'startup jobs failed');
	});
	startDailyTimer({ hour: TASTING_ORDER_HOUR, run: freezeOrders });
	startDailyTimer({
		hour: TASTING_RELEASE_HOUR,
		run: () => researchDistilleriesInBackground(db)
	});
};

// BODY_SIZE_LIMIT is raised for the presentation upload (Dockerfile) and would
// otherwise apply to every route – including the anonymous Better Auth
// endpoints. Runs first, before anything reads a body (see bodyLimit.ts).
const bodyLimitHandle: Handle = ({ event, resolve }) => {
	const { method, headers } = event.request;
	if (exceedsBodyLimit(event.route.id, method, headers.get('content-length'))) {
		return new Response('Payload Too Large', { status: 413 });
	}
	return resolve(event);
};

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
// Better Auth endpoints and static assets – tastings need a login too. The
// decision itself lives in evaluateGuard so it can be unit-tested without a
// full request.
const guardHandle: Handle = ({ event, resolve }) => {
	const decision = evaluateGuard(event.url.pathname, {
		authenticated: Boolean(event.locals.user)
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

export const handle = sequence(
	bodyLimitHandle,
	authHandle,
	sessionHandle,
	guardHandle,
	securityHeadersHandle
);
