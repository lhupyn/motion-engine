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
import { FaceMirror } from './FaceMirror.js';
import { extractBaseline, EMPATHIC_PREFIX, SKIP_KEYS } from './utils.js';

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
 * Default emoji → motion-name map for `handleTranscript()`.
 * Emoji is the natural control channel for LLM-driven avatars: the model emits
 * emoji in its speech, they survive in the transcription, and are not vocalized.
 *
 * This is a COARSE emotional-signal translation, not a 1:1 dictionary: LLMs emit
 * a wide, partly-symbolic palette (✨ sparkle, 🎂 cake, 💥 boom) that has no facial
 * equivalent, so whole categories collapse onto a handful of motions (positive
 * symbols → happy/celebrate, etc.). Tune it from what your model actually emits in
 * audio. Mood-track names persist (first per turn wins); everything else plays once.
 * Override per consumer via `setEmojiMap()`. Names must exist in the registered catalog.
 */
const DEFAULT_EMOJI_MAP = {
  // ---- moods (persistent — only the first per turn is honored) ----
  // happy + positive symbols (the LLM leans hard on ✨/🌸/sparkle as "positive")
  '😊': 'happy', '🙂': 'happy', '😄': 'happy', '😁': 'happy', '😀': 'happy', '😃': 'happy',
  '☺': 'happy', '🥲': 'happy', '😌': 'happy', '😇': 'happy', '🙌': 'happy',
  '✨': 'happy', '🌟': 'happy', '💫': 'happy', '⭐': 'happy', '🌈': 'happy',
  '🌸': 'happy', '🌼': 'happy', '🌺': 'happy', '💖': 'happy', '💕': 'happy', '💗': 'happy',
  // love / adoration
  '😍': 'love', '🥰': 'love', '😘': 'love', '🤩': 'love', '😻': 'love',
  '❤': 'love', '🧡': 'love', '💛': 'love', '💚': 'love', '💙': 'love', '💜': 'love', '💝': 'love',
  // sad
  '😢': 'sad', '😭': 'sad', '😔': 'sad', '😞': 'sad', '😟': 'sad', '🥺': 'sad', '☹': 'sad', '🙁': 'sad', '😣': 'sad',
  // angry
  '😠': 'angry', '😡': 'angry', '🤬': 'angry', '😤': 'angry',
  // fear
  '😨': 'fear', '😱': 'fear', '😰': 'fear', '😖': 'fear',
  // disgust
  '🤢': 'disgust', '🤮': 'disgust', '😝': 'disgust',
  // curious / thinking
  '🤔': 'curious', '👀': 'curious', '🧐': 'curious', '💭': 'curious',
  // shy / nervous
  '😳': 'shy', '😅': 'nervous', '😬': 'nervous',
  // smirk / playful
  '😏': 'smirk', '😈': 'smirk', '😼': 'smirk',
  // sleepy
  '😴': 'sleep', '😪': 'sleep',
  // neutral
  '😐': 'neutral', '😶': 'neutral', '🫤': 'neutral',
  // ---- actions (temporal — fired on every occurrence) ----
  '👋': 'wave_right', '👍': 'thumbup_right', '👎': 'thumbdown_right',
  '👏': 'applause', '🙏': 'pray', '🤷': 'shrug_both', '👌': 'ok_sign',
  '🎉': 'celebrate', '🎊': 'celebrate', '🥳': 'celebrate', '🎂': 'celebrate', '🍾': 'celebrate',
  '💥': 'excited', '🔥': 'excited', '⚡': 'excited',
  '😂': 'laugh', '🤣': 'laugh', '😆': 'laugh',
  '😉': 'wink', '🙄': 'eyeroll', '🤦': 'facepalm', '🥱': 'yawn', '💃': 'dance', '🕺': 'dance',
  '😮': 'surprised', '😲': 'surprised', '😯': 'surprised', '🤯': 'surprised',
};

/** Hoisted so handleTranscript() doesn't recompile them per transcription chunk. */
const MARKER_RE = /::([a-z0-9_]+)::/gi;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const VARIATION_SELECTOR_RE = /️/g;

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
    /** @type {FaceMirror|null} */
    this._mirror = null;

    /** @type {function(string):void|null} */
    this.onStart = null;
    /** @type {function(string):void|null} */
    this.onEnd = null;
    /** @type {function(string, Error):void|null} */
    this.onError = null;

    /** Emoji → motion-name map used by handleTranscript(). @type {Object<string,string>} */
    this._emojiMap = { ...DEFAULT_EMOJI_MAP };
    /** Whether a mood was already set in the current turn. @type {boolean} */
    this._turnMoodSet = false;
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
    this._sequenceStopped = false;
    for (const name of names) {
      if (this._sequenceStopped) return;
      await this.play(name);
    }
  }

  /**
   * Force-stop the current action. Cleanly cancels any pending wait timers
   * and resets the action track immediately.
   */
  stop() {
    this._sequenceStopped = true;
    this._interruptAction();
  }

  /**
   * Drive avatar motion straight from an LLM speech transcript chunk.
   *
   * This is the high-level entry point for speech-driven avatars: the consumer
   * forwards each transcription chunk and the engine routes expression itself —
   * no marker/emoji glue on the consumer side.
   *
   * Two channels, one pass:
   *   - **Emoji** (natural, token-free): mapped via the emoji map to a motion.
   *   - **`::name::` markers**: explicit names for what emoji can't address
   *     (left/right gestures, poses). Stripped from any user-facing text by the
   *     consumer, not here.
   *
   * Routing rule: a **mood** motion is applied only once per turn (first wins),
   * so an in-content emoji can't keep resetting the persistent state; **action**
   * motions fire on every occurrence. Call `resetTurn()` at each turn boundary.
   *
   * @param {string} text - A transcription chunk (may contain emoji and/or markers).
   */
  handleTranscript(text) {
    if (!text) return;

    // Explicit ::name:: markers — for cases emoji can't reach (poses, left/right).
    // matchAll clones the regex internally, so the hoisted /g consts stay reentrancy-safe.
    for (const m of text.matchAll(MARKER_RE)) {
      this._routeName(m[1].toLowerCase());
    }

    // Emoji — the natural control channel.
    for (const e of text.matchAll(EMOJI_RE)) {
      const raw = e[0];
      const name = this._emojiMap[raw] || this._emojiMap[raw.replace(VARIATION_SELECTOR_RE, '')];
      if (name) this._routeName(name);
    }
  }

  /**
   * Reset per-turn state. Call on each turn boundary (e.g. turn_complete) so the
   * "one mood per turn" rule re-arms for the next turn.
   */
  resetTurn() {
    this._turnMoodSet = false;
  }

  /**
   * Replace the emoji → motion-name map used by handleTranscript().
   *
   * @param {Object<string,string>} map - Emoji to motion-name mapping
   */
  setEmojiMap(map) {
    this._emojiMap = { ...map };
  }

  /**
   * Resolve a motion name to its track and play it, honoring the per-turn mood rule.
   * @private
   * @param {string} name - Motion name (catalog, pose, or native mood)
   */
  _routeName(name) {
    const motion = this._motions[name];
    const track = motion?._track
      || (this.head.poseTemplates?.[name] ? 'pose'
        : (this.head.animMoods?.[name] ? 'mood' : 'action'));

    if (track === 'mood') {
      if (this._turnMoodSet) return; // first mood of the turn wins
      this._turnMoodSet = true;
    }
    this.play(name);
  }

  /**
   * Get all registered custom motion names.
   *
   * @returns {string[]}
   */
  getMotionNames() {
    return Object.keys(this._motions);
  }

  /**
   * Stop all idle animations (breathing, blinking, head move, eye contact).
   * Useful for testing bone positions or for very focused interactions.
   *
   * @param {boolean} [enabled=true]
   */
  freeze(enabled = true) {
    if (enabled) {
      this._previousMood = this.tracks.mood.name || 'neutral';
      this._previousIdle = {
        eye: this.head.opt.avatarIdleEyeContact,
        head: this.head.opt.avatarIdleHeadMove,
        spkEye: this.head.opt.avatarSpeakingEyeContact,
        spkHead: this.head.opt.avatarSpeakingHeadMove
      };

      this.head.animMoods['frozen'] = {
        baseline: {},
        speech: { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 },
        anims: []
      };
      this.head.setMood('frozen');
      this.head.opt.avatarIdleEyeContact = 0;
      this.head.opt.avatarIdleHeadMove = 0;
      this.head.opt.avatarSpeakingEyeContact = 0;
      this.head.opt.avatarSpeakingHeadMove = 0;
      this.head.animQueue = [];
    } else if (this._previousIdle) {
      this.head.setMood(this._previousMood || 'neutral');
      this.head.opt.avatarIdleEyeContact = this._previousIdle.eye;
      this.head.opt.avatarIdleHeadMove = this._previousIdle.head;
      this.head.opt.avatarSpeakingEyeContact = this._previousIdle.spkEye;
      this.head.opt.avatarSpeakingHeadMove = this._previousIdle.spkHead;
    }
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
          if (this.tracks.action.overlayTimer) {
            clearTimeout(this.tracks.action.overlayTimer);
            this.tracks.action.overlayTimer = null;
          }
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
  // Face Mirror
  // ===========================================================================

  /**
   * Start face mirroring from a video element.
   *
   * In **empathic** mode (default): avatar reacts to user emotions with attenuated
   * intensity and complementary gestures via `playMoodAttenuated()` and `setHeadPose()`.
   *
   * In **mirror** mode: 1:1 mood cloning (v1 behavior) — detected mood plays directly.
   *
   * @param {HTMLVideoElement} videoEl - Live camera feed
   * @param {object} [options] - FaceMirror options
   * @param {string} [options.mode='mirror'] - 'empathic' | 'mirror'
   * @param {boolean} [options.headPose=true]  - Enable head pose tracking (empathic only)
   * @returns {Promise<void>}
   */
  async startMirror(videoEl, options = {}) {
    if (this._mirror) this.stopMirror();

    const opts = { mode: 'mirror', headPose: true, ...options };
    this._mirror = new FaceMirror(opts);
    this._mirror.loadMotions(this._motions);
    // Face mirroring depends on the optional @mediapipe/tasks-vision peer dep.
    // If it isn't available, degrade gracefully (no mirror) instead of throwing
    // into the caller — the avatar still works, it just doesn't read the camera.
    try {
      await this._mirror.init();
    } catch (err) {
      console.warn('[MotionEngine] Face mirror unavailable, skipping:', err?.message || err);
      this._mirror = null;
      return;
    }

    if (opts.mode === 'empathic') {
      this._mirror.onReaction = (reactionMood, intensity, gesture) => {
        this.playMoodAttenuated(reactionMood, intensity);
        if (gesture && this._motions[gesture]) this.play(gesture);
      };
      this._mirror.onValues = (_, headPose) => {
        if (opts.headPose && !this.tracks.action.active) {
          this.setHeadPose(headPose.pitch, headPose.yaw, headPose.roll);
        }
      };
    } else {
      this._mirror.onMood = (mood) => this.play(mood);
    }

    this._mirror.start(videoEl);
  }

  /**
   * Stop and dispose face mirroring. Cleans up empathic mood and resets head pose.
   */
  stopMirror() {
    if (!this._mirror) return;
    this._mirror.stop();
    this._mirror.dispose();
    this._mirror = null;

    // Clean up empathic mood entry
    if (this.head.animMoods) {
      for (const key of Object.keys(this.head.animMoods)) {
        if (key.startsWith(EMPATHIC_PREFIX)) delete this.head.animMoods[key];
      }
    }

    // Reset head pose
    this.setHeadPose(0, 0, 0);
  }

  /**
   * Pause face mirroring (e.g. while avatar is speaking).
   */
  pauseMirror() {
    this._mirror?.pause();
  }

  /**
   * Resume face mirroring after pause.
   */
  resumeMirror() {
    this._mirror?.resume();
  }

  /**
   * Access the FaceMirror instance for advanced configuration.
   * @returns {FaceMirror|null}
   */
  get mirror() {
    return this._mirror;
  }

  // ===========================================================================
  // Empathic API
  // ===========================================================================

  /**
   * Play a mood at reduced intensity for empathic reactions.
   *
   * Looks up the mood's baseline from `head.animMoods`, creates an attenuated
   * copy as `_empathic_<name>`, registers it, and sets it as the active mood.
   *
   * @param {string} name - Mood name (must exist in animMoods)
   * @param {number} intensity - Attenuation factor (0-1)
   */
  playMoodAttenuated(name, intensity) {
    const source = this.head.animMoods?.[name];
    if (!source) return;

    // Clean up previous empathic mood
    for (const key of Object.keys(this.head.animMoods)) {
      if (key.startsWith(EMPATHIC_PREFIX)) delete this.head.animMoods[key];
    }

    // Create attenuated baseline
    const baseline = {};
    if (source.baseline) {
      for (const [key, val] of Object.entries(source.baseline)) {
        baseline[key] = val * intensity;
      }
    }

    const empathicName = `${EMPATHIC_PREFIX}${name}`;
    const neutral = this.head.animMoods['neutral'];
    this.head.animMoods[empathicName] = {
      baseline,
      speech: source.speech || { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 },
      anims: neutral?.anims ? [...neutral.anims] : [],
    };

    this.head.setMood(empathicName);
    this.tracks.mood = {
      active: true, name: empathicName,
      startTime: performance.now(), motion: null, isNative: false,
    };
  }

  /**
   * Set avatar head rotation for empathic head pose mirroring.
   *
   * @param {number} pitch - X rotation (nod)
   * @param {number} yaw   - Y rotation (shake)
   * @param {number} roll  - Z rotation (tilt)
   */
  setHeadPose(pitch, yaw, roll) {
    const mt = this.head.mtAvatar;
    if (!mt) return;
    if (mt.headRotateX) { mt.headRotateX.newvalue = pitch; mt.headRotateX.needsUpdate = true; }
    if (mt.headRotateY) { mt.headRotateY.newvalue = yaw; mt.headRotateY.needsUpdate = true; }
    if (mt.headRotateZ) { mt.headRotateZ.newvalue = roll; mt.headRotateZ.needsUpdate = true; }
  }

  // ===========================================================================
  // Render Loop
  // ===========================================================================

  /**
   * Frame update hook — delegates to OverlayManager for bone overlays
   * and FaceMirror for expression detection.
   * Connect to TalkingHead via: `head.opt.update = (dt) => engine.update(dt);`
   *
   * @param {number} dt - Delta time from TalkingHead render loop
   */
  update(dt) {
    this._overlays.update(dt);
    this._mirror?.update(dt);
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
    const baseline = extractBaseline(entry.vs);

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
