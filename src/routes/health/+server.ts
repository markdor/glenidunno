import type { RequestHandler } from '@sveltejs/kit';

// Public liveness check for the container healthcheck (see compose.yaml) and
// any future depends_on: condition: service_healthy. No DB access on purpose:
// migrations already ran synchronously before this server started listening
// (db/index.ts), so 200 here means only "the SvelteKit server is up".
export const GET: RequestHandler = () => new Response(null, { status: 200 });
