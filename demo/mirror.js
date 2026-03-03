/**
 * Face Mirror Demo — Tests FaceMirror + MotionEngine integration.
 *
 * Left: avatar with mood mirroring from user's webcam.
 * Right: camera preview, score bars, config sliders, manual overrides.
 */
import { TalkingHead } from 'talkinghead';
import { MotionEngine } from '../src/MotionEngine.js';
import motions from '../src/motions.json';
import motionsTH from '../src/motions_th.json';

// --- Config ---
const AVATAR_MODEL = './female_1.glb';
const AVATAR_BODY = 'F';

// --- DOM refs ---
const container = document.getElementById('avatar-container');
const statusEl = document.getElementById('status');
const logEl = document.getElementById('log');
const moodStatusEl = document.getElementById('mood-status');
const scoreBarsEl = document.getElementById('score-bars');
const videoEl = document.getElementById('camera-preview');
const btnMirror = document.getElementById('btn-mirror');
const btnPause = document.getElementById('btn-pause');
const sliderThreshold = document.getElementById('slider-threshold');
const sliderCooldown = document.getElementById('slider-cooldown');
const valThreshold = document.getElementById('val-threshold');
const valCooldown = document.getElementById('val-cooldown');

// --- State ---
let head = null;
let engine = null;
let mirroring = false;
let paused = false;

// --- Logging ---
function log(msg, level = 'info') {
  const span = document.createElement('span');
  span.className = `log-${level}`;
  span.textContent = `[${new Date().toLocaleTimeString()}] ${msg}\n`;
  logEl.appendChild(span);
  logEl.scrollTop = logEl.scrollHeight;
}

// --- Score Bars ---
const scoreBarEls = {};

function initScoreBars() {
  // Build bars for each mood that has _detect
  for (const [name, entry] of Object.entries(motions)) {
    if (entry._track !== 'mood' || !entry._detect) continue;

    const row = document.createElement('div');
    row.className = 'score-bar';
    row.innerHTML = `
      <label>${name}</label>
      <div class="bar"><div class="bar-fill" style="width:0%"></div></div>
      <span class="value">0.00</span>
    `;
    scoreBarsEl.appendChild(row);
    scoreBarEls[name] = {
      fill: row.querySelector('.bar-fill'),
      value: row.querySelector('.value'),
    };
  }
}

function updateScoreBar(mood, score) {
  for (const [name, els] of Object.entries(scoreBarEls)) {
    const s = name === mood ? score : 0;
    els.fill.style.width = `${Math.min(s * 100, 100)}%`;
    els.value.textContent = s.toFixed(2);
  }
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

  engine = new MotionEngine(head);
  engine.registerMotions(motions);
  engine.registerMotions(motionsTH);

  engine.onStart = (name) => log(`Playing: ${name}`);
  engine.onError = (name, err) => log(`${err.message}`, 'warn');

  head.opt.update = (dt) => engine.update(dt);

  initScoreBars();
  statusEl.textContent = 'Ready. Click "Start Mirror" to begin.';
  log('Avatar ready.');
}

// =============================================================================
// Camera + Mirror
// =============================================================================
async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: 'user' },
    });
    videoEl.srcObject = stream;
    await videoEl.play();
    return true;
  } catch (e) {
    log(`Camera error: ${e.message}`, 'error');
    return false;
  }
}

function stopCamera() {
  const tracks = videoEl.srcObject?.getTracks();
  if (tracks) tracks.forEach((t) => t.stop());
  videoEl.srcObject = null;
}

async function toggleMirror() {
  if (mirroring) {
    engine.stopMirror();
    stopCamera();
    mirroring = false;
    paused = false;
    btnMirror.textContent = 'Start Mirror';
    btnMirror.classList.remove('active');
    btnPause.disabled = true;
    btnPause.textContent = 'Pause';
    moodStatusEl.textContent = 'neutral';
    statusEl.textContent = 'Mirror stopped.';
    log('Mirror stopped.');
    return;
  }

  statusEl.textContent = 'Starting camera...';
  const ok = await startCamera();
  if (!ok) return;

  statusEl.textContent = 'Loading MediaPipe...';
  log('Loading MediaPipe FaceLandmarker...');

  try {
    await engine.startMirror(videoEl, {
      threshold: parseFloat(sliderThreshold.value),
      cooldown: parseInt(sliderCooldown.value),
    });

    // Wire callbacks for UI
    engine.mirror.onMood = (mood, score, b) => {
      engine.play(mood);
      moodStatusEl.textContent = `${mood} (${score.toFixed(2)})`;
      updateScoreBar(mood, score);
      log(`Mirror: ${mood} (${score.toFixed(2)})`);
    };

    engine.mirror.onDetect = (b) => {
      // Update all score bars on each detection
      if (!engine.mirror) return;
      const result = engine.mirror._classify(b);
      for (const [name, els] of Object.entries(scoreBarEls)) {
        // Re-classify per mood for visualization
        const classifier = engine.mirror._classifiers.find((c) => c.mood === name);
        if (!classifier) continue;
        let score = 0;
        for (const [shape, weight] of Object.entries(classifier.weights)) {
          score += (b[shape] ?? 0) * weight;
        }
        score /= classifier.total;
        els.fill.style.width = `${Math.min(score * 100, 100)}%`;
        els.fill.style.background = score >= engine.mirror.opt.threshold ? '#6c9' : '#555';
        els.value.textContent = score.toFixed(2);
      }
    };

    mirroring = true;
    btnMirror.textContent = 'Stop Mirror';
    btnMirror.classList.add('active');
    btnPause.disabled = false;
    statusEl.textContent = 'Mirroring active.';
    log('Mirror started.');
  } catch (e) {
    log(`Mirror init failed: ${e.message}`, 'error');
    statusEl.textContent = 'Mirror init failed.';
    stopCamera();
  }
}

function togglePause() {
  if (!mirroring) return;
  paused = !paused;
  if (paused) {
    engine.pauseMirror();
    btnPause.textContent = 'Resume';
    statusEl.textContent = 'Mirror paused.';
    log('Mirror paused.');
  } else {
    engine.resumeMirror();
    btnPause.textContent = 'Pause';
    statusEl.textContent = 'Mirroring active.';
    log('Mirror resumed.');
  }
}

// --- Events ---
btnMirror.addEventListener('click', toggleMirror);
btnPause.addEventListener('click', togglePause);

// Config sliders
sliderThreshold.addEventListener('input', () => {
  const v = parseFloat(sliderThreshold.value);
  valThreshold.textContent = v.toFixed(2);
  if (engine.mirror) engine.mirror.opt.threshold = v;
});

sliderCooldown.addEventListener('input', () => {
  const v = parseInt(sliderCooldown.value);
  valCooldown.textContent = `${(v / 1000).toFixed(1)}s`;
  if (engine.mirror) engine.mirror.opt.cooldown = v;
});

// Manual mood buttons
document.querySelectorAll('[data-mood]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mood = btn.dataset.mood;
    engine.play(mood);
    moodStatusEl.textContent = mood;
    log(`Manual: ${mood}`);
  });
});

// --- Boot ---
initAvatar().catch((e) => {
  log(`Init failed: ${e.message}`, 'error');
  statusEl.textContent = 'Failed to load avatar.';
});
