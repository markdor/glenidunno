import { redirect, type Actions, type ServerLoad } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';

// Visiting /logout directly does nothing destructive – logout is POST-only.
export const load: ServerLoad = () => {
	throw redirect(303, '/');
};

export const actions: Actions = {
	default: async ({ request }) => {
		await auth.api.signOut({ headers: request.headers });
		throw redirect(303, '/login');
	}
};
