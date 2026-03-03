import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FaceMirror } from '../src/FaceMirror.js';

// --- Sample motion dict with _detect ---
const MOTIONS = {
  neutral: { _track: 'mood', _description: 'Default state' },
  happy: {
    _track: 'mood',
    _detect: { mouthSmileLeft: 0.5, mouthSmileRight: 0.5 },
    dt: [500],
    vs: { mouthSmile: [0.6] },
  },
  sad: {
    _track: 'mood',
    _detect: { mouthFrownLeft: 0.3, mouthFrownRight: 0.3, browInnerUp: 0.2 },
    dt: [500],
    vs: {},
  },
  angry: {
    _track: 'mood',
    _detect: { browDownLeft: 0.25, browDownRight: 0.25, noseSneerLeft: 0.15, noseSneerRight: 0.15 },
    dt: [500],
    vs: {},
  },
  // Action motion — should be ignored by loadMotions
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
      expect(count).toBe(3); // happy, sad, angry
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
      mirror.dispose();
      expect(mirror._active).toBe(false);
      expect(mirror._videoEl).toBeNull();
      expect(mirror._classifiers).toHaveLength(0);
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
  });
});
