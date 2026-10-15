/**
 * Jev client — asks TypeSafe's Jev decision model typed questions over HTTP.
 *
 * Jev returns decisions, not text: for each question, the chosen option with
 * its confidence and the probability of every option. Questions are answered
 * in parallel, so asking several costs about the same latency as asking one.
 *
 * Providers (same System One API, different host and key):
 *   - openrouter — callable from the browser (CORS open), so a page can use
 *                  the visitor's own key.
 *   - typesafe   — TypeSafe's own API. Server-side only: it does not accept
 *                  requests from other websites.
 *
 * @module jev
 */

const PROVIDERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: '~typesafe/jev-latest' },
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
};

/**
 * @typedef {object} JevResult
 * @property {Object<string, object>} answers - Per question: { choice, confidence, probabilities } | { noul } | { score, … }
 * @property {?string} model - Exact model version that answered
 * @property {?{input_tokens:number, cost:number}} usage
 * @property {number} ms - Round-trip time
 */

/**
 * Create a classify function bound to a provider and key.
 *
 * @param {object} options
 * @param {string} options.apiKey
 * @param {'openrouter'|'typesafe'} [options.provider='openrouter']
 * @param {string} [options.model]   - Defaults to the provider's latest Jev
 * @param {string} [options.url]     - Override the endpoint (e.g. your own proxy)
 * @returns {function(object|string, object, {signal?:AbortSignal}=): Promise<JevResult>}
 */
export function jev({ apiKey, provider = 'openrouter', model, url }) {
  const p = PROVIDERS[provider];
  if (!p) throw new Error(`Unknown Jev provider "${provider}" (use openrouter or typesafe)`);
  const endpoint = url || p.url;
  const modelId = model || p.model;

  return async function classify(state, questions, { signal } = {}) {
    const started = performance.now();
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: modelId, state, questions }),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = body.error?.message || body.detail?.message || res.statusText;
      throw new Error(`Jev ${res.status}: ${msg}`);
    }
    return {
      answers: body.answers ?? body,
      model: body.model ?? null,
      usage: body.usage ?? null,
      ms: Math.round(performance.now() - started),
    };
  };
}

/** Jev question builders, in the API's raw JSON shape. */
export const ask = {
  /** Pick one option; `options` maps each option name to what it means. */
  choice: (instructions, options) => ({ type: 'choice', instructions, criteria: options }),
  /** Probability that a statement is true. */
  noul: (instructions, whenTrue, whenFalse) =>
    ({ type: 'noul', instructions, criteria: { true: whenTrue, false: whenFalse } }),
};
