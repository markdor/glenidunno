import { env } from '$env/dynamic/private';

// Presentation uploads (usually PowerPoint) and their converted PDFs live as
// plain files in MEDIA_PATH – in Docker the named volume glenidunno-media,
// locally ./media. Its own module, so tastingMedia.ts (uploads, moves) and
// presentationPdf.ts (PDF cache) share it without importing each other.
export function mediaDir(): string {
	return env.MEDIA_PATH || './media';
}
