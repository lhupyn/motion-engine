/**
 * MotionEngine Demo — Test UI
 *
 * Imports MotionEngine + motions dictionary, connects to TalkingHead,
 * and wires up the test button panel.
 *
 * Demonstrates multi-track playback: mood and action tracks run concurrently.
 */
import { TalkingHead } from 'talkinghead';
import { MotionEngine } from '../src/MotionEngine.js';
import { MotionStudio } from '../src/MotionStudio.js';
import motions from '../src/motions.json';
import motionsTH from '../src/motions_th.json';

// --- Config ---
const AVATAR_MODEL = './female_1.glb';
const AVATAR_BODY = 'F';

// --- DOM refs ---
const container = document.getElementById('avatar-container');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const motionInput = document.getElementById('motion-text');
const btnGenerate = document.getElementById('btn-generate');
const btnStop = document.getElementById('btn-stop');
const btnAudit = document.getElementById('btn-audit');

// --- State ---
let head = null;
let engine = null;
let studio = null;

// --- Logging ---
function log(msg, level = 'info') {
  const span = document.createElement('span');
  span.className = `log-${level}`;
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

// =============================================================================
// INIT
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

  // Create engine (player) and studio (authoring/discovery)
  engine = new MotionEngine(head);
  studio = new MotionStudio(engine);
  const count = engine.registerMotions(motions) + engine.registerMotions(motionsTH);

  // Expose for console / devtools poking (demo only)
  window.head = head;
  window.engine = engine;
  window.studio = studio;

  // Wire up event callbacks to UI
  engine.onStart = (name) => {
    statusEl.textContent = `Playing: ${name}`;
    log(`Playing: ${name}`, 'info');
  };
  engine.onEnd = (name) => {
    statusEl.textContent = 'Ready.';
    log(`Finished: ${name}`, 'info');
  };
  engine.onError = (name, err) => {
    log(`${err.message}`, 'warn');
  };

  // Hook oscillation overlay + mood blending into render loop
  head.opt.update = (dt) => engine.update(dt);

  log(`Registered ${count} custom motions.`, 'info');
  log('Available poses: ' + Object.keys(head.poseTemplates).join(', '), 'info');
  log('Native gestures: ' + Object.keys(head.gestureTemplates).join(', '), 'info');
  log('Custom motions: ' + engine.getMotionNames().join(', '), 'info');
  statusEl.textContent = 'Ready. Click any motion.';
}

// --- Event handling ---
async function handleMotion(motionId) {
  const btn = document.querySelector(`[data-motion="${motionId}"]`);
  if (btn) btn.classList.add('active');

  try {
    await engine.play(motionId);
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }

  if (btn) btn.classList.remove('active');
}

async function handleSequence(sequenceStr) {
  const names = sequenceStr.split(',').map((s) => s.trim());
  log(`Sequence: ${names.join(' → ')}`, 'info');
  statusEl.textContent = `Sequence: ${names.join(' → ')}`;

  try {
    await engine.playSequence(names);
  } catch (e) {
    if (e.name !== 'AbortError') throw e;
  }

  statusEl.textContent = 'Ready.';
}

// --- Discovery Audit (uses MotionStudio) ---
async function handleAudit() {
  log('Starting Avatar Audit...', 'warn');
  const ctx = studio.getLLMContext();
  console.log('LLM Context:\n', ctx);

  log('\n--- LLM CONTEXT ---\n', 'info');
  ctx.split('\n').filter(line => line.trim()).forEach(line => {
    log(line, 'info');
  });
  log('--- END AUDIT ---\n', 'info');

  statusEl.textContent = 'Audit complete. Check console/logs.';
}

// Motion buttons
document.querySelectorAll('[data-motion]').forEach((btn) => {
  btn.addEventListener('click', () => handleMotion(btn.dataset.motion));
});

// Sequence buttons
document.querySelectorAll('[data-sequence]').forEach((btn) => {
  btn.addEventListener('click', () => handleSequence(btn.dataset.sequence));
});

// Camera view buttons (TalkingHead framing: head / upper / mid / full)
document.querySelectorAll('[data-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const view = btn.dataset.view;
    head.setView(view);
    document.querySelectorAll('[data-view].active').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    log(`Camera view: ${view}`, 'warn');
  });
});

// FACS expression buttons (7-core emotion menu → engine.expr / resetExpression)
document.querySelectorAll('[data-expr]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const name = btn.dataset.expr;
    document.querySelectorAll('[data-expr].active').forEach((b) => b.classList.remove('active'));
    if (name === '__reset__') {
      engine.resetExpression();
      statusEl.textContent = 'FACS: neutral';
      log('FACS reset → neutral', 'warn');
      return;
    }
    const r = engine.expr(name);
    if (r) {
      btn.classList.add('active');
      statusEl.textContent = `FACS: ${r.name}`;
      log(`FACS expr: ${name} → ${r.name} (${r.kind})`, 'info');
    } else {
      log(`FACS expr: ${name} — unresolved`, 'error');
    }
  });
});

// Transcript box — full pipeline: [emotion] + ::gesture:: + emoji, stripped like the chat bubble
const transcriptInput = document.getElementById('transcript-text');
const btnTranscript = document.getElementById('btn-transcript');
function runTranscript() {
  const text = transcriptInput.value.trim();
  if (!text) return;
  engine.handleTranscript(text);
  const bubble = text
    .replace(/\[[^\]]*\]/g, '')
    .replace(/::[^:]+::/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
  log(`Transcript ▸ raw:    ${text}`, 'info');
  log(`Transcript ▸ bubble: ${bubble}`, 'info');
}
if (btnTranscript) btnTranscript.addEventListener('click', runTranscript);
if (transcriptInput) {
  transcriptInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') runTranscript();
  });
}

// Stop button
btnStop.addEventListener('click', () => {
  engine.stop();
  statusEl.textContent = 'Stopped.';
  log('Stopped.', 'warn');
  document.querySelectorAll('.btn.active').forEach((b) => b.classList.remove('active'));
});

// Audit button
if (btnAudit) {
  btnAudit.addEventListener('click', handleAudit);
}

// Custom input
btnGenerate.addEventListener('click', () => {
  const text = motionInput.value.trim();
  if (text) handleMotion(text);
});

motionInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const text = motionInput.value.trim();
    if (text) handleMotion(text);
  }
});

// --- Boot ---
initAvatar().catch((e) => {
  log(`Init failed: ${e.message}`, 'error');
  statusEl.textContent = 'Failed to load avatar.';
});
