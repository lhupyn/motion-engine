// Client for the System One API that decision models share (Jev, Clef…):
// typed questions (choice, yes/no) answered with a confidence instead of text.
// The defaults point at Jev, TypeSafe's decision model.
//
// OpenRouter accepts requests from any website, so a page can use the
// visitor's own key. TypeSafe's API only accepts its own console, so use it
// from a server.

const PROVIDERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: '~typesafe/jev-latest' },
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
};

/**
 * @param {object} options
 * @param {string} options.apiKey
 * @param {'openrouter'|'typesafe'} [options.provider='openrouter']
 * @param {string} [options.model]
 * @param {string} [options.url] - e.g. your own proxy
 * @returns {(state: object|string, questions: object, opts?: {signal?: AbortSignal}) =>
 *   Promise<{answers: object, model: ?string, usage: ?object, ms: number}>}
 */
export function systemOne({ apiKey, provider = 'openrouter', model, url }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown System One provider "${provider}" (use openrouter or typesafe)`);
  const endpoint = url || p.url;
  const modelId = model || p.model;

  return async function classify(state, questions, { signal } = {}) {
    const started = performance.now();
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({ model: modelId, state, questions }),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.error?.message || body.detail?.message || res.statusText;
      throw new Error(`System One ${res.status}: ${msg}`);
    }
    return {
      answers: body.answers ?? body,
      model: body.model ?? null,
      usage: body.usage ?? null,
      ms: Math.round(performance.now() - started),
    };
  };
}

export const ask = {
  /** @param {Object<string,string>} options - Option name → what it means */
  choice: (instructions, options) => ({ type: 'choice', instructions, criteria: options }),
  noul: (instructions, whenTrue, whenFalse) =>
    ({ type: 'noul', instructions, criteria: { true: whenTrue, false: whenFalse } }),
};
