/**
 * MotionEngine — Reusable motion player for TalkingHead avatars.
 *
 * Responsibilities:
 *   - Register custom animEmojis on a TalkingHead instance
 *   - Play motions (custom, native gesture/emoji, or pose)
 *   - Manage poseDelta oscillation overlays via update() hook
 *
 * No DOM dependencies. Designed to be used as a plugin.
 *
 * @module MotionEngine
 */

/**
 * @class MotionEngine
 */
export class MotionEngine {
  /**
   * @param {object} talkingHead - TalkingHead instance
   */
  constructor(talkingHead) {
    this.head = talkingHead;
    this.overlay = null;
    this.playing = false;
    this._playStart = 0;
    this._motions = {};

    /** @type {function(string):void|null} */
    this.onStart = null;
    /** @type {function(string):void|null} */
    this.onEnd = null;
    /** @type {function(string, Error):void|null} */
    this.onError = null;
  }

  /**
   * Register a dictionary of custom motions as animEmojis on the TalkingHead instance.
   * Converts `null` to `Infinity` in gesture duration fields (JSON compatibility).
   * Validates that no motion name collides with gestureTemplates to prevent recursive loops.
   *
   * @param {object} motions - Dictionary of motion definitions
   * @returns {number} Number of motions registered
   */
  registerMotions(motions) {
    let count = 0;
    const gestureNames = this.head.gestureTemplates
      ? Object.keys(this.head.gestureTemplates)
      : [];

    for (const [name, motion] of Object.entries(motions)) {
      // Collision check: animEmoji name must not match a gestureTemplate name
      if (gestureNames.includes(name)) {
        console.warn(`[MotionEngine] Skipping "${name}" — collides with gestureTemplates (would cause recursive loop).`);
        continue;
      }

      // Deep clone to avoid mutating the source dictionary
      const entry = JSON.parse(JSON.stringify(motion));

      // Convert null → Infinity in gesture arrays (JSON doesn't support Infinity)
      if (entry.vs?.gesture) {
        for (const gestureFrame of entry.vs.gesture) {
          if (Array.isArray(gestureFrame)) {
            for (let i = 0; i < gestureFrame.length; i++) {
              if (gestureFrame[i] === null) {
                gestureFrame[i] = Infinity;
              }
            }
          }
        }
      }

      // Store full motion (with _overlay) for play()
      this._motions[name] = entry;

      // Register without _overlay as animEmoji
      const { _overlay, ...animEmoji } = entry;
      this.head.animEmojis[name] = animEmoji;
      count++;
    }

    return count;
  }

  /**
   * Play a motion by name.
   * Resolves custom motions, native gestures/emojis, and poses.
   *
   * @param {string} name - Motion identifier
   * @param {number} [dur] - Optional duration override for native gestures (seconds)
   */
  async play(name, dur) {
    if (this.playing) {
      // Force reset if stuck for more than 10s
      if (this._playStart && (performance.now() - this._playStart > 10000)) {
        this.head.stopGesture(100);
        this._clearOverlay();
        this.playing = false;
      } else {
        return;
      }
    }
    this._playStart = performance.now();

    const motion = this._motions[name];
    if (!motion) {
      // Try as a native TalkingHead gesture/emoji
      if (this.head.gestureTemplates[name] || this.head.animEmojis[name]) {
        this.playing = true;
        this._emit('onStart', name);
        const d = dur || 3;
        this.head.playGesture(name, d, false, 800);
        await this._wait(d * 1000 + 800);
        this.playing = false;
        this._emit('onEnd', name);
        return;
      }

      // Try as a pose
      if (this.head.poseTemplates[name]) {
        this.playing = true;
        this._emit('onStart', name);
        this.head.poseName = name;
        this.head.setPoseFromTemplate(this.head.poseTemplates[name], 1500);
        await this._wait(1700);
        this.playing = false;
        this._emit('onEnd', name);
        return;
      }

      this._emit('onError', name, new Error(`Unknown motion: ${name}`));
      return;
    }

    this.playing = true;
    this._emit('onStart', name);

    // Calculate total duration from dt array
    const totalMs = motion.dt.reduce((sum, d) => {
      return sum + (Array.isArray(d) ? (d[0] + d[1]) / 2 : d);
    }, 0);

    // Start overlay if defined
    if (motion._overlay) {
      const ol = motion._overlay;
      setTimeout(() => {
        this._startOverlay(ol.bones, ol.duration);
      }, ol.delay);
    }

    // Play via TalkingHead — don't pass dur so our dt timing is used as-is
    this.head.playGesture(name, Infinity, false, 800);

    // Wait for the animation to play out
    await this._wait(totalMs);

    // Manually stop the gesture (hand returns to base pose)
    this.head.stopGesture(800);
    await this._wait(1000);
    this._clearOverlay();

    this.playing = false;
    this._emit('onEnd', name);
  }

  /**
   * Force-stop the current motion.
   */
  stop() {
    if (!this.playing) return;
    this.head.stopGesture(100);
    this._clearOverlay();
    this.playing = false;
  }

  /**
   * Frame update hook — manages oscillation overlays.
   * Connect to TalkingHead via: `head.opt.update = (dt) => engine.update(dt);`
   *
   * @param {number} dt - Delta time from TalkingHead render loop
   */
  update(dt) {
    if (!this.overlay) return;

    const elapsed = performance.now() - this.overlay.startTime;
    if (elapsed > this.overlay.duration) {
      this._clearOverlay();
      return;
    }

    const time = elapsed / 1000;
    // Fade in/out envelope
    const fadeIn = Math.min(elapsed / 300, 1);
    const fadeOut = Math.min((this.overlay.duration - elapsed) / 300, 1);
    const envelope = fadeIn * fadeOut;

    for (const [boneName, osc] of Object.entries(this.overlay.bones)) {
      // Skip custom overlay types (like jump)
      if (osc.custom) continue;

      const key = `${boneName}.quaternion`;
      if (this.head.poseDelta.props[key]) {
        this.head.poseDelta.props[key].x = Math.sin(time * osc.freq) * osc.amp[0] * envelope;
        this.head.poseDelta.props[key].y = Math.sin(time * osc.freq) * osc.amp[1] * envelope;
        this.head.poseDelta.props[key].z = Math.sin(time * osc.freq + (osc.phase || 0)) * osc.amp[2] * envelope;
      }
    }
  }

  /** @private */
  _startOverlay(bones, duration) {
    this.overlay = {
      bones,
      startTime: performance.now(),
      duration,
    };
  }

  /** @private */
  _clearOverlay() {
    if (!this.overlay) return;
    for (const boneName of Object.keys(this.overlay.bones)) {
      const key = `${boneName}.quaternion`;
      if (this.head.poseDelta.props[key]) {
        this.head.poseDelta.props[key].x = 0;
        this.head.poseDelta.props[key].y = 0;
        this.head.poseDelta.props[key].z = 0;
      }
    }
    this.overlay = null;
  }

  /** @private */
  _emit(event, name, err) {
    if (typeof this[event] === 'function') {
      if (err) {
        this[event](name, err);
      } else {
        this[event](name);
      }
    }
  }

  /** @private */
  _wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
