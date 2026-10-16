// FACS compositor: expressions are Action Unit recipes (facs.json) resolved to
// ARKit blendshapes and added on top of the avatar's mood baseline each frame.
// Moods hold and cross-fade; beats play once with an in/hold/out envelope.
// Within a beat, an AU with an `offset` rises that much later and falls that
// much earlier than the rest (the tongue comes out after the lips part).

import FACS from './facs.json' with { type: 'json' };

const BEAT_ENVELOPE = { in: 300, hold: 1500, out: 600 };

// AUs that open the mouth; their blendshapes give way to the lip-sync visemes.
const MOUTH_OPENING_AUS = ['AU10', 'AU16', 'AU20', 'AU25', 'AU26', 'AU27'];
// AUs that pull the lip corners out; over a viseme they over-stretch the mouth.
const SMILE_AUS = ['AU12', 'AU14'];

/**
 * @typedef {object} Expression
 * @property {string} [description] - When to use it; without one the classifier never picks it
 * @property {string} [facs] - Provenance note, unused at runtime
 * @property {'mood'|'beat'} [kind='mood'] - A mood holds until replaced; a beat plays once on top
 * @property {Record<string, number>} [aus] - AU → level; a trailing _L/_R makes it one-sided
 * @property {{in?: number, hold?: number, out?: number}} [envelope] - Beats only, ms
 * @property {Record<string, number>} [offset] - Beats only: AU → ms it starts later and ends earlier
 * @property {boolean} [whileSpeaking=true] - Beats only: false = the director never starts it while the avatar speaks
 *   (a yawn can't share the jaw with the lip-sync; a laugh can)
 */

/**
 * @typedef {object} FacsCatalog
 * @property {Record<string, Record<string, number>>} au_map - AU → ARKit blendshape weights
 * @property {Record<string, Expression>} expressions
 * @property {Record<string, {max: number, beatMax?: number, note?: string}>} [au_limits]
 * @property {{aus: Record<string, number>, note?: string}[]} [avoid]
 */

/**
 * @typedef {object} FaceOptions
 * @property {FacsCatalog} [facs] - Default: the bundled facs.json
 * @property {number} [fade=400] - Mood cross-fade, ms
 * @property {number} [speechMouth=0.3] - While a viseme plays, mouth-opening morphs drop to this share of their value,
 *   so speech doesn't open the mouth too wide or bare the teeth, and p/b/m still close the lips. 1 = off
 * @property {number} [speechSmile=0.5] - The same for the lip corners (smile, dimple), which over-stretch the mouth on
 *   visemes. 1 = off
 */

export class Face {
  // Not part of the documented API: kept out of the published types (stripInternal).
  /** @internal */ adapter;
  /** @internal @type {FacsCatalog} */ facs;
  /** @internal */ fade;
  /** @internal */ _unduck;
  /** @internal */ _moods = [];
  /** @internal */ _beats = [];
  /** @internal */ _driven = new Set();
  // Reused every frame: the summed morphs, and the next frame's driven set.
  /** @internal */ _sum = new Map();
  /** @internal */ _spare = new Set();
  // Morphs a beat drives this frame, and last frame: written exactly, without TalkingHead's easing.
  /** @internal */ _exact = new Set();
  /** @internal */ _wasExact = new Set();

  /**
   * @internal
   * @param {import('./adapter.js').TalkingHeadAdapter} adapter
   * @param {FaceOptions} [options]
   */
  constructor(
    adapter,
    { facs = /** @type {FacsCatalog} */ (FACS), fade = 400, speechMouth = 0.3, speechSmile = 0.5 } = {},
  ) {
    this.adapter = adapter;
    this.facs = facs;
    // Limits are a review aid, not a clamp: a custom catalog may break them on purpose.
    for (const v of auViolations(facs)) console.warn(`[motion-engine] ${v}`);
    this.fade = fade;
    const floors = {};
    for (const [aus, floor] of [
      [MOUTH_OPENING_AUS, speechMouth],
      [SMILE_AUS, speechSmile],
    ]) {
      if (floor >= 1) continue;
      for (const mt of aus.flatMap((au) => Object.keys(facs.au_map[au] || {}))) {
        floors[mt] = Math.min(floors[mt] ?? 1, Math.max(0, floor));
      }
    }
    this._unduck = Object.keys(floors).length ? adapter.duckMouth(floors) : () => {};
  }

  /** @returns {string[]} */
  get names() {
    return Object.keys(this.facs.expressions);
  }

  /**
   * The held expression shown or fading in, or null.
   * @returns {string|null}
   */
  get current() {
    return this._moods.find((m) => m.target === 1)?.name ?? null;
  }

  /**
   * @param {string} name
   * @returns {{name: string, kind: 'mood'|'beat', vs: Record<string, number>, envelope: ?object, offsets: Record<string, number>}|null}
   * @internal
   */
  resolve(name) {
    const recipe = this.facs.expressions[name];
    if (!recipe) return null;
    return {
      name,
      kind: recipe.kind || 'mood',
      vs: this._ausToVs(recipe.aus || {}),
      envelope: recipe.envelope || null,
      offsets: this._offsets(recipe.offset || {}),
    };
  }

  /**
   * A mood replaces the held expression (neutral just fades it out); a beat plays once on top.
   * @param {string} name
   * @returns {boolean} false if the name isn't in the catalog
   */
  play(name) {
    const r = this.resolve(name);
    if (!r) return false;
    const morphs = Object.entries(r.vs);
    if (r.kind === 'beat') {
      const env = { ...BEAT_ENVELOPE, ...r.envelope };
      // An offset can use up the morph's hold, never its ramps.
      const staged = morphs.map(([mt, w]) => [mt, w, Math.min(r.offsets[mt] || 0, env.hold / 2)]);
      if (morphs.length) this._beats.push({ morphs: staged, t: 0, ...env });
      return true;
    }
    for (const m of this._moods) m.target = 0;
    if (morphs.length) this._moods.push({ name, morphs, level: 0, target: 1 });
    return true;
  }

  /** @internal */
  reset() {
    this._moods = [];
    this._beats = [];
    for (const mt of this._driven) this.adapter.releaseMorph(mt);
    this._driven.clear();
  }

  /** @internal Reset, and hand the mouth back to TalkingHead. */
  dispose() {
    this.reset();
    this._unduck();
  }

  /** @internal @param {number} dt - ms since the last frame */
  update(dt) {
    if (!this._moods.length && !this._beats.length && !this._driven.size) return;

    const sum = this._sum;
    sum.clear();
    const add = (morphs, k) => {
      for (const [mt, w] of morphs) sum.set(mt, (sum.get(mt) || 0) + w * k);
    };

    const step = dt / this.fade;
    this._moods = this._moods.filter((m) => {
      m.level = m.target > m.level ? Math.min(m.target, m.level + step) : Math.max(m.target, m.level - step);
      if (m.level <= 0 && m.target === 0) return false;
      add(m.morphs, m.level);
      return true;
    });

    const exact = this._wasExact;
    const wasExact = this._exact;
    exact.clear();
    this._beats = this._beats.filter((b) => {
      b.t += dt;
      if (b.t >= b.in + b.hold + b.out) return false;
      // All of a live beat's morphs, even at 0 (an offset's tail): eased, they'd linger.
      for (const [mt, w, offset] of b.morphs) {
        exact.add(mt);
        sum.set(mt, (sum.get(mt) || 0) + w * beatLevel(b, offset));
      }
      return true;
    });

    const driven = this._spare;
    driven.clear();
    sum.forEach((w, mt) => {
      const isExact = exact.has(mt) || wasExact.has(mt);
      if (w <= 0 && !isExact) return;
      // One more exact frame after a beat ends puts its last level in place, so
      // TalkingHead's easing (slow to start) has no tail left to ease.
      this.adapter.setExpressionMorph(mt, Math.max(0, w), isExact);
      driven.add(mt);
    });
    for (const mt of wasExact) {
      if (driven.has(mt)) continue;
      this.adapter.setExpressionMorph(mt, 0, true);
      driven.add(mt);
    }
    for (const mt of this._driven) if (!driven.has(mt)) this.adapter.releaseMorph(mt);
    this._exact = exact;
    this._wasExact = wasExact;
    this._spare = this._driven;
    this._driven = driven;
  }

  // A morph shared by AUs with different offsets follows the latest one, so a
  // staged AU never shows before what it waits for.
  /** @internal */
  _offsets(offset) {
    const out = {};
    for (const [au, ms] of Object.entries(offset)) {
      for (const mt of Object.keys(this._ausToVs({ [au]: 1 }))) out[mt] = Math.max(out[mt] || 0, ms);
    }
    return out;
  }

  // A trailing _L/_R makes an AU unilateral.
  /** @internal */
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

// The envelope at the beat's time, with the morph's ramps moved inwards by `offset`.
function beatLevel(b, offset) {
  const t = b.t - offset;
  const end = b.in + b.hold + b.out - 2 * offset;
  if (t < 0 || t >= end) return 0;
  if (t < b.in) return t / b.in;
  if (t < end - b.out) return 1;
  return (end - t) / b.out;
}

/**
 * Recipes that break the catalog's per-avatar calibration: an AU above its
 * `au_limits` level, or a combination from `avoid`.
 * @param {FacsCatalog} facs
 * @returns {string[]} One message per problem
 * @internal
 */
export function auViolations({ au_map: map, au_limits: limits = {}, avoid = [], expressions }) {
  const out = [];
  for (const [au, lim] of Object.entries(limits)) {
    if (!map[au]) out.push(`au_limits: unknown AU "${au}"`);
    if (typeof lim.max !== 'number') out.push(`au_limits: ${au} needs a numeric max`);
  }
  for (const rule of avoid) {
    const aus = Object.keys(rule.aus || {});
    if (aus.length < 2) out.push(`avoid: a rule needs at least two AUs (${aus.join(', ') || 'none'})`);
    for (const au of aus) if (!map[au]) out.push(`avoid: unknown AU "${au}"`);
  }
  if (out.length) return out;

  const why = (note) => (note ? ` — ${note}` : '');
  for (const [name, e] of Object.entries(expressions)) {
    const level = auLevels(e.aus || {});
    const beat = e.kind === 'beat';
    for (const [au, lim] of Object.entries(limits)) {
      const max = beat ? (lim.beatMax ?? lim.max) : lim.max;
      if ((level[au] || 0) > max)
        out.push(`${name}: ${au} ${level[au]} is above ${max}${beat ? ' for a beat' : ''}${why(lim.note)}`);
    }
    for (const rule of avoid) {
      if (Object.entries(rule.aus).every(([au, max]) => (level[au] || 0) > max)) {
        out.push(`${name}: ${Object.keys(rule.aus).join(' + ')} together${why(rule.note)}`);
      }
    }
  }
  return out;
}

// Each AU at its stronger side's level: AU12 + AU12_L on the left, AU12 + AU12_R on the right.
function auLevels(aus) {
  const left = {};
  const right = {};
  for (const [key, w] of Object.entries(aus)) {
    const au = key.replace(/_[LR]$/, '');
    if (!key.endsWith('_R')) left[au] = (left[au] || 0) + w;
    if (!key.endsWith('_L')) right[au] = (right[au] || 0) + w;
  }
  // Rounded, so 0.1 + 0.2 isn't "above" a 0.3 limit.
  const level = {};
  for (const [au, w] of [...Object.entries(left), ...Object.entries(right)])
    level[au] = Math.max(level[au] || 0, Math.round(w * 1000) / 1000);
  return level;
}
