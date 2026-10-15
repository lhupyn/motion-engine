// Gestures are TalkingHead animation templates (gestures.json), played one at a
// time. An optional overlay adds per-bone sine oscillations or a jump arc
// through TalkingHead's pose deltas.

import GESTURES from './gestures.json';

const RAMP = 300;

export class Body {
  /**
   * @param {TalkingHeadAdapter} adapter
   * @param {object} [options]
   * @param {object} [options.gestures]
   * @param {number} [options.fadeIn=800]
   * @param {number} [options.fadeOut=800]
   * @param {number} [options.cutFade=100] - Fade when interrupted
   * @param {number} [options.settle=1000] - Wait after fading out before the gesture counts as done
   */
  constructor(adapter, { gestures = GESTURES, fadeIn = 800, fadeOut = 800, cutFade = 100, settle = 1000 } = {}) {
    this.adapter = adapter;
    this.opt = { fadeIn, fadeOut, cutFade, settle };
    this.gestures = {};
    this._osc = new Oscillation(adapter);
    this._current = null;
    this._cancel = null;

    const builtIn = new Set(adapter.gestureNames());
    for (const [name, g] of Object.entries(gestures)) {
      if (builtIn.has(name)) {
        // A template named like a built-in gesture would play itself recursively.
        console.warn(`[motion-engine] Gesture "${name}" collides with a TalkingHead built-in; skipped.`);
        continue;
      }
      this.gestures[name] = g;
      adapter.registerAnim(name, toTemplate(g));
    }
  }

  get names() {
    return Object.keys(this.gestures);
  }

  get current() {
    return this._current;
  }

  /** Interrupts the current gesture. Resolves true when done, false if interrupted or unknown. */
  async play(name) {
    const g = this.gestures[name];
    if (!g) return false;
    this.stop();
    this._current = name;

    const total = duration(g.dt);
    this.adapter.playGesture(name, Infinity, false, this.opt.fadeIn);
    if (g.overlay) this._osc.start(g.overlay.bones || {}, g.overlay.duration || total, g.overlay.delay || 0);

    if (!(await this._wait(total))) return false;
    this.adapter.stopGesture(this.opt.fadeOut);
    if (!(await this._wait(this.opt.settle))) return false;
    this._current = null;
    return true;
  }

  stop() {
    if (!this._current) return;
    this._cancel?.();
    this._osc.clear();
    this.adapter.stopGesture(this.opt.cutFade);
    this._current = null;
  }

  update(dt) {
    this._osc.update(dt);
  }

  _wait(ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this._cancel = null; resolve(true); }, ms);
      this._cancel = () => { clearTimeout(timer); this._cancel = null; resolve(false); };
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
    this._run = {
      t: -delay,
      length,
      bones: Object.entries(bones).map(([bone, osc]) => ({
        osc,
        jump: osc.custom === 'jump',
        pos: `${bone}.position`,
        quat: `${bone}.quaternion`,
      })),
    };
  }

  update(dt) {
    const run = this._run;
    if (!run) return;
    run.t += dt;
    if (run.t < 0) return;
    if (run.t > run.length) { this.clear(); return; }

    const props = this.adapter.poseDeltaProps();
    if (!props) return;

    const sec = run.t / 1000;
    const env = Math.min(run.t / RAMP, 1) * Math.min((run.length - run.t) / RAMP, 1);
    for (const { osc, jump, pos, quat } of run.bones) {
      if (jump) {
        if (props[pos]) props[pos].y = Math.sin((run.t / run.length) * Math.PI) * 0.12;
      } else if (props[quat]) {
        const s = Math.sin(sec * osc.freq) * env;
        props[quat].x = s * (osc.amp[0] || 0);
        props[quat].y = s * (osc.amp[1] || 0);
        props[quat].z = Math.sin(sec * osc.freq + (osc.phase || 0)) * (osc.amp[2] || 0) * env;
      }
    }
  }

  clear() {
    const run = this._run;
    this._run = null;
    const props = run && this.adapter.poseDeltaProps();
    if (!props) return;
    for (const { jump, pos, quat } of run.bones) {
      if (jump) { if (props[pos]) props[pos].y = 0; }
      else if (props[quat]) { props[quat].x = props[quat].y = props[quat].z = 0; }
    }
  }
}

// JSON has no Infinity: null in a gesture frame means "hold".
function toTemplate({ dt, rescale, vs }) {
  const t = { dt, vs: structuredClone(vs) };
  if (rescale) t.rescale = rescale;
  for (const frame of t.vs.gesture || []) {
    if (Array.isArray(frame)) for (let i = 0; i < frame.length; i++) if (frame[i] === null) frame[i] = Infinity;
  }
  return t;
}

// A [min, max] timing counts as its midpoint.
function duration(dt) {
  return (Array.isArray(dt) ? dt : [dt]).reduce((ms, d) => ms + (Array.isArray(d) ? (d[0] + d[1]) / 2 : d), 0);
}
