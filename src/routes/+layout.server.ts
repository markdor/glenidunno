import type { LayoutServerLoad } from './$types';

// Expose a minimal, safe view of the current user to every page so the header
// can render the username dropdown (and the Admin link for admins).
export const load: LayoutServerLoad = ({ locals }) => {
	if (!locals.user) return { user: null };
	return {
		user: {
			id: locals.user.id,
			username: locals.user.username,
			isAdmin: Boolean(locals.user.isAdmin)
		}
	};
};
