/**
 * LLM Motion Playground — Logic
 *
 * Initializes TalkingHead + MotionEngine (same as demo.js),
 * wires provider tabs, API key persistence, LLM generation, and playback.
 */
import { TalkingHead } from 'talkinghead';
import { MotionEngine } from '../src/MotionEngine.js';
import motions from '../src/motions.json';
import { callLLM } from './llm.js';
import { buildSystemPrompt } from './prompt.js';

// --- Config ---
const AVATAR_MODEL = './female_1.glb';
const AVATAR_BODY = 'F';

const MODELS = {
  openai: 'gpt-5.2',
  gemini: 'gemini-3.1-pro-preview',
  claude: 'claude-opus-4-6',
};

// --- DOM refs ---
const container = document.getElementById('avatar-container');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const modelNameEl = document.getElementById('model-name');
const apiKeyInput = document.getElementById('api-key');
const promptInput = document.getElementById('prompt-input');
const jsonEditor = document.getElementById('json-editor');
const btnGenerate = document.getElementById('btn-generate');
const btnPlay = document.getElementById('btn-play');
const btnStop = document.getElementById('btn-stop');
const tabs = document.querySelectorAll('.tab[data-provider]');
const presetsSelect = document.getElementById('presets');

// --- State ---
let head = null;
let engine = null;
let provider = 'gemini';

// --- Logging ---
function log(msg, level = 'info') {
  const span = document.createElement('span');
  span.className = `log-${level}`;
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

// =============================================================================
// AVATAR INIT (same pattern as demo.js)
// =============================================================================
async function initAvatar() {
  log('Initializing TalkingHead...');
  const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  head = new TalkingHead(container, {
    audioCtx,
    showProgressBar: false,
    dracoEnabled: true,
    pcmSampleRate: 16000,
    cameraView: 'full',
  });

  await head.showAvatar({ url: AVATAR_MODEL, body: AVATAR_BODY, avatarMode: 'full-body' });
  head.start();

  engine = new MotionEngine(head);
  const count = engine.registerMotions(motions);

  engine.onStart = (name) => {
    statusEl.textContent = `Playing: ${name}`;
    log(`Playing: ${name}`);
  };
  engine.onEnd = (name) => {
    statusEl.textContent = 'Ready.';
    log(`Finished: ${name}`);
  };
  engine.onError = (name, err) => {
    log(`Error: ${err.message}`, 'warn');
  };

  head.opt.update = (dt) => engine.update(dt);

  log(`Registered ${count} custom motions.`);
  statusEl.textContent = 'Ready. Describe a movement and generate!';
}

// =============================================================================
// PROVIDER TABS
// =============================================================================
function switchProvider(p) {
  provider = p;
  tabs.forEach((t) => t.classList.toggle('active', t.dataset.provider === p));
  modelNameEl.textContent = MODELS[p];
  // Restore saved key for this provider
  apiKeyInput.value = localStorage.getItem(`llm-key-${p}`) || '';
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchProvider(tab.dataset.provider));
});

// Persist API key on change
apiKeyInput.addEventListener('input', () => {
  localStorage.setItem(`llm-key-${provider}`, apiKeyInput.value);
});

// Load initial key
apiKeyInput.value = localStorage.getItem(`llm-key-${provider}`) || '';

// Preset selector fills the prompt textarea
presetsSelect.addEventListener('change', () => {
  if (presetsSelect.value) {
    promptInput.value = presetsSelect.value;
  }
});

// =============================================================================
// GENERATE
// =============================================================================
btnGenerate.addEventListener('click', async () => {
  const prompt = promptInput.value.trim();
  if (!prompt) return;
  if (!apiKeyInput.value.trim()) {
    log('Please enter an API key.', 'error');
    return;
  }

  btnGenerate.disabled = true;
  btnGenerate.textContent = 'Generating...';
  log(`Sending to ${provider} (${MODELS[provider]})...`);

  try {
    const system = buildSystemPrompt(engine);
    const response = await callLLM({
      provider,
      apiKey: apiKeyInput.value.trim(),
      model: MODELS[provider],
      system,
      prompt,
    });

    log('LLM responded.', 'info');

    // Extract JSON from response (strip markdown fences if present)
    let json = response.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) json = fenceMatch[1].trim();

    // Validate and pretty-print
    const parsed = JSON.parse(json);
    jsonEditor.value = JSON.stringify(parsed, null, 2);
    log('Motion JSON ready. Edit if needed, then Play.', 'info');
  } catch (e) {
    log(`Generate failed: ${e.message}`, 'error');
  } finally {
    btnGenerate.disabled = false;
    btnGenerate.textContent = 'Generate Motion';
  }
});

// Allow Ctrl+Enter in prompt to generate
promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    btnGenerate.click();
  }
});

// =============================================================================
// PLAY / STOP
// =============================================================================
btnPlay.addEventListener('click', async () => {
  const text = jsonEditor.value.trim();
  if (!text) {
    log('No motion JSON to play.', 'warn');
    return;
  }

  try {
    JSON.parse(text); // validate
    await engine.play(text);
  } catch (e) {
    if (e.name !== 'AbortError') {
      log(`Play error: ${e.message}`, 'error');
    }
  }
});

btnStop.addEventListener('click', () => {
  engine.stop();
  statusEl.textContent = 'Stopped.';
  log('Stopped.', 'warn');
});

// =============================================================================
// BOOT
// =============================================================================
initAvatar().catch((e) => {
  log(`Init failed: ${e.message}`, 'error');
  statusEl.textContent = 'Failed to load avatar.';
});
