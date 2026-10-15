import { describe, it, expect, afterEach, vi } from 'vitest';
import { systemOne, ask } from '../src/systemone.js';

const ok = (body) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));

describe('System One client', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts state and questions to OpenRouter with the key', async () => {
    const fetch = ok({ answers: { mood: { choice: 'happy', confidence: 0.8 } }, model: 'typesafe/jev-1.14', usage: { cost: 0.00002 } });
    vi.stubGlobal('fetch', fetch);
    const q = { mood: ask.choice('Mood?', { happy: 'Glad', none: 'No change' }) };
    const r = await systemOne({ apiKey: 'sk-test' })({ speaker: 'avatar', text: 'Yay' }, q);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/systemone');
    expect(init.headers.Authorization).toBe('Bearer sk-test');
    expect(JSON.parse(init.body)).toEqual({
      model: '~typesafe/jev-latest',
      state: { speaker: 'avatar', text: 'Yay' },
      questions: { mood: { type: 'choice', instructions: 'Mood?', criteria: { happy: 'Glad', none: 'No change' } } },
    });
    expect(r).toMatchObject({ answers: { mood: { choice: 'happy' } }, model: 'typesafe/jev-1.14', usage: { cost: 0.00002 } });
    expect(typeof r.ms).toBe('number');
  });

  it('targets TypeSafe directly with provider: typesafe', async () => {
    const fetch = ok({ answers: {} });
    vi.stubGlobal('fetch', fetch);
    await systemOne({ apiKey: 'k', provider: 'typesafe' })('hi', {});
    expect(fetch.mock.calls[0][0]).toBe('https://api.typesafe.ai/v1/systemone');
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('jev-latest');
  });

  it('accepts a custom endpoint and model', async () => {
    const fetch = ok({ answers: {} });
    vi.stubGlobal('fetch', fetch);
    await systemOne({ apiKey: 'k', url: '/my-proxy', model: 'typesafe/jev-1.13' })('hi', {});
    expect(fetch.mock.calls[0][0]).toBe('/my-proxy');
    expect(JSON.parse(fetch.mock.calls[0][1].body).model).toBe('typesafe/jev-1.13');
  });

  it('reports API errors from either provider', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 401, json: async () => ({ error: { message: 'No auth' } }) })));
    await expect(systemOne({ apiKey: 'bad' })('hi', {})).rejects.toThrow('System One 401: No auth');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 403, json: async () => ({ detail: { message: 'Must supply an API key!' } }) })));
    await expect(systemOne({ apiKey: '', provider: 'typesafe' })('hi', {})).rejects.toThrow('System One 403: Must supply an API key!');
  });

  it('rejects an unknown provider', () => {
    expect(() => systemOne({ apiKey: 'k', provider: 'acme' })).toThrow(/Unknown System One provider/);
  });

  it('builds yes/no questions', () => {
    expect(ask.noul('Clear?', 'yes', 'no')).toEqual({ type: 'noul', instructions: 'Clear?', criteria: { true: 'yes', false: 'no' } });
  });
});
