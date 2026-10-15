import { redirectNotFound, requireUser } from './authGuards';
import { db } from './db';
import { findParticipant, type Participant } from './tastings';

/**
 * The logged-in user's participation in the tasting behind `slug`, for the
 * participant page and the presentation viewer. Unknown slug and a user who
 * doesn't take part – the admin included – end in the very same redirect as
 * every other missing page. Separate from authGuards.ts, which needs no
 * database.
 */
export function requireParticipant(locals: App.Locals, slug: string): Participant {
	const user = requireUser(locals);
	const participant = findParticipant(db, slug, user.id);
	if (!participant) redirectNotFound();
	return participant;
}
