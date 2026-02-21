/**
 * MotionEngine Demo — Test UI
 *
 * Imports MotionEngine + motions dictionary, connects to TalkingHead,
 * and wires up the test button panel.
 */
import { TalkingHead } from 'talkinghead';
import { MotionEngine } from '../src/MotionEngine.js';
import motions from '../src/motions.json';

// --- Config ---
const AVATAR_MODEL = 'https://met4citizen.github.io/TalkingHead/avatars/brunette.glb';
const AVATAR_BODY = 'F';

// --- DOM refs ---
const container = document.getElementById('avatar-container');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const motionInput = document.getElementById('motion-text');
const btnGenerate = document.getElementById('btn-generate');

// --- State ---
let head = null;
let engine = null;

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

  // Create engine and register custom motions
  engine = new MotionEngine(head);
  const count = engine.registerMotions(motions);

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

  // Hook oscillation overlay into render loop
  head.opt.update = (dt) => engine.update(dt);

  log(`Registered ${count} custom motions.`, 'info');
  log('Available poses: ' + Object.keys(head.poseTemplates).join(', '), 'info');
  log('Native gestures: ' + Object.keys(head.gestureTemplates).join(', '), 'info');
  log('Custom motions: ' + Object.keys(motions).join(', '), 'info');
  statusEl.textContent = 'Ready. Click any motion.';
}

// --- Event handling ---
async function handleMotion(motionId) {
  const btn = document.querySelector(`[data-motion="${motionId}"]`);
  if (btn) btn.classList.add('active');

  await engine.play(motionId);

  if (btn) btn.classList.remove('active');
}

document.querySelectorAll('[data-motion]').forEach((btn) => {
  btn.addEventListener('click', () => handleMotion(btn.dataset.motion));
});

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
