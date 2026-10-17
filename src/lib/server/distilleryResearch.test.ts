import { describe, it, expect, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';

const sdk = vi.hoisted(() => ({ constructed: vi.fn(), stream: vi.fn() }));
vi.mock('@anthropic-ai/sdk', () => ({
	default: class {
		messages = { stream: sdk.stream };
		constructor(options: unknown) {
			sdk.constructed(options);
		}
	}
}));

import {
	anthropicMessages,
	callCost,
	DEFAULT_RESEARCH_RULES,
	MAX_CONTINUATIONS,
	normalizeSourceUrl,
	RESEARCH_MODEL,
	researchDistillery,
	rulesHash,
	type ResearchCall,
	type ResearchRequest
} from './distilleryResearch';

const WIKI = 'https://en.wikipedia.org/wiki/Ardbeg_distillery';
const WHISKYPEDIA = 'https://scotchwhisky.com/whiskypedia/1/ardbeg/';
const OTHER = 'https://www.ardbeg.com/en-gb/distillery';

type Usage = Partial<Anthropic.Usage>;

function message(content: unknown[], stopReason: string, usage: Usage = {}): Anthropic.Message {
	return {
		id: 'msg_test',
		type: 'message',
		role: 'assistant',
		model: RESEARCH_MODEL,
		content,
		stop_reason: stopReason,
		stop_sequence: null,
		stop_details: null,
		container: null,
		usage: {
			input_tokens: 1000,
			output_tokens: 200,
			cache_creation_input_tokens: 0,
			cache_read_input_tokens: 0,
			cache_creation: null,
			server_tool_use: { web_search_requests: 1, web_fetch_requests: 0 },
			...usage
		}
	} as unknown as Anthropic.Message;
}

const searched = (...urls: string[]) => ({
	type: 'web_search_tool_result',
	tool_use_id: 'srvtoolu_search',
	caller: { type: 'direct' },
	content: urls.map((url) => ({
		type: 'web_search_result',
		url,
		title: 'Ardbeg',
		encrypted_content: 'enc',
		page_age: null
	}))
});

const fetched = (url: string) => ({
	type: 'web_fetch_tool_result',
	tool_use_id: 'srvtoolu_fetch',
	// Nested in the dynamic filtering's code execution.
	caller: { type: 'code_execution_20260120', tool_id: 'srvtoolu_code' },
	content: {
		type: 'web_fetch_result',
		url,
		content: { type: 'document', source: { type: 'text', media_type: 'text/plain', data: '…' } },
		retrieved_at: null
	}
});

const failedFetch = {
	type: 'web_fetch_tool_result',
	tool_use_id: 'srvtoolu_fetch2',
	caller: { type: 'direct' },
	content: { type: 'web_fetch_tool_result_error', error_code: 'url_not_accessible' }
};

const searchError = {
	type: 'web_search_tool_result',
	tool_use_id: 'srvtoolu_search2',
	caller: { type: 'direct' },
	content: { type: 'web_search_tool_result_error', error_code: 'max_uses_exceeded' }
};

type Entry = {
	status: string;
	value: unknown;
	source_url: string | null;
	quote: string | null;
};

const found = (value: unknown, source = WIKI, quote = 'A quote'): Entry => ({
	status: 'found',
	value,
	source_url: source,
	quote
});
const status = (s: string): Entry => ({ status: s, value: null, source_url: null, quote: null });

function report(input: Partial<Record<'country' | 'region' | 'capacity', Entry>>) {
	return {
		type: 'tool_use',
		id: 'toolu_report',
		name: 'report_distillery_facts',
		caller: { type: 'direct' },
		input: {
			country: status('not_requested'),
			region: status('not_requested'),
			capacity: status('not_requested'),
			...input
		}
	};
}

const request = (over: Partial<ResearchRequest> = {}): ResearchRequest => ({
	name: 'Ardbeg',
	fields: ['country', 'region', 'capacity'],
	knownCountry: null,
	rules: DEFAULT_RESEARCH_RULES,
	...over
});

/** A client answering with the given messages in turn, recording the calls. */
function client(...responses: Anthropic.Message[]) {
	const calls: ResearchCall[] = [];
	const createMessage = vi.fn(async (params: Anthropic.MessageStreamParams) => {
		void params;
		const next = responses.shift();
		if (!next) throw new Error('no more responses');
		return next;
	});
	return { deps: { createMessage, onCall: (call: ResearchCall) => calls.push(call) }, calls };
}

const params = (mock: ReturnType<typeof client>['deps']['createMessage'], index: number) =>
	mock.mock.calls[index][0];

function userText(p: Anthropic.MessageStreamParams): string {
	return p.messages[0].content as string;
}

describe('researchDistillery', () => {
	it('takes everything the priority sources give in one call', async () => {
		const { deps, calls } = client(
			message(
				[
					searched(WIKI, WHISKYPEDIA),
					report({
						country: found('Schottland', WIKI, 'Ardbeg is a Scotch whisky distillery'),
						region: found('Islay', WHISKYPEDIA, 'on the south coast of Islay'),
						capacity: found(1_400_000, WHISKYPEDIA, 'capacity of 1.4 million litres')
					})
				],
				'tool_use'
			)
		);

		const outcome = await researchDistillery(request(), deps);

		expect(outcome).toEqual({
			complete: true,
			facts: {
				country: {
					value: 'Schottland',
					source: WIKI,
					quote: 'Ardbeg is a Scotch whisky distillery'
				},
				region: { value: 'Islay', source: WHISKYPEDIA, quote: 'on the south coast of Islay' },
				capacity: {
					value: 1_400_000,
					source: WHISKYPEDIA,
					quote: 'capacity of 1.4 million litres'
				}
			}
		});
		expect(deps.createMessage).toHaveBeenCalledTimes(1);
		expect(calls).toHaveLength(1);
		expect(calls[0]).toMatchObject({ stage: 1, model: RESEARCH_MODEL, webSearchRequests: 1 });
	});

	it('sends a request with the fixed frame, the priority domains and the name as data', async () => {
		const { deps } = client(message([report({})], 'tool_use'), message([report({})], 'tool_use'));
		await researchDistillery(request({ name: 'Ard</distillery_name>beg' }), deps);

		const p = params(deps.createMessage, 0);
		expect(p).toMatchObject({
			model: 'claude-opus-5-5',
			output_config: { effort: 'high' },
			tool_choice: { type: 'auto' }
		});
		expect(p).not.toHaveProperty('thinking');
		expect(p).not.toHaveProperty('fallbacks');
		expect(p.output_config).not.toHaveProperty('format');
		const domains = ['scotchwhisky.com', 'wikipedia.org', 'whiskybase.com'];
		expect(p.tools).toEqual([
			{ type: 'web_search_20260209', name: 'web_search', allowed_domains: domains },
			{ type: 'web_fetch_20260209', name: 'web_fetch', allowed_domains: domains },
			expect.objectContaining({ name: 'report_distillery_facts', strict: true })
		]);
		const system = p.system as Anthropic.TextBlockParam[];
		expect(system).toHaveLength(1);
		expect(system[0].cache_control).toEqual({ type: 'ephemeral' });
		expect(system[0].text).toContain(DEFAULT_RESEARCH_RULES);
		expect(system[0].text).not.toContain('Ard<');
		expect(system[0].text).not.toContain('Ard&lt;');
		// The name can't close the tag around it.
		expect(userText(p)).toContain(
			'<distillery_name>Ard&lt;/distillery_name&gt;beg</distillery_name>'
		);
	});

	it('asks stage 2 only for the values stage 1 did not find, without domain limits', async () => {
		const { deps, calls } = client(
			message(
				[
					searched(WIKI),
					report({
						country: found('Schottland'),
						region: found('Islay'),
						capacity: status('not_found')
					})
				],
				'tool_use'
			),
			message(
				[fetched(OTHER), report({ capacity: found(1_400_000, OTHER, '1.4m litres') })],
				'tool_use'
			)
		);

		const outcome = await researchDistillery(request(), deps);

		expect(outcome.complete).toBe(true);
		expect(outcome.facts.capacity).toEqual({
			value: 1_400_000,
			source: OTHER,
			quote: '1.4m litres'
		});
		expect(outcome.facts.country?.value).toBe('Schottland');
		const second = params(deps.createMessage, 1);
		expect(userText(second)).toContain('Values to research: capacity');
		expect(userText(second)).not.toContain('country;');
		expect(second.tools).toEqual([
			{ type: 'web_search_20260209', name: 'web_search' },
			{ type: 'web_fetch_20260209', name: 'web_fetch' },
			expect.objectContaining({ name: 'report_distillery_facts' })
		]);
		// Same system prompt in both stages: cacheable.
		expect(second.system).toEqual(params(deps.createMessage, 0).system);
		expect(calls.map((call) => call.stage)).toEqual([1, 2]);
	});

	it('keeps a contradiction among the priority sources as not found, never asking stage 2', async () => {
		const { deps } = client(
			message(
				[
					searched(WIKI),
					report({
						country: status('conflicting'),
						region: status('not_found'),
						capacity: found(900_000)
					})
				],
				'tool_use'
			)
		);

		const outcome = await researchDistillery(request(), deps);

		// No country: the region stays open, it is neither searched nor "not found".
		expect(outcome).toEqual({
			complete: true,
			facts: { country: null, capacity: { value: 900_000, source: WIKI, quote: 'A quote' } }
		});
		expect(deps.createMessage).toHaveBeenCalledTimes(1);
	});

	it('never lets stage 2 override a value stage 1 found', async () => {
		const { deps } = client(
			message(
				[searched(WIKI), report({ country: found('Schottland'), capacity: status('not_found') })],
				'tool_use'
			),
			message(
				[
					searched(OTHER),
					report({ country: found('England', OTHER), capacity: found(5_000, OTHER) })
				],
				'tool_use'
			)
		);

		const outcome = await researchDistillery(request({ fields: ['country', 'capacity'] }), deps);

		expect(outcome.facts.country?.value).toBe('Schottland');
		expect(outcome.facts.capacity?.value).toBe(5_000);
	});

	describe('evidence', () => {
		it.each([
			['a URL the research never saw', found('Schottland', 'https://en.wikipedia.org/wiki/Other')],
			['a site outside the priority domains in stage 1', found('Schottland', OTHER)],
			['no quote', found('Schottland', WIKI, '  ')],
			['a javascript: link', found('Schottland', 'javascript:alert(1)')],
			['an invalid value', found('Vereinigtes Königreich, ' + 'x'.repeat(60))]
		])('discards a value with %s, stage 2 looks again', async (_, entry) => {
			const { deps } = client(
				message([searched(WIKI, OTHER), report({ country: entry })], 'tool_use'),
				message([searched(OTHER)], 'end_turn')
			);

			const outcome = await researchDistillery(request({ fields: ['country'] }), deps);

			expect(deps.createMessage).toHaveBeenCalledTimes(2);
			expect(outcome).toEqual({ complete: false, facts: {} });
		});

		it('makes a discarded value of stage 2 not found', async () => {
			const { deps } = client(
				message([searched(WIKI), report({ capacity: status('not_found') })], 'tool_use'),
				message([searched(OTHER), report({ capacity: found(1.5, OTHER) })], 'tool_use')
			);

			const outcome = await researchDistillery(request({ fields: ['capacity'] }), deps);

			expect(outcome).toEqual({ complete: true, facts: { capacity: null } });
		});

		it('matches the URL without fragment and trailing slash, also of nested results', async () => {
			const { deps } = client(
				message(
					[
						searchError,
						failedFetch,
						fetched(WHISKYPEDIA),
						report({
							region: found('Islay', 'https://SCOTCHWHISKY.com/whiskypedia/1/ardbeg#history')
						})
					],
					'tool_use'
				)
			);

			const outcome = await researchDistillery(
				request({ fields: ['region'], knownCountry: 'Schottland' }),
				deps
			);

			expect(outcome.facts.region?.value).toBe('Islay');
		});

		it('rejects a region outside the list', async () => {
			const { deps } = client(
				message([searched(WIKI), report({ region: found('Skye') })], 'tool_use'),
				message([report({ region: status('not_found') })], 'tool_use')
			);

			const outcome = await researchDistillery(
				request({ fields: ['region'], knownCountry: 'Schottland' }),
				deps
			);

			expect(outcome.facts).toEqual({ region: null });
		});
	});

	describe('region', () => {
		it('drops a region for another country and never looks for it', async () => {
			const { deps } = client(
				message(
					[
						searched(WIKI),
						report({
							country: found('Nordirland'),
							region: status('not_found'),
							capacity: found(4_500_000)
						})
					],
					'tool_use'
				)
			);

			const outcome = await researchDistillery(request(), deps);

			expect(outcome.facts).not.toHaveProperty('region');
			expect(deps.createMessage).toHaveBeenCalledTimes(1);
		});

		it('ignores a region reported along with another country', async () => {
			const { deps } = client(
				message(
					[searched(WIKI), report({ country: found('Irland'), region: found('Islay') })],
					'tool_use'
				)
			);

			const outcome = await researchDistillery(request({ fields: ['country', 'region'] }), deps);

			expect(outcome.facts).toEqual({ country: expect.objectContaining({ value: 'Irland' }) });
		});

		it('looks only for the region of a known Scotland', async () => {
			const { deps } = client(
				message([searched(WIKI), report({ region: found('Highlands') })], 'tool_use')
			);

			const outcome = await researchDistillery(
				request({ fields: ['region'], knownCountry: 'Schottland' }),
				deps
			);

			expect(outcome.facts).toEqual({ region: expect.objectContaining({ value: 'Highlands' }) });
			const text = userText(params(deps.createMessage, 0));
			expect(text).toContain('Values to research: region');
			expect(text).toContain('The country is already known: Schottland.');
		});

		it('takes a region of stage 1 once stage 2 finds Scotland as the country', async () => {
			const { deps } = client(
				message(
					[searched(WIKI), report({ country: status('not_found'), region: found('Speyside') })],
					'tool_use'
				),
				message([searched(OTHER), report({ country: found('Schottland', OTHER) })], 'tool_use')
			);

			const outcome = await researchDistillery(request({ fields: ['country', 'region'] }), deps);

			expect(outcome.facts.country?.value).toBe('Schottland');
			expect(outcome.facts.region?.value).toBe('Speyside');
			expect(userText(params(deps.createMessage, 1))).toContain('Values to research: country.');
		});
	});

	describe('stop reasons', () => {
		it('continues after pause_turn with the paused turn as assistant message', async () => {
			const paused = message([searched(WIKI)], 'pause_turn');
			const { deps, calls } = client(
				paused,
				message([report({ country: found('Schottland') })], 'tool_use')
			);

			const outcome = await researchDistillery(request({ fields: ['country'] }), deps);

			expect(outcome.facts.country?.value).toBe('Schottland');
			const continued = params(deps.createMessage, 1);
			expect(continued.messages).toHaveLength(2);
			expect(continued.messages[1]).toEqual({ role: 'assistant', content: paused.content });
			expect(calls).toHaveLength(2);
		});

		it(`fails after ${MAX_CONTINUATIONS} continuations, counting every call`, async () => {
			const pauses = Array.from({ length: MAX_CONTINUATIONS + 1 }, () =>
				message([searched(WIKI)], 'pause_turn')
			);
			const { deps, calls } = client(...pauses);

			const outcome = await researchDistillery(request(), deps);

			expect(outcome).toEqual({ complete: false, facts: {} });
			expect(calls).toHaveLength(MAX_CONTINUATIONS + 1);
		});

		it.each([
			['refusal', [report({ country: found('Schottland') })]],
			['max_tokens', [searched(WIKI), report({ country: found('Schottland') })]],
			['end_turn', [searched(WIKI), { type: 'text', text: 'Ardbeg is on Islay.' }]]
		])('gives no values after %s', async (stopReason, content) => {
			const { deps, calls } = client(message(content, stopReason));

			const outcome = await researchDistillery(request(), deps);

			expect(outcome).toEqual({ complete: false, facts: {} });
			expect(calls).toHaveLength(1);
		});

		it('keeps the values of stage 1 when stage 2 fails', async () => {
			const { deps } = client(
				message(
					[searched(WIKI), report({ country: found('Schottland'), capacity: status('not_found') })],
					'tool_use'
				),
				message([], 'refusal')
			);

			const outcome = await researchDistillery(request({ fields: ['country', 'capacity'] }), deps);

			expect(outcome).toEqual({
				complete: false,
				facts: { country: expect.objectContaining({ value: 'Schottland' }) }
			});
		});

		it('passes API errors on to the caller', async () => {
			const createMessage = vi.fn().mockRejectedValue(new Error('overloaded'));
			const onCall = vi.fn();

			await expect(researchDistillery(request(), { createMessage, onCall })).rejects.toThrow(
				'overloaded'
			);
			expect(onCall).not.toHaveBeenCalled();
		});
	});
});

describe('callCost', () => {
	const usage = (over: Usage): Anthropic.Usage =>
		({
			input_tokens: 1000,
			output_tokens: 500,
			cache_creation_input_tokens: 2000,
			cache_read_input_tokens: 3000,
			cache_creation: null,
			server_tool_use: { web_search_requests: 2, web_fetch_requests: 3 },
			...over
		}) as Anthropic.Usage;

	it('prices tokens, cache and searches in micro-dollars; fetches cost tokens only', () => {
		// 1000·4 + 500·20 + 2000·5 + 3000·0.2 + 2·10000
		expect(callCost(usage({}))).toBe(44_600);
	});

	it('prices one-hour cache writes double', () => {
		const cacheCreation = { ephemeral_5m_input_tokens: 1000, ephemeral_1h_input_tokens: 1000 };
		expect(callCost(usage({ cache_creation: cacheCreation }))).toBe(
			4000 + 10000 + 13000 + 600 + 20000
		);
	});

	it('copes with missing fields', () => {
		expect(
			callCost(
				usage({
					cache_creation_input_tokens: null,
					cache_read_input_tokens: null,
					server_tool_use: null
				})
			)
		).toBe(14_000);
	});

	it('rounds to whole micro-dollars', () => {
		expect(
			callCost(
				usage({
					input_tokens: 0,
					output_tokens: 0,
					cache_creation_input_tokens: 0,
					cache_read_input_tokens: 3,
					server_tool_use: null
				})
			)
		).toBe(1);
	});
});

describe('normalizeSourceUrl', () => {
	it('drops fragment and trailing slash and lowercases the host', () => {
		expect(normalizeSourceUrl('https://EN.Wikipedia.org/wiki/Ardbeg/#x')).toBe(
			'https://en.wikipedia.org/wiki/Ardbeg'
		);
		expect(normalizeSourceUrl('ftp://example.com')).toBeNull();
	});
});

describe('rulesHash', () => {
	it('is a short hash that changes with the rules', () => {
		expect(rulesHash(DEFAULT_RESEARCH_RULES)).toMatch(/^[0-9a-f]{12}$/);
		expect(rulesHash(DEFAULT_RESEARCH_RULES)).toBe(rulesHash(DEFAULT_RESEARCH_RULES));
		expect(rulesHash(`${DEFAULT_RESEARCH_RULES}\n- Neu`)).not.toBe(
			rulesHash(DEFAULT_RESEARCH_RULES)
		);
	});
});

describe('anthropicMessages', () => {
	it('streams with the given key and resolves to the final message', async () => {
		const final = message([], 'end_turn');
		sdk.stream.mockReturnValue({ finalMessage: () => Promise.resolve(final) });

		const createMessage = anthropicMessages('sk-test');
		const p = { model: RESEARCH_MODEL, max_tokens: 1, messages: [] };

		await expect(createMessage(p)).resolves.toBe(final);
		expect(sdk.constructed).toHaveBeenCalledWith({ apiKey: 'sk-test' });
		expect(sdk.stream).toHaveBeenCalledWith(p);
	});
});
