/**
 * TalkingHeadAdapter — the single point of contact with a TalkingHead instance.
 *
 * Every other module talks to the avatar through these verbs, never to `head`
 * directly. That keeps TalkingHead's surface in one file: when TalkingHead
 * changes, this is the only place to update.
 *
 * Each verb is tagged with how it reaches TalkingHead:
 *   - [public]   documented API (README method list / options)
 *   - [appendix] documented extension dictionaries (README Appendix D:
 *                animMoods, animEmojis, gestureTemplates, poseTemplates)
 *   - [internal] undocumented internals — the fragile part; re-check these
 *                first on every TalkingHead upgrade
 *
 * Verified against TalkingHead 1.7.
 *
 * @module TalkingHeadAdapter
 */

/** Idle/speaking options that freeze() zeroes and restores. */
const IDLE_OPTS = [
  'avatarIdleEyeContact',
  'avatarIdleHeadMove',
  'avatarSpeakingEyeContact',
  'avatarSpeakingHeadMove',
];

export class TalkingHeadAdapter {
  /**
   * @param {object} head - TalkingHead instance
   */
  constructor(head) {
    this.head = head;
  }

  // ===========================================================================
  // Discovery [appendix]
  // ===========================================================================

  /** Whether a pose template exists. */
  hasPose(name) {
    return !!this.head.poseTemplates?.[name];
  }

  /** Whether a mood exists (native or injected). */
  hasMood(name) {
    return !!this.head.animMoods?.[name];
  }

  /** Whether a native hand gesture template exists. */
  hasGesture(name) {
    return !!this.head.gestureTemplates?.[name];
  }

  /** Whether an animated emoji / registered animation exists. */
  hasAnim(name) {
    return !!this.head.animEmojis?.[name];
  }

  /** Names of native hand gesture templates. */
  gestureNames() {
    return this.head.gestureTemplates ? Object.keys(this.head.gestureTemplates) : [];
  }

  /** Whether the mood dictionary is available. */
  supportsMoods() {
    return !!this.head.animMoods;
  }

  // ===========================================================================
  // Registration [appendix]
  // ===========================================================================

  /**
   * Register an animation template, playable via playGesture(name).
   * @param {string} name
   * @param {object} template - TalkingHead animation template ({ dt, vs, … })
   */
  registerAnim(name, template) {
    this.head.animEmojis[name] = template;
  }

  /**
   * Get a mood definition ({ baseline, speech, anims }), or undefined.
   * @param {string} name
   */
  getMood(name) {
    return this.head.animMoods?.[name];
  }

  /**
   * Add or replace a mood, selectable via setMood(name).
   * @param {string} name
   * @param {{baseline:object, speech:object, anims:Array}} mood
   */
  registerMood(name, mood) {
    this.head.animMoods[name] = mood;
  }

  /**
   * Remove every mood whose name starts with `prefix`.
   * @param {string} prefix
   */
  removeMoodsWithPrefix(prefix) {
    const moods = this.head.animMoods;
    if (!moods) return;
    for (const key of Object.keys(moods)) {
      if (key.startsWith(prefix)) delete moods[key];
    }
  }

  // ===========================================================================
  // Playback [public]
  // ===========================================================================

  /** Set the avatar mood. Throws if the mood is unknown (TalkingHead behavior). */
  setMood(name) {
    this.head.setMood(name);
  }

  /** Play a gesture / registered animation. */
  playGesture(name, dur, mirror, ms) {
    this.head.playGesture(name, dur, mirror, ms);
  }

  /** Stop the current gesture. */
  stopGesture(ms) {
    this.head.stopGesture(ms);
  }

  /**
   * Transition to a named pose template. [internal]
   * TalkingHead's public playPose() loads Mixamo FBX files; named templates go
   * through setPoseFromTemplate() plus the poseName field.
   * @param {string} name
   * @param {number} ms - Transition time
   */
  playPoseTemplate(name, ms) {
    this.head.poseName = name;
    this.head.setPoseFromTemplate(this.head.poseTemplates[name], ms);
  }

  // ===========================================================================
  // Morph targets [internal]
  // ===========================================================================

  /** Names of the avatar's morph targets. */
  morphNames() {
    return this.head.mtAvatar ? Object.keys(this.head.mtAvatar) : [];
  }

  /** Write a morph's baseline (persistent level the animation system rests on). */
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

  /**
   * Set head rotation directly on the head-rotation morph slots.
   * @param {number} pitch - X rotation (nod)
   * @param {number} yaw   - Y rotation (shake)
   * @param {number} roll  - Z rotation (tilt)
   */
  setHeadRotation(pitch, yaw, roll) {
    const mt = this.head.mtAvatar;
    if (!mt) return;
    if (mt.headRotateX) { mt.headRotateX.newvalue = pitch; mt.headRotateX.needsUpdate = true; }
    if (mt.headRotateY) { mt.headRotateY.newvalue = yaw; mt.headRotateY.needsUpdate = true; }
    if (mt.headRotateZ) { mt.headRotateZ.newvalue = roll; mt.headRotateZ.needsUpdate = true; }
  }

  // ===========================================================================
  // Skeleton [internal]
  // ===========================================================================

  /**
   * Per-bone additive offsets (`"<Bone>.quaternion"` / `"<Bone>.position"`),
   * applied on top of the pose each frame. Requires TalkingHead's pose-delta
   * support; null when unavailable.
   * @returns {?Object<string, {x:number, y:number, z:number}>}
   */
  poseDeltaProps() {
    return this.head.poseDelta?.props || null;
  }

  /** Names of the avatar's bones. */
  boneNames() {
    const names = [];
    this.head.armature?.traverse((obj) => { if (obj.isBone) names.push(obj.name); });
    return names;
  }

  // ===========================================================================
  // Idle behavior [public options + internal queue]
  // ===========================================================================

  /** Current idle/speaking eye-contact and head-move options. */
  getIdleOptions() {
    const out = {};
    for (const k of IDLE_OPTS) out[k] = this.head.opt[k];
    return out;
  }

  /** Set idle/speaking eye-contact and head-move options. */
  setIdleOptions(values) {
    for (const k of IDLE_OPTS) if (k in values) this.head.opt[k] = values[k];
  }

  /** Drop every queued animation (breathing, blinks, idle moves). [internal] */
  clearAnimQueue() {
    this.head.animQueue = [];
  }
}
