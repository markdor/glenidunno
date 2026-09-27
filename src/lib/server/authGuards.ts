import { error } from '@sveltejs/kit';

type CurrentUser = NonNullable<App.Locals['user']>;

export function requireUser(locals: App.Locals): CurrentUser {
	if (!locals.user) throw error(401, 'Unauthorized');
	return locals.user;
}

export function requireAdmin(locals: App.Locals): CurrentUser {
	const user = requireUser(locals);
	if (!user.isAdmin) throw error(403, 'Forbidden');
	return user;
}
