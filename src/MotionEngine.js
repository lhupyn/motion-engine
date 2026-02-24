/**
 * MotionEngine — Multi-track motion player for TalkingHead avatars.
 *
 * Responsibilities:
 *   - Register custom animEmojis on a TalkingHead instance
 *   - Manage 3 parallel tracks: pose, mood, action
 *   - Inject custom moods into TH's native animMoods for seamless transitions
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

    /** Multi-track state machine */
    this.tracks = {
      pose: { active: false, name: null, startTime: 0, motion: null, isNative: false },
      mood: { active: false, name: null, startTime: 0, motion: null, isNative: false },
      action: { active: false, name: null, startTime: 0, motion: null, cancelFn: null, overlayTimer: null, isNative: false },
    };

    this._motions = {};
    this._overlays = new OverlayManager(talkingHead);

    /** @type {function(string):void|null} */
    this.onStart = null;
    /** @type {function(string):void|null} */
    this.onEnd = null;
    /** @type {function(string, Error):void|null} */
    this.onError = null;
  }

  /**
   * Whether an action gesture is currently playing.
   * @returns {boolean}
   */
  get playing() {
    return this.tracks.action.active;
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
        console.warn(`[MotionEngine] Skipping "${name}" — collides with gestureTemplates.`);
        continue;
      }

      // Deep clone to avoid mutating the source dictionary
      const entry = structuredClone(motion);

      // Overlay-only motions: synthesize minimal dt/vs so playback works
      if (!entry.dt && entry._overlay) {
        entry.dt = [entry._overlay.duration || 2000];
        entry.vs = entry.vs || {};
      }

      // Metadata-only mood entries (no dt): register for discovery but skip animation
      if (!entry.dt && entry._track === 'mood') {
        this._motions[name] = entry;
        count++;
        continue;
      }

      // Skip motions that have no timing at all (invalid)
      if (!entry.dt) continue;

      // Normalize vs fields: LLMs often send numbers instead of arrays
      if (entry.vs) {
        for (const [key, val] of Object.entries(entry.vs)) {
          let normalizedVal = Array.isArray(val) ? val : [val];
          if (key !== 'gesture') entry.vs[key] = normalizedVal;
        }
      }

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

      // Mood-track motions: inject into TH's animMoods so setMood() works natively
      if (entry._track === 'mood' && this.head.animMoods) {
        this._registerMood(name, entry);
      }

      // Register without metadata as animEmoji on TalkingHead
      const { _overlay, _description, _tags, _track, ...animEmoji } = entry;
      this.head.animEmojis[name] = animEmoji;
      count++;
    }

    return count;
  }

  /**
   * Get the internal motions registry. Used by MotionStudio for discovery
   * without directly accessing private fields.
   *
   * @returns {object} Dictionary of registered motion definitions
   */
  getRegisteredMotions() {
    return this._motions;
  }

  // ===========================================================================
  // Playback Control (Multi-Track Routing)
  // ===========================================================================

  /**
   * Play a motion by name, routing to the appropriate track.
   *
   * Track resolution:
   * 1. If motion has `_track` metadata → use that track
   * 2. If name matches poseTemplates → pose track
   * 3. If name matches moodTemplates or known moods → mood track
   * 4. Otherwise → action track (default)
   *
   * @param {string} name - Motion identifier
   * @param {number} [dur] - Optional duration override for native gestures (seconds)
   */
  async play(name, dur) {
    const motion = this._motions[name];

    // Track resolution logic
    let trackName = 'action';
    if (motion) {
      trackName = motion._track || 'action';
    } else if (this.head.poseTemplates?.[name]) {
      trackName = 'pose';
    } else if (
      (this.head.moodTemplates && this.head.moodTemplates[name]) ||
      ['neutral', 'happy', 'relax'].includes(name)
    ) {
      trackName = 'mood';
    }

    this._emit('onStart', name);

    switch (trackName) {
      case 'pose':  return this._playPose(name, motion);
      case 'mood':  return this._playMood(name, motion);
      default:      return this._playAction(name, motion, dur);
    }
  }

  /**
   * Play a sequence of motions in order.
   * Each motion waits for the previous one to finish before starting.
   * If stop() is called during a sequence, remaining motions are skipped.
   *
   * @param {string[]} names - Array of motion names to play sequentially
   */
  async playSequence(names) {
    for (let i = 0; i < names.length; i++) {
      if (!this.tracks.action.active && i > 0) return;
      await this.play(names[i]);
    }
  }

  /**
   * Force-stop the current action. Cleanly cancels any pending wait timers
   * and resets the action track immediately.
   */
  stop() {
    this._interruptAction();
  }

  /**
   * Get all registered custom motion names.
   *
   * @returns {string[]}
   */
  getMotionNames() {
    return Object.keys(this._motions);
  }

  // ===========================================================================
  // Private — Track Playback
  // ===========================================================================

  /**
   * Apply a pose immediately.
   * @private
   */
  _playPose(name, motion) {
    this.tracks.pose = { active: true, name, startTime: performance.now(), motion, isNative: !motion };
    if (this.head.poseTemplates?.[name]) {
      this.head.poseName = name;
      this.head.setPoseFromTemplate(this.head.poseTemplates[name], this.opt.poseFadeIn);
    }
  }

  /**
   * Apply a mood (persistent).
   *
   * All moods — both TH-native and custom — are handled via TH's setMood().
   * Custom moods were injected into head.animMoods during registerMotions(),
   * so TH manages baselines, idle animations, and smooth transitions natively.
   *
   * @private
   */
  _playMood(name, motion) {
    this.tracks.mood = { active: true, name, startTime: performance.now(), motion, isNative: !motion };

    // Bone overlays from motion definition
    if (motion?._overlay) {
      this._overlays.start(motion._overlay.bones || {}, Infinity);
    } else {
      this._overlays.clear();
    }

    // Delegate entirely to TalkingHead's native mood system
    try {
      this.head.setMood(name);
    } catch {
      // Mood not in animMoods — fall back to neutral
      this.head.setMood('neutral');
    }
  }

  /**
   * Play a temporal action gesture (interrupts previous action).
   * @private
   */
  async _playAction(name, motion, dur) {
    if (this.tracks.action.active) {
      this._interruptAction();
    }

    if (motion) {
      this.tracks.action = {
        active: true, name, motion,
        startTime: performance.now(),
        cancelFn: null, overlayTimer: null, isNative: false,
      };

      const dtArray = Array.isArray(motion.dt) ? motion.dt : [motion.dt];
      const totalMs = dtArray.reduce((sum, d) => sum + (Array.isArray(d) ? (d[0] + d[1]) / 2 : d), 0);

      // Start overlay if defined (with delay)
      if (motion._overlay) {
        const ol = motion._overlay;
        this.tracks.action.overlayTimer = setTimeout(() => {
          if (this.tracks.action.active && this.tracks.action.name === name) {
            this._overlays.start(ol.bones || {}, ol.duration || totalMs);
          }
        }, ol.delay || 0);
      }

      this.head.playGesture(name, Infinity, false, this.opt.gestureFadeIn);

      try {
        await this._waitAction(totalMs);
        if (this.tracks.action.active && this.tracks.action.name === name) {
          this.head.stopGesture(this.opt.gestureFadeOut);
          await this._waitAction(this.opt.stopSettleTime);
          this.tracks.action.active = false;
          this._emit('onEnd', name);
        }
      } catch (e) {
        if (e.name !== 'AbortError') throw e;
      }

    } else if (this.head.gestureTemplates?.[name] || this.head.animEmojis?.[name]) {
      // Native gesture/emoji fallback
      this.tracks.action = {
        active: true, name, isNative: true,
        startTime: performance.now(),
        cancelFn: null, motion: null, overlayTimer: null,
      };
      const d = dur || this.opt.nativeDuration;
      this.head.playGesture(name, d, false, this.opt.gestureFadeIn);

      try {
        await this._waitAction(d * 1000 + this.opt.gestureFadeIn);
        if (this.tracks.action.active && this.tracks.action.name === name) {
          this.tracks.action.active = false;
          this._emit('onEnd', name);
        }
      } catch (e) {
        if (e.name !== 'AbortError') throw e;
      }
    } else {
      console.warn(`[MotionEngine] DROPPED: "${name}"`);
      this._emit('onError', name, new Error(`Unknown semantic motion: ${name}`));
    }
  }

  // ===========================================================================
  // Render Loop
  // ===========================================================================

  /**
   * Frame update hook — delegates to OverlayManager for bone overlays.
   * Mood morphs are handled entirely by TH's native mood system.
   * Connect to TalkingHead via: `head.opt.update = (dt) => engine.update(dt);`
   *
   * @param {number} dt - Delta time from TalkingHead render loop
   */
  update(dt) {
    this._overlays.update(dt);
  }

  // ===========================================================================
  // Private — Mood Registration
  // ===========================================================================

  /**
   * Inject a custom mood into TH's animMoods so setMood() handles it natively.
   *
   * Extracts morph target values from the motion's `vs` object as static baselines.
   * For multi-frame arrays, picks the peak value (second element in a 3-frame
   * ramp-up/hold/ramp-down pattern, or first element for single-value arrays).
   * Copies neutral mood's `anims` so the avatar keeps breathing, blinking, etc.
   *
   * @private
   * @param {string} name - Mood name
   * @param {object} entry - Motion definition with `vs` morph targets
   */
  _registerMood(name, entry) {
    // Build baseline from vs morph targets (skip non-morph keys)
    const SKIP_KEYS = new Set(['gesture', 'headMove']);
    const baseline = {};

    if (entry.vs) {
      for (const [key, val] of Object.entries(entry.vs)) {
        if (SKIP_KEYS.has(key)) continue;
        const arr = Array.isArray(val) ? val : [val];
        // For 3-frame [ramp, hold, ramp-down]: use hold (index 1)
        // For 1-frame [value]: use that value
        // For 2-frame [a, b]: use first
        const picked = arr.length >= 2 ? arr[1] : arr[0];
        // Only include finite numbers — skip range arrays and oscillation patterns
        if (typeof picked === 'number' && isFinite(picked)) {
          baseline[key] = picked;
        }
      }
    }

    // Copy idle animations from neutral mood (breathing, eyes, blink, etc.)
    const neutral = this.head.animMoods?.['neutral'];
    const anims = neutral?.anims ? [...neutral.anims] : [];

    this.head.animMoods[name] = {
      baseline,
      speech: { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 },
      anims,
    };
  }

  // ===========================================================================
  // Private — Utilities
  // ===========================================================================

  /**
   * Interrupt the current action track. Cancels timers, stops gesture, resets state.
   * @private
   */
  _interruptAction() {
    if (this.tracks.action.cancelFn) {
      this.tracks.action.cancelFn();
      this.tracks.action.cancelFn = null;
    }
    if (this.tracks.action.overlayTimer) {
      clearTimeout(this.tracks.action.overlayTimer);
      this.tracks.action.overlayTimer = null;
    }
    this.head.stopGesture(this.opt.stopFade);
    this.tracks.action.active = false;
  }

  /**
   * Cancellable wait tied to the action track.
   * @private
   * @param {number} ms - Milliseconds to wait
   * @returns {Promise<void>}
   */
  _waitAction(ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(resolve, ms);
      this.tracks.action.cancelFn = () => {
        clearTimeout(timer);
        reject(Object.assign(new Error('Interrupted'), { name: 'AbortError' }));
      };
    });
  }

  /**
   * Emit a callback event.
   * @private
   */
  _emit(event, name, err) {
    if (typeof this[event] === 'function') {
      err ? this[event](name, err) : this[event](name);
    }
  }
}
