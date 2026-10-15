import { randomUUID } from 'node:crypto';
import { createWriteStream, openAsBlob } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { env } from '$env/dynamic/private';
import { isViewablePresentation } from '$lib/tasting';
import { logger } from './logger';
import { mediaDir } from './mediaDir';
import { fileNameKey, PDF_CACHE_FILE_RE, presentationExtension } from './presentationFiles';

// The presentation viewer renders PDFs (pdf.js in the browser). Original PDFs
// are served as they are; office files are converted by Gotenberg
// (LibreOffice) – in the background right after the upload, otherwise on the
// first view – and the result is cached in MEDIA_PATH/pdf-cache. The cache
// follows every file change via applyFileChanges (tastingMedia.ts).

/** Cache folder in MEDIA_PATH. Part of the media backup, but regenerable. */
const PDF_CACHE_DIR = 'pdf-cache';

/** A bit above Gotenberg's --api-timeout (120 s, compose.yaml): its own error answer comes first. */
export const CONVERSION_TIMEOUT_MS = 150_000;

/** Upper bound for a converted PDF: the 30 MB upload plus room for re-encoded images. */
export const MAX_PDF_BYTES = 100 * 1024 * 1024;

/** The result was dropped: the file changed while it was being converted. */
export class StalePdfError extends Error {
	constructor(file: string) {
		super(`presentation ${file} changed during its conversion`);
		this.name = 'StalePdfError';
	}
}

/** Whether the viewer needs a conversion: viewable, but not a PDF already. */
export function needsConversion(file: string): boolean {
	return isViewablePresentation(file) && presentationExtension(file) !== '.pdf';
}

// The cached PDF is the stored name plus ".pdf" in its own folder – the bare
// name with .pdf may legitimately be another bottle's original PDF. `null`
// for names outside the scheme (temp uploads, anything odd from the DB).
function cachePath(file: string): string | null {
	const name = `${file}.pdf`;
	return PDF_CACHE_FILE_RE.test(name) ? join(mediaDir(), PDF_CACHE_DIR, name) : null;
}

// Bumped by every change to a file (discardPdf). A conversion only keeps its
// result if the count is unchanged since it started: deleting a tasting frees
// its file names, and a conversion still running must not leave the old
// slides under a name a new bottle gets. Keyed by fileNameKey like the file
// system (case-insensitive volumes); lives as long as the process.
const generations = new Map<string, number>();

// Single-flight: one conversion per file and generation, shared by the
// background conversion and every view waiting for it. A new generation
// starts a new conversion instead of joining the outdated one.
const running = new Map<string, { generation: number; pdf: Promise<string> }>();

function generationOf(file: string): number {
	return generations.get(fileNameKey(file)) ?? 0;
}

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

/**
 * Path of an office file's converted PDF: from the cache, otherwise converted
 * by Gotenberg first. Throws if the file needs no conversion, Gotenberg isn't
 * configured or fails, or the file changed meanwhile (StalePdfError) – no
 * failed or stale result is ever cached.
 */
export async function ensurePdf(file: string, fetchImpl: typeof fetch = fetch): Promise<string> {
	const cached = cachePath(file);
	if (!cached || !needsConversion(file)) throw new Error(`no convertible presentation: ${file}`);
	if (await exists(cached)) return cached;

	const key = fileNameKey(file);
	const generation = generationOf(file);
	const current = running.get(key);
	if (current?.generation === generation) return current.pdf;
	const pdf = convert(file, cached, generation, fetchImpl).finally(() => {
		if (running.get(key)?.pdf === pdf) running.delete(key);
	});
	running.set(key, { generation, pdf });
	return pdf;
}

async function convert(
	file: string,
	cached: string,
	generation: number,
	fetchImpl: typeof fetch
): Promise<string> {
	const gotenberg = env.GOTENBERG_URL;
	if (!gotenberg) throw new Error('GOTENBERG_URL is not set');

	// Under its stored name: the extension tells LibreOffice the format. Only
	// ever a file from MEDIA_PATH, never a URL for Gotenberg to fetch.
	const form = new FormData();
	form.append('files', await openAsBlob(join(mediaDir(), file)), file);

	const temp = join(mediaDir(), PDF_CACHE_DIR, `.convert-${randomUUID()}`);
	const controller = new AbortController();
	const timer = setTimeout(
		() => controller.abort(new Error('presentation conversion timed out')),
		CONVERSION_TIMEOUT_MS
	);
	try {
		const response = await fetchImpl(`${gotenberg.replace(/\/+$/, '')}/forms/libreoffice/convert`, {
			method: 'POST',
			body: form,
			signal: controller.signal
		});
		const type = response.headers.get('content-type') ?? '';
		const declared = Number(response.headers.get('content-length') ?? 0);
		if (!response.ok || !response.body || !type.startsWith('application/pdf')) {
			await response.body?.cancel();
			throw new Error(`gotenberg answered ${response.status} with ${type || 'no content type'}`);
		}
		if (declared > MAX_PDF_BYTES) {
			await response.body.cancel();
			throw new Error(`converted pdf too large: ${declared} bytes`);
		}

		// Atomically into the cache: a temp file first, renamed when complete.
		await mkdir(join(mediaDir(), PDF_CACHE_DIR), { recursive: true });
		await pipeline(
			Readable.fromWeb(response.body as NodeReadableStream<Uint8Array>),
			limitSize(MAX_PDF_BYTES),
			createWriteStream(temp)
		);
		if (generationOf(file) !== generation) throw new StalePdfError(file);
		await rename(temp, cached);
		// Changed between the check and the rename: drop the result again.
		if (generationOf(file) !== generation) {
			await rm(cached, { force: true });
			throw new StalePdfError(file);
		}
		return cached;
	} finally {
		clearTimeout(timer);
		await rm(temp, { force: true });
	}
}

// Counts the bytes on their way to disk – Content-Length may be missing.
function limitSize(max: number): Transform {
	let size = 0;
	return new Transform({
		transform(chunk: Buffer, _encoding, callback) {
			size += chunk.length;
			callback(size > max ? new Error(`converted pdf larger than ${max} bytes`) : null, chunk);
		}
	});
}

/**
 * The file's PDF is stale – called for every file change (applyFileChanges):
 * bumps the generation, so a conversion still running for the old content
 * drops its result, and deletes the cached PDF. Never creates the folder.
 */
export async function discardPdf(file: string): Promise<void> {
	const cached = cachePath(file);
	if (!cached) return;
	generations.set(fileNameKey(file), generationOf(file) + 1);
	await rm(cached, { force: true });
}

/**
 * Starts converting a freshly stored office file without waiting for it – the
 * save doesn't either. Errors only end up in the log, the viewer converts on
 * the first view instead. Without GOTENBERG_URL (local development) nothing
 * happens.
 */
export function convertInBackground(file: string): void {
	if (!needsConversion(file)) return;
	if (!env.GOTENBERG_URL) {
		logger.debug({ file }, 'no GOTENBERG_URL, presentation conversion skipped');
		return;
	}
	ensurePdf(file).catch((err: unknown) => {
		if (err instanceof StalePdfError) logger.info({ file }, err.message);
		else logger.error({ err, file }, 'presentation conversion failed');
	});
}
