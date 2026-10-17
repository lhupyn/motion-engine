// Two channels play at once, so the avatar can nod while it gestures:
//   head  — head and torso (nod, shake, bow), run as plain animations
//   hands — arm gestures, through TalkingHead's gesture system
// Each plays one gesture at a time; a new one interrupts the current one.

import GESTURES from './gestures.json' with { type: 'json' };

const RAMP = 300;

// The same hand gesture with the other hand is registered under this suffix.
const MIRROR = ':mirror';

/**
 * A TalkingHead animation template, plus an optional oscillation overlay.
 * @typedef {object} Gesture
 * @property {string} [description] - When to use it; without one the classifier never picks it
 * @property {number | Array<number | [number, number]>} dt - Frame timings, ms; [min, max] is a range
 * @property {number[]} [rescale]
 * @property {Record<string, any[]>} vs - Values per frame; hands use vs.gesture: [pose, duration, mirror, transitionMs]
 * @property {{bones?: Record<string, {freq: number, amp: number[], phase?: number}>, delay?: number, duration?: number}} [overlay]
 */

/**
 * @typedef {object} GestureCatalog
 * @property {Record<string, Gesture>} head
 * @property {Record<string, Gesture>} hands
 * @property {Record<string, Record<string, {x: number, y: number, z: number}>>} [poses] - Arm poses: bone rotations in radians
 */

/**
 * @typedef {object} BodyOptions
 * @property {GestureCatalog} [gestures] - Default: the bundled gestures.json
 * @property {number} [fadeIn=800] - Arm transition into a pose, unless the gesture frame sets its own
 * @property {number} [fadeOut=800]
 * @property {number} [cutFade=100] - Arms back to the stance when a hand gesture is stopped early
 * @property {number} [settle=1000] - Wait after a hand gesture fades out before it counts as done
 */

export class Body {
  /** @internal */ adapter;
  /** @internal @type {{head: Record<string, Gesture>, hands: Record<string, Gesture>}} */ gestures = {
    head: {},
    hands: {},
  };
  /** @internal */ _channels;

  /**
   * @internal
   * @param {import('./adapter.js').TalkingHeadAdapter} adapter
   * @param {BodyOptions} [options]
   */
  constructor(
    adapter,
    {
      gestures = /** @type {GestureCatalog} */ (GESTURES),
      fadeIn = 800,
      fadeOut = 800,
      cutFade = 100,
      settle = 1000,
    } = {},
  ) {
    const opt = { fadeIn, fadeOut, cutFade, settle };
    this.adapter = adapter;
    this._channels = { head: new Channel(adapter, 'head', opt), hands: new Channel(adapter, 'hands', opt) };

    const builtIn = new Set(adapter.gestureNames());
    for (const [name, props] of Object.entries(gestures.poses || {})) {
      if (builtIn.has(name)) {
        console.warn(`[motion-engine] Pose "${name}" collides with a TalkingHead built-in; skipped.`);
        continue;
      }
      adapter.registerPose(name, props);
    }
    for (const channel of Object.keys(this.gestures)) {
      for (const [name, g] of Object.entries(gestures[channel] || {})) {
        this.gestures[channel][name] = g;
        this._channels[channel].add(name, g);
        if (channel === 'hands') this._channels.hands.add(name + MIRROR, mirrored(g));
      }
    }
  }

  /** @returns {string[]} */
  get names() {
    return [...Object.keys(this.gestures.head), ...Object.keys(this.gestures.hands)];
  }

  /**
   * What each channel is playing: { head, hands }, null when idle.
   * @returns {{head: string|null, hands: string|null}}
   */
  get current() {
    return { head: this._channels.head.current, hands: this._channels.hands.current };
  }

  /**
   * @param {string} name
   * @returns {'head'|'hands'|null}
   * @internal
   */
  channelOf(name) {
    return Object.keys(this.gestures).find((c) => this.gestures[c][name]) ?? null;
  }

  /**
   * Interrupts the current gesture on its channel.
   * @param {string} name
   * @param {object} [options]
   * @param {boolean} [options.mirror=false] - Hand gestures: play it with the other hand (the left, for the catalog's
   *   one-hand gestures)
   * @returns {Promise<boolean>} true when done, false if interrupted or unknown
   */
  play(name, { mirror = false } = {}) {
    const channel = this.channelOf(name);
    if (!channel) return Promise.resolve(false);
    return this._channels[channel].play(name, mirror && channel === 'hands' ? name + MIRROR : name);
  }

  /** @param {'head'|'hands'} [channel] - Both when omitted */
  stop(channel) {
    for (const c of channel ? [channel] : Object.keys(this._channels)) this._channels[c].stop();
  }

  /** @internal @param {number} dt - ms since the last frame */
  update(dt) {
    this._channels.head.update(dt);
    this._channels.hands.update(dt);
  }
}

class Channel {
  constructor(adapter, kind, opt) {
    this.adapter = adapter;
    this.kind = kind;
    this.opt = opt;
    this.current = null;
    this.frames = {};
    this.anims = {};
    this._cancel = null;
    this._osc = new Oscillation(adapter);
  }

  add(anim, g) {
    const t = toTemplate(g, this.opt.fadeIn);
    this.anims[anim] = g;
    this.frames[anim] = framesOf(t);
    this.adapter.registerAnim(anim, t);
  }

  /**
   * @param {string} name - What `current` reports
   * @param {string} anim - The registered animation: the name, or its mirrored variant
   */
  async play(name, anim) {
    const g = this.anims[anim];
    // A new hand gesture takes the arms over from the current one instead of
    // dropping them to the stance first.
    this.stop(this.frames[anim]);
    this.current = name;
    this._anim = anim;
    const total = duration(g.dt);
    if (this.kind === 'hands') this.adapter.playGesture(anim);
    else this.adapter.playAnim(anim);
    if (g.overlay) this._osc.start(g.overlay.bones || {}, g.overlay.duration || total, g.overlay.delay || 0);

    if (!(await this._wait(total))) return false;
    if (this.kind === 'hands') {
      this.adapter.stopGesture(this.opt.fadeOut);
      if (!(await this._wait(this.opt.settle))) return false;
    }
    this.current = null;
    return true;
  }

  /** @param {Array} [next] - Frames of the hand gesture taking over; without them, a real stop */
  stop(next = null) {
    // An overlay can outlast its gesture.
    this._osc.clear();
    if (!this.current) return;
    this._cancel?.();
    if (this.kind === 'head') this.adapter.stopAnim(this._anim);
    else if (next)
      this.adapter.handOver(
        next.map(([pose, , mirror]) => [pose, mirror]),
        next[0]?.[3] ?? this.opt.fadeIn,
      );
    else this.adapter.stopGesture(this.opt.cutFade);
    this.current = null;
  }

  update(dt) {
    this._osc.update(dt);
  }

  _wait(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._cancel = null;
        resolve(true);
      }, ms);
      this._cancel = () => {
        clearTimeout(timer);
        this._cancel = null;
        resolve(false);
      };
    });
  }
}

class Oscillation {
  constructor(adapter) {
    this.adapter = adapter;
    this._run = null;
  }

  start(bones, length, delay) {
    this.clear();
    this._run = { t: -delay, length, bones: Object.entries(bones) };
  }

  update(dt) {
    const run = this._run;
    if (!run) return;
    run.t += dt;
    if (run.t < 0) return;
    if (run.t > run.length) {
      this.clear();
      return;
    }

    const sec = run.t / 1000;
    const env = Math.min(run.t / RAMP, 1) * Math.min((run.length - run.t) / RAMP, 1);
    for (const [bone, osc] of run.bones) {
      const s = Math.sin(sec * osc.freq) * env;
      const z = Math.sin(sec * osc.freq + (osc.phase || 0)) * env;
      this.adapter.setBoneOffset(bone, s * (osc.amp[0] || 0), s * (osc.amp[1] || 0), z * (osc.amp[2] || 0));
    }
  }

  clear() {
    const run = this._run;
    this._run = null;
    if (run) for (const [bone] of run.bones) this.adapter.setBoneOffset(bone, 0, 0, 0);
  }
}

// A gesture frame is [pose, duration, mirror, transitionMs]. JSON has no
// Infinity, so a null duration means "hold"; a missing transition gets fadeIn
// (TalkingHead's own default is a slow 1 s).
function toTemplate({ dt, rescale, vs }, fadeIn) {
  const t = { dt, vs: structuredClone(vs) };
  if (rescale) t.rescale = rescale;
  for (const frame of framesOf(t)) {
    frame[1] ??= Infinity;
    frame[2] ??= false;
    frame[3] ??= fadeIn;
  }
  return t;
}

const framesOf = (g) => (g.vs.gesture || []).filter(Array.isArray);

const otherSide = (name) => name.replace(/(Left|Right)/, (s) => (s === 'Left' ? 'Right' : 'Left'));

// Rotation tracks that turn or tilt to one side.
const SIDED_TRACKS = new Set(['bodyRotateY', 'bodyRotateZ', 'headRotateY', 'headRotateZ', 'eyesRotateY']);
const negate = (v) => (typeof v === 'number' ? -v : Array.isArray(v) ? v.map(negate) : v);

// The gesture with the other hand: each frame's mirror flag flips, sided tracks
// and the overlay move to the other side, their y and z rotations reversed.
function mirrored(g) {
  const m = structuredClone(g);
  for (const frame of framesOf(m)) frame[2] = !frame[2];
  m.vs = Object.fromEntries(Object.entries(m.vs).map(([k, v]) => [otherSide(k), SIDED_TRACKS.has(k) ? negate(v) : v]));
  if (m.overlay?.bones) {
    m.overlay.bones = Object.fromEntries(
      Object.entries(m.overlay.bones).map(([bone, o]) => [
        otherSide(bone),
        { ...o, amp: [o.amp[0] || 0, -(o.amp[1] || 0), -(o.amp[2] || 0)] },
      ]),
    );
  }
  return m;
}

// A [min, max] timing counts as its midpoint.
function duration(dt) {
  return (Array.isArray(dt) ? dt : [dt]).reduce((ms, d) => ms + (Array.isArray(d) ? (d[0] + d[1]) / 2 : d), 0);
}
