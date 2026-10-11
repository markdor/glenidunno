import { error, redirect } from '@sveltejs/kit';
import { NOT_FOUND_LOCATION } from '$lib/notices';

type CurrentUser = NonNullable<App.Locals['user']>;

/**
 * Every page-level 404 and 403 ends here: the user lands on the dashboard,
 * which shows a notice. Unknown path or slug, no participation, unknown admin
 * ID and missing admin rights all get this very same response – it must not
 * reveal which cause applied, so there is no notice per cause. A redirect also
 * works for __data.json, invalidateAll() and use:enhance actions.
 */
export function redirectNotFound(): never {
	redirect(303, NOT_FOUND_LOCATION);
}

export function requireUser(locals: App.Locals): CurrentUser {
	if (!locals.user) throw error(401, 'Unauthorized');
	return locals.user;
}

export function requireAdmin(locals: App.Locals): CurrentUser {
	const user = requireUser(locals);
	if (!user.isAdmin) redirectNotFound();
	return user;
}
