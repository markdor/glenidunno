// Route IDs (`event.route.id`) of a tasting's participant page and its
// presentation routes, for the hooks that treat them specially: the upload
// body limit (bodyLimit.ts) and the response headers (securityHeaders.ts).

/** The participant page `/tasting/<adjective>-<animal>`, incl. its save and remove actions. */
export const TASTING_ROUTE_ID = '/tasting/[slug=tastingSlug]';

/** Download of a bottle's presentation from the participant page. */
export const TASTING_PRESENTATION_ROUTE_ID = '/tasting/[slug=tastingSlug]/presentation/[bottleId]';

/** The presentation as PDF, fetched by the viewer. */
export const TASTING_PRESENTATION_PDF_ROUTE_ID =
	'/tasting/[slug=tastingSlug]/presentation/[bottleId]/pdf';

/** The presentation viewer page. */
export const TASTING_PRESENTATION_VIEW_ROUTE_ID =
	'/tasting/[slug=tastingSlug]/presentation/[bottleId]/view';
