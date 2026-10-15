import { describe, it, expect, afterEach, vi } from 'vitest';
import { llm } from '../src/llm.js';
import { ask } from '../src/jev.js';

const QUESTIONS = {
  expression: ask.choice('Face?', { happy: 'Glad', look_left: 'Glance left', look_right: 'Glance right', none: 'No change' }),
  clear: ask.noul('Intelligible?', 'Coherent words', 'Noise'),
};

// A chat-completions response; each token is [text, logprob].
function completion(tokens, { usage = { prompt_tokens: 900, completion_tokens: 20, cost: 0.00015 }, logprobs = true } = {}) {
  const content = tokens.map(([t]) => t).join('');
  return {
    model: 'openai/gpt-4o-mini',
    choices: [{
      message: { role: 'assistant', content },
      logprobs: logprobs ? { content: tokens.map(([token, logprob]) => ({ token, logprob })) } : null,
    }],
    usage,
  };
}

const ok = (body) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));

const TOKENS = [
  ['{"', 0], ['expression', 0], ['":"', 0], ['look', Math.log(0.9)], ['_right', Math.log(0.5)], ['","', 0],
  ['clear', 0], ['":', 0], ['true', Math.log(0.7)], ['}', 0],
];

describe('llm client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts a chat completion whose JSON schema allows only the options', async () => {
    const fetch = ok(completion(TOKENS));
    vi.stubGlobal('fetch', fetch);
    await llm({ apiKey: 'sk-test' })({ speaker: 'avatar', text: 'Look!' }, QUESTIONS);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({ model: 'openai/gpt-4o-mini', temperature: 0, logprobs: true, provider: { require_parameters: true } });
    expect(body.response_format.json_schema).toEqual({
      name: 'answers',
      strict: true,
      schema: {
        type: 'object',
        properties: {
          expression: { type: 'string', enum: ['happy', 'look_left', 'look_right', 'none'] },
          clear: { type: 'boolean' },
        },
        required: ['expression', 'clear'],
        additionalProperties: false,
      },
    });
    expect(body.messages[0].content).toContain('expression: Face?\n- happy: Glad');
    expect(body.messages[0].content).toContain('clear: Intelligible?\n- true: Coherent words\n- false: Noise');
    expect(JSON.parse(body.messages[1].content)).toEqual({ speaker: 'avatar', text: 'Look!' });
  });

  it("takes each answer's confidence from the logprobs of all the tokens that spell it", async () => {
    vi.stubGlobal('fetch', ok(completion(TOKENS)));
    const r = await llm({ apiKey: 'k' })('Look!', QUESTIONS);
    expect(r.answers.expression.choice).toBe('look_right');
    expect(r.answers.expression.confidence).toBeCloseTo(0.45);
    expect(r.answers.clear.noul).toBeCloseTo(0.7);
    expect(r).toMatchObject({ model: 'openai/gpt-4o-mini', usage: { input_tokens: 900, output_tokens: 20, cost: 0.00015 } });
    expect(typeof r.ms).toBe('number');
  });

  it('a false yes/no answer becomes the probability of true', async () => {
    const tokens = TOKENS.map(([t, l]) => (t === 'true' ? ['false', Math.log(0.8)] : [t, l]));
    vi.stubGlobal('fetch', ok(completion(tokens)));
    const r = await llm({ apiKey: 'k' })('eh asdf', QUESTIONS);
    expect(r.answers.clear.noul).toBeCloseTo(0.2);
  });

  it('without logprobs, choices get assumeConfidence and yes/no answers are certain', async () => {
    vi.stubGlobal('fetch', ok(completion(TOKENS, { logprobs: false, usage: null })));
    const r = await llm({ url: 'http://localhost:11434/v1/chat/completions', model: 'gemma3', assumeConfidence: 0.7 })('Look!', QUESTIONS);
    expect(r.answers).toEqual({ expression: { choice: 'look_right', confidence: 0.7 }, clear: { noul: 1 } });
    expect(r.usage).toBeNull();
  });

  it('a local server gets no key and no OpenRouter routing', async () => {
    const fetch = ok(completion(TOKENS));
    vi.stubGlobal('fetch', fetch);
    await llm({ url: 'http://localhost:1234/v1/chat/completions', model: 'qwen3', logprobs: false })('hi', QUESTIONS);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('http://localhost:1234/v1/chat/completions');
    expect(init.headers.Authorization).toBeUndefined();
    const body = JSON.parse(init.body);
    expect(body.provider).toBeUndefined();
    expect(body.logprobs).toBeUndefined();
  });

  it('ignores logprobs that do not spell the content', async () => {
    const body = completion(TOKENS);
    body.choices[0].message.content = '```json\n' + body.choices[0].message.content + '\n```';
    vi.stubGlobal('fetch', ok(body));
    const r = await llm({ apiKey: 'k' })('Look!', QUESTIONS);
    expect(r.answers.expression).toEqual({ choice: 'look_right', confidence: 0.8 });
  });

  it('reports API errors and answers that are not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404, json: async () => ({ error: { message: 'No endpoints found' } }) })));
    await expect(llm({ apiKey: 'k' })('hi', QUESTIONS)).rejects.toThrow('LLM 404: No endpoints found');
    vi.stubGlobal('fetch', ok(completion([['Sorry, I cannot help.', 0]])));
    await expect(llm({ apiKey: 'k' })('hi', QUESTIONS)).rejects.toThrow(/not JSON/);
  });

  it('passes the abort signal to fetch', async () => {
    const fetch = vi.fn((_, { signal }) => new Promise((_, reject) => {
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    }));
    vi.stubGlobal('fetch', fetch);
    const ctrl = new AbortController();
    const call = llm({ apiKey: 'k' })('hi', QUESTIONS, { signal: ctrl.signal });
    ctrl.abort();
    await expect(call).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('refuses question types it cannot express in a schema', async () => {
    vi.stubGlobal('fetch', ok(completion(TOKENS)));
    await expect(llm({ apiKey: 'k' })('hi', { level: { type: 'score', instructions: 'How much?' } })).rejects.toThrow(/can't ask "score"/);
  });
});
