/**
 * MotionEngine — Reusable motion player for TalkingHead avatars.
 *
 * Responsibilities:
 *   - Register custom animEmojis on a TalkingHead instance
 *   - Play motions (custom, native gesture/emoji, or pose)
 *   - Delegate poseDelta oscillation overlays to OverlayManager
 *   - Support motion interruption and sequencing
 *
 * No DOM dependencies. Designed to be used as a plugin.
 *
 * @module MotionEngine
 */

import { OverlayManager } from './OverlayManager.js';

/** Default timing options (ms) */
const DEFAULTS = {
  gestureFadeIn: 800,
  gestureFadeOut: 800,
  stopFade: 100,
  stopSettleTime: 1000,
  poseFadeIn: 1500,
  poseSettleTime: 1700,
  nativeDuration: 3,
};

/**
 * @class MotionEngine
 */
export class MotionEngine {
  /**
   * @param {object} talkingHead - TalkingHead instance
   * @param {object} [options] - Timing and behavior overrides
   * @param {number} [options.gestureFadeIn=800]     - Fade-in for gesture playback (ms)
   * @param {number} [options.gestureFadeOut=800]     - Fade-out when stopping a gesture (ms)
   * @param {number} [options.stopFade=100]           - Quick fade for interrupt stops (ms)
   * @param {number} [options.stopSettleTime=1000]    - Wait after stopGesture before cleanup (ms)
   * @param {number} [options.poseFadeIn=1500]        - Transition time for pose changes (ms)
   * @param {number} [options.poseSettleTime=1700]    - Wait after setPoseFromTemplate (ms)
   * @param {number} [options.nativeDuration=3]       - Default duration for native gestures (s)
   */
  constructor(talkingHead, options = {}) {
    this.head = talkingHead;
    this.opt = { ...DEFAULTS, ...options };
    this.playing = false;
    this._playStart = 0;
    this._motions = {};
    this._cancelFn = null;
    this._overlays = new OverlayManager(talkingHead);

    /** @type {function(string):void|null} */
    this.onStart = null;
    /** @type {function(string):void|null} */
    this.onEnd = null;
    /** @type {function(string, Error):void|null} */
    this.onError = null;
  }

  // ===========================================================================
  // Registration
  // ===========================================================================

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
      if (gestureNames.includes(name)) {
        console.warn(`[MotionEngine] Skipping "${name}" — collides with gestureTemplates (would cause recursive loop).`);
        continue;
      }

      // Deep clone to avoid mutating the source dictionary
      const entry = JSON.parse(JSON.stringify(motion));

      // Convert null → Infinity in gesture arrays (JSON doesn't support Infinity)
      if (entry.vs?.gesture) {
        for (const frame of entry.vs.gesture) {
          if (Array.isArray(frame)) {
            for (let i = 0; i < frame.length; i++) {
              if (frame[i] === null) frame[i] = Infinity;
            }
          }
        }
      }

      this._motions[name] = entry;

      // Register without _overlay as animEmoji on TalkingHead
      const { _overlay, _description, _tags, ...animEmoji } = entry;
      this.head.animEmojis[name] = animEmoji;
      count++;
    }

    return count;
  }

  // ===========================================================================
  // Playback
  // ===========================================================================

  /**
   * Play a motion by name.
   * If a motion is already playing, it will be interrupted first.
   * Resolution order: custom → native gesture/emoji → pose.
   *
   * @param {string} name - Motion identifier
   * @param {number} [dur] - Optional duration override for native gestures (seconds)
   */
  async play(name, dur) {
    if (this.playing) {
      this._interrupt();
    }
    this._playStart = performance.now();

    const motion = this._motions[name];

    // ── Custom motion ──────────────────────────────────────────────────
    if (motion) {
      return this._playCustom(name, motion);
    }

    // ── Native gesture / emoji ─────────────────────────────────────────
    if (this.head.gestureTemplates[name] || this.head.animEmojis[name]) {
      return this._playNative(name, dur);
    }

    // ── Pose ───────────────────────────────────────────────────────────
    if (this.head.poseTemplates[name]) {
      return this._playPose(name);
    }

    this._emit('onError', name, new Error(`Unknown motion: ${name}`));
  }

  /**
   * Play a sequence of motions in order.
   * Each motion waits for the previous one to finish before starting.
   * If stop() is called during a sequence, the remaining motions are skipped.
   *
   * @param {string[]} names - Array of motion names to play sequentially
   */
  async playSequence(names) {
    for (const name of names) {
      if (!this.playing && names.indexOf(name) > 0) return;
      await this.play(name);
    }
  }

  /**
   * Force-stop the current motion. Cleanly cancels any pending wait timers
   * and resets state immediately.
   */
  stop() {
    if (!this.playing) return;
    this._interrupt();
  }

  // ===========================================================================
  // Discovery
  // ===========================================================================

  /**
   * Get all registered custom motion names.
   *
   * @returns {string[]}
   */
  getMotionNames() {
    return Object.keys(this._motions);
  }

  /**
   * Get motion metadata for LLM tool discovery.
   * Returns name, description, and tags for each registered motion.
   *
   * @returns {Array<{name: string, description: string, tags: string[]}>}
   */
  getMotions() {
    return Object.entries(this._motions).map(([name, motion]) => ({
      name,
      description: motion._description || name,
      tags: motion._tags || [],
    }));
  }

  // ===========================================================================
  // Render loop hook
  // ===========================================================================

  /**
   * Frame update hook — delegates to OverlayManager.
   * Connect to TalkingHead via: `head.opt.update = (dt) => engine.update(dt);`
   *
   * @param {number} dt - Delta time from TalkingHead render loop
   */
  update(dt) {
    this._overlays.update(dt);
  }

  // ===========================================================================
  // Private — playback strategies
  // ===========================================================================

  /** @private — Play a custom motion from the registry */
  async _playCustom(name, motion) {
    this.playing = true;
    this._emit('onStart', name);

    const totalMs = motion.dt.reduce((sum, d) => {
      return sum + (Array.isArray(d) ? (d[0] + d[1]) / 2 : d);
    }, 0);

    // Start overlay if defined
    if (motion._overlay) {
      const ol = motion._overlay;
      setTimeout(() => this._overlays.start(ol.bones, ol.duration), ol.delay);
    }

    this.head.playGesture(name, Infinity, false, this.opt.gestureFadeIn);

    try {
      await this._wait(totalMs);
      this.head.stopGesture(this.opt.gestureFadeOut);
      await this._wait(this.opt.stopSettleTime);
    } catch (e) {
      if (e.name === 'AbortError') return;
      throw e;
    }

    this._overlays.clear();
    this.playing = false;
    this._emit('onEnd', name);
  }

  /** @private — Play a native TalkingHead gesture or emoji */
  async _playNative(name, dur) {
    this.playing = true;
    this._emit('onStart', name);
    const d = dur || this.opt.nativeDuration;
    this.head.playGesture(name, d, false, this.opt.gestureFadeIn);

    try {
      await this._wait(d * 1000 + this.opt.gestureFadeIn);
    } catch (e) {
      if (e.name === 'AbortError') return;
      throw e;
    }

    this.playing = false;
    this._emit('onEnd', name);
  }

  /** @private — Apply a TalkingHead pose template */
  async _playPose(name) {
    this.playing = true;
    this._emit('onStart', name);
    this.head.poseName = name;
    this.head.setPoseFromTemplate(this.head.poseTemplates[name], this.opt.poseFadeIn);

    try {
      await this._wait(this.opt.poseSettleTime);
    } catch (e) {
      if (e.name === 'AbortError') return;
      throw e;
    }

    this.playing = false;
    this._emit('onEnd', name);
  }

  // ===========================================================================
  // Private — utilities
  // ===========================================================================

  /** @private — Interrupt: cancel timers, stop gesture, clear overlays */
  _interrupt() {
    if (this._cancelFn) {
      this._cancelFn();
      this._cancelFn = null;
    }
    this.head.stopGesture(this.opt.stopFade);
    this._overlays.clear();
    this.playing = false;
  }

  /** @private — Emit a callback event */
  _emit(event, name, err) {
    if (typeof this[event] === 'function') {
      err ? this[event](name, err) : this[event](name);
    }
  }

  /** @private — Cancellable wait */
  _wait(ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      this._cancelFn = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' }));
      };
    });
  }
}
