// Gesture lab: film strips of the catalog's gestures in the demo's framing, plus measured motion, since stills can't
// show how a move feels. Use it from the toolbar or from the console through window.lab.

import * as THREE from 'three';
import GESTURES from '../src/gestures.json' with { type: 'json' };
import { capture, createStage, createStatus, wait } from './stage.js';
import { createSheet, publish, saveJson } from './sheet.js';

// Body's default fadeOut: after a hand gesture's last frame the arms take this long to return to the stance.
const FADE_OUT = 1100;
// Recording goes on this long after the gesture ends, to catch the arms coming back.
const TAIL = 600;
const CELL = 300;
const HANDS_PER_STRIP = 4;
// TalkingHead animates the model at 30 fps while requestAnimationFrame samples at 60, so a speed between two
// consecutive samples reads double. Speeds are averaged over at least this long (ms), between samples where the
// track moved.
const MIN_WINDOW = 100;

const { head, engine } = await createStage({ view: 'upper' });
const { status, tracked } = createStatus();

// The last recording of each gesture: [{ t, head: [pitch, yaw, roll], right: [x, y, z], left: [x, y, z] }].
const recordings = new Map();

const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const midpoint = (dt) => (Array.isArray(dt) ? (dt[0] + dt[1]) / 2 : dt);

// How long a gesture plays, ms: its frames, and for hand gestures the arms' way back.
function lengthOf(name) {
  const channel = engine.body.channelOf(name);
  if (!channel) throw new Error(`unknown gesture ${name}`);
  const frames = [GESTURES[channel][name].dt].flat();
  return frames.reduce((sum, dt) => sum + midpoint(dt), 0) + (channel === 'hands' ? FADE_OUT : 0);
}

const position = (boneName) => head.armature.getObjectByName(boneName).getWorldPosition(new THREE.Vector3()).toArray();

function headAngles() {
  const quaternion = head.armature.getObjectByName('Head').getWorldQuaternion(new THREE.Quaternion());
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'YXZ');
  return [euler.x, euler.y, euler.z];
}

// Samples the head and both hands on every animation frame until `ms` after `start`.
function record(start, ms) {
  return new Promise((resolve) => {
    const samples = [];
    const tick = () => {
      const t = performance.now() - start;
      head.armature.updateMatrixWorld(true);
      samples.push({ t, head: headAngles(), right: position('RightHand'), left: position('LeftHand') });
      if (t < ms) requestAnimationFrame(tick);
      else resolve(samples);
    };
    requestAnimationFrame(tick);
  });
}

// Farthest distance from the start, and the fastest average speed over any window of at least MIN_WINDOW, with the
// time at the middle of that window.
function motionOf(samples, track) {
  // Two samples in a row usually show the same model frame; a window that starts or ends inside one overstates it.
  const steps = samples.filter((s, i) => i === 0 || distance(s[track], samples[i - 1][track]) > 1e-6);
  let reach = 0;
  let peak = 0;
  let peakAt = 0;
  let end = 0;
  for (const from of steps) {
    reach = Math.max(reach, distance(from[track], samples[0][track]));
    while (end < steps.length && steps[end].t - from.t < MIN_WINDOW) end++;
    if (end === steps.length) continue;
    const to = steps[end];
    const speed = (distance(from[track], to[track]) * 1000) / (to.t - from.t);
    if (speed > peak) {
      peak = speed;
      peakAt = (from.t + to.t) / 2;
    }
  }
  return { reach, peak, peakAt };
}

// Speeds in m/s and rad/s, times in ms; the hand is the one that travels farther.
function statsOf(samples) {
  const right = motionOf(samples, 'right');
  const left = motionOf(samples, 'left');
  const hand = right.reach >= left.reach ? right : left;
  return {
    reachM: +hand.reach.toFixed(2),
    handPeakMps: +hand.peak.toFixed(1),
    handPeakAtMs: Math.round(hand.peakAt),
    headPeakRadps: +motionOf(samples, 'head').peak.toFixed(1),
  };
}

/**
 * Back to the stance, face neutral.
 * @param {number} [ms=1500] - How long to wait for the arms to settle
 */
async function rest(ms = 1500) {
  engine.body.stop();
  engine.face.reset();
  head.stopGesture(300);
  await wait(ms);
}

/**
 * Plays each gesture, records its motion and, with `file`, saves a strip of stills: a row per gesture, `frames`
 * moments spread over its length.
 * @param {string[]} names
 * @param {object} [options]
 * @param {string} [options.file] - Relative to lab/out/; without it the gestures are only measured
 * @param {number} [options.frames=6]
 * @returns {Promise<{file?: string, stats: Record<string, {reachM: number, handPeakMps: number, handPeakAtMs: number, headPeakRadps: number}>}>}
 */
async function film(names, { file, frames = 6 } = {}) {
  const sheet = file
    ? createSheet({
        title: names.join(', '),
        subtitle: 'upper view, idle frozen',
        columns: frames,
        rows: names.length,
        cell: CELL,
      })
    : null;
  const stats = {};
  for (const [row, name] of names.entries()) {
    status(`playing ${name}`);
    await rest();
    const length = lengthOf(name);
    const start = performance.now();
    engine.body.play(name);
    const recording = record(start, length + TAIL);
    for (let i = 0; sheet && i < frames; i++) {
      await wait(Math.max(0, ((i + 0.5) * length) / frames - (performance.now() - start)));
      // A square from the top centre: the avatar fills the renderer's width, and the gestures happen above the hips.
      const { width, height } = head.renderer.domElement;
      const side = Math.min(width, height);
      const still = capture(head, { x: (width - side) / 2, y: 0, w: side, h: side }, CELL, CELL);
      sheet.put(row, i, still, `${name} · ${Math.round(performance.now() - start)} ms`);
    }
    recordings.set(name, await recording);
    stats[name] = statsOf(recordings.get(name));
  }
  await rest(300);
  return { file: sheet ? await publish(sheet.canvas, file) : undefined, stats };
}

/**
 * The last recording of a gesture as `t:value` pairs, one each time the value changes.
 * @param {string} name
 * @param {object} [options]
 * @param {'right'|'left'|'head'} [options.track='right']
 * @param {0|1|2|null} [options.axis=null] - For the head: 0 pitch, 1 yaw, 2 roll, in rad from the start. Without
 *   one, the track's distance from its start (m for a hand)
 * @param {number} [options.from=0] - ms
 * @param {number} [options.to=Infinity] - ms
 * @returns {string}
 */
function series(name, { track = 'right', axis = null, from = 0, to = Infinity } = {}) {
  const samples = recordings.get(name);
  if (!samples) throw new Error(`no recording of ${name}: film it first`);
  const start = samples[0][track];
  const pairs = [];
  let last;
  for (const sample of samples) {
    if (sample.t < from || sample.t > to) continue;
    const value = +(axis === null ? distance(sample[track], start) : sample[track][axis] - start[axis]).toFixed(3);
    if (value !== last) pairs.push(`${Math.round(sample.t)}:${value}`);
    last = value;
  }
  return pairs.join(' ');
}

// The stats as a table under the strips, with the pops marked.
function showTable(stats) {
  const table = document.createElement('table');
  const columns = ['gesture', 'reach (m)', 'hand peak (m/s)', 'peak at (ms)', 'head peak (rad/s)'];
  table.append(
    Object.assign(document.createElement('tr'), { innerHTML: columns.map((c) => `<th>${c}</th>`).join('') }),
  );
  for (const [name, s] of Object.entries(stats)) {
    const row = document.createElement('tr');
    for (const value of [name, s.reachM, s.handPeakMps, s.handPeakAtMs, s.headPeakRadps]) {
      row.append(Object.assign(document.createElement('td'), { textContent: value }));
    }
    if (s.handPeakMps >= 4) row.children[2].className = 'hot';
    table.append(row);
  }
  document.getElementById('out').append(table);
}

/**
 * Every gesture in the catalog: head gestures in one strip, hand gestures four per strip, and the measured motion
 * in a table and in one file.
 * @param {object} [options]
 * @param {string} [options.dir='review'] - Under lab/out/
 * @returns {Promise<string[]>} The files written
 */
async function review({ dir = 'review' } = {}) {
  const files = [];
  const stats = {};
  const run = async (names, file) => {
    const result = await film(names, { file });
    files.push(result.file);
    Object.assign(stats, result.stats);
  };
  await run(Object.keys(GESTURES.head), `${dir}/head.jpeg`);
  const hands = Object.keys(GESTURES.hands);
  for (let i = 0; i < hands.length; i += HANDS_PER_STRIP) {
    await run(hands.slice(i, i + HANDS_PER_STRIP), `${dir}/hands-${i / HANDS_PER_STRIP + 1}.jpeg`);
  }
  files.push(await saveJson(stats, `${dir}/motion.json`));
  showTable(stats);
  return files;
}

const tools = { film: tracked(film), review: tracked(review) };
const button = document.getElementById('review');
button.addEventListener('click', async () => {
  button.disabled = true;
  try {
    await tools.review();
  } catch (error) {
    console.error(error);
  } finally {
    button.disabled = false;
  }
});

window.lab = { head, engine, rest, series, ...tools };
