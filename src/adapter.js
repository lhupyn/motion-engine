// The only module that touches the TalkingHead instance, so a TalkingHead
// upgrade is checked here and nowhere else. Verified against TalkingHead 1.7;
// test/adapter.test.js checks every member used here against its source.
//
// [public]   documented API
// [appendix] documented extension dictionaries (README, Appendix D)
// [internal] undocumented — re-check first on every upgrade

// Marks the gesture templates registered here, so a second engine on the same
// avatar can replace them instead of treating them as built-ins.
const OWN = Symbol('motion-engine');

// playGesture(name) applies the gesture template AND plays the animation of that
// name, so a registered "shrug" would drag in TalkingHead's own shrug. Our
// animations get a key of their own.
const key = (name) => `motion-engine:${name}`;

// Gaze and blink belong to TalkingHead's idle eye animation, which outranks the
// baseline, so they go through the system slot (it expires on its own). Every
// other morph is written as baseline so lip-sync visemes still play over it.
const EYE_ANIM_RE = /^(eyeLook|eyeBlink)/;

const has = (o, k) => !!o && Object.hasOwn(o, k);

export class TalkingHeadAdapter {
  constructor(head) {
    this.head = head;
  }

  /**
   * [public] Run fn(dt) every frame, after any update callback the app already set.
   * @returns {function} Unhooks fn; leaves the callback alone if the app replaced it since
   */
  onFrame(fn) {
    const prev = this.head.opt.update;
    const update = prev
      ? (dt) => {
          prev(dt);
          fn(dt);
        }
      : fn;
    this.head.opt.update = update;
    return () => {
      if (this.head.opt.update === update) this.head.opt.update = prev;
    };
  }

  /** [appendix] Gesture templates that TalkingHead ships or the app added (not the poses registered here). */
  gestureNames() {
    return Object.entries(this.head.gestureTemplates || {})
      .filter(([, t]) => !t[OWN])
      .map(([name]) => name);
  }

  /** [appendix] An arm/hand pose (bone rotations) that gesture frames can use like a built-in. */
  registerPose(name, props) {
    this.head.gestureTemplates[name] = { ...props, [OWN]: true };
  }

  /** [appendix] Makes the template playable with playGesture(name) and playAnim(name). */
  registerAnim(name, template) {
    this.head.animEmojis[key(name)] = template;
  }

  /** [public] Plays a registered animation through the gesture system, until stopGesture(). */
  playGesture(name) {
    // An infinite duration: no rescaling and no timer of TalkingHead's own.
    this.head.playGesture(key(name), Infinity);
  }

  /** [public] */
  stopGesture(ms) {
    this.head.stopGesture(ms);
  }

  /**
   * [internal] Ends the current hand gesture for a new one: bones that the next
   * poses move stay put and go straight to their new target; the rest return to
   * the stance in ms. (A new playGesture() alone would leave them stuck.)
   * @param {Array<[string, boolean]>} next - [pose, mirror] pairs
   */
  handOver(next, ms) {
    const head = this.head;
    if (head.gesture) {
      const kept = new Set();
      for (const [pose, mirror] of next) {
        for (const prop of Object.keys(head.gestureTemplates[pose] || {})) {
          const bone = prop.replace('.rotation', '.quaternion');
          kept.add(mirror ? bone.replace(/^(Left|Right)/, (s) => (s === 'Left' ? 'Right' : 'Left')) : bone);
        }
      }
      head.gesture = Object.fromEntries(Object.entries(head.gesture).filter(([bone]) => !kept.has(bone)));
    }
    head.stopGesture(ms);
  }

  /** [internal] Play a registered animation alongside any gesture; untagged, so stopGesture() leaves it running. */
  playAnim(name) {
    const anim = this.head.animFactory(this.head.animEmojis[key(name)]);
    anim.motionEngine = name;
    this.head.animQueue.push(anim);
  }

  /** [internal] */
  stopAnim(name) {
    const queue = this.head.animQueue;
    const i = queue.findIndex((a) => a.motionEngine === name);
    if (i !== -1) queue.splice(i, 1);
  }

  /** [internal] Shows a morph `w` above its rest level; call it every frame while it's held. */
  setExpressionMorph(mt, w) {
    const value = Math.min(1, this.restBaseline(mt) + w);
    if (EYE_ANIM_RE.test(mt)) this.head.setValue(mt, value, 200);
    else this.head.setBaselineValue(mt, value);
  }

  /** [internal] Back to the rest level. */
  releaseMorph(mt) {
    if (!EYE_ANIM_RE.test(mt)) this.head.setBaselineValue(mt, this.restBaseline(mt));
  }

  /** [internal] A morph's level with no expression, in setMood()'s precedence order. */
  restBaseline(mt) {
    const head = this.head;
    if (has(head.mood?.baseline, mt)) return head.mood.baseline[mt];
    if (has(head.avatar?.baseline, mt)) return head.avatar.baseline[mt];
    if (has(head.mtBaselineExceptions, mt)) return head.mtBaselineExceptions[mt];
    return head.mtBaselineDefault ?? 0;
  }

  /** [internal] Rotation offset (Euler x, y, z) on top of a bone's pose; ignored for bones TalkingHead keeps no offset for. */
  setBoneOffset(bone, x, y, z) {
    const d = this.head.poseDelta?.props?.[`${bone}.quaternion`];
    if (!d) return;
    d.x = x;
    d.y = y;
    d.z = z;
  }
}
