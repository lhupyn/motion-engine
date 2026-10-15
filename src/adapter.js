// The only module that touches the TalkingHead instance, so a TalkingHead
// upgrade is checked here and nowhere else. Verified against TalkingHead 1.7;
// test/adapter.test.js checks every member used here against its source.
//
// [public]   documented API
// [appendix] documented extension dictionaries (README, Appendix D)
// [internal] undocumented — re-check first on every upgrade

export class TalkingHeadAdapter {
  constructor(head) {
    this.head = head;
  }

  /** [public] Run fn(dt) every frame, after any update callback the app already set. */
  onFrame(fn) {
    const prev = this.head.opt.update;
    this.head.opt.update = prev ? (dt) => { prev(dt); fn(dt); } : fn;
  }

  /** [appendix] */
  gestureNames() {
    return Object.keys(this.head.gestureTemplates || {});
  }

  /** [appendix] Makes the template playable with playGesture(name). */
  registerAnim(name, template) {
    this.head.animEmojis[name] = template;
  }

  /** [public] */
  playGesture(name, dur, mirror, ms) {
    this.head.playGesture(name, dur, mirror, ms);
  }

  /** [public] */
  stopGesture(ms) {
    this.head.stopGesture(ms);
  }

  /** [internal] */
  setMorphBaseline(mt, value) {
    this.head.setBaselineValue(mt, value);
  }

  /** [internal] System slot: outranks the idle eye animation. */
  setMorphValue(mt, value, ms) {
    this.head.setValue(mt, value, ms);
  }

  /** [internal] A morph's level with no expression, in setMood()'s precedence order. */
  restBaseline(mt) {
    const head = this.head;
    const has = (o) => o && Object.prototype.hasOwnProperty.call(o, mt);
    if (has(head.mood?.baseline)) return head.mood.baseline[mt];
    if (has(head.avatar?.baseline)) return head.avatar.baseline[mt];
    if (has(head.mtBaselineExceptions)) return head.mtBaselineExceptions[mt];
    return head.mtBaselineDefault ?? 0;
  }

  /** [internal] Per-bone offsets ("Bone.quaternion", "Bone.position"); null without pose deltas. */
  poseDeltaProps() {
    return this.head.poseDelta?.props || null;
  }
}
