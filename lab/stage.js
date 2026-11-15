// The frozen avatar every lab page shares: idle life off, so captures of the same recipe come out the same.

import { TalkingHead } from 'talkinghead';
import * as THREE from 'three';
import { MotionEngine } from '../src/index.js';
import FACS from '../src/facs.json' with { type: 'json' };

const STAGE_COLOUR = '#e9e8e4';

// Versioned with three, as in the demo.
const DRACO_PATH = 'https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/libs/draco/';

/** @param {number} ms */
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Loads the avatar and freezes it. URL parameters: `avatar` (a .glb, default the demo's), `body` (`F` or `M`),
 * `lids=0` (without the live-like lids).
 * @param {object} [options]
 * @param {string} [options.view='head'] - TalkingHead camera view
 * @returns {Promise<{head: any, engine: MotionEngine, facs: any}>} `facs` is the catalog plus one pseudo-AU per
 *   avatar morph: `{ '=mouthRollLower': 0.4 }` in a recipe sets that blendshape directly
 */
export async function createStage({ view = 'head' } = {}) {
  const params = new URLSearchParams(location.search);
  const head = new TalkingHead(document.getElementById('avatar'), {
    cameraView: view,
    showProgressBar: false,
    dracoEnabled: true,
    dracoDecoderPath: DRACO_PATH,
  });
  await head.showAvatar({ url: params.get('avatar') || './female_1.glb', body: params.get('body') || 'F' });

  // Live, TalkingHead's gaze keeps the eyes slightly down and its lids follow (eyeBlink about 0.14, the eye about 88%
  // open). Without this the lab shows eyes more open than a real session ever does.
  const baseline = params.get('lids') === '0' ? {} : { eyesLookDown: 0.28 };
  head.animMoods.lab = { baseline, speech: { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 }, anims: [] };
  head.setMood('lab');
  Object.assign(head.opt, {
    avatarIdleEyeContact: 0,
    avatarIdleHeadMove: 0,
    avatarSpeakingEyeContact: 0,
    avatarSpeakingHeadMove: 0,
  });
  head.animQueue = [];
  // TalkingHead adds random noise to about 20 face morphs every frame; one harmless entry keeps it off the face.
  head.mtRandomized = ['handFistLeft'];

  const facs = structuredClone(FACS);
  for (const morph of Object.keys(head.mtAvatar)) facs.au_map['=' + morph] = { [morph]: 1 };

  // No cross-fade and no settling, so a sheet shows the recipe itself.
  const engine = new MotionEngine(head, { face: { facs, fade: 1, sustain: 1 } });
  return { head, engine, facs };
}

/**
 * Offsets the head from its rest pose, in radians.
 * @param {any} head
 * @param {number} [pitch=0] - Positive looks down
 * @param {number} [yaw=0]
 * @param {number} [roll=0]
 */
export function setHeadPose(head, pitch = 0, yaw = 0, roll = 0) {
  Object.assign(head.poseDelta.props['Head.quaternion'], { x: pitch, y: yaw, z: roll });
}

/**
 * Renders a frame and copies a part of it onto a new canvas.
 * @param {any} head
 * @param {{x: number, y: number, w: number, h: number}} rect - In renderer pixels
 * @param {number} width
 * @param {number} height
 * @returns {HTMLCanvasElement}
 */
export function capture(head, rect, width, height) {
  // The WebGL canvas is not preserved between frames: without a render now, it reads back empty.
  head.renderer.render(head.scene, head.camera);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  context.fillStyle = STAGE_COLOUR;
  context.fillRect(0, 0, width, height);
  context.drawImage(head.renderer.domElement, rect.x, rect.y, rect.w, rect.h, 0, 0, width, height);
  return canvas;
}

// Where a bone is on the renderer's canvas, in pixels.
function pixelOf(head, boneName) {
  const point = head.armature.getObjectByName(boneName).getWorldPosition(new THREE.Vector3()).project(head.camera);
  const { width, height } = head.renderer.domElement;
  return { x: ((point.x + 1) / 2) * width, y: ((1 - point.y) / 2) * height };
}

/**
 * Crop rectangle around the face, sized from the distance between the eyes so it follows the avatar's proportions.
 * @param {any} head
 * @param {'face'|'eyes'|'mouth'} kind
 * @returns {{x: number, y: number, w: number, h: number}} In renderer pixels, at the current pixel ratio
 */
export function faceRect(head, kind) {
  head.armature.updateMatrixWorld(true);
  const left = pixelOf(head, 'LeftEye');
  const right = pixelOf(head, 'RightEye');
  const cx = (left.x + right.x) / 2;
  const cy = (left.y + right.y) / 2;
  const d = Math.hypot(left.x - right.x, left.y - right.y);
  if (kind === 'eyes') return { x: cx - 1.2 * d, y: cy - 0.45 * d, w: 2.4 * d, h: 1.2 * d };
  if (kind === 'mouth') return { x: cx - 0.8 * d, y: cy + 0.2 * d, w: 1.6 * d, h: 1.6 * d };
  return { x: cx - 1.9 * d, y: cy - 1.45 * d, w: 3.8 * d, h: 3.8 * d };
}

/**
 * Runs `fn` at another renderer pixel ratio (a higher one gives sharper crops), then restores it.
 * @template T
 * @param {any} head
 * @param {number} ratio
 * @param {() => Promise<T>|T} fn
 * @returns {Promise<T>}
 */
export async function withPixelRatio(head, ratio, fn) {
  const previous = head.renderer.getPixelRatio();
  head.renderer.setPixelRatio(ratio);
  try {
    return await fn();
  } finally {
    head.renderer.setPixelRatio(previous);
  }
}

/**
 * Keeps `#status` in step with what the page is doing. Wrap every public async function with `tracked`: it shows
 * the error if one throws and `ready` when the outermost call ends. A hidden tab is flagged because Chrome stops
 * rendering it and captures come out stale.
 * @returns {{status: (text: string) => void, tracked: <A extends any[], R>(fn: (...args: A) => Promise<R>) => (...args: A) => Promise<R>}}
 */
export function createStatus() {
  const element = document.getElementById('status');
  const notice = () =>
    document.hidden ? 'ready (the tab is hidden: Chrome stops rendering it, captures would be stale)' : 'ready';
  let depth = 0;
  let failed = false;

  const status = (text) => {
    element.textContent = text;
  };
  document.addEventListener('visibilitychange', () => {
    if (!depth && !failed) status(notice());
  });

  const tracked =
    (fn) =>
    async (...args) => {
      if (!depth++) {
        failed = false;
        status(document.hidden ? 'running (the tab is hidden: captures will be stale)' : 'running…');
      }
      try {
        return await fn(...args);
      } catch (error) {
        failed = true;
        status(`error: ${error.message}`);
        throw error;
      } finally {
        if (!--depth && !failed) status(notice());
      }
    };

  status(notice());
  return { status, tracked };
}
