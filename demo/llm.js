/**
 * LLM Adapter — thin client-side wrapper for Gemini.
 * Returns the raw text response from the model.
 *
 * @param {Object} opts
 * @param {string} opts.provider  - 'gemini'
 * @param {string} opts.apiKey
 * @param {string} opts.model     - model id
 * @param {string} opts.system    - system prompt
 * @param {string} opts.prompt    - user prompt
 * @returns {Promise<string>}     - the model's text reply
 */
export async function callLLM({ provider, apiKey, model, system, prompt }) {
  if (!apiKey) throw new Error(`API key required for ${provider}`);
  if (!model) throw new Error(`Model required for ${provider}`);

  if (provider === 'gemini') return callGemini(apiKey, model, system, prompt);
  throw new Error(`Unknown provider: ${provider}`);
}

async function callGemini(key, model, system, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7 },
    }),
  });
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}
