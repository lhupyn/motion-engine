// Client for the System One API that decision models share (Jev by default):
// typed questions (choice, yes/no) answered with a confidence instead of text.
// OpenRouter accepts browser requests; TypeSafe's API is server-only.

/**
 * The line to classify.
 * @typedef {object} State
 * @property {'avatar'|'user'} speaker
 * @property {string} text
 * @property {{speaker: 'avatar'|'user', text: string}} [previous] - The line before; omitted on the first
 */

/** @typedef {{type: 'choice', instructions: string, criteria: Record<string, string>}} ChoiceQuestion - criteria: option → when to pick it */
/** @typedef {{type: 'noul', instructions: string, criteria: {true: string, false: string}}} NoulQuestion - A yes/no question */

/**
 * Keyed by what the director reads back: expression, head, hands, and clear for the person's lines.
 * @typedef {Record<string, ChoiceQuestion | NoulQuestion>} Questions
 */

/**
 * @typedef {object} Answers
 * @property {{choice: string, confidence?: number}} [expression]
 * @property {{choice: string, confidence?: number}} [head]
 * @property {{choice: string, confidence?: number}} [hands]
 * @property {{noul: number}} [clear] - 0–1, how likely the line is intelligible
 */

/**
 * @typedef {object} ClassifyResult
 * @property {Answers} answers
 * @property {string|null} [model]
 * @property {object|null} [usage] - As the provider returns it, e.g. { input_tokens, cost }
 * @property {number} [ms]
 */

/**
 * Anything that answers the questions about a line. Reject with an AbortError when `signal` aborts.
 * @callback Classify
 * @param {State} state
 * @param {Questions} questions
 * @param {{signal?: AbortSignal}} [options]
 * @returns {Promise<ClassifyResult>}
 */

const PROVIDERS = {
  openrouter: { url: 'https://openrouter.ai/api/v1/systemone', model: '~typesafe/jev-latest' },
  typesafe: { url: 'https://api.typesafe.ai/v1/systemone', model: 'jev-latest' },
};

/**
 * @param {object} options
 * @param {string} [options.apiKey] - Not needed by a server without auth
 * @param {'openrouter'|'typesafe'} [options.provider='openrouter']
 * @param {string} [options.model] - Default: Jev on the provider
 * @param {string} [options.url] - e.g. your own proxy or a self-hosted decision model
 * @returns {Classify}
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

/** @internal Question builders for the director. */
export const ask = {
  /**
   * @param {string} instructions
   * @param {Record<string, string>} options - Option name → what it means
   * @returns {ChoiceQuestion}
   */
  choice: (instructions, options) => ({ type: 'choice', instructions, criteria: options }),
  /**
   * @param {string} instructions
   * @param {string} whenTrue
   * @param {string} whenFalse
   * @returns {NoulQuestion}
   */
  noul: (instructions, whenTrue, whenFalse) => ({
    type: 'noul',
    instructions,
    criteria: { true: whenTrue, false: whenFalse },
  }),
};
