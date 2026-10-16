import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { RequestEvent } from '@sveltejs/kit';
import { DISTILLERY_PROMPT_LENGTH, EMAIL_LENGTH } from '$lib/validation';

vi.mock('$lib/server/db', async () => {
	const Database = (await import('better-sqlite3')).default;
	const { drizzle } = await import('drizzle-orm/better-sqlite3');
	const { runMigrations } = await import('$lib/server/db/migrate');
	const schema = await import('$lib/server/db/schema');
	const sqlite = new Database(':memory:');
	runMigrations(sqlite, './drizzle');
	const db = drizzle(sqlite, { schema });
	return { db, schema };
});

vi.mock('$lib/server/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }
}));

// One job that runs until the test lets it finish.
const testJob = vi.hoisted(() => ({ finish: (_summary: string) => {} }));
vi.mock('$lib/server/startupJobList', () => ({
	STARTUP_JOBS: [
		{
			id: '2026-01-test',
			title: 'Testjob',
			description: 'Läuft, bis der Test ihn beendet.',
			run: () => new Promise<string>((resolve) => (testJob.finish = resolve))
		}
	]
}));

import { eq } from 'drizzle-orm';
import { db } from '$lib/server/db';
import {
	appSetting,
	distillery,
	distilleryResearchCall,
	session,
	tasting,
	tastingBottle,
	tastingParticipant,
	user
} from '$lib/server/db/schema';
import { DEFAULT_RESEARCH_RULES } from '$lib/server/distilleryResearch';
import { logger } from '$lib/server/logger';
import { createTasting } from '$lib/server/tastings';
import { actions, load } from './+page.server';

/** Every missing page and missing admin right gets exactly this response. */
const NOT_FOUND_REDIRECT = { status: 303, location: '/?notice=not-found' };

const ADMIN = { id: 'admin-id', username: 'admin', isAdmin: true };

function makeEvent(form: Record<string, string>, currentUser: unknown = ADMIN): RequestEvent {
	const fd = new FormData();
	for (const [k, v] of Object.entries(form)) fd.append(k, v);
	const request = new Request('http://localhost/admin', { method: 'POST', body: fd });
	return { request, locals: { user: currentUser, session: null } } as unknown as RequestEvent;
}

function loadEvent(currentUser: unknown) {
	return {
		locals: { user: currentUser, session: null },
		depends: vi.fn()
	} as unknown as Parameters<typeof load>[0];
}

function insertUser(opts: { id?: string; email: string; username: string; isAdmin?: boolean }) {
	const id = opts.id ?? randomUUID();
	db.insert(user)
		.values({
			id,
			name: opts.username,
			email: opts.email,
			emailVerified: true,
			username: opts.username,
			isAdmin: opts.isAdmin ?? false,
			createdAt: new Date(),
			updatedAt: new Date()
		})
		.run();
	return id;
}

/** Makes the user a participant of a fresh tasting (together with the admin). */
function takePart(userId: string) {
	createTasting(db, {
		name: 'Herbst-Tasting',
		tastingDate: '2026-10-24',
		participantUserIds: [ADMIN.id, userId]
	});
}

function addSession(userId: string, id = `sess-${userId}`) {
	db.insert(session)
		.values({
			id,
			expiresAt: new Date(Date.now() + 1000),
			token: `tok-${id}`,
			createdAt: new Date(),
			updatedAt: new Date(),
			userId
		})
		.run();
}

beforeEach(() => {
	db.delete(session).run();
	// Participations restrict deleting their users, so the tastings go first.
	db.delete(tasting).run();
	db.delete(user).run();
	db.delete(distillery).run();
	db.delete(distilleryResearchCall).run();
	db.delete(appSetting).run();
	// The current admin always exists (bootstrap guarantees this in prod).
	insertUser({ id: ADMIN.id, email: 'admin@glenidunno.de', username: 'admin', isAdmin: true });
});

describe('admin load', () => {
	it('throws 401 without a session', () => {
		expect(() => load(loadEvent(null))).toThrowError(expect.objectContaining({ status: 401 }));
	});

	it('redirects a non-admin to the dashboard', () => {
		expect(() => load(loadEvent({ id: 'x', username: 'u', isAdmin: false }))).toThrowError(
			expect.objectContaining(NOT_FOUND_REDIRECT)
		);
	});

	it('returns the users for an admin', () => {
		const result = load(loadEvent(ADMIN)) as { users: unknown[] };
		expect(result.users.length).toBe(1);
	});

	it('tells per user whether they are deactivated and took part in a tasting', () => {
		const anna = insertUser({ email: 'anna@glenidunno.de', username: 'anna' });
		insertUser({ email: 'ben@glenidunno.de', username: 'ben' });
		takePart(anna);
		db.update(user).set({ deactivatedAt: new Date() }).where(eq(user.id, anna)).run();

		const { users } = load(loadEvent(ADMIN)) as {
			users: Array<{ username: string; deactivated: boolean; hasParticipation: boolean }>;
		};
		expect(
			users.map(({ username, deactivated, hasParticipation }) => ({
				username,
				deactivated,
				hasParticipation
			}))
		).toEqual([
			{ username: 'admin', deactivated: false, hasParticipation: true },
			{ username: 'anna', deactivated: true, hasParticipation: true },
			{ username: 'ben', deactivated: false, hasParticipation: false }
		]);
	});
});

describe('admin create', () => {
	it('creates a whitelisted user', async () => {
		const result = await actions.create(
			makeEvent({ email: 'new@glenidunno.de', username: 'newbie' })
		);
		expect(result).toEqual({ action: 'create', created: true });
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.email === 'new@glenidunno.de');
		expect(row).toMatchObject({ username: 'newbie', isAdmin: false });
	});

	it('stores the admin flag when provided', async () => {
		await actions.create(
			makeEvent({ email: 'boss@glenidunno.de', username: 'boss', isAdmin: 'on' })
		);
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.email === 'boss@glenidunno.de');
		expect(row).toMatchObject({ isAdmin: true });
	});

	it('rejects an invalid email', async () => {
		const result = await actions.create(makeEvent({ email: 'nope', username: 'x' }));
		expect(result).toMatchObject({ status: 400, data: { fieldErrors: { email: 'invalid' } } });
	});

	it('accepts an email at exactly the maximum length', async () => {
		const email = `${'a'.repeat(EMAIL_LENGTH.max - '@glenidunno.de'.length)}@glenidunno.de`;
		expect(email.length).toBe(EMAIL_LENGTH.max);
		const result = await actions.create(makeEvent({ email, username: 'longmail' }));
		expect(result).toEqual({ action: 'create', created: true });
	});

	it('rejects an email longer than the shared maximum', async () => {
		const email = `${'a'.repeat(EMAIL_LENGTH.max - '@glenidunno.de'.length + 1)}@glenidunno.de`;
		expect(email.length).toBe(EMAIL_LENGTH.max + 1);
		const result = await actions.create(makeEvent({ email, username: 'toolongmail' }));
		expect(result).toMatchObject({ status: 400, data: { fieldErrors: { email: 'invalid' } } });
	});

	it('rejects an invalid username pattern', async () => {
		const result = await actions.create(
			makeEvent({ email: 'shortname@glenidunno.de', username: 'a' })
		);
		expect(result).toMatchObject({ status: 400, data: { fieldErrors: { username: 'invalid' } } });
	});

	it('requires email and username', async () => {
		const result = await actions.create(makeEvent({ email: '', username: '' }));
		expect(result).toMatchObject({
			status: 400,
			data: { fieldErrors: { email: 'required', username: 'required' } }
		});
	});

	it('returns 409 on a duplicate email', async () => {
		insertUser({ email: 'dupe@glenidunno.de', username: 'dupe' });
		const result = await actions.create(
			makeEvent({ email: 'dupe@glenidunno.de', username: 'other' })
		);
		expect(result).toMatchObject({ status: 409, data: { fieldErrors: { email: 'taken' } } });
	});

	it('returns 409 on a duplicate username', async () => {
		insertUser({ email: 'dupe-user@glenidunno.de', username: 'dupeuser' });
		const result = await actions.create(
			makeEvent({ email: 'other@glenidunno.de', username: 'dupeuser' })
		);
		expect(result).toMatchObject({ status: 409, data: { fieldErrors: { username: 'taken' } } });
	});

	it('logs and returns 500 on an unexpected (non-UNIQUE) database error', async () => {
		const err = new Error('disk full');
		const insertSpy = vi.spyOn(db, 'insert').mockImplementationOnce(() => {
			throw err;
		});

		const result = await actions.create(makeEvent({ email: 'x@glenidunno.de', username: 'xx' }));
		expect(result).toMatchObject({
			status: 500,
			data: { action: 'create', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'admin create user failed');

		insertSpy.mockRestore();
	});
});

describe('admin update', () => {
	it('updates a user', async () => {
		const id = insertUser({ email: 'u@glenidunno.de', username: 'u' });
		const result = await actions.update(
			makeEvent({ id, email: 'u2@glenidunno.de', username: 'u2' })
		);
		expect(result).toMatchObject({ action: 'update', updated: true });
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.id === id);
		expect(row).toMatchObject({ email: 'u2@glenidunno.de', username: 'u2' });
	});

	it('blocks an admin from demoting themselves', async () => {
		// isAdmin omitted => checkbox off, but self-demotion must be ignored.
		const result = await actions.update(
			makeEvent({ id: ADMIN.id, email: 'admin@glenidunno.de', username: 'admin' })
		);
		expect(result).toMatchObject({ updated: true, selfDemoteBlocked: true });
		const row = db
			.select()
			.from(user)
			.all()
			.find((u) => u.id === ADMIN.id);
		expect(row?.isAdmin).toBe(true);
	});

	it('returns 404 for an unknown id', async () => {
		const result = await actions.update(
			makeEvent({ id: 'ghost', email: 'g@glenidunno.de', username: 'ghost' })
		);
		expect(result).toMatchObject({
			status: 404,
			data: {
				userMessage:
					'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
			}
		});
	});

	it('returns 400 without an id', async () => {
		const result = await actions.update(makeEvent({ email: 'g@glenidunno.de', username: 'g' }));
		expect(result).toMatchObject({
			status: 400,
			data: { userMessage: 'Eintrag konnte nicht verarbeitet werden.' }
		});
	});

	it('returns 409 when the new email collides', async () => {
		const id = insertUser({ email: 'one@glenidunno.de', username: 'one' });
		insertUser({ email: 'two@glenidunno.de', username: 'two' });
		const result = await actions.update(
			makeEvent({ id, email: 'two@glenidunno.de', username: 'one' })
		);
		expect(result).toMatchObject({ status: 409, data: { fieldErrors: { email: 'taken' } } });
	});

	it('rejects an invalid email with a validation error', async () => {
		const id = insertUser({ email: 'v@glenidunno.de', username: 'v' });
		const result = await actions.update(makeEvent({ id, email: 'nope', username: 'v' }));
		expect(result).toMatchObject({
			status: 400,
			data: { action: 'update', fieldErrors: { email: 'invalid' } }
		});
	});

	it('logs and returns 500 on an unexpected (non-UNIQUE) database error', async () => {
		const id = insertUser({ email: 'e@glenidunno.de', username: 'e' });
		const err = new Error('disk full');
		const updateSpy = vi.spyOn(db, 'update').mockImplementationOnce(() => {
			throw err;
		});

		const result = await actions.update(
			makeEvent({ id, email: 'e2@glenidunno.de', username: 'e2' })
		);
		expect(result).toMatchObject({
			status: 500,
			data: { action: 'update', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'admin update user failed');

		updateSpy.mockRestore();
	});
});

describe('admin delete', () => {
	it('deletes a user and cascades their sessions', async () => {
		const id = insertUser({ email: 'gone@glenidunno.de', username: 'gone' });
		db.insert(session)
			.values({
				id: 'sess-1',
				expiresAt: new Date(Date.now() + 1000),
				token: 'tok-1',
				createdAt: new Date(),
				updatedAt: new Date(),
				userId: id
			})
			.run();

		const result = await actions.delete(makeEvent({ id }));
		expect(result).toEqual({ action: 'delete', deleted: true });
		expect(
			db
				.select()
				.from(user)
				.all()
				.find((u) => u.id === id)
		).toBeUndefined();
		// Forced logout: the session is gone too.
		expect(db.select().from(session).all().length).toBe(0);
	});

	it('refuses to delete the current admin (self)', async () => {
		const result = await actions.delete(makeEvent({ id: ADMIN.id }));
		expect(result).toMatchObject({
			status: 400,
			data: { userMessage: 'Du kannst deinen eigenen Eintrag nicht löschen.' }
		});
		expect(
			db
				.select()
				.from(user)
				.all()
				.find((u) => u.id === ADMIN.id)
		).toBeDefined();
	});

	it('returns 404 for an unknown id', async () => {
		const result = await actions.delete(makeEvent({ id: 'ghost' }));
		expect(result).toMatchObject({
			status: 404,
			data: {
				userMessage:
					'Dieser Benutzer wurde nicht gefunden – möglicherweise wurde er bereits gelöscht.'
			}
		});
	});

	it('returns 400 without an id', async () => {
		const result = await actions.delete(makeEvent({}));
		expect(result).toMatchObject({
			status: 400,
			data: { userMessage: 'Eintrag konnte nicht verarbeitet werden.' }
		});
	});

	it('deactivates a user who took part in a tasting instead of deleting them', async () => {
		const id = insertUser({ email: 'anna@glenidunno.de', username: 'anna' });
		takePart(id);
		addSession(id);

		expect(await actions.delete(makeEvent({ id }))).toEqual({
			action: 'delete',
			deactivated: true
		});
		const row = db.select().from(user).where(eq(user.id, id)).get();
		expect(row).toMatchObject({ email: 'anna@glenidunno.de', username: 'anna' });
		expect(row?.deactivatedAt).toBeInstanceOf(Date);
		// Forced logout as with a delete.
		expect(db.select().from(session).all()).toEqual([]);
	});

	it('keeps the first deactivation time on a second click', async () => {
		const id = insertUser({ email: 'anna@glenidunno.de', username: 'anna' });
		takePart(id);
		const first = new Date('2026-10-01T12:00:00Z');
		db.update(user).set({ deactivatedAt: first }).where(eq(user.id, id)).run();

		expect(await actions.delete(makeEvent({ id }))).toEqual({
			action: 'delete',
			deactivated: true
		});
		expect(db.select().from(user).where(eq(user.id, id)).get()?.deactivatedAt).toEqual(first);
	});

	it('keeps the email and username of a deactivated user taken', async () => {
		const id = insertUser({ email: 'anna@glenidunno.de', username: 'anna' });
		takePart(id);
		await actions.delete(makeEvent({ id }));

		expect(
			await actions.create(makeEvent({ email: 'anna@glenidunno.de', username: 'anna2' }))
		).toMatchObject({ status: 409, data: { fieldErrors: { email: 'taken' } } });
		expect(
			await actions.create(makeEvent({ email: 'anna2@glenidunno.de', username: 'anna' }))
		).toMatchObject({ status: 409, data: { fieldErrors: { username: 'taken' } } });
	});

	it('refuses to deactivate the current admin (self) as well', async () => {
		takePart(insertUser({ email: 'anna@glenidunno.de', username: 'anna' }));
		expect(await actions.delete(makeEvent({ id: ADMIN.id }))).toMatchObject({ status: 400 });
		expect(db.select().from(user).where(eq(user.id, ADMIN.id)).get()?.deactivatedAt).toBeNull();
	});

	it('logs and returns 500 on an unexpected database error', async () => {
		const id = insertUser({ email: 'boom@glenidunno.de', username: 'boom' });
		const err = new Error('disk full');
		const deleteSpy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
			throw err;
		});

		const result = await actions.delete(makeEvent({ id }));
		expect(result).toMatchObject({
			status: 500,
			data: { action: 'delete', userMessage: 'Da ist etwas schiefgelaufen.' }
		});
		expect(logger.error).toHaveBeenCalledWith({ err }, 'admin delete user failed');

		deleteSpy.mockRestore();
	});
});

describe('admin startup jobs', () => {
	const jobs = () => (load(loadEvent(ADMIN)) as { startupJobs: { status: string }[] }).startupJobs;

	it('lists the jobs and reloads on their own dependency', () => {
		const event = loadEvent(ADMIN);
		const { startupJobs } = load(event) as { startupJobs: unknown[] };
		expect(startupJobs).toEqual([
			expect.objectContaining({ id: '2026-01-test', title: 'Testjob', status: 'pending' })
		]);
		expect(event.depends).toHaveBeenCalledWith('app:startup-jobs');
	});

	it('restarts a job without waiting for it, but never twice at once', async () => {
		expect(await actions.restartJob(makeEvent({ id: '2026-01-test' }))).toEqual({
			action: 'restartJob',
			restarted: true
		});
		expect(jobs()).toEqual([expect.objectContaining({ status: 'running' })]);

		expect(await actions.restartJob(makeEvent({ id: '2026-01-test' }))).toMatchObject({
			status: 409,
			data: { action: 'restartJob', userMessage: 'Dieser Job läuft bereits.' }
		});

		testJob.finish('erledigt');
		await vi.waitFor(() =>
			expect(jobs()).toEqual([
				expect.objectContaining({ status: 'succeeded', message: 'erledigt' })
			])
		);
	});

	it('answers an unknown job with 404', async () => {
		expect(await actions.restartJob(makeEvent({ id: 'nope' }))).toMatchObject({
			status: 404,
			data: { action: 'restartJob', userMessage: 'Diesen Job gibt es nicht.' }
		});
	});

	it('is for admins only', async () => {
		await expect(
			actions.restartJob(makeEvent({ id: '2026-01-test' }, { id: 'u', isAdmin: false }))
		).rejects.toMatchObject(NOT_FOUND_REDIRECT);
	});
});

describe('admin guards on actions', () => {
	it('rejects create from a non-admin', async () => {
		await expect(
			actions.create(
				makeEvent({ email: 'x@glenidunno.de', username: 'x' }, { id: 'u', isAdmin: false })
			)
		).rejects.toMatchObject(NOT_FOUND_REDIRECT);
	});
});

/** A tasting with the admin's bottles of these distilleries, inserted directly. */
function tastingWith(id: string, date: string, distilleries: string[]) {
	db.insert(tasting)
		.values({ id, slug: `slug-${id}`, name: id, tastingDate: date, createdAt: new Date() })
		.run();
	db.insert(tastingParticipant)
		.values({ id: `${id}-p`, tastingId: id, userId: ADMIN.id, createdAt: new Date() })
		.run();
	distilleries.forEach((name, index) => {
		db.insert(tastingBottle)
			.values({
				id: `${id}-${index}`,
				participantId: `${id}-p`,
				slot: index + 1,
				alias: `${id}${index}`,
				distillery: name,
				abv: 46,
				smoke: 1,
				cask: 1,
				value: 1,
				updatedAt: new Date()
			})
			.run();
	});
}

function researchCall(nameKey: string, costMicroUsd: number) {
	db.insert(distilleryResearchCall)
		.values({
			createdAt: new Date(),
			nameKey,
			stage: 1,
			model: 'claude-opus-5-5',
			inputTokens: 1,
			outputTokens: 1,
			cacheCreationInputTokens: 0,
			cacheReadInputTokens: 0,
			webSearchRequests: 1,
			webFetchRequests: 0,
			costMicroUsd
		})
		.run();
}

type DistilleryData = {
	distilleries: Array<{ key: string; name: string; costMicroUsd: number }>;
	researchCostMicroUsd: number;
	researchPrompt: { text: string; custom: boolean };
};

describe('admin distilleries', () => {
	beforeEach(() => {
		// Long revealed – and one far ahead, still in the entry.
		tastingWith('past', '2020-01-01', ['Ardbeg', 'Blend', 'Bushmills']);
		tastingWith('future', '2999-01-01', ['Geheimbrennerei']);
	});

	it('loads only distilleries of revealed tastings, the costs of all and the prompt', () => {
		researchCall('ardbeg', 400_000);
		researchCall('geheimbrennerei', 100_000);

		const data = load(loadEvent(ADMIN)) as unknown as DistilleryData;

		expect(data.distilleries.map((d) => [d.key, d.name, d.costMicroUsd])).toEqual([
			['ardbeg', 'Ardbeg', 400_000],
			['bushmills', 'Bushmills', 0]
		]);
		// Blind: no trace of the unrevealed distillery anywhere in the data.
		expect(JSON.stringify(data)).not.toMatch(/geheimbrennerei/i);
		expect(data.researchCostMicroUsd).toBe(500_000);
		expect(data.researchPrompt).toEqual({ text: DEFAULT_RESEARCH_RULES, custom: false });
	});

	it("stores the admin's values", async () => {
		const result = await actions.updateDistillery(
			makeEvent({ key: 'ardbeg', country: ' Schottland ', region: 'Islay', capacity: '2.400.000' })
		);

		expect(result).toEqual({ action: 'updateDistillery', updated: true });
		expect(db.select().from(distillery).get()).toMatchObject({
			nameKey: 'ardbeg',
			country: 'Schottland',
			countryState: 'admin',
			region: 'Islay',
			regionState: 'admin',
			capacity: 2_400_000,
			capacityState: 'admin'
		});
	});

	it.each([
		[{ country: 'Irland', region: 'Islay', capacity: '' }, { region: 'invalid' }],
		[{ country: '', region: 'Islay', capacity: '' }, { region: 'invalid' }],
		[{ country: 'x'.repeat(61), region: '', capacity: '' }, { country: 'invalid' }],
		[{ country: 'Japan', region: '', capacity: '1,5' }, { capacity: 'invalid' }],
		[{ country: 'Japan', region: '', capacity: '0' }, { capacity: 'invalid' }]
	])('rejects %o with field errors', async (fields, fieldErrors) => {
		const result = await actions.updateDistillery(makeEvent({ key: 'ardbeg', ...fields }));

		expect(result).toMatchObject({
			status: 400,
			data: { action: 'updateDistillery', key: 'ardbeg', fieldErrors }
		});
		expect(db.select().from(distillery).all()).toEqual([]);
	});

	it('answers 404 for a distillery that is not in the table', async () => {
		for (const key of ['geheimbrennerei', 'nowhere']) {
			const result = await actions.updateDistillery(
				makeEvent({ key, country: 'Japan', region: '', capacity: '' })
			);
			expect(result).toMatchObject({
				status: 404,
				data: { action: 'updateDistillery', userMessage: expect.any(String) }
			});
		}
		expect(db.select().from(distillery).all()).toEqual([]);
	});

	it('answers 500 with a generic text when storing fails', async () => {
		const spy = vi.spyOn(db, 'transaction').mockImplementationOnce(() => {
			throw new Error('disk full');
		});
		const result = await actions.updateDistillery(
			makeEvent({ key: 'ardbeg', country: 'Japan', region: '', capacity: '' })
		);
		spy.mockRestore();

		expect(result).toMatchObject({
			status: 500,
			data: { action: 'updateDistillery', userMessage: expect.any(String) }
		});
		expect(JSON.stringify(result)).not.toContain('disk full');
		expect(logger.error).toHaveBeenCalled();
	});

	it('saves the research prompt as a deviation', async () => {
		const result = await actions.saveResearchPrompt(
			makeEvent({ prompt: '  Regel 1\r\nRegel 2 \r\n' })
		);

		expect(result).toEqual({ action: 'saveResearchPrompt', saved: true });
		const data = load(loadEvent(ADMIN)) as unknown as DistilleryData;
		expect(data.researchPrompt).toEqual({ text: 'Regel 1\nRegel 2', custom: true });
	});

	it('removes the deviation when the default text is saved', async () => {
		await actions.saveResearchPrompt(makeEvent({ prompt: 'Eigene Regeln' }));
		await actions.saveResearchPrompt(makeEvent({ prompt: DEFAULT_RESEARCH_RULES }));

		expect(db.select().from(appSetting).all()).toEqual([]);
	});

	it.each([
		['', 'required'],
		['   ', 'required'],
		['x'.repeat(DISTILLERY_PROMPT_LENGTH.max + 1), 'tooLong']
	])('rejects the prompt %#', async (prompt, code) => {
		const result = await actions.saveResearchPrompt(makeEvent({ prompt }));

		expect(result).toMatchObject({
			status: 400,
			data: { action: 'saveResearchPrompt', fieldErrors: { prompt: code } }
		});
		expect(db.select().from(appSetting).all()).toEqual([]);
	});

	it('resets the research prompt to the default', async () => {
		await actions.saveResearchPrompt(makeEvent({ prompt: 'Eigene Regeln' }));

		const result = await actions.resetResearchPrompt(makeEvent({}));

		expect(result).toEqual({ action: 'resetResearchPrompt', reset: true });
		expect(db.select().from(appSetting).all()).toEqual([]);
	});

	it.each([
		['saveResearchPrompt', 'insert'],
		['resetResearchPrompt', 'delete']
	] as const)('answers 500 when %s fails', async (action, method) => {
		const spy = vi.spyOn(db, method).mockImplementationOnce(() => {
			throw new Error('disk full');
		});
		const result = await actions[action](makeEvent({ prompt: 'Eigene Regeln' }));
		spy.mockRestore();

		expect(result).toMatchObject({
			status: 500,
			data: { action, userMessage: expect.any(String) }
		});
	});

	it.each(['updateDistillery', 'saveResearchPrompt', 'resetResearchPrompt'])(
		'redirects a non-admin away from %s',
		async (action) => {
			await expect(
				actions[action](
					makeEvent(
						{ key: 'ardbeg', country: 'Japan', prompt: 'Eigene Regeln' },
						{ id: 'u', isAdmin: false }
					)
				)
			).rejects.toMatchObject(NOT_FOUND_REDIRECT);
			expect(db.select().from(distillery).all()).toEqual([]);
			expect(db.select().from(appSetting).all()).toEqual([]);
		}
	);
});
