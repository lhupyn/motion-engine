/**
 * MotionStudio — Authoring & discovery layer for MotionEngine.
 *
 * Wraps a MotionEngine instance. Provides:
 *   - LLM discovery (getMotions, getMotionsCompact, getMotionsForPrompt, getLLMContext)
 *   - Avatar capability inspection
 *   - Dynamic motion parsing from raw JSON (LLM output)
 *   - Morph and bone alias systems
 *   - Auto-wrap bare morph target names as motions
 *
 * Optional module — consumers who only need playback import MotionEngine directly.
 *
 * @module MotionStudio
 */

/** Default morph target whitelist for capability discovery */
const DEFAULT_MT_WHITELIST = [
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeLookDownLeft', 'eyeLookDownRight',
  'jawOpen', 'mouthPucker', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthFrownLeft', 'mouthFrownRight',
  'cheekPuff', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
];

/** Default bone whitelist for capability discovery */
const DEFAULT_BONE_WHITELIST = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  'RightHand', 'LeftHand',
];

/**
 * @class MotionStudio
 */
export class MotionStudio {
  /**
   * @param {import('./MotionEngine.js').MotionEngine} engine - A MotionEngine instance
   * @param {object} [options]
   * @param {Object<string, string[]>} [options.aliases] - Morph name aliases
   * @param {Object<string, string>} [options.boneAliases] - Bone name aliases
   * @param {boolean} [options.autoWrapMorphs=false] - Auto-wrap bare morph names as motions
   * @param {string[]} [options.morphWhitelist] - Custom morph whitelist for getAvatarCapabilities()
   * @param {string[]} [options.boneWhitelist] - Custom bone whitelist for getAvatarCapabilities()
   */
  constructor(engine, options = {}) {
    this.engine = engine;
    this._aliases = options.aliases || {};
    this._boneAliases = options.boneAliases || {};
    this._autoWrapMorphs = options.autoWrapMorphs || false;
    this._morphWhitelist = options.morphWhitelist || DEFAULT_MT_WHITELIST;
    this._boneWhitelist = options.boneWhitelist || DEFAULT_BONE_WHITELIST;
  }

  // ===========================================================================
  // Discovery
  // ===========================================================================

  /**
   * Inspect the bound TalkingHead instance to discover its anatomical capabilities.
   *
   * @returns {{ morphTargets: string[], bones: string[] }}
   */
  getAvatarCapabilities() {
    const head = this.engine.head;
    const caps = { morphTargets: [], bones: [] };

    // Discover morph targets (filtered to whitelist)
    if (head.mtAvatar) {
      const allMTs = Object.keys(head.mtAvatar);
      caps.morphTargets = allMTs.filter(mt =>
        this._morphWhitelist.includes(mt) ||
        mt.toLowerCase().includes('smile') ||
        mt.toLowerCase().includes('blink')
      );
    }

    // Discover bones (filtered to whitelist)
    const bones = [];
    const group = head.armature || head.group;
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
   * Get all registered custom motion names.
   *
   * @returns {string[]}
   */
  getMotionNames() {
    return this.engine.getMotionNames();
  }

  /**
   * Get motion metadata for LLM tool discovery.
   * Returns name, description, tags, and track for each registered motion.
   *
   * @returns {Array<{name: string, description: string, tags: string[], track: string}>}
   */
  getMotions() {
    const motions = this.engine.getRegisteredMotions();
    return Object.entries(motions).map(([name, motion]) => ({
      name,
      description: motion._description || name,
      tags: motion._tags || [],
      track: motion._track || 'action',
    }));
  }

  /**
   * Get motions grouped by primary tag — compact format for token-constrained LLMs.
   *
   * @returns {Object<string, string[]>} Map of tag → motion names
   */
  getMotionsCompact() {
    const motions = this.engine.getRegisteredMotions();
    const groups = {};
    for (const [name, motion] of Object.entries(motions)) {
      const tag = (motion._tags && motion._tags[0]) || 'other';
      if (!groups[tag]) groups[tag] = [];
      groups[tag].push(name);
    }
    return groups;
  }

  /**
   * Get a pre-formatted prompt string for LLM system instructions.
   *
   * @param {'full'|'compact'|'minimal'} [level='compact'] - Verbosity level
   * @returns {string}
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
   * Get a compact context string for LLM system prompts.
   *
   * @returns {string}
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
      'Any morph name works as motion. For custom: {"dt":[ms],"vs":{"morph":[val]}}',
    ].join('\n');
  }

  // ===========================================================================
  // Dynamic Motions
  // ===========================================================================

  /**
   * Parse a raw JSON string or object from an LLM into a normalized motion.
   *
   * Handles:
   * - `{ "name": { ...motionDef } }` wrapper format
   * - Direct motion objects `{ dt: [...], vs: {...} }`
   * - Non-array vs values → wrapped in arrays
   *
   * @param {string|object} json - Raw JSON string or object
   * @returns {{ name: string, motion: object }} Normalized name and motion object
   */
  parseDynamic(json) {
    const raw = typeof json === 'string' ? JSON.parse(json) : json;

    const RESERVED = new Set(['dt', 'vs', 'rescale', '_overlay', '_description', '_tags', '_track']);
    const keys = Object.keys(raw);
    const shouldUnwrap = keys.length === 1
      && typeof raw[keys[0]] === 'object'
      && !Array.isArray(raw[keys[0]])
      && !RESERVED.has(keys[0]);

    const motion = shouldUnwrap ? raw[keys[0]] : raw;
    const name = shouldUnwrap ? keys[0] : `dynamic_${Date.now()}`;

    // Normalize non-array vs values
    if (motion.vs) {
      for (const [key, val] of Object.entries(motion.vs)) {
        if (key !== 'gesture' && !Array.isArray(val)) {
          motion.vs[key] = [val];
        }
      }
    }

    return { name, motion };
  }

  /**
   * Parse, register, and play a dynamic motion in one step.
   *
   * @param {string|object} json - Raw JSON string or object
   * @returns {Promise<void>}
   */
  async playDynamic(json) {
    const { name, motion } = this.parseDynamic(json);
    this.registerDynamic(name, motion);
    return this.engine.play(name);
  }

  /**
   * Register a dynamic motion with alias normalization.
   *
   * @param {string} name - Motion name
   * @param {object} obj - Motion definition
   */
  registerDynamic(name, obj) {
    const entry = structuredClone(obj);

    if (entry.vs) entry.vs = this.applyMorphAliases(entry.vs);
    if (entry._overlay?.bones) entry._overlay.bones = this.applyBoneAliases(entry._overlay.bones);

    this.engine.registerMotions({ [name]: entry });
  }

  // ===========================================================================
  // Aliases
  // ===========================================================================

  /**
   * Configure morph name aliases.
   *
   * @param {Object<string, string[]>} morphAliases - e.g., {eyesClosed: ['eyeBlinkLeft','eyeBlinkRight']}
   */
  setAliases(morphAliases) {
    this._aliases = morphAliases;
  }

  /**
   * Configure bone name aliases.
   *
   * @param {Object<string, string>} boneAliases - e.g., {Head: 'Neck'}
   */
  setBoneAliases(boneAliases) {
    this._boneAliases = boneAliases;
  }

  /**
   * Transform a vs (morph values) object through morph aliases.
   *
   * @param {object} vs - Morph values object
   * @returns {object} Transformed vs with aliases expanded
   */
  applyMorphAliases(vs) {
    const result = {};
    for (const [key, val] of Object.entries(vs)) {
      if (this._aliases[key]) {
        const normalized = Array.isArray(val) ? val : [val];
        this._aliases[key].forEach(target => {
          result[target] = normalized;
        });
      } else {
        result[key] = val;
      }
    }
    return result;
  }

  /**
   * Transform overlay bones through bone aliases.
   *
   * @param {object} bones - Bone config object
   * @returns {object} Transformed bones with aliases applied
   */
  applyBoneAliases(bones) {
    const result = {};
    for (const [b, config] of Object.entries(bones)) {
      const target = this._boneAliases[b] || b;
      result[target] = config;
    }
    return result;
  }

  // ===========================================================================
  // Auto-wrap
  // ===========================================================================

  /**
   * Wrap a bare morph target name into a full motion definition.
   *
   * @param {string} name - Morph target name (e.g., "cheekPuff")
   * @param {object} [opts] - Optional overrides
   * @param {number[]} [opts.dt] - Timing array
   * @param {number[]} [opts.rescale] - Rescale array
   * @param {number} [opts.intensity] - Peak value (0-1)
   * @returns {object} A valid motion definition
   */
  wrapMorph(name, opts = {}) {
    return {
      dt: opts.dt || [300, 1500, 500],
      rescale: opts.rescale || [0, 1, 0],
      vs: { [name]: [opts.intensity || 0.8] },
    };
  }
}
