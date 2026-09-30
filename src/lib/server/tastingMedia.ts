import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { env } from '$env/dynamic/private';
import { TASTING_PRESENTATION_MAX_BYTES, TASTING_PRESENTATION_NAME_LENGTH } from '$lib/validation';
import { logger } from './logger';
import {
	presentationExtension,
	PRESENTATION_FILE_RE,
	UPLOAD_TEMP_FILE_RE,
	type FileChange
} from './presentationFiles';

// Presentation uploads (usually PowerPoint) live as plain files in MEDIA_PATH –
// in Docker the named volume glenidunno-media, locally ./media – named after
// the scheme in presentationFiles.ts.
function mediaDir(): string {
	return env.MEDIA_PATH || './media';
}

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
 */
export async function applyFileChanges(changes: readonly FileChange[]): Promise<void> {
	for (const change of changes) {
		try {
			if ('move' in change) {
				if (!isOwnFile(change.move) || !isOwnFile(change.to)) {
					throw new Error('unexpected presentation file name');
				}
				await rename(join(mediaDir(), change.move), join(mediaDir(), change.to));
			} else {
				if (!isOwnFile(change.delete)) throw new Error('unexpected presentation file name');
				await rm(join(mediaDir(), change.delete), { force: true });
			}
		} catch (err) {
			logger.error({ err, change }, 'presentation file change failed');
		}
	}
}

// RFC 6266: plain ASCII fallback plus the exact name as UTF-8.
function contentDisposition(name: string): string {
	const fallback = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
	return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/**
 * Download response for a stored presentation, `null` if the file is gone.
 * Always served as an attachment with a neutral content type and nosniff:
 * an uploaded HTML or SVG file must never render (and run scripts) on the
 * app's origin. The download keeps the original file name.
 */
export async function presentationResponse(
	presentation: StoredPresentation
): Promise<Response | null> {
	if (!PRESENTATION_FILE_RE.test(presentation.file)) return null;
	const path = join(mediaDir(), presentation.file);
	let size: number;
	try {
		size = (await stat(path)).size;
	} catch {
		logger.warn({ file: presentation.file }, 'presentation file missing on disk');
		return null;
	}
	const body = Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
	return new Response(body, {
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(size),
			'content-disposition': contentDisposition(presentation.name),
			'x-content-type-options': 'nosniff',
			'content-security-policy': "default-src 'none'; sandbox"
		}
	});
}
