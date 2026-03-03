/**
 * FaceMirror — Standalone face expression detection with empathic reaction mapping.
 *
 * Detects user facial expressions from a video feed and classifies them
 * into mood names using `_detect` weights from a motion dictionary.
 *
 * Two modes:
 * - **mirror** (v1): 1:1 mood cloning — detected mood fires `onMood` directly.
 * - **empathic** (v2): avatar REACTS to user emotion with attenuated intensity,
 *   complementary gestures, and smooth morph blending via `onReaction`/`onValues`.
 *
 * No hard dependency on MotionEngine — can be used standalone.
 *
 * @module FaceMirror
 */

/** @type {string} */
const MEDIAPIPE_WASM_CDN =
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm';

/** @type {string} */
const FACE_LANDMARKER_MODEL =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

import { extractBaseline, SKIP_KEYS } from './utils.js';

/** Default configuration */
const DEFAULTS = {
  threshold: 0.3,
  cooldown: 2000,
  detectInterval: 200,
  mode: 'mirror',
  blendSpeed: 0.08,
  headPose: false,
  headPoseScale: 0.25,
};

/**
 * @class FaceMirror
 */
export class FaceMirror {
  /**
   * @param {object} [options]
   * @param {number}  [options.threshold=0.3]        - Min score to trigger mood
   * @param {number}  [options.cooldown=2000]         - Ms between mood changes
   * @param {number}  [options.detectInterval=200]    - Ms between detections (5 FPS)
   * @param {string}  [options.mode='mirror']          - 'empathic' | 'mirror'
   * @param {number}  [options.blendSpeed=0.08]       - Lerp factor per update tick
   * @param {boolean} [options.headPose=false]         - Enable head pose tracking
   * @param {number}  [options.headPoseScale=0.25]    - Attenuation for head rotation
   */
  constructor(options = {}) {
    this.opt = { ...DEFAULTS, ...options };

    /** @type {Array<{mood: string, weights: Object<string,number>, total: number}>} */
    this._classifiers = [];

    /** @type {Object<string, {mood: string, intensity: number, gesture?: string}>} */
    this._reactions = {};

    /** @type {Object<string, Object<string, number>>} */
    this._moodBaselines = {};

    /** @private */
    this._landmarker = null;
    /** @private */
    this._videoEl = null;
    /** @private */
    this._active = false;
    /** @private */
    this._paused = false;
    /** @private */
    this._elapsedSinceDetect = 0;
    /** @private */
    this._elapsedSinceMood = 0;
    /** @private */
    this._currentMood = null;

    /** Smooth blending state for empathic mode */
    /** @type {Object<string, number>} */
    this._targetValues = {};
    /** @type {Object<string, number>} */
    this._currentValues = {};
    /** @type {{pitch: number, yaw: number, roll: number}} */
    this._targetHeadPose = { pitch: 0, yaw: 0, roll: 0 };
    /** @type {{pitch: number, yaw: number, roll: number}} */
    this._currentHeadPose = { pitch: 0, yaw: 0, roll: 0 };

    /** @type {function(string, number, object):void|null} */
    this.onMood = null;
    /** @type {function(object):void|null} */
    this.onDetect = null;
    /** @type {function(string, number, string|null, string):void|null} */
    this.onReaction = null;
    /** @type {function(Object<string,number>, {pitch:number,yaw:number,roll:number}):void|null} */
    this.onValues = null;
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  /**
   * Extract `_detect` classifiers and `_react` mappings from a motion dictionary.
   * Also extracts mood baselines from `vs` for empathic blending.
   *
   * @param {object} motions - Motion dictionary (same format as motions.json)
   * @returns {number} Number of classifiers loaded
   */
  loadMotions(motions) {
    this._classifiers = [];
    this._reactions = {};
    this._moodBaselines = {};

    for (const [name, entry] of Object.entries(motions)) {
      // Extract mood baselines from vs (for empathic target computation)
      if (entry._track === 'mood' && entry.vs) {
        const baseline = extractBaseline(entry.vs);
        if (Object.keys(baseline).length > 0) {
          this._moodBaselines[name] = baseline;
        }
      }

      // Extract classifiers and reactions
      if (entry._track !== 'mood' || !entry._detect) continue;

      const weights = entry._detect;
      const total = Object.values(weights).reduce((s, w) => s + w, 0);
      if (total <= 0) continue;

      this._classifiers.push({ mood: name, weights, total });

      if (entry._react) {
        this._reactions[name] = entry._react;
      }
    }

    return this._classifiers.length;
  }

  /**
   * Initialize MediaPipe FaceLandmarker via dynamic import.
   *
   * @param {object} [options]
   * @param {string} [options.wasmPath]  - Override WASM CDN path
   * @param {string} [options.modelPath] - Override model asset path
   * @param {string} [options.delegate]  - 'GPU' or 'CPU' (default: 'GPU')
   * @returns {Promise<void>}
   */
  async init(options = {}) {
    if (this._landmarker) return;

    let FaceLandmarker, FilesetResolver;
    try {
      ({ FaceLandmarker, FilesetResolver } = await import(
        '@mediapipe/tasks-vision'
      ));
    } catch (err) {
      throw new Error(
        `[FaceMirror] Failed to import @mediapipe/tasks-vision. ` +
        `Install it with: npm install @mediapipe/tasks-vision`,
        { cause: err },
      );
    }

    let vision;
    try {
      vision = await FilesetResolver.forVisionTasks(
        options.wasmPath || MEDIAPIPE_WASM_CDN,
      );
    } catch (err) {
      throw new Error(
        `[FaceMirror] Failed to load MediaPipe WASM runtime from: ` +
        `${options.wasmPath || MEDIAPIPE_WASM_CDN}`,
        { cause: err },
      );
    }

    try {
      this._landmarker = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: options.modelPath || FACE_LANDMARKER_MODEL,
          delegate: options.delegate || 'GPU',
        },
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: this.opt.headPose,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
    } catch (err) {
      throw new Error(
        `[FaceMirror] Failed to create FaceLandmarker. ` +
        `Model: ${options.modelPath || FACE_LANDMARKER_MODEL}, ` +
        `Delegate: ${options.delegate || 'GPU'}`,
        { cause: err },
      );
    }
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start mirroring from a video element.
   *
   * @param {HTMLVideoElement} videoEl - Live video element with camera feed
   */
  start(videoEl) {
    this._videoEl = videoEl;
    this._active = true;
    this._paused = false;
    this._elapsedSinceDetect = 0;
    this._elapsedSinceMood = this.opt.cooldown + 1; // allow immediate first mood
    this._currentMood = null;
    this._targetValues = {};
    this._currentValues = {};
    this._targetHeadPose = { pitch: 0, yaw: 0, roll: 0 };
    this._currentHeadPose = { pitch: 0, yaw: 0, roll: 0 };
  }

  /**
   * Stop mirroring. Resets state but keeps MediaPipe loaded.
   */
  stop() {
    this._active = false;
    this._paused = false;
    this._videoEl = null;
    this._currentMood = null;
    this._targetValues = {};
    this._currentValues = {};
    this._targetHeadPose = { pitch: 0, yaw: 0, roll: 0 };
    this._currentHeadPose = { pitch: 0, yaw: 0, roll: 0 };
  }

  /**
   * Pause detection (e.g. while avatar is speaking).
   */
  pause() {
    this._paused = true;
  }

  /**
   * Resume detection after pause.
   */
  resume() {
    this._paused = false;
    this._elapsedSinceMood = this.opt.cooldown + 1; // allow immediate mood
  }

  /**
   * Release all resources.
   */
  dispose() {
    this._active = false;
    this._paused = false;
    this._videoEl = null;
    this._currentMood = null;
    this._classifiers = [];
    this._reactions = {};
    this._moodBaselines = {};
    this._targetValues = {};
    this._currentValues = {};
    this._targetHeadPose = { pitch: 0, yaw: 0, roll: 0 };
    this._currentHeadPose = { pitch: 0, yaw: 0, roll: 0 };
    this._landmarker?.close();
    this._landmarker = null;
  }

  // ===========================================================================
  // Render Loop
  // ===========================================================================

  /**
   * Frame update — runs smooth blending every frame and detection at configured FPS.
   * Call this from your render loop.
   *
   * @param {number} dt - Delta time in ms
   */
  update(dt) {
    // Always blend + emit values (smooth output every frame), even without detection
    if (this._active && this.opt.mode === 'empathic') {
      this._blend(dt);
      if (this.onValues) {
        this.onValues({ ...this._currentValues }, { ...this._currentHeadPose });
      }
    }

    if (!this._active || this._paused || !this._landmarker || !this._videoEl) return;
    if (this._videoEl.readyState < 2) return;

    // Guard dead video tracks
    const tracks = this._videoEl.srcObject?.getVideoTracks?.();
    if (!tracks?.length || tracks[0].readyState === 'ended') return;

    this._elapsedSinceDetect += dt;
    this._elapsedSinceMood += dt;

    if (this._elapsedSinceDetect < this.opt.detectInterval) return;
    this._elapsedSinceDetect = 0;

    const now = performance.now();
    const result = this._landmarker.detectForVideo(this._videoEl, now);
    if (!result.faceBlendshapes?.length) return;

    // Build blendshape lookup
    const shapes = result.faceBlendshapes[0].categories;
    const b = {};
    for (const s of shapes) b[s.categoryName] = s.score;

    if (this.onDetect) this.onDetect(b);

    // Head pose extraction
    if (this.opt.headPose && result.facialTransformationMatrixes?.length) {
      const matrix = result.facialTransformationMatrixes[0].data;
      const pose = this._extractPose(matrix);
      const scale = this.opt.headPoseScale;
      this._targetHeadPose = {
        pitch: pose.pitch * scale,
        yaw: pose.yaw * scale,
        roll: pose.roll * scale,
      };
    }

    // Classify
    const { mood, score } = this._classify(b);

    // Apply with cooldown
    if (mood !== this._currentMood && this._elapsedSinceMood > this.opt.cooldown) {
      this._currentMood = mood;
      this._elapsedSinceMood = 0;

      if (this.opt.mode === 'empathic') {
        this._applyReaction(mood, score, b);
      }

      if (this.onMood) this.onMood(mood, score, b);
    }
  }

  // ===========================================================================
  // Empathic Reaction
  // ===========================================================================

  /**
   * Compute target morph values from the reaction map and fire `onReaction`.
   *
   * @param {string} mood - Detected mood name
   * @param {number} score - Detection confidence score
   * @param {object} b - Blendshape map
   */
  _applyReaction(mood, score, b) {
    const reaction = this._reactions[mood];

    if (!reaction) {
      // No reaction defined — clear targets (neutral fallback)
      this._targetValues = {};
      if (this.onReaction) this.onReaction('neutral', 0, null, mood);
      return;
    }

    const baseline = this._moodBaselines[reaction.mood];
    if (baseline) {
      const targets = {};
      for (const [key, val] of Object.entries(baseline)) {
        targets[key] = val * reaction.intensity;
      }
      this._targetValues = targets;
    } else {
      this._targetValues = {};
    }

    if (this.onReaction) {
      this.onReaction(reaction.mood, reaction.intensity, reaction.gesture || null, mood);
    }
  }

  // ===========================================================================
  // Smooth Blending
  // ===========================================================================

  /**
   * Lerp current values toward targets. Decays orphan keys toward 0.
   * Called every frame for smooth transitions.
   *
   * @param {number} dt - Delta time in ms
   */
  _blend(dt) {
    const speed = this.opt.blendSpeed;

    // Blend toward target values
    const allKeys = new Set([
      ...Object.keys(this._targetValues),
      ...Object.keys(this._currentValues),
    ]);

    for (const key of allKeys) {
      const target = this._targetValues[key] ?? 0;
      const current = this._currentValues[key] ?? 0;
      const next = current + (target - current) * speed;
      // Remove keys that have decayed to near-zero
      if (Math.abs(next) < 0.001 && !(key in this._targetValues)) {
        delete this._currentValues[key];
      } else {
        this._currentValues[key] = next;
      }
    }

    // Blend head pose axes
    for (const axis of ['pitch', 'yaw', 'roll']) {
      const target = this._targetHeadPose[axis];
      const current = this._currentHeadPose[axis];
      this._currentHeadPose[axis] = current + (target - current) * speed;
    }
  }

  // ===========================================================================
  // Head Pose
  // ===========================================================================

  /**
   * Decompose MediaPipe's 4x4 column-major transformation matrix to euler angles.
   *
   * @param {Float32Array|number[]} m - 4x4 column-major matrix (16 elements)
   * @returns {{pitch: number, yaw: number, roll: number}} Euler angles in radians
   */
  _extractPose(m) {
    // Column-major: m[col * 4 + row]
    const pitch = -Math.asin(-m[6]);  // negated: MediaPipe pitch is inverted vs TalkingHead
    const yaw = Math.atan2(m[2], m[10]); // m[0][2] / m[2][2]
    const roll = Math.atan2(m[4], m[5]); // m[1][0] / m[1][1]
    return { pitch, yaw, roll };
  }

  // ===========================================================================
  // Classification
  // ===========================================================================

  /**
   * Score blendshapes against loaded classifiers.
   * Public for testing.
   *
   * @param {Object<string,number>} b - Blendshape name->score map
   * @returns {{mood: string, score: number}}
   */
  _classify(b) {
    let bestMood = 'neutral';
    let bestScore = 0;

    for (const { mood, weights, total } of this._classifiers) {
      let score = 0;
      for (const [shape, weight] of Object.entries(weights)) {
        score += (b[shape] ?? 0) * weight;
      }
      score /= total;

      if (score > bestScore) {
        bestScore = score;
        bestMood = mood;
      }
    }

    if (bestScore < this.opt.threshold) {
      return { mood: 'neutral', score: bestScore };
    }

    return { mood: bestMood, score: bestScore };
  }
}
