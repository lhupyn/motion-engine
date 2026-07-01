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
import DEFAULT_FACS from './facs.json';

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
 *
 * A value may be a single motion name OR an array of names: a celebration emoji
 * fires the `celebrate` action AND arms the `happy` mood, so the face matches the
 * gesture instead of staying neutral.
 */
const DEFAULT_EMOJI_MAP = {
  // ---- moods (persistent — only the first per turn is honored) ----
  // happy + positive symbols (the LLM leans hard on ✨/🌸/sparkle as "positive")
  '😊': 'happy', '🙂': 'happy', '😄': 'happy', '😁': 'happy', '😀': 'happy', '😃': 'happy',
  '☺': 'happy', '🥲': 'happy', '😌': 'happy', '😇': 'happy', '🙌': 'happy',
  '✨': 'happy', '🌟': 'happy', '💫': 'happy', '⭐': 'happy', '🌈': 'happy',
  '🌸': 'happy', '🌼': 'happy', '🌺': 'happy', '💖': 'happy', '💕': 'happy', '💗': 'happy',
  // love / adoration
  '😍': 'love', '🥰': 'love', '😘': 'love', '🤩': 'love', '😻': 'love', '🤗': 'love',
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
  // celebration: fire the action AND arm the happy mood so the face matches it
  '🎉': ['celebrate', 'happy'], '🎊': ['celebrate', 'happy'], '🥳': ['celebrate', 'happy'],
  '🎂': ['celebrate', 'happy'], '🍾': ['celebrate', 'happy'],
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
 * FACS emotion markers: `[emotion]` or `[emotion:intensity]` (e.g. `[amused]`,
 * `[skeptical:strong]`). Also catches natural stage-directions the LLM already
 * emits in brackets (`[laughs]`, `[sighs]`). Unresolvable brackets are ignored.
 */
const BRACKET_RE = /\[\s*([a-zA-Z][a-zA-Z _:-]*?)\s*\]/g;
/**
 * Eye-animation morphs (gaze + blink) are owned by TalkingHead's idle animation,
 * which writes them via the newvalue slot — higher priority than the compositor's
 * baseline. These must be driven through setValue() (the system slot) to win.
 */
const EYE_ANIM_RE = /^(eyeLook|eyeBlink)/;
/**
 * Wrapper keywords the LLM sometimes prefixes onto a marker, e.g.
 * `[emotion:amused]` or `[motion:calm]`. When present, the real name is the value.
 */
const WRAPPER_WORDS = new Set(['motion', 'emotion', 'emotions', 'feeling', 'feelings', 'expression', 'mood', 'face', 'gesture']);

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

    /** FACS data (AU map + expression recipes + intensity + aliases). @type {object} */
    this._facs = options.facs || DEFAULT_FACS;

    // --- Additive expression compositor (FACS) ---
    /** Sustained mood-expression layer: { vs, current, target }. @type {?object} */
    this._moodExpr = null;
    /** Transient expression beats: [{ vs, elapsed, in, hold, out }]. @type {object[]} */
    this._beats = [];
    /** Morphs currently driven by the compositor (for clean release). @type {Set<string>} */
    this._exprMorphs = new Set();
    /** Mood-expression fade in/out time (ms). */
    this.opt.exprMoodFade = this.opt.exprMoodFade ?? 400;
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
   * Three channels, one pass:
   *   - **Emoji** (natural, token-free): mapped via the emoji map to a motion.
   *   - **`::name::` markers**: explicit names for what emoji can't address
   *     (left/right gestures, poses).
   *   - **`[emotion]` / `[emotion:intensity]`**: FACS expression markers resolved
   *     to a weighted blend of Action Units (see `expr()`).
   *   All markers are stripped from any user-facing text by the consumer, not here.
   *
   * Routing rule: a **mood** motion is applied only once per turn (first wins),
   * so an in-content emoji can't keep resetting the persistent state; **action**
   * motions fire on every occurrence. Call `resetTurn()` at each turn boundary.
   *
   * @param {string} text - A transcription chunk (may contain emoji and/or markers).
   */
  handleTranscript(text) {
    if (!text) return;

    // All three channels resolve through _route(): a FACS name (emotion or facial
    // action) → the AU compositor; a body/gesture name → a motion; unknown → ignored.

    // Explicit ::name:: markers. matchAll clones the regex internally, so the
    // hoisted /g consts stay reentrancy-safe.
    for (const m of text.matchAll(MARKER_RE)) {
      this._route(m[1].toLowerCase());
    }

    // Emoji — the natural, token-free channel. A mapped value is a name or an
    // array of names (e.g. 🎉 → celebrate gesture + happy expression).
    for (const e of text.matchAll(EMOJI_RE)) {
      const raw = e[0];
      const mapped = this._emojiMap[raw] || this._emojiMap[raw.replace(VARIATION_SELECTOR_RE, '')];
      if (!mapped) continue;
      if (Array.isArray(mapped)) {
        for (const name of mapped) this._route(name);
      } else {
        this._route(mapped);
      }
    }

    // FACS markers. The LLM's format varies — [name], [name:intensity],
    // [wrapper:name], [wrapper:name:intensity] — so split on ':' and drop a
    // leading wrapper keyword (emotion/motion/feeling/…) if present.
    for (const b of text.matchAll(BRACKET_RE)) {
      let parts = b[1].split(':').map((s) => s.trim().toLowerCase()).filter(Boolean);
      if (parts.length > 1 && WRAPPER_WORDS.has(parts[0])) parts = parts.slice(1);
      if (parts.length) this._route(parts[0], parts[1]);
    }
  }

  /**
   * Single entry point for every expression request. A FACS name (emotion or
   * facial action) plays through the AU compositor; a known body/gesture name
   * plays as a motion; anything else is ignored (garbage brackets, unknown words).
   *
   * @param {string} name - Emotion, facial action, or gesture name
   * @param {string|number} [intensity] - Honored only for FACS expressions
   */
  _route(name, intensity) {
    if (this._hasExpr(name)) this.expr(name, intensity);
    else if (this._hasMotion(name)) this._routeName(name);
  }

  /**
   * Whether a name resolves to a FACS expression (emotion or facial action).
   * @private
   */
  _hasExpr(name) {
    const key = String(name || '').trim().toLowerCase();
    return !!(this._facs.expressions?.[key] || this._facs.aliases?.[key]);
  }

  /**
   * Whether a name is a known motion / gesture / pose (body track).
   * @private
   */
  _hasMotion(name) {
    return !!(
      this._motions[name] ||
      this.head.poseTemplates?.[name] ||
      this.head.animMoods?.[name] ||
      this.head.gestureTemplates?.[name] ||
      this.head.animEmojis?.[name]
    );
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

  // ===========================================================================
  // FACS Expressions (emotion name + intensity → Action Unit blend)
  // ===========================================================================

  /**
   * Replace the FACS data (AU map, expression recipes, intensity words, aliases).
   * @param {object} facs
   */
  setFacs(facs) {
    this._facs = facs;
  }

  /**
   * Play a FACS expression by name at a given intensity, routed to the additive
   * compositor. The name may be any emotion word (resolved via the alias table);
   * intensity is a word (`slight`/`moderate`/`strong`/…) or a 0..1 number.
   * A `mood`-kind recipe replaces the sustained expression layer; a `beat`-kind
   * recipe (laugh, surprise, …) fires a transient overlay. Unknown names are a no-op.
   *
   * @param {string} name - Emotion word (e.g. "amused", "wistful", "laughs")
   * @param {string|number} [intensity] - Intensity word or 0..1 scalar
   * @returns {object|null} The resolved expression, or null if unknown
   */
  expr(name, intensity) {
    const resolved = this.resolveExpression(name, intensity);
    if (!resolved) {
      this._emit('onError', name, new Error(`Unknown expression: ${name}`));
      return null;
    }
    this._emit('onStart', resolved.name);
    if (resolved.kind === 'beat') this._pushBeat(resolved);
    else this._setMoodLayer(resolved);
    return resolved;
  }

  /**
   * Set (or clear) the sustained mood-expression layer directly. Passing a falsy
   * name or "neutral" fades the current mood expression out.
   * @param {?string} name - Emotion word, or null/"neutral" to clear
   * @param {string|number} [intensity]
   * @returns {object|null} The resolved expression, or null
   */
  setMoodExpression(name, intensity) {
    const key = String(name || '').trim().toLowerCase();
    if (!key || key === 'neutral') {
      if (this._moodExpr) this._moodExpr.target = 0;
      return null;
    }
    const resolved = this.resolveExpression(key, intensity);
    if (!resolved) {
      this._emit('onError', name, new Error(`Unknown expression: ${name}`));
      return null;
    }
    this._setMoodLayer(resolved);
    return resolved;
  }

  /**
   * Clear all compositor layers (mood + beats) and release driven morphs back to
   * their mood-baseline rest. Call on a hard reset (e.g. session end, barge-in).
   */
  resetExpression() {
    this._moodExpr = null;
    this._beats = [];
    for (const mt of this._exprMorphs) this.head.setBaselineValue(mt, this._restBaseline(mt));
    this._exprMorphs = new Set();
  }

  /**
   * Replace the sustained mood layer with a resolved expression (fades in from
   * the current level). Empty vs (neutral) fades the layer out.
   * @private
   */
  _setMoodLayer(resolved) {
    const vs = resolved.vs;
    if (!vs || Object.keys(vs).length === 0) {
      if (this._moodExpr) this._moodExpr.target = 0;
      return;
    }
    this._moodExpr = { vs, current: this._moodExpr?.current ?? 0, target: 1 };
  }

  /**
   * Queue a transient expression beat (bloom → hold → fade) on top of the mood.
   * @private
   */
  _pushBeat(resolved) {
    const vs = resolved.vs;
    if (!vs || Object.keys(vs).length === 0) return;
    const env = resolved.envelope || { in: 300, hold: 1500, out: 600 };
    this._beats.push({ vs, elapsed: 0, in: env.in, hold: env.hold, out: env.out });
  }

  /**
   * The mood-baseline rest value for a morph (what it would be with no expression),
   * mirroring TalkingHead's setMood() precedence so expression sums *on top* of the
   * active mood rather than replacing it.
   * @private
   * @param {string} mt
   * @returns {number}
   */
  _restBaseline(mt) {
    const head = this.head;
    const has = (o) => o && Object.prototype.hasOwnProperty.call(o, mt);
    if (has(head.mood?.baseline)) return head.mood.baseline[mt];
    if (has(head.avatar?.baseline)) return head.avatar.baseline[mt];
    if (has(head.mtBaselineExceptions)) return head.mtBaselineExceptions[mt];
    return head.mtBaselineDefault ?? 0;
  }

  /**
   * Per-frame additive composite: sum the mood layer (faded) and all active beats
   * (enveloped) into per-morph weights, write them over the mood baseline, and
   * release any morph no longer driven. Called from update().
   * @private
   * @param {number} dt - Delta time (ms)
   */
  _composite(dt) {
    if (!this._moodExpr && this._beats.length === 0 && this._exprMorphs.size === 0) return;

    const sum = {};
    const add = (vs, scale) => {
      if (scale <= 0) return;
      for (const [mt, w] of Object.entries(vs)) sum[mt] = (sum[mt] || 0) + w * scale;
    };

    // Sustained mood layer, with fade in/out.
    if (this._moodExpr) {
      const m = this._moodExpr;
      const step = dt / (this.opt.exprMoodFade || 400);
      if (m.current < m.target) m.current = Math.min(m.target, m.current + step);
      else if (m.current > m.target) m.current = Math.max(m.target, m.current - step);
      if (m.current <= 0 && m.target === 0) this._moodExpr = null;
      else add(m.vs, m.current);
    }

    // Transient beats, with bloom → hold → fade envelope.
    for (let i = this._beats.length - 1; i >= 0; i--) {
      const b = this._beats[i];
      b.elapsed += dt;
      const total = b.in + b.hold + b.out;
      if (b.elapsed >= total) { this._beats.splice(i, 1); continue; }
      let f;
      if (b.elapsed < b.in) f = b.in > 0 ? b.elapsed / b.in : 1;
      else if (b.elapsed < b.in + b.hold) f = 1;
      else f = b.out > 0 ? 1 - (b.elapsed - b.in - b.hold) / b.out : 0;
      add(b.vs, f);
    }

    // Apply: expression sums on top of the mood-baseline rest, clamped to 1.
    // Eye-animation morphs (gaze/blink) go through setValue() — the system slot,
    // which outranks TalkingHead's idle-eye animation; the baseline would be
    // ignored. Everything else writes to the baseline.
    const next = new Set();
    for (const [mt, w] of Object.entries(sum)) {
      const val = Math.min(1, this._restBaseline(mt) + w);
      if (EYE_ANIM_RE.test(mt)) this.head.setValue(mt, val, 200);
      else this.head.setBaselineValue(mt, val);
      next.add(mt);
    }
    // Release morphs no longer driven. Eye morphs release by letting their brief
    // setValue window lapse (idle resumes); the rest reset to their mood rest.
    for (const mt of this._exprMorphs) {
      if (next.has(mt)) continue;
      if (!EYE_ANIM_RE.test(mt)) this.head.setBaselineValue(mt, this._restBaseline(mt));
    }
    this._exprMorphs = next;
  }

  /**
   * Resolve an emotion word + intensity to a set of morph-target weights, without
   * playing it. Useful for previews/tests.
   *
   * @param {string} name - Emotion word (canonical, alias, or unknown)
   * @param {string|number} [intensity] - Intensity word or 0..1 scalar
   * @returns {{name:string, vs:Object<string,number>, envelope?:object}|null}
   */
  resolveExpression(name, intensity) {
    const key = String(name || '').trim().toLowerCase();
    if (!key) return null;

    const f = this._facs;
    const canonical = f.expressions?.[key] ? key : f.aliases?.[key];
    const recipe = canonical ? f.expressions?.[canonical] : null;
    if (!recipe) return null;

    const scale = this._intensityScalar(intensity);
    const scaledAus = {};
    for (const [au, w] of Object.entries(recipe.aus || {})) scaledAus[au] = w * scale;

    return {
      name: canonical,
      vs: this._ausToVs(scaledAus),
      envelope: recipe.envelope,
      kind: recipe.kind || 'mood',
    };
  }

  /**
   * Convert a weighted Action-Unit set to morph-target weights via the AU map.
   * Supports unilateral AUs (`AU12_L` / `AU12_R`) by filtering to one side.
   * Weights accumulate additively and clamp to [0, 1].
   * @private
   * @param {Object<string,number>} aus
   * @returns {Object<string,number>}
   */
  _ausToVs(aus) {
    const vs = {};
    for (const [au, weight] of Object.entries(aus)) {
      let side = null;
      let baseAu = au;
      if (au.endsWith('_L')) { side = 'Left'; baseAu = au.slice(0, -2); }
      else if (au.endsWith('_R')) { side = 'Right'; baseAu = au.slice(0, -2); }

      const morphs = this._facs.au_map?.[baseAu];
      if (!morphs) continue;

      for (const [morph, mw] of Object.entries(morphs)) {
        if (side && !morph.includes(side)) continue; // unilateral filter
        vs[morph] = Math.min(1, (vs[morph] || 0) + weight * mw);
      }
    }
    return vs;
  }

  /**
   * Map an intensity word or scalar to a 0..1 value (default ~C on the FACS A–E scale).
   * @private
   * @param {string|number} [intensity]
   * @returns {number}
   */
  _intensityScalar(intensity) {
    const table = this._facs.intensity_words || {};
    const dflt = table._default ?? 0.55;
    if (intensity == null || intensity === '') return dflt;
    if (typeof intensity === 'number') return Math.max(0, Math.min(1, intensity));
    return table[String(intensity).trim().toLowerCase()] ?? dflt;
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
   * Frame update hook — delegates to OverlayManager for bone overlays,
   * FaceMirror for expression detection, and ticks the additive FACS
   * expression compositor (mood layer + transient beats).
   * Connect to TalkingHead via: `head.opt.update = (dt) => engine.update(dt);`
   *
   * @param {number} dt - Delta time from TalkingHead render loop
   */
  update(dt) {
    this._overlays.update(dt);
    this._mirror?.update(dt);
    this._composite(dt);
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
