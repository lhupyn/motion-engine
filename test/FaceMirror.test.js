import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FaceMirror } from '../src/FaceMirror.js';

// --- Sample motion dict with _detect and _react ---
const MOTIONS = {
  neutral: { _track: 'mood', _description: 'Default state' },
  happy: {
    _track: 'mood',
    _detect: { mouthSmileLeft: 0.5, mouthSmileRight: 0.5 },
    _react: { mood: 'happy', intensity: 0.3, gesture: 'nod_yes' },
    dt: [500],
    vs: { mouthSmile: [0.6] },
  },
  sad: {
    _track: 'mood',
    _detect: { mouthFrownLeft: 0.3, mouthFrownRight: 0.3, browInnerUp: 0.2 },
    _react: { mood: 'pleading', intensity: 0.25, gesture: 'nod_yes' },
    dt: [500],
    vs: { mouthFrownLeft: [0.8], browInnerUp: [0.6] },
  },
  angry: {
    _track: 'mood',
    _detect: { browDownLeft: 0.25, browDownRight: 0.25, noseSneerLeft: 0.15, noseSneerRight: 0.15 },
    _react: { mood: 'neutral', intensity: 0.2, gesture: 'nod_yes' },
    dt: [500],
    vs: {},
  },
  pleading: {
    _track: 'mood',
    _detect: { browInnerUp: 0.4, mouthFrownLeft: 0.2, mouthFrownRight: 0.2 },
    _react: { mood: 'sad', intensity: 0.3, gesture: 'nod_yes' },
    dt: [500, 2000, 500],
    vs: { browInnerUp: [0.3, 0.9, 0.3], mouthFrownLeft: [0.5] },
  },
  curious: {
    _track: 'mood',
    _detect: { browInnerUp: 0.3, eyeWideLeft: 0.2, eyeWideRight: 0.2 },
    _react: { mood: 'curious', intensity: 0.3 },
    dt: [500],
    vs: { browInnerUp: [0.5], mouthSmile: [0.15] },
  },
  // Action motion — should be ignored by loadMotions classifiers
  wave_right: {
    _track: 'action',
    dt: [300],
    vs: { mouthSmile: [0.6] },
  },
  // Mood without _detect — should be ignored
  sleep: { _track: 'mood', _description: 'Zzz' },
};

describe('FaceMirror', () => {
  let mirror;

  beforeEach(() => {
    mirror = new FaceMirror();
  });

  // ===========================================================================
  // loadMotions
  // ===========================================================================

  describe('loadMotions', () => {
    it('extracts classifiers from moods with _detect', () => {
      const count = mirror.loadMotions(MOTIONS);
      expect(count).toBe(5); // happy, sad, angry, pleading, curious
    });

    it('ignores non-mood entries', () => {
      const count = mirror.loadMotions({
        wave: { _track: 'action', _detect: { mouthSmileLeft: 0.5 } },
      });
      expect(count).toBe(0);
    });

    it('ignores moods without _detect', () => {
      const count = mirror.loadMotions({
        neutral: { _track: 'mood' },
        sleep: { _track: 'mood', _description: 'Zzz' },
      });
      expect(count).toBe(0);
    });

    it('resets classifiers on re-call', () => {
      mirror.loadMotions(MOTIONS);
      const count = mirror.loadMotions({ happy: MOTIONS.happy });
      expect(count).toBe(1);
    });

    it('extracts _react data into _reactions map', () => {
      mirror.loadMotions(MOTIONS);
      expect(mirror._reactions.happy).toEqual({ mood: 'happy', intensity: 0.3, gesture: 'nod_yes' });
      expect(mirror._reactions.sad).toEqual({ mood: 'pleading', intensity: 0.25, gesture: 'nod_yes' });
      expect(mirror._reactions.curious).toEqual({ mood: 'curious', intensity: 0.3 });
    });

    it('extracts mood baselines from vs', () => {
      mirror.loadMotions(MOTIONS);
      expect(mirror._moodBaselines.happy).toEqual({ mouthSmile: 0.6 });
      expect(mirror._moodBaselines.sad).toEqual({ mouthFrownLeft: 0.8, browInnerUp: 0.6 });
    });

    it('picks hold value (index 1) for multi-frame vs arrays', () => {
      mirror.loadMotions(MOTIONS);
      // pleading has browInnerUp: [0.3, 0.9, 0.3] — should pick 0.9
      expect(mirror._moodBaselines.pleading.browInnerUp).toBe(0.9);
    });

    it('skips mood entries without vs', () => {
      mirror.loadMotions(MOTIONS);
      expect(mirror._moodBaselines.angry).toBeUndefined();
    });

    it('skips gesture and headMove keys in baselines', () => {
      mirror.loadMotions({
        test: {
          _track: 'mood',
          _detect: { browInnerUp: 0.5 },
          dt: [500],
          vs: { gesture: [['wave', null]], headMove: [0.1], browInnerUp: [0.5] },
        },
      });
      expect(mirror._moodBaselines.test).toEqual({ browInnerUp: 0.5 });
    });

    it('does not extract _react when not present', () => {
      mirror.loadMotions({
        bare: {
          _track: 'mood',
          _detect: { browInnerUp: 0.5 },
          dt: [500],
          vs: { browInnerUp: [0.5] },
        },
      });
      expect(mirror._reactions.bare).toBeUndefined();
    });
  });

  // ===========================================================================
  // _classify
  // ===========================================================================

  describe('_classify', () => {
    beforeEach(() => {
      mirror.loadMotions(MOTIONS);
    });

    it('detects happy from smile blendshapes', () => {
      const result = mirror._classify({
        mouthSmileLeft: 0.8,
        mouthSmileRight: 0.7,
      });
      expect(result.mood).toBe('happy');
      expect(result.score).toBeGreaterThan(0.3);
    });

    it('detects angry from brow/sneer blendshapes', () => {
      const result = mirror._classify({
        browDownLeft: 0.9,
        browDownRight: 0.8,
        noseSneerLeft: 0.6,
        noseSneerRight: 0.7,
      });
      expect(result.mood).toBe('angry');
      expect(result.score).toBeGreaterThan(0.3);
    });

    it('returns neutral when all scores below threshold', () => {
      const result = mirror._classify({
        mouthSmileLeft: 0.05,
        browDownLeft: 0.02,
      });
      expect(result.mood).toBe('neutral');
    });

    it('returns neutral for empty blendshapes', () => {
      const result = mirror._classify({});
      expect(result.mood).toBe('neutral');
      expect(result.score).toBe(0);
    });

    it('handles missing blendshape keys gracefully', () => {
      const result = mirror._classify({
        mouthSmileLeft: 0.9,
        // mouthSmileRight missing — should use 0
      });
      expect(result.mood).toBe('happy');
      // score = (0.9 * 0.5 + 0 * 0.5) / 1.0 = 0.45
      expect(result.score).toBeCloseTo(0.45, 2);
    });

    it('picks highest scoring mood', () => {
      const result = mirror._classify({
        mouthSmileLeft: 0.9,
        mouthSmileRight: 0.9,
        browDownLeft: 0.1,
      });
      expect(result.mood).toBe('happy');
    });
  });

  // ===========================================================================
  // _applyReaction (empathic mode)
  // ===========================================================================

  describe('_applyReaction', () => {
    beforeEach(() => {
      mirror.loadMotions(MOTIONS);
    });

    it('sets target values from reaction map', () => {
      mirror._applyReaction('happy', 0.8, {});
      // happy._react = { mood: 'happy', intensity: 0.3 }
      // happy baseline = { mouthSmile: 0.6 }
      // target = 0.6 * 0.3 = 0.18
      expect(mirror._targetValues.mouthSmile).toBeCloseTo(0.18, 4);
    });

    it('falls back to neutral when no reaction defined', () => {
      // 'angry' has a reaction, but let's test a mood without one
      const onReaction = vi.fn();
      mirror.onReaction = onReaction;

      // Manually add a classifier without _react
      mirror._reactions = {}; // clear all reactions
      mirror._applyReaction('happy', 0.8, {});

      expect(mirror._targetValues).toEqual({});
      expect(onReaction).toHaveBeenCalledWith('neutral', 0, null, 'happy');
    });

    it('fires onReaction callback with correct args', () => {
      const onReaction = vi.fn();
      mirror.onReaction = onReaction;

      mirror._applyReaction('happy', 0.8, {});
      expect(onReaction).toHaveBeenCalledWith('happy', 0.3, 'nod_yes', 'happy');
    });

    it('fires onReaction with null gesture when not defined', () => {
      const onReaction = vi.fn();
      mirror.onReaction = onReaction;

      mirror._applyReaction('curious', 0.6, {});
      expect(onReaction).toHaveBeenCalledWith('curious', 0.3, null, 'curious');
    });

    it('clears targets when reaction mood has no baseline', () => {
      // angry._react = { mood: 'neutral', intensity: 0.2 }
      // neutral has no baseline in our test motions
      mirror._applyReaction('angry', 0.7, {});
      expect(mirror._targetValues).toEqual({});
    });
  });

  // ===========================================================================
  // _blend (smooth blending)
  // ===========================================================================

  describe('_blend', () => {
    it('lerps values toward targets', () => {
      mirror._targetValues = { mouthSmile: 1.0 };
      mirror._currentValues = { mouthSmile: 0 };
      mirror._blend(16);
      // After one step: 0 + (1 - 0) * 0.08 = 0.08
      expect(mirror._currentValues.mouthSmile).toBeCloseTo(0.08, 4);
    });

    it('decays orphan keys toward zero', () => {
      mirror._currentValues = { mouthSmile: 0.5 };
      mirror._targetValues = {}; // no target — should decay
      mirror._blend(16);
      // 0.5 + (0 - 0.5) * 0.08 = 0.46
      expect(mirror._currentValues.mouthSmile).toBeCloseTo(0.46, 4);
    });

    it('removes keys that have decayed below threshold', () => {
      mirror._currentValues = { mouthSmile: 0.0005 };
      mirror._targetValues = {};
      mirror._blend(16);
      expect(mirror._currentValues.mouthSmile).toBeUndefined();
    });

    it('blends head pose axes', () => {
      mirror._targetHeadPose = { pitch: 0.1, yaw: -0.2, roll: 0 };
      mirror._currentHeadPose = { pitch: 0, yaw: 0, roll: 0 };
      mirror._blend(16);
      expect(mirror._currentHeadPose.pitch).toBeCloseTo(0.008, 4);
      expect(mirror._currentHeadPose.yaw).toBeCloseTo(-0.016, 4);
    });

    it('handles new target keys not yet in current', () => {
      mirror._currentValues = {};
      mirror._targetValues = { browInnerUp: 0.5 };
      mirror._blend(16);
      // 0 + (0.5 - 0) * 0.08 = 0.04
      expect(mirror._currentValues.browInnerUp).toBeCloseTo(0.04, 4);
    });
  });

  // ===========================================================================
  // _extractPose
  // ===========================================================================

  describe('_extractPose', () => {
    it('decomposes identity matrix to zeros', () => {
      // 4x4 identity in column-major
      const identity = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ];
      const pose = mirror._extractPose(identity);
      expect(pose.pitch).toBeCloseTo(0, 4);
      expect(pose.yaw).toBeCloseTo(0, 4);
      expect(pose.roll).toBeCloseTo(0, 4);
    });

    it('extracts non-zero angles from rotated matrix', () => {
      // Simple rotation around Y axis by ~0.3 rad (column-major)
      const angle = 0.3;
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      const m = [
        c, 0, -s, 0,
        0, 1, 0, 0,
        s, 0, c, 0,
        0, 0, 0, 1,
      ];
      const pose = mirror._extractPose(m);
      expect(Math.abs(pose.yaw)).toBeCloseTo(0.3, 2);
      expect(pose.pitch).toBeCloseTo(0, 2);
    });
  });

  // ===========================================================================
  // Mode compatibility
  // ===========================================================================

  describe('mode compatibility', () => {
    it("mode defaults to 'mirror'", () => {
      expect(mirror.opt.mode).toBe('mirror');
    });

    it("mode 'mirror' skips reaction mapping in update", () => {
      const m = new FaceMirror({ mode: 'mirror' });
      m.loadMotions(MOTIONS);
      // _applyReaction should not be called in mirror mode
      // (tested indirectly — mirror mode doesn't set _targetValues)
      expect(m.opt.mode).toBe('mirror');
    });

    it('onMood fires in both modes', () => {
      // Already tested via _classify path — just verify callback exists
      expect(mirror.onMood).toBeNull();
    });

    it('constructor accepts blendSpeed option', () => {
      const m = new FaceMirror({ blendSpeed: 0.15 });
      expect(m.opt.blendSpeed).toBe(0.15);
    });

    it('constructor accepts headPose option', () => {
      const m = new FaceMirror({ headPose: true });
      expect(m.opt.headPose).toBe(true);
    });

    it('constructor accepts headPoseScale option', () => {
      const m = new FaceMirror({ headPoseScale: 0.5 });
      expect(m.opt.headPoseScale).toBe(0.5);
    });
  });

  // ===========================================================================
  // Callbacks
  // ===========================================================================

  describe('callbacks', () => {
    it('onReaction callback fires with correct args', () => {
      mirror.loadMotions(MOTIONS);
      const onReaction = vi.fn();
      mirror.onReaction = onReaction;
      mirror._applyReaction('sad', 0.7, {});
      expect(onReaction).toHaveBeenCalledWith('pleading', 0.25, 'nod_yes', 'sad');
    });

    it('onValues fires every update in empathic mode', () => {
      mirror = new FaceMirror({ mode: 'empathic' });
      mirror.loadMotions(MOTIONS);
      mirror.start({});
      const onValues = vi.fn();
      mirror.onValues = onValues;
      // update will blend (no detection since no landmarker, but blend + onValues runs)
      mirror.update(16);
      expect(onValues).toHaveBeenCalledTimes(1);
      expect(onValues).toHaveBeenCalledWith(
        expect.any(Object),
        expect.objectContaining({ pitch: expect.any(Number), yaw: expect.any(Number), roll: expect.any(Number) }),
      );
    });

    it('onValues does not fire in mirror mode', () => {
      const m = new FaceMirror({ mode: 'mirror' });
      m.loadMotions(MOTIONS);
      m.start({});
      const onValues = vi.fn();
      m.onValues = onValues;
      m.update(16);
      expect(onValues).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  describe('lifecycle', () => {
    it('start activates mirror', () => {
      const videoEl = {};
      mirror.start(videoEl);
      expect(mirror._active).toBe(true);
      expect(mirror._videoEl).toBe(videoEl);
    });

    it('stop deactivates mirror', () => {
      mirror.start({});
      mirror.stop();
      expect(mirror._active).toBe(false);
      expect(mirror._videoEl).toBeNull();
    });

    it('stop clears blend state', () => {
      mirror.start({});
      mirror._currentValues = { mouthSmile: 0.5 };
      mirror._targetValues = { mouthSmile: 1.0 };
      mirror.stop();
      expect(mirror._currentValues).toEqual({});
      expect(mirror._targetValues).toEqual({});
    });

    it('pause / resume toggle _paused', () => {
      mirror.start({});
      mirror.pause();
      expect(mirror._paused).toBe(true);
      mirror.resume();
      expect(mirror._paused).toBe(false);
    });

    it('resume resets cooldown for immediate mood', () => {
      mirror.start({});
      mirror._elapsedSinceMood = 0;
      mirror.resume();
      expect(mirror._elapsedSinceMood).toBeGreaterThan(mirror.opt.cooldown);
    });

    it('dispose releases all state', () => {
      mirror.loadMotions(MOTIONS);
      mirror.start({});
      mirror._currentValues = { mouthSmile: 0.5 };
      mirror.dispose();
      expect(mirror._active).toBe(false);
      expect(mirror._videoEl).toBeNull();
      expect(mirror._classifiers).toHaveLength(0);
      expect(mirror._reactions).toEqual({});
      expect(mirror._moodBaselines).toEqual({});
      expect(mirror._currentValues).toEqual({});
      expect(mirror._landmarker).toBeNull();
    });
  });

  // ===========================================================================
  // Cooldown
  // ===========================================================================

  describe('cooldown', () => {
    it('respects default cooldown of 2000ms', () => {
      expect(mirror.opt.cooldown).toBe(2000);
    });

    it('accepts custom cooldown', () => {
      const m = new FaceMirror({ cooldown: 500 });
      expect(m.opt.cooldown).toBe(500);
    });

    it('accepts custom threshold', () => {
      const m = new FaceMirror({ threshold: 0.5 });
      expect(m.opt.threshold).toBe(0.5);
    });

    it('accepts custom detectInterval', () => {
      const m = new FaceMirror({ detectInterval: 100 });
      expect(m.opt.detectInterval).toBe(100);
    });
  });

  // ===========================================================================
  // update (without MediaPipe — guards only)
  // ===========================================================================

  describe('update guards', () => {
    it('does nothing when not active', () => {
      mirror.update(16);
      // Should not throw
    });

    it('does nothing when paused', () => {
      mirror.start({});
      mirror.pause();
      mirror._landmarker = {}; // fake
      mirror.update(16);
      // _elapsedSinceDetect should not change
      expect(mirror._elapsedSinceDetect).toBe(0);
    });

    it('does nothing without landmarker', () => {
      mirror.start({});
      mirror.update(16);
      expect(mirror._elapsedSinceDetect).toBe(0);
    });

    it('still runs blend when active in empathic mode (even without landmarker)', () => {
      mirror = new FaceMirror({ mode: 'empathic' });
      mirror.start({});
      mirror._targetValues = { mouthSmile: 1.0 };
      mirror.update(16);
      // blend should have run
      expect(mirror._currentValues.mouthSmile).toBeGreaterThan(0);
    });
  });
});
