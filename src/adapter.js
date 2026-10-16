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

// TalkingHead drives vowels at 0.6 (up to 1 at the end of long words) and PP/FF
// at 0.9: a vowel at its usual level already counts as a fully open mouth.
const VISEME_PEAK = 0.6;

// Gaze and blink belong to TalkingHead's idle eye animation, which outranks the
// baseline, so they go through the system slot (it expires on its own). Every
// other morph is written as baseline so lip-sync visemes still play over it.
const EYE_ANIM_RE = /^(eyeLook|eyeBlink)/;

const has = (o, k) => !!o && Object.hasOwn(o, k);

const isLookAt = (anim) => anim.template?.name === 'lookat';

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
    const queue = this.head.animQueue;
    const prior = queue.find(isLookAt);
    // An infinite duration: no rescaling and no timer of TalkingHead's own.
    this.head.playGesture(key(name), Infinity);
    // [internal] TalkingHead also looks at the camera on every gesture: it pitches the
    // head up and raises the brows at random. Drop that look, keep any earlier one.
    for (let i = queue.length - 1; i >= 0; i--) if (isLookAt(queue[i]) && queue[i] !== prior) queue.splice(i, 1);
    if (prior && !queue.includes(prior)) queue.push(prior);
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

  /**
   * [internal] Shows a morph `w` above its rest level; call it every frame while it's held.
   * TalkingHead eases baseline changes over about a second, which smooths a mood's
   * cross-fade but smears a beat, so `exact` writes the value through the realtime
   * slot (no easing, and TalkingHead never writes it itself). The baseline follows
   * along, so releasing the slot doesn't jump.
   * @param {string} mt
   * @param {number} w
   * @param {boolean} [exact=false]
   */
  setExpressionMorph(mt, w, exact = false) {
    const value = Math.min(1, this.restBaseline(mt) + w);
    if (EYE_ANIM_RE.test(mt)) return this.head.setValue(mt, value, 200);
    this.head.setBaselineValue(mt, value);
    this._realtime(mt, exact ? value : null);
  }

  /** [internal] Back to the rest level. */
  releaseMorph(mt) {
    if (EYE_ANIM_RE.test(mt)) return;
    this.head.setBaselineValue(mt, this.restBaseline(mt));
    this._realtime(mt, null);
  }

  /** [internal] */
  _realtime(mt, value) {
    const o = this.head.mtAvatar?.[mt];
    if (!o || (o.realtime ?? null) === value) return;
    o.realtime = value;
    o.needsUpdate = true;
  }

  /** [internal] Whether TalkingHead is playing speech (audio or lip-sync) right now. */
  isSpeaking() {
    return !!this.head.isSpeaking;
  }

  /**
   * [internal] Lets the lip-sync take the mouth back: while a viseme plays, the
   * given morphs drop to `floor` of their value (by how open the viseme is),
   * whatever drives them. Uses TalkingHead's own per-morph hooks, the ones that
   * make the eyelids follow the gaze: `limit` shapes the applied value and the
   * visemes' `onchange` re-evaluates the morphs. Installed on the current avatar
   * and in mtLimits/mtOnchange, so a reloaded avatar keeps it.
   * @param {string[]} morphs
   * @param {number} floor - 0 = gone at a full viseme, 1 = untouched
   * @returns {function} Removes it, restoring any hook it wrapped
   */
  duckMouth(morphs, floor) {
    const head = this.head;
    const mt = head.mtAvatar;
    if (!mt || !head.mtLimits || !head.mtOnchange) return () => {};
    const visemes = Object.keys(mt).filter((n) => n.startsWith('viseme_') && n !== 'viseme_sil');
    const targets = morphs.filter((n) => mt[n]);
    const open = () => visemes.reduce((m, n) => Math.max(m, mt[n]?.value || 0), 0);
    const duck = (v) => v * (1 - (1 - floor) * Math.min(1, open() / VISEME_PEAK));

    const undo = [];
    // One hook per morph, in both places TalkingHead keeps it.
    const wrap = (table, name, field, make) => {
      const prev = table[name] ?? null;
      const ours = make(prev);
      table[name] = ours;
      const entry = mt[name];
      const live = entry?.[field] ?? null;
      if (entry) entry[field] = live === prev ? ours : make(live);
      const installed = entry?.[field];
      undo.push(() => {
        if (table[name] === ours) {
          if (prev === null) delete table[name];
          else table[name] = prev;
        }
        if (entry && entry[field] === installed) entry[field] = live;
      });
    };
    for (const n of targets) wrap(head.mtLimits, n, 'limit', (prev) => (prev ? (v) => duck(prev(v)) : duck));
    const refresh = () => {
      for (const n of targets) if (mt[n]) mt[n].needsUpdate = true;
    };
    for (const n of visemes) {
      wrap(head.mtOnchange, n, 'onchange', (prev) =>
        prev
          ? (v) => {
              prev(v);
              refresh();
            }
          : refresh,
      );
    }
    refresh();
    return () => {
      for (const u of undo.reverse()) u();
      refresh();
    };
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
