// Classifier on any OpenAI-compatible chat model: OpenRouter, or a local
// server (Ollama, LM Studio). The schema limits each answer to its options;
// the confidence is the probability the model gave the tokens of the answer.

const OPENROUTER = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * Same contract as jev().
 * @param {object} [options]
 * @param {string} [options.apiKey] - Not needed by a local server
 * @param {string} [options.model='openai/gpt-4o-mini']
 * @param {string} [options.url] - Chat-completions endpoint, e.g. http://localhost:11434/v1/chat/completions
 * @param {boolean} [options.logprobs=true] - Ask for token probabilities (on OpenRouter, only providers that return them are used)
 * @param {number} [options.assumeConfidence=0.8] - Confidence of every choice when no logprobs come back
 */
export function llm({ apiKey, model = 'openai/gpt-4o-mini', url = OPENROUTER, logprobs = true, assumeConfidence = 0.8 } = {}) {
  // OpenRouter otherwise routes to the cheapest provider, which may ignore the schema or logprobs.
  const routing = url.startsWith('https://openrouter.ai/') ? { provider: { require_parameters: true } } : {};

  return async function classify(state, questions, { signal } = {}) {
    const started = performance.now();
    const format = { type: 'json_schema', json_schema: { name: 'answers', strict: true, schema: schema(questions) } };
    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: prompt(questions) },
          { role: 'user', content: typeof state === 'string' ? state : JSON.stringify(state) },
        ],
        response_format: format,
        temperature: 0,
        ...(logprobs && { logprobs: true }),
        ...routing,
      }),
      signal,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(`LLM ${res.status}: ${body.error?.message || res.statusText}`);

    const choice = body.choices?.[0];
    const content = choice?.message?.content ?? '';
    let out;
    try {
      out = JSON.parse(content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1));
    } catch {
      throw new Error(`LLM: the answer is not JSON: ${content.slice(0, 80)}`);
    }

    const probs = valueProbs(content, choice.logprobs?.content, Object.keys(questions));
    const answers = {};
    for (const [name, q] of Object.entries(questions)) {
      if (!(name in out)) continue;
      if (q.type === 'noul') {
        const sure = probs[name] ?? 1;
        answers[name] = { noul: out[name] === true ? sure : 1 - sure };
      } else {
        answers[name] = { choice: out[name], confidence: probs[name] ?? assumeConfidence };
      }
    }

    const u = body.usage;
    return {
      answers,
      model: body.model ?? null,
      usage: u ? { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, cost: u.cost ?? null } : null,
      ms: Math.round(performance.now() - started),
    };
  };
}

function prompt(questions) {
  const parts = ['Answer each question about the line in the user message (who says it, the text, the line before it). Reply with JSON.'];
  for (const [name, q] of Object.entries(questions)) {
    const options = Object.entries(q.criteria).map(([k, v]) => `- ${k}: ${v}`).join('\n');
    parts.push(`${name}: ${q.instructions}\n${options}`);
  }
  return parts.join('\n\n');
}

function schema(questions) {
  const properties = {};
  for (const [name, q] of Object.entries(questions)) {
    if (q.type === 'choice') properties[name] = { type: 'string', enum: Object.keys(q.criteria) };
    else if (q.type === 'noul') properties[name] = { type: 'boolean' };
    else throw new Error(`llm() can't ask "${q.type}" questions`);
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

// The probability of each answer is the joint probability of the tokens that
// spell its value: options can share a first token ("look_left", "look_right").
function valueProbs(content, tokens, names) {
  const probs = {};
  if (!tokens?.length || tokens.map((t) => t.token).join('') !== content) return probs;
  for (const name of names) {
    const m = new RegExp(`"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"\\s*:\\s*"?([^"\\s,}]+)`).exec(content);
    if (!m) continue;
    const end = m.index + m[0].length;
    const start = end - m[1].length;
    let logprob = 0;
    let at = 0;
    for (const t of tokens) {
      if (at < end && at + t.token.length > start) logprob += t.logprob;
      at += t.token.length;
    }
    probs[name] = Math.exp(logprob);
  }
  return probs;
}
