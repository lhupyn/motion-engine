/**
 * LLM Adapter — thin client-side wrappers for OpenAI, Gemini, and Claude.
 * All return the raw text response from the model.
 *
 * @param {Object} opts
 * @param {string} opts.provider  - 'openai' | 'gemini' | 'claude'
 * @param {string} opts.apiKey
 * @param {string} opts.model     - model id
 * @param {string} opts.system    - system prompt
 * @param {string} opts.prompt    - user prompt
 * @returns {Promise<string>}     - the model's text reply
 */
export async function callLLM({ provider, apiKey, model, system, prompt }) {
  if (!apiKey) throw new Error(`API key required for ${provider}`);
  if (!model) throw new Error(`Model required for ${provider}`);

  if (provider === 'openai') return callOpenAI(apiKey, model, system, prompt);
  if (provider === 'gemini') return callGemini(apiKey, model, system, prompt);
  if (provider === 'claude') return callClaude(apiKey, model, system, prompt);
  throw new Error(`Unknown provider: ${provider}`);
}

async function callOpenAI(key, model, system, prompt) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
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

async function callClaude(key, model, system, prompt) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    }),
  });
  if (!res.ok) throw new Error(`Claude ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.content[0].text;
}
