import type { TastingBottle } from '$lib/tasting';
import {
	isRefillable,
	type BottleFacts,
	type Cask,
	type FactsBottle,
	type Finish
} from '$lib/tastingFacts';
import {
	isCaskType,
	normalizeWhiskybaseUrl,
	TASTING_ABV,
	TASTING_AGE,
	TASTING_ALIAS_LENGTH,
	TASTING_BOTTLER_LENGTH,
	TASTING_BOTTLING_LENGTH,
	TASTING_CASK_INFLUENCE,
	TASTING_CASK_LABEL_LENGTH,
	TASTING_DISTILLERY_LENGTH,
	TASTING_FINISH_MONTHS,
	TASTING_PEAT_LEVELS,
	TASTING_PRICE,
	TASTING_SCALE,
	type PeatLevel,
	type TastingAlgorithm
} from '$lib/validation';

// The bottle form of the participant page (TastingBottleForm.svelte): which
// fields the save action reads – the shared ones plus those of the tasting's
// algorithm – and their server-side validation. Field errors are short codes
// (required, invalid) the form translates.

/** Fields of every bottle (besides slot, the presentation file and its checkbox). */
const COMMON_FIELDS = [
	'alias',
	'distillery',
	'bottler',
	'bottling',
	'age',
	'whiskybaseUrl',
	'abv'
] as const;

/** The sliders of a `taste` tasting. */
export const TASTE_FIELDS = ['smoke', 'cask', 'value'] as const;

/** The facts of a `facts` tasting (checkboxes are sent as "on" only when ticked). */
export const FACTS_FIELDS = [
	'peat',
	'mainCask',
	'mainCaskRefill',
	'mainCaskLabel',
	'mainCaskInfluence',
	'finish',
	'finishRefill',
	'finishLabel',
	'finishInfluence',
	'finishMonths',
	'price',
	'priceUnknown'
] as const;

/** Select values besides the cask types. */
export const OTHER_CASK = 'other';
export const UNKNOWN_CASK = 'unknown';
export const NO_FINISH = 'none';

export type BottleFormResult = {
	/** `null` while there are field errors. */
	bottle: TastingBottle | FactsBottle | null;
	/** The sent fields as text, to show the form again after an error. */
	values: Record<string, string>;
	fieldErrors: Record<string, string>;
	/** Fields of the other algorithm came along – an outdated page, not this form. */
	foreign: boolean;
};

// One decimal place at most; trailing zeros (46.30) are fine, comma or dot.
const ABV_RE = /^\d{1,3}(?:\.\d0*)?$/;
// Euros with up to two decimals, comma or dot.
const PRICE_RE = /^\d{1,3}(?:\.\d{1,2})?$/;

/** Reads and checks the bottle fields of the tasting's algorithm. */
export function parseBottleForm(form: FormData, algorithm: TastingAlgorithm): BottleFormResult {
	const own = algorithm === 'facts' ? FACTS_FIELDS : TASTE_FIELDS;
	const other = algorithm === 'facts' ? TASTE_FIELDS : FACTS_FIELDS;
	const values: Record<string, string> = Object.fromEntries(
		[...COMMON_FIELDS, ...own].map((field) => [field, String(form.get(field) ?? '')])
	);
	const foreign = other.some((field) => form.has(field));
	const fieldErrors: Record<string, string> = {};
	const read = fieldReader(values, fieldErrors);

	const common = parseCommon(values, fieldErrors, read);
	const extra = algorithm === 'facts' ? parseFacts(values, fieldErrors, read) : parseTaste(read);

	if (Object.keys(fieldErrors).length > 0 || !common || !extra) {
		return { bottle: null, values, fieldErrors, foreign };
	}
	return { bottle: { ...common, ...extra }, values, fieldErrors, foreign };
}

type Reader = ReturnType<typeof fieldReader>;

function fieldReader(values: Record<string, string>, fieldErrors: Record<string, string>) {
	function text(field: string, max: number, required: boolean): string | null {
		const value = values[field].trim();
		if (!value) {
			if (required) fieldErrors[field] = 'required';
			return null;
		}
		if (value.length > max) fieldErrors[field] = 'invalid';
		return value;
	}

	function integer(field: string, min: number, max: number, required: boolean): number | null {
		const value = values[field].trim();
		if (!value) {
			if (required) fieldErrors[field] = 'required';
			return null;
		}
		const n = Number(value);
		if (!/^\d+$/.test(value) || n < min || n > max) fieldErrors[field] = 'invalid';
		return n;
	}

	return { text, integer };
}

type CommonFields = Omit<TastingBottle, 'smoke' | 'cask' | 'value'>;

function parseCommon(
	values: Record<string, string>,
	fieldErrors: Record<string, string>,
	{ text, integer }: Reader
): CommonFields | null {
	const alias = text('alias', TASTING_ALIAS_LENGTH.max, true);
	const distillery = text('distillery', TASTING_DISTILLERY_LENGTH.max, true);
	const bottler = text('bottler', TASTING_BOTTLER_LENGTH.max, false);
	const bottling = text('bottling', TASTING_BOTTLING_LENGTH.max, false);
	const age = integer('age', TASTING_AGE.min, TASTING_AGE.max, false);

	const rawAbv = values.abv.trim().replace(',', '.');
	const abv = Number(rawAbv);
	if (!rawAbv) fieldErrors.abv = 'required';
	else if (!ABV_RE.test(rawAbv) || abv < TASTING_ABV.min || abv > TASTING_ABV.max) {
		fieldErrors.abv = 'invalid';
	}

	// Server-side check via new URL(): only https links to whiskybase.com make
	// it into the reveal, no javascript: or foreign links.
	const rawUrl = values.whiskybaseUrl.trim();
	const whiskybaseUrl = rawUrl ? normalizeWhiskybaseUrl(rawUrl) : null;
	if (rawUrl && !whiskybaseUrl) fieldErrors.whiskybaseUrl = 'invalid';

	if (!alias || !distillery) return null;
	return { alias, distillery, bottler, bottling, age, whiskybaseUrl, abv };
}

function parseTaste({ integer }: Reader): Pick<TastingBottle, 'smoke' | 'cask' | 'value'> | null {
	const smoke = integer('smoke', TASTING_SCALE.min, TASTING_SCALE.max, true);
	const cask = integer('cask', TASTING_SCALE.min, TASTING_SCALE.max, true);
	const value = integer('value', TASTING_SCALE.min, TASTING_SCALE.max, true);
	return smoke === null || cask === null || value === null ? null : { smoke, cask, value };
}

/**
 * A cask of the list, another one (name and rating) or unknown; the finish
 * also none. Fields that don't go with the choice – which the form doesn't
 * even render – make it invalid.
 */
function parseCask(
	prefix: 'mainCask' | 'finish',
	values: Record<string, string>,
	fieldErrors: Record<string, string>,
	{ text, integer }: Reader
): Cask | { kind: 'none' } | null {
	const choice = values[prefix].trim();
	const [refill, label, influence] = [`${prefix}Refill`, `${prefix}Label`, `${prefix}Influence`];
	const sent = (field: string) => values[field].trim() !== '';
	const noExtras = (...fields: string[]) => {
		for (const field of fields) if (sent(field)) fieldErrors[field] = 'invalid';
	};

	if (!choice) {
		fieldErrors[prefix] = 'required';
		return null;
	}
	if (choice === UNKNOWN_CASK || (prefix === 'finish' && choice === NO_FINISH)) {
		noExtras(refill, label, influence);
		return choice === UNKNOWN_CASK ? { kind: 'unknown' } : { kind: 'none' };
	}
	if (choice === OTHER_CASK) {
		noExtras(refill);
		const name = text(label, TASTING_CASK_LABEL_LENGTH.max, true);
		const rating = integer(influence, TASTING_CASK_INFLUENCE.min, TASTING_CASK_INFLUENCE.max, true);
		return name === null || rating === null
			? null
			: { kind: 'other', label: name, influence: rating };
	}
	if (!isCaskType(choice)) {
		fieldErrors[prefix] = 'invalid';
		return null;
	}
	noExtras(label, influence);
	const refilled = values[refill] === 'on';
	if (sent(refill) && (!refilled || !isRefillable(choice))) fieldErrors[refill] = 'invalid';
	return { kind: 'known', type: choice, refill: refilled };
}

function parseFacts(
	values: Record<string, string>,
	fieldErrors: Record<string, string>,
	reader: Reader
): { facts: BottleFacts } | null {
	const peat = values.peat.trim();
	if (!peat) fieldErrors.peat = 'required';
	else if (!(TASTING_PEAT_LEVELS as readonly string[]).includes(peat)) fieldErrors.peat = 'invalid';

	const cask = parseCask('mainCask', values, fieldErrors, reader);
	const finishCask = parseCask('finish', values, fieldErrors, reader);

	// Months only with a finish (the form shows the field only then).
	let finish: Finish | null = null;
	if (finishCask?.kind === 'none' || finishCask?.kind === 'unknown') {
		if (values.finishMonths.trim()) fieldErrors.finishMonths = 'invalid';
		finish = finishCask;
	} else if (finishCask) {
		const months = reader.integer(
			'finishMonths',
			TASTING_FINISH_MONTHS.min,
			TASTING_FINISH_MONTHS.max,
			false
		);
		finish = { ...finishCask, months };
	}

	// "Preis unknown" disables the price field, so it doesn't come along.
	let priceCents: number | null = null;
	const rawPrice = values.price.trim().replace(',', '.');
	if (values.priceUnknown === 'on') {
		if (rawPrice) fieldErrors.price = 'invalid';
	} else if (!rawPrice) {
		fieldErrors.price = 'required';
	} else {
		const euros = Number(rawPrice);
		if (!PRICE_RE.test(rawPrice) || euros < TASTING_PRICE.min || euros > TASTING_PRICE.max) {
			fieldErrors.price = 'invalid';
		}
		priceCents = Math.round(euros * 100);
	}

	if (!cask || cask.kind === 'none' || !finish) return null;
	return { facts: { peat: peat as PeatLevel, cask, finish, priceCents } };
}
