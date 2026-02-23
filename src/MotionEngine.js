/**
 * MotionEngine — Reusable motion player for TalkingHead avatars.
 *
 * Responsibilities:
 *   - Register custom animEmojis on a TalkingHead instance
 *   - Play motions (custom, native gesture/emoji, or pose)
 *   - Delegate poseDelta oscillation overlays to OverlayManager
 *   - Support motion interruption and sequencing
 *   - Autodiscover avatar capabilities (morph targets and bones)
 *   - Parse raw JSON motions from LLMs
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

/** Default morph target whitelist for capability discovery */
const DEFAULT_MT_WHITELIST = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight', 'eyeLookDownLeft', 'eyeLookDownRight',
  'jawOpen', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight', 'mouthFrownLeft', 'mouthFrownRight',
  'cheekPuff', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight'
];

/** Default bone whitelist for capability discovery */
const DEFAULT_BONE_WHITELIST = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'RightHand', 'LeftHand'];

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
   * @param {Object<string, string[]>} [options.aliases] - Morph name aliases (e.g., {eyesClosed: ['eyeBlinkLeft','eyeBlinkRight']})
   * @param {Object<string, string>} [options.boneAliases] - Bone name aliases (e.g., {Head: 'Neck', Spine: 'Spine2'})
   * @param {boolean} [options.autoWrapMorphs=false]  - Auto-wrap bare morph target names as dynamic motions
   * @param {string[]} [options.morphWhitelist]       - Custom morph target whitelist for getAvatarCapabilities()
   * @param {string[]} [options.boneWhitelist]        - Custom bone whitelist for getAvatarCapabilities()
   */
  constructor(talkingHead, options = {}) {
    this.head = talkingHead;

    // Separate MotionEngine-specific options from timing options
    const { aliases, boneAliases, autoWrapMorphs, morphWhitelist, boneWhitelist, ...timingOpts } = options;

    this.opt = { ...DEFAULTS, ...timingOpts };
    this.playing = false;
    this._playStart = 0;
    this._motions = {};
    this._cancelFn = null;
    this._overlayTimer = null;
    this._overlays = new OverlayManager(talkingHead);

    // Opt-in aliasing configuration
    this._aliases = aliases || {};
    this._boneAliases = boneAliases || {};
    this._autoWrapMorphs = autoWrapMorphs || false;
    this._morphWhitelist = morphWhitelist || DEFAULT_MT_WHITELIST;
    this._boneWhitelist = boneWhitelist || DEFAULT_BONE_WHITELIST;

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
      const entry = structuredClone(motion);

      // Overlay-only motions: synthesize minimal dt/vs so playback works
      if (!entry.dt && entry._overlay) {
        entry.dt = [entry._overlay.duration || 2000];
        entry.vs = entry.vs || {};
      }

      // Skip motions that have no timing at all (invalid)
      if (!entry.dt) {
        console.warn(`[MotionEngine] Skipping "${name}" — no dt field (invalid motion).`);
        continue;
      }

      // Normalize vs fields: LLMs often send numbers instead of arrays
      if (entry.vs) {
        for (const [key, val] of Object.entries(entry.vs)) {
          // Array wrapping for direct numbers
          let normalizedVal = Array.isArray(val) ? val : [val];

          // Apply morph aliases if configured
          if (this._aliases[key]) {
            this._aliases[key].forEach(target => {
              entry.vs[target] = normalizedVal;
            });
            delete entry.vs[key];
          } else if (key !== 'gesture') {
            entry.vs[key] = normalizedVal;
          }
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
   * Resolution order: custom → raw JSON → native gesture/emoji → pose → bare morph.
   *
   * @param {string} name - Motion identifier (name, JSON string, or morph target name)
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

    // ── Raw JSON motion (Dynamic from LLM) ──────────────────────────────
    if (typeof name === 'string' && (name.startsWith('{') || name.startsWith('['))) {
      try {
        const raw = JSON.parse(name);
        // If it's a wrapper { "name": { ...motionDef } }, unwrap it.
        // But skip unwrapping if the sole key is a reserved motion field.
        const RESERVED = new Set(['dt', 'vs', 'rescale', '_overlay', '_description', '_tags']);
        const keys = Object.keys(raw);
        const shouldUnwrap = keys.length === 1
          && typeof raw[keys[0]] === 'object'
          && !RESERVED.has(keys[0]);
        const dynamicMotion = shouldUnwrap ? raw[keys[0]] : raw;
        const dynamicName = shouldUnwrap ? keys[0] : `dynamic_${Date.now()}`;

        // Register it temporarily to make it playable by TalkingHead
        console.log(`[MotionEngine] Executing DYNAMIC motion: ${dynamicName}`, dynamicMotion);
        const tempDict = {};
        tempDict[dynamicName] = dynamicMotion;
        this.registerMotions(tempDict);

        // ALWAYS use the registered/normalized version from this._motions
        return this._playCustom(dynamicName, this._motions[dynamicName]);
      } catch (e) {
        console.warn("[MotionEngine] Failed to parse raw motion JSON:", e.message);
      }
    }
    if (typeof name === 'object') {
      return this._playCustom(`dynamic_${Date.now()}`, name);
    }

    // ── Native gesture / emoji ─────────────────────────────────────────
    if (this.head.gestureTemplates[name] || this.head.animEmojis[name]) {
      return this._playNative(name, dur);
    }

    // ── Pose ───────────────────────────────────────────────────────────
    if (this.head.poseTemplates[name]) {
      return this._playPose(name);
    }

    // ── Bare morph target name (LLM sends "cheekPuff" instead of JSON) ──
    if (this._autoWrapMorphs && this.head.mtAvatar?.[name]) {
      console.log(`[MotionEngine] Auto-wrapping morph "${name}" as dynamic motion.`);
      const autoMotion = { dt: [300, 1500, 500], rescale: [0, 1, 0], vs: { [name]: [0.8] } };
      this.registerMotions({ [name]: autoMotion });
      return this._playCustom(name, this._motions[name]);
    }

    console.warn(`[MotionEngine] DROPPED: "${name}" — not found in custom, native, pose, or morph registries.`);
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
  // Discovery & Capabilities
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

  /**
   * Get motions grouped by primary tag — compact format for token-constrained LLMs.
   * Produces ~75% fewer tokens than getMotions() while preserving semantic context.
   *
   * @returns {Object<string, string[]>} Map of tag → motion names
   *
   * @example
   * engine.getMotionsCompact()
   * // → { greeting: ["wave_right","wave_left","namaste_bow"],
   * //     sarcasm: ["eyeroll","smirk"], ... }
   */
  getMotionsCompact() {
    const groups = {};
    for (const [name, motion] of Object.entries(this._motions)) {
      const tag = (motion._tags && motion._tags[0]) || 'other';
      if (!groups[tag]) groups[tag] = [];
      groups[tag].push(name);
    }
    return groups;
  }

  /**
   * Get a pre-formatted prompt string for LLM system instructions.
   * Three verbosity levels to trade off context size vs precision.
   *
   * @param {'full'|'compact'|'minimal'} [level='compact'] - Verbosity level
   * @returns {string} Ready-to-inject prompt text
   */
  getMotionsForPrompt(level = 'compact') {
    switch (level) {
      case 'full':
        return this.getMotions()
          .map(m => `- ${m.name}: ${m.description}`)
          .join('\n');

      case 'minimal':
        return this.getMotionNames().join(', ');

      case 'compact':
      default: {
        const groups = this.getMotionsCompact();
        return Object.entries(groups)
          .map(([tag, names]) => `${tag}: ${names.join(', ')}`)
          .join('\n');
      }
    }
  }

  /**
   * Inspect the bound TalkingHead instance to discover its anatomical capabilities.
   * List available morph targets (for facial expressions) and bones (for body movements).
   * Whitelists are configurable via constructor options.
   *
   * @returns {object} { morphTargets: string[], bones: string[] }
   */
  getAvatarCapabilities() {
    const caps = {
      morphTargets: [],
      bones: []
    };

    // 1. Discover Morph Targets (filtered to whitelist)
    if (this.head.mtAvatar) {
      const allMTs = Object.keys(this.head.mtAvatar);
      caps.morphTargets = allMTs.filter(mt =>
        this._morphWhitelist.includes(mt) || mt.toLowerCase().includes('smile') || mt.toLowerCase().includes('blink')
      );
    }

    // 2. Discover Bones (filtered to whitelist)
    const bones = [];
    const group = this.head.armature || this.head.group;
    if (group && typeof group.traverse === 'function') {
      group.traverse((obj) => {
        if (obj.isBone && this._boneWhitelist.some(w => obj.name.includes(w))) {
          bones.push(obj.name);
        }
      });
    }
    caps.bones = [...new Set(bones)];

    return caps;
  }

  /**
   * Get a compact context string for LLM system prompts.
   * Includes avatar capabilities and available presets in a token-efficient format.
   *
   * @returns {string} Ready-to-inject context text
   */
  getLLMContext() {
    const caps = this.getAvatarCapabilities();

    const compact = this.getMotionsCompact();
    const presetLines = Object.entries(compact)
      .map(([tag, names]) => `${tag}: ${names.join(',')}`)
      .join('; ');

    return [
      'MOTION ENGINE',
      `Morphs: ${caps.morphTargets.join(',')}`,
      `Bones: ${caps.bones.join(',')}`,
      `Presets: ${presetLines}`,
      'Any morph name works as motion. For custom: {"dt":[ms],"vs":{"morph":[val]}}'
    ].join('\n');
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

    const dtArray = Array.isArray(motion.dt) ? motion.dt : [motion.dt];
    const totalMs = dtArray.reduce((sum, d) => {
      return sum + (Array.isArray(d) ? (d[0] + d[1]) / 2 : d);
    }, 0);

    // Start overlay if defined
    if (motion._overlay) {
      const ol = motion._overlay;
      const bonesWithAliases = {};

      // Apply bone aliases if configured
      for (const [b, config] of Object.entries(ol.bones || {})) {
        const targetBone = this._boneAliases[b] || b;
        bonesWithAliases[targetBone] = config;
      }

      this._overlayTimer = setTimeout(() => {
        this._overlays.start(bonesWithAliases, ol.duration || totalMs);
        this._overlayTimer = null;
      }, ol.delay || 0);
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
    if (this._overlayTimer) {
      clearTimeout(this._overlayTimer);
      this._overlayTimer = null;
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
