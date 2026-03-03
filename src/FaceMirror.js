/**
 * FaceMirror — Standalone face expression mirroring via MediaPipe.
 *
 * Detects user facial expressions from a video feed and classifies them
 * into mood names using `_detect` weights from a motion dictionary.
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

/** Default configuration */
const DEFAULTS = {
  threshold: 0.3,
  cooldown: 2000,
  detectInterval: 200,
};

/**
 * @class FaceMirror
 */
export class FaceMirror {
  /**
   * @param {object} [options]
   * @param {number} [options.threshold=0.3]       - Min score to trigger mood
   * @param {number} [options.cooldown=2000]        - Ms between mood changes
   * @param {number} [options.detectInterval=200]   - Ms between detections (5 FPS)
   */
  constructor(options = {}) {
    this.opt = { ...DEFAULTS, ...options };

    /** @type {Array<{mood: string, weights: Object<string,number>, total: number}>} */
    this._classifiers = [];

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

    /** @type {function(string, number, object):void|null} */
    this.onMood = null;
    /** @type {function(object):void|null} */
    this.onDetect = null;
  }

  // ===========================================================================
  // Setup
  // ===========================================================================

  /**
   * Extract `_detect` classifiers from a motion dictionary.
   * Only picks entries with `_track: "mood"` and `_detect` object.
   *
   * @param {object} motions - Motion dictionary (same format as motions.json)
   * @returns {number} Number of classifiers loaded
   */
  loadMotions(motions) {
    this._classifiers = [];

    for (const [name, entry] of Object.entries(motions)) {
      if (entry._track !== 'mood' || !entry._detect) continue;

      const weights = entry._detect;
      const total = Object.values(weights).reduce((s, w) => s + w, 0);
      if (total <= 0) continue;

      this._classifiers.push({ mood: name, weights, total });
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

    const { FaceLandmarker, FilesetResolver } = await import(
      '@mediapipe/tasks-vision'
    );

    const vision = await FilesetResolver.forVisionTasks(
      options.wasmPath || MEDIAPIPE_WASM_CDN,
    );

    this._landmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: options.modelPath || FACE_LANDMARKER_MODEL,
        delegate: options.delegate || 'GPU',
      },
      outputFaceBlendshapes: true,
      outputFacialTransformationMatrixes: false,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
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
  }

  /**
   * Stop mirroring. Resets state but keeps MediaPipe loaded.
   */
  stop() {
    this._active = false;
    this._paused = false;
    this._videoEl = null;
    this._currentMood = null;
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
    this._landmarker?.close();
    this._landmarker = null;
  }

  // ===========================================================================
  // Render Loop
  // ===========================================================================

  /**
   * Frame update — accumulates delta time and runs detection at configured FPS.
   * Call this from your render loop.
   *
   * @param {number} dt - Delta time in ms
   */
  update(dt) {
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

    // Classify
    const { mood, score } = this._classify(b);

    // Apply with cooldown
    if (mood !== this._currentMood && this._elapsedSinceMood > this.opt.cooldown) {
      this._currentMood = mood;
      this._elapsedSinceMood = 0;
      if (this.onMood) this.onMood(mood, score, b);
    }
  }

  // ===========================================================================
  // Classification
  // ===========================================================================

  /**
   * Score blendshapes against loaded classifiers.
   * Public for testing.
   *
   * @param {Object<string,number>} b - Blendshape name→score map
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
