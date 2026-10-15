// FACS compositor: expressions are Action Unit recipes (facs.json) resolved to
// ARKit blendshapes and added on top of the avatar's mood baseline each frame.
// Moods hold and cross-fade; beats play once with an in/hold/out envelope.

import FACS from './facs.json' with { type: 'json' };

// Gaze and blink belong to TalkingHead's idle eye animation, which outranks the
// baseline; they must go through the system slot. Everything else is written as
// baseline so lip-sync visemes still play over the expression.
const EYE_ANIM_RE = /^(eyeLook|eyeBlink)/;

const BEAT_ENVELOPE = { in: 300, hold: 1500, out: 600 };

export class Face {
  /**
   * @param {TalkingHeadAdapter} adapter
   * @param {object} [options]
   * @param {object} [options.facs] - { au_map, expressions }
   * @param {number} [options.fade=400] - Mood cross-fade (ms)
   */
  constructor(adapter, { facs = FACS, fade = 400 } = {}) {
    this.adapter = adapter;
    this.facs = facs;
    this.fade = fade;
    this._moods = [];
    this._beats = [];
    this._driven = new Set();
  }

  get names() {
    return Object.keys(this.facs.expressions);
  }

  /** The held expression shown or fading in, or null. */
  get current() {
    return this._moods.find((m) => m.target === 1)?.name ?? null;
  }

  /** @returns {{name:string, kind:'mood'|'beat', vs:Object<string,number>, envelope:?object}|null} */
  resolve(name) {
    const recipe = this.facs.expressions[name];
    if (!recipe) return null;
    return {
      name,
      kind: recipe.kind || 'mood',
      vs: this._ausToVs(recipe.aus || {}),
      envelope: recipe.envelope || null,
    };
  }

  /** A mood replaces the held expression (neutral just fades it out); a beat plays once on top. */
  play(name) {
    const r = this.resolve(name);
    if (!r) return false;
    if (r.kind === 'beat') {
      if (Object.keys(r.vs).length) this._beats.push({ vs: r.vs, t: 0, ...BEAT_ENVELOPE, ...r.envelope });
      return true;
    }
    for (const m of this._moods) m.target = 0;
    if (Object.keys(r.vs).length) this._moods.push({ name, vs: r.vs, level: 0, target: 1 });
    return true;
  }

  reset() {
    this._moods = [];
    this._beats = [];
    for (const mt of this._driven) this._release(mt);
    this._driven.clear();
  }

  update(dt) {
    if (!this._moods.length && !this._beats.length && !this._driven.size) return;

    const sum = {};
    const add = (vs, k) => {
      for (const [mt, w] of Object.entries(vs)) sum[mt] = (sum[mt] || 0) + w * k;
    };

    const step = dt / this.fade;
    this._moods = this._moods.filter((m) => {
      m.level = m.target > m.level ? Math.min(m.target, m.level + step) : Math.max(m.target, m.level - step);
      if (m.level <= 0 && m.target === 0) return false;
      add(m.vs, m.level);
      return true;
    });

    this._beats = this._beats.filter((b) => {
      b.t += dt;
      if (b.t >= b.in + b.hold + b.out) return false;
      const k = b.t < b.in ? b.t / b.in
        : b.t < b.in + b.hold ? 1
        : 1 - (b.t - b.in - b.hold) / b.out;
      add(b.vs, k);
      return true;
    });

    const driven = new Set();
    for (const [mt, w] of Object.entries(sum)) {
      if (w <= 0) continue;
      const value = Math.min(1, this.adapter.restBaseline(mt) + w);
      if (EYE_ANIM_RE.test(mt)) this.adapter.setMorphValue(mt, value, 200);
      else this.adapter.setMorphBaseline(mt, value);
      driven.add(mt);
    }
    for (const mt of this._driven) if (!driven.has(mt)) this._release(mt);
    this._driven = driven;
  }

  _release(mt) {
    if (!EYE_ANIM_RE.test(mt)) this.adapter.setMorphBaseline(mt, this.adapter.restBaseline(mt));
  }

  // A trailing _L/_R makes an AU unilateral.
  _ausToVs(aus) {
    const vs = {};
    for (const [au, weight] of Object.entries(aus)) {
      const side = au.endsWith('_L') ? 'Left' : au.endsWith('_R') ? 'Right' : null;
      const morphs = this.facs.au_map[side ? au.slice(0, -2) : au];
      if (!morphs) continue;
      for (const [mt, k] of Object.entries(morphs)) {
        if (side && !mt.includes(side)) continue;
        vs[mt] = Math.min(1, (vs[mt] || 0) + weight * k);
      }
    }
    return vs;
  }
}
