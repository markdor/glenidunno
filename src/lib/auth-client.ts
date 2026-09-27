import { createAuthClient } from 'better-auth/svelte';
import { magicLinkClient } from 'better-auth/client/plugins';

// baseURL defaults to the current origin in the browser; basePath must match
// the server (/auth) so requests hit the right endpoints.
export const authClient = createAuthClient({
	basePath: '/auth',
	plugins: [magicLinkClient()]
});
