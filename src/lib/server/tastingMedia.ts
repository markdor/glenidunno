import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { isViewablePresentation } from '$lib/tasting';
import { TASTING_PRESENTATION_MAX_BYTES, TASTING_PRESENTATION_NAME_LENGTH } from '$lib/validation';
import { logger } from './logger';
import { mediaDir } from './mediaDir';
import {
	presentationExtension,
	PRESENTATION_FILE_RE,
	UPLOAD_TEMP_FILE_RE,
	type FileChange
} from './presentationFiles';
import { convertInBackground, discardPdf, ensurePdf, needsConversion } from './presentationPdf';

// Presentation uploads (usually PowerPoint) live as plain files in MEDIA_PATH,
// named after the scheme in presentationFiles.ts; their converted PDFs in a
// cache folder next to them (presentationPdf.ts).

/** A stored presentation: its file in MEDIA_PATH plus the original name. */
export type StoredPresentation = { file: string; name: string };

/** An upload written to a temporary file, waiting for its database row. */
export type PendingUpload = { tempFile: string; name: string; extension: string };

/** The upload's original name without any client-side path parts. */
function originalName(upload: File): string {
	return upload.name.split(/[\\/]/).pop()?.trim() ?? '';
}

// Defence in depth: only names the scheme (or the temp naming) can produce
// ever reach path.join, whatever ends up in the database.
function isOwnFile(file: string): boolean {
	return PRESENTATION_FILE_RE.test(file) || UPLOAD_TEMP_FILE_RE.test(file);
}

/**
 * Field-level check of an optional upload. An empty file input arrives as a
 * 0-byte File without a name and means "no new presentation".
 */
export function checkPresentationUpload(upload: FormDataEntryValue | null): {
	upload: File | null;
	error: 'invalid' | null;
} {
	if (!(upload instanceof File) || upload.size === 0) return { upload: null, error: null };
	if (
		upload.size > TASTING_PRESENTATION_MAX_BYTES ||
		originalName(upload).length > TASTING_PRESENTATION_NAME_LENGTH.max
	) {
		return { upload: null, error: 'invalid' };
	}
	return { upload, error: null };
}

/**
 * Writes the upload byte for byte to a temporary file. Only once the database
 * accepted the save does it move to its final name (applyFileChanges) – a
 * re-upload under the same alias must not overwrite the previous file before
 * that, the save may still be refused (alias taken, entry closed).
 */
export async function stageUpload(upload: File): Promise<PendingUpload> {
	const tempFile = `.upload-${randomUUID()}`;
	await mkdir(mediaDir(), { recursive: true });
	await writeFile(join(mediaDir(), tempFile), Buffer.from(await upload.arrayBuffer()));
	const name = originalName(upload) || 'Praesentation';
	return { tempFile, name, extension: presentationExtension(name) };
}

/**
 * Carries out the moves and deletions a committed change asks for, in order.
 * Never throws: the database is already committed, a failed step is logged.
 *
 * The central hook of the PDF cache as well: after every step – also a failed
 * one – the PDFs of all names involved are stale, and a stored office file
 * gets converted in the background.
 */
export async function applyFileChanges(changes: readonly FileChange[]): Promise<void> {
	for (const change of changes) {
		let stored: string | null = null;
		try {
			if ('move' in change) {
				if (!isOwnFile(change.move) || !isOwnFile(change.to)) {
					throw new Error('unexpected presentation file name');
				}
				await rename(join(mediaDir(), change.move), join(mediaDir(), change.to));
				stored = change.to;
			} else {
				if (!isOwnFile(change.delete)) throw new Error('unexpected presentation file name');
				await rm(join(mediaDir(), change.delete), { force: true });
			}
		} catch (err) {
			logger.error({ err, change }, 'presentation file change failed');
		}
		// Only after the step: a conversion that read the old file meanwhile
		// sees the new generation and drops its result (presentationPdf.ts).
		for (const file of 'move' in change ? [change.move, change.to] : [change.delete]) {
			try {
				await discardPdf(file);
			} catch (err) {
				logger.error({ err, file }, 'presentation pdf cleanup failed');
			}
		}
		if (stored) convertInBackground(stored);
	}
}

// RFC 6266: plain ASCII fallback plus the exact name as UTF-8.
function contentDisposition(name: string): string {
	const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * A file from MEDIA_PATH as an attachment, `null` if it is gone. Always with
 * nosniff and a sandbox CSP: an uploaded HTML or SVG file must never render
 * (and run scripts) on the app's origin.
 */
async function fileResponse(
	path: string,
	contentType: string,
	name: string
): Promise<Response | null> {
	let size: number;
	try {
		size = (await stat(path)).size;
	} catch {
		return null;
	}
	const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
	return new Response(body, {
		headers: {
			'content-type': contentType,
			'content-length': String(size),
			'content-disposition': contentDisposition(name),
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
}

function missingFile(file: string): null {
	logger.warn({ file }, 'presentation file missing on disk');
	return null;
}

/**
 * Download response for a stored presentation, `null` if the file is gone.
 * Served with a neutral content type, under the name the caller picked (the
 * original one only after the reveal).
 */
export async function presentationResponse(
	presentation: StoredPresentation
): Promise<Response | null> {
	if (!PRESENTATION_FILE_RE.test(presentation.file)) return null;
	const path = join(mediaDir(), presentation.file);
	return (
		(await fileResponse(path, 'application/octet-stream', presentation.name)) ??
		missingFile(presentation.file)
	);
}

/**
 * The presentation as PDF for the viewer, `null` if it can't be viewed or its
 * file is gone. Original PDFs come straight from MEDIA_PATH, office files
 * from the PDF cache – converted first if needed, which throws if that fails.
 * Named after the stored file with ".pdf": no original name before the reveal.
 */
export async function presentationPdfResponse(file: string): Promise<Response | null> {
	if (!PRESENTATION_FILE_RE.test(file) || !isViewablePresentation(file)) return null;
	const source = join(mediaDir(), file);
	let pdf = source;
	if (needsConversion(file)) {
		// A vanished file is a 404 like on the download, not a failed conversion.
		try {
			await stat(source);
		} catch {
			return missingFile(file);
		}
		pdf = await ensurePdf(file);
	}
	const name = `${file.slice(0, file.length - presentationExtension(file).length)}.pdf`;
	return (await fileResponse(pdf, 'application/pdf', name)) ?? missingFile(file);
}
