/**
 * TalkingHeadAdapter — the single point of contact with a TalkingHead instance.
 *
 * Every other module talks to the avatar through these verbs, never to `head`
 * directly. That keeps TalkingHead's surface in one file: when TalkingHead
 * changes, this is the only place to update.
 *
 * Each verb is tagged with how it reaches TalkingHead:
 *   - [public]   documented API (README method list / options)
 *   - [appendix] documented extension dictionaries (README Appendix D)
 *   - [internal] undocumented internals — the fragile part; re-check these
 *                first on every TalkingHead upgrade
 *
 * test/adapter.test.js checks every member used here against the real
 * TalkingHead source. Verified against TalkingHead 1.7.
 *
 * @module adapter
 */

export class TalkingHeadAdapter {
  /**
   * @param {object} head - TalkingHead instance
   */
  constructor(head) {
    this.head = head;
  }

  // ===========================================================================
  // Render loop [public]
  // ===========================================================================

  /**
   * Run `fn(dt)` on every frame, before rendering. Chains any `update` callback
   * the app already installed instead of replacing it.
   * @param {function(number):void} fn - Called with the frame delta (ms)
   */
  onFrame(fn) {
    const prev = this.head.opt.update;
    this.head.opt.update = prev ? (dt) => { prev(dt); fn(dt); } : fn;
  }

  // ===========================================================================
  // Gestures [public + appendix]
  // ===========================================================================

  /** Names of TalkingHead's built-in hand gestures. [appendix] */
  gestureNames() {
    return Object.keys(this.head.gestureTemplates || {});
  }

  /**
   * Register an animation template, playable via playGesture(name). [appendix]
   * @param {string} name
   * @param {object} template - TalkingHead animation template ({ dt, vs, … })
   */
  registerAnim(name, template) {
    this.head.animEmojis[name] = template;
  }

  /** Play a built-in gesture or registered animation. [public] */
  playGesture(name, dur, mirror, ms) {
    this.head.playGesture(name, dur, mirror, ms);
  }

  /** Stop the current gesture. [public] */
  stopGesture(ms) {
    this.head.stopGesture(ms);
  }

  // ===========================================================================
  // Morph targets [internal]
  // ===========================================================================

  /** Write a morph's baseline (the level the animation system rests on). */
  setMorphBaseline(mt, value) {
    this.head.setBaselineValue(mt, value);
  }

  /** Write a morph through the system slot (outranks idle eye animation). */
  setMorphValue(mt, value, ms) {
    this.head.setValue(mt, value, ms);
  }

  /**
   * The morph's rest level with no expression applied, mirroring setMood()'s
   * precedence: active mood → avatar baseline → per-morph exception → default.
   * @param {string} mt
   * @returns {number}
   */
  restBaseline(mt) {
    const head = this.head;
    const has = (o) => o && Object.prototype.hasOwnProperty.call(o, mt);
    if (has(head.mood?.baseline)) return head.mood.baseline[mt];
    if (has(head.avatar?.baseline)) return head.avatar.baseline[mt];
    if (has(head.mtBaselineExceptions)) return head.mtBaselineExceptions[mt];
    return head.mtBaselineDefault ?? 0;
  }

  // ===========================================================================
  // Skeleton [internal]
  // ===========================================================================

  /**
   * Per-bone additive offsets (`"<Bone>.quaternion"` / `"<Bone>.position"`),
   * applied on top of the pose each frame; null without pose-delta support.
   * @returns {?Object<string, {x:number, y:number, z:number}>}
   */
  poseDeltaProps() {
    return this.head.poseDelta?.props || null;
  }
}
