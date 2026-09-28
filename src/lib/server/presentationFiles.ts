// Naming scheme of the presentation files in MEDIA_PATH:
//
//   Tasting_<YYYY-MM-DD>_<alias>[_<n>][.<ext>]   e.g. Tasting_2026-10-24_Nebel.pptx
//
// Pure functions only – the database decides which names are taken (see
// tastings.ts), tastingMedia.ts does the file system work.

/** A file system step a committed change asks for, carried out by tastingMedia.ts. */
export type FileChange = { move: string; to: string } | { delete: string };

// Everything but letters (umlauts included), digits, "-" and "_" becomes "_":
// no path separators, no dots, no "..", nothing a shell or Windows chokes on.
const UNSAFE_CHARS = /[^\p{L}\p{N}_-]+/gu;

/** `Tasting_<date>_<alias>` with the alias reduced to file-name-safe characters. */
export function presentationBaseName(tastingDate: string, alias: string): string {
	const safeAlias = alias
		.normalize('NFC')
		.replace(UNSAFE_CHARS, '_')
		.replace(/_{2,}/g, '_')
		.replace(/^_+|_+$/g, '');
	return `Tasting_${tastingDate}_${safeAlias || 'Flasche'}`;
}

/** Lower-cased extension of a file name incl. the dot, '' if missing or odd. */
export function presentationExtension(fileName: string): string {
	const dot = fileName.lastIndexOf('.');
	const extension = dot > 0 ? fileName.slice(dot).toLowerCase() : '';
	return /^\.[a-z0-9]{1,10}$/.test(extension) ? extension : '';
}

/**
 * Key for comparing file names. Case-insensitive: a Windows dev machine (and
 * any case-insensitive volume) treats "Nebel" and "NEBEL" as the same file.
 */
export function fileNameKey(fileName: string): string {
	return fileName.toLocaleLowerCase('de-DE');
}

/**
 * The scheme's name for `base`, suffixed with _2, _3, … while the name is
 * taken (keys from fileNameKey) – two tastings on the same day may use the
 * same alias, and different aliases may reduce to the same safe name.
 */
export function uniquePresentationFileName(
	base: string,
	extension: string,
	taken: ReadonlySet<string>
): string {
	for (let n = 1; ; n++) {
		const candidate = `${base}${n === 1 ? '' : `_${n}`}${extension}`;
		if (!taken.has(fileNameKey(candidate))) return candidate;
	}
}

/** Every name the scheme can produce – checked before touching the disk. */
export const PRESENTATION_FILE_RE =
	/^Tasting_\d{4}-\d{2}-\d{2}_[\p{L}\p{N}_-]+(\.[a-z0-9]{1,10})?$/u;

/** An upload waiting for its database row; renamed to its final name afterwards. */
export const UPLOAD_TEMP_FILE_RE = /^\.upload-[0-9a-f-]{36}$/;
