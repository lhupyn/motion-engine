/**
 * LLM Motion Playground — Logic
 *
 * Initializes TalkingHead + MotionEngine + MotionStudio,
 * wires provider tabs, API key persistence, LLM generation, and playback.
 */
import { TalkingHead } from 'talkinghead';
import { MotionEngine } from '../src/MotionEngine.js';
import { MotionStudio } from '../src/MotionStudio.js';
import motions from '../src/motions.json';
import motionsTH from '../src/motions_th.json';
import { callLLM } from './llm.js';
import { buildSystemPrompt } from './prompt.js';

// --- Config ---
const AVATAR_MODEL = './female_1.glb';
const AVATAR_BODY = 'F';

const MODELS = {
  gemini: 'gemini-3.1-pro-preview',
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
let studio = null;
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
// AVATAR INIT
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
  studio = new MotionStudio(engine);
  const count = engine.registerMotions(motions) + engine.registerMotions(motionsTH);

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
  apiKeyInput.value = localStorage.getItem(`llm-key-${p}`) || '';
}

tabs.forEach((tab) => {
  tab.addEventListener('click', () => switchProvider(tab.dataset.provider));
});

apiKeyInput.addEventListener('input', () => {
  localStorage.setItem(`llm-key-${provider}`, apiKeyInput.value);
});

apiKeyInput.value = localStorage.getItem(`llm-key-${provider}`) || '';

presetsSelect.addEventListener('change', () => {
  if (presetsSelect.value) {
    promptInput.value = presetsSelect.value;
  }
});

// =============================================================================
// GENERATE (uses MotionStudio for context)
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
    const system = buildSystemPrompt(studio);
    const response = await callLLM({
      provider,
      apiKey: apiKeyInput.value.trim(),
      model: MODELS[provider],
      system,
      prompt,
    });

    log('LLM responded.', 'info');

    let json = response.trim();
    const fenceMatch = json.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) json = fenceMatch[1].trim();

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

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
    btnGenerate.click();
  }
});

// =============================================================================
// PLAY / STOP (uses MotionStudio.playDynamic for JSON input)
// =============================================================================
btnPlay.addEventListener('click', async () => {
  const text = jsonEditor.value.trim();
  if (!text) {
    log('No motion JSON to play.', 'warn');
    return;
  }

  try {
    await studio.playDynamic(text);
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
