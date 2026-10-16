import { env } from '$env/dynamic/private';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { formatCount } from '$lib/tasting';
import type * as Schema from './db/schema';
import {
	applyResearchResult,
	getResearchRules,
	recordResearchCall,
	refreshTarget,
	researchTargets,
	type ResearchMode
} from './distilleries';
import { anthropicMessages, researchDistillery, type CreateMessage } from './distilleryResearch';
import { logger } from './logger';
import { StartupJobError, type StartupJob } from './startupJobs';

// Runs of the distillery research over all distilleries of released tastings.
// Triggers: the daily timer at 21:00 (distilleryResearchTimer.ts), "Jetzt
// auflösen", the startup job after a deployment and its "Neu starten". Never
// after saving a bottle (rising costs would tell the admin that somebody
// entered a new distillery), never in a load.

type Db = BetterSQLite3Database<typeof Schema>;

/** Counts of one run – no names: they may come from tastings not revealed yet. */
export type ResearchSummary = { total: number; failed: number };

export type ResearchRunOptions = {
	createMessage: CreateMessage;
	progress?: (done: number, total: number) => void;
	now?: () => Date;
};

/**
 * One run: the distilleries one after the other, each checked again right
 * before its API call. A failure of one distillery is counted, logged and
 * leaves its open values as they were; the run goes on with the next one.
 */
export async function runDistilleryResearch(
	db: Db,
	mode: ResearchMode,
	{ createMessage, progress, now = () => new Date() }: ResearchRunOptions
): Promise<ResearchSummary> {
	const targets = researchTargets(db, mode, now());
	// Fixed for the whole run: the system prompt stays cacheable.
	const rules = getResearchRules(db).text;
	let failed = 0;
	progress?.(0, targets.length);
	for (const [index, planned] of targets.entries()) {
		const target = refreshTarget(db, planned, mode);
		if (target) {
			logger.debug({ distillery: target.name, fields: target.fields }, 'researching distillery');
			try {
				const outcome = await researchDistillery(
					{ name: target.name, fields: target.fields, knownCountry: target.knownCountry, rules },
					{ createMessage, onCall: (call) => recordResearchCall(db, target.key, call, now()) }
				);
				applyResearchResult(db, target.key, outcome.facts, rules, mode, now());
				if (!outcome.complete) {
					failed++;
					logger.debug({ distillery: target.name }, 'distillery research incomplete');
				}
			} catch (err: unknown) {
				failed++;
				logger.error({ err }, 'distillery research failed');
			}
		}
		progress?.(index + 1, targets.length);
	}
	logger.info({ mode, total: targets.length, failed }, 'distillery research run finished');
	return { total: targets.length, failed };
}

type Queued = {
	mode: ResearchMode;
	options: ResearchRunOptions;
	promise: Promise<ResearchSummary>;
	resolve: (summary: ResearchSummary) => void;
	reject: (reason: unknown) => void;
};

// One run at a time in this process (enough for one app instance, like the
// other locks). No distillery is paid twice: a follow-up checks every target
// again against the database.
let running = false;
let queued: Queued | null = null;

function start(db: Db, mode: ResearchMode, options: ResearchRunOptions): Promise<ResearchSummary> {
	running = true;
	const run = runDistilleryResearch(db, mode, options);
	const next = () => {
		running = false;
		const followUp = queued;
		queued = null;
		if (followUp) {
			start(db, followUp.mode, followUp.options).then(followUp.resolve, followUp.reject);
		}
	};
	run.then(next, next);
	return run;
}

/**
 * Starts a run, or – while one is running – queues at most one follow-up for
 * afterwards. Every trigger meanwhile shares that follow-up (`manual` if any of
 * them asks for it, with the latest caller's options): a run that listed its
 * distilleries before "Jetzt auflösen" would miss the new ones otherwise.
 */
export function requestDistilleryResearch(
	db: Db,
	mode: ResearchMode,
	options: ResearchRunOptions
): Promise<ResearchSummary> {
	if (!running) return start(db, mode, options);
	if (queued) {
		if (mode === 'manual') queued.mode = 'manual';
		queued.options = options;
		return queued.promise;
	}
	let resolve!: Queued['resolve'];
	let reject!: Queued['reject'];
	const promise = new Promise<ResearchSummary>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	queued = { mode, options, promise, resolve, reject };
	return promise;
}

/** Read on every run, not at module load: a key added to `.env` counts after a restart. */
function apiKey(): string | undefined {
	return env.ANTHROPIC_API_KEY || undefined;
}

/**
 * Timer and "Jetzt auflösen": a run in the background, failures only in the
 * log. Without a key nothing happens – a no-op on `debug`, like
 * convertInBackground() without GOTENBERG_URL.
 */
export function researchDistilleriesInBackground(
	db: Db,
	createClient: (apiKey: string) => CreateMessage = anthropicMessages
): void {
	const key = apiKey();
	if (!key) {
		logger.debug('no ANTHROPIC_API_KEY, distillery research skipped');
		return;
	}
	requestDistilleryResearch(db, 'pending', { createMessage: createClient(key) }).catch(
		(err: unknown) => {
			logger.error({ err }, 'distillery research run failed');
		}
	);
}

/**
 * After a deployment the values never researched of all distilleries of
 * released tastings; "Neu starten" additionally the ones not found. Like every
 * startup job it only runs until it succeeded once – the timer takes over then.
 */
export function distilleryFactsJob(
	db: Db,
	createClient: (apiKey: string) => CreateMessage = anthropicMessages
): StartupJob {
	return {
		id: '2026-10-distillery-facts',
		title: 'Destillerie-Daten',
		description:
			'Recherchiert per Claude API Land, Region und Kapazität der Destillerien freigegebener Tastings. Nach einem Deployment die noch nie recherchierten Werte, „Neu starten“ zusätzlich die nicht gefundenen.',
		async run({ trigger, progress }) {
			const key = apiKey();
			if (!key) {
				throw new StartupJobError(
					'ANTHROPIC_API_KEY is not set',
					'ANTHROPIC_API_KEY ist nicht gesetzt.'
				);
			}
			const { total, failed } = await requestDistilleryResearch(
				db,
				trigger === 'manual' ? 'manual' : 'pending',
				{ createMessage: createClient(key), progress }
			);
			if (total === 0) return 'Keine Destillerie zu recherchieren.';
			const distilleries = formatCount(total, 'Destillerie', 'Destillerien');
			if (failed > 0) {
				throw new StartupJobError(
					`${failed} of ${total} distillery researches failed`,
					`${failed} von ${distilleries} ließen sich nicht vollständig recherchieren, Details im Server-Log.`
				);
			}
			return `${distilleries} recherchiert.`;
		}
	};
}
