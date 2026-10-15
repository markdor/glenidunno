import { env } from '$env/dynamic/private';
import { isNotNull } from 'drizzle-orm';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { formatCount } from '$lib/tasting';
import type * as Schema from './db/schema';
import { tastingBottle } from './db/schema';
import { logger } from './logger';
import {
	discardPdf,
	ensurePdf,
	hasPdf,
	needsConversion,
	StalePdfError,
	waitForGotenberg
} from './presentationPdf';
import { StartupJobError, type StartupJob } from './startupJobs';

type Db = BetterSQLite3Database<typeof Schema>;

/**
 * The viewer's PDFs of all stored office presentations, also the imported
 * history (#27). After a deployment only the missing ones; the admin's button
 * converts all of them again. One after the other, so Gotenberg isn't flooded
 * – a view of the same file meanwhile shares the conversion (single-flight).
 */
export function presentationPdfJob(db: Db): StartupJob {
	return {
		id: '2026-10-presentation-pdfs',
		title: 'PDFs für den Präsentations-Viewer',
		description:
			'Wandelt die hochgeladenen Office-Präsentationen per Gotenberg in PDF um. Nach einem Deployment nur die fehlenden, „Neu starten“ erzeugt alle neu.',
		async run({ trigger, progress }) {
			const stored = db
				.selectDistinct({ file: tastingBottle.presentationFile })
				.from(tastingBottle)
				.where(isNotNull(tastingBottle.presentationFile))
				.all()
				.flatMap((row) => (row.file && needsConversion(row.file) ? [row.file] : []));
			const todo: string[] = [];
			for (const file of stored) {
				if (trigger === 'manual' || !(await hasPdf(file))) todo.push(file);
			}
			if (todo.length === 0) return 'Keine Präsentation umzuwandeln.';

			if (!env.GOTENBERG_URL) {
				throw new StartupJobError('GOTENBERG_URL is not set', 'GOTENBERG_URL ist nicht gesetzt.');
			}
			if (!(await waitForGotenberg())) {
				throw new StartupJobError('gotenberg unreachable', 'Gotenberg ist nicht erreichbar.');
			}

			let failed = 0;
			progress(0, todo.length);
			for (const [index, file] of todo.entries()) {
				try {
					if (trigger === 'manual') await discardPdf(file);
					await ensurePdf(file);
				} catch (err: unknown) {
					// Changed meanwhile: its own background conversion takes over.
					if (!(err instanceof StalePdfError)) {
						failed++;
						logger.error({ err, file }, 'presentation pdf job: conversion failed');
					}
				}
				progress(index + 1, todo.length);
			}

			if (failed > 0) {
				throw new StartupJobError(
					`${failed} of ${todo.length} conversions failed`,
					`${failed} von ${formatCount(todo.length, 'Präsentation', 'Präsentationen')} ließen sich nicht umwandeln, Details im Server-Log.`
				);
			}
			return `${formatCount(todo.length, 'Präsentation', 'Präsentationen')} umgewandelt.`;
		}
	};
}
