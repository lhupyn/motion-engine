import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MotionEngine } from '../src/MotionEngine.js';
import { FaceMirror } from '../src/FaceMirror.js';

// --- TalkingHead mock ---
function createMockHead() {
  return {
    gestureTemplates: { wave: {} },
    poseTemplates: { standing: {}, sitting: {} },
    moodTemplates: { neutral: {}, happy: {} },
    animEmojis: {},
    animMoods: {
      neutral: {
        baseline: { eyesLookDown: 0.1 },
        speech: { deltaRate: 0, deltaPitch: 0, deltaVolume: 0 },
        anims: [
          { name: 'breathing', delay: 1500, dt: [1200, 500, 1000], vs: { chestInhale: [0.5, 0.5, 0] } },
          { name: 'head', idle: { dt: [[200, 5000]], vs: { bodyRotateX: [[-0.04, 0.10]] } } },
        ],
      },
      happy: {
        baseline: { mouthSmile: 0.2, eyesLookDown: 0.1 },
        speech: { deltaRate: 0, deltaPitch: 0.1, deltaVolume: 0 },
        anims: [],
      },
    },
    poseName: null,
    mtAvatar: {
      browInnerUp: { newvalue: 0, baseline: 0, needsUpdate: false },
      mouthSmile: { newvalue: 0, baseline: 0, needsUpdate: false },
      eyeSquintLeft: { newvalue: 0, baseline: 0, needsUpdate: false },
      headRotateX: { newvalue: 0, baseline: 0, needsUpdate: false },
      headRotateY: { newvalue: 0, baseline: 0, needsUpdate: false },
      headRotateZ: { newvalue: 0, baseline: 0, needsUpdate: false },
    },
    avatar: { baseline: {} },
    mood: { baseline: {} },
    mtBaselineDefault: 0,
    mtBaselineExceptions: {},
    poseDelta: { props: {} },
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    setPoseFromTemplate: vi.fn(),
    setMood: vi.fn(),
    setBaselineValue: vi.fn(),
    setValue: vi.fn(),
  };
}

describe('MotionEngine', () => {
  let head, engine;

  beforeEach(() => {
    head = createMockHead();
    engine = new MotionEngine(head);
    // Mock performance.now for deterministic tests
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  // ===========================================================================
  // Registration
  // ===========================================================================

  describe('registerMotions', () => {
    it('registers motions and returns count', () => {
      const count = engine.registerMotions({
        test_action: { dt: [300, 1000, 300], vs: { mouthSmile: [0.5] }, _track: 'action' },
        test_mood: { dt: [500], vs: { browInnerUp: [0.8] }, _track: 'mood' },
      });
      expect(count).toBe(2);
      expect(engine.getMotionNames()).toContain('test_action');
      expect(engine.getMotionNames()).toContain('test_mood');
    });

    it('skips motions that collide with gestureTemplates', () => {
      const count = engine.registerMotions({
        wave: { dt: [300], vs: {} }, // collides with head.gestureTemplates.wave
      });
      expect(count).toBe(0);
    });

    it('skips motions without dt field', () => {
      const count = engine.registerMotions({
        invalid: { vs: { mouthSmile: [0.5] } },
      });
      expect(count).toBe(0);
    });

    it('registers metadata-only mood entries for discovery', () => {
      const count = engine.registerMotions({
        neutral: { _track: 'mood', _description: 'Default relaxed state', _tags: ['calm'] },
      });
      expect(count).toBe(1);
      expect(engine.getMotionNames()).toContain('neutral');
      // Should NOT overwrite TH's native animMoods entry
      expect(head.animMoods.neutral.baseline.eyesLookDown).toBe(0.1);
    });

    it('does not register metadata-only entry as animEmoji', () => {
      engine.registerMotions({
        neutral: { _track: 'mood', _description: 'Default state' },
      });
      expect(head.animEmojis.neutral).toBeUndefined();
    });

    it('normalizes scalar vs values to arrays', () => {
      engine.registerMotions({
        scalar_test: { dt: [500], vs: { mouthSmile: 0.8 } },
      });
      const motions = engine.getRegisteredMotions();
      expect(motions.scalar_test.vs.mouthSmile).toEqual([0.8]);
    });

    it('converts null to Infinity in gesture arrays', () => {
      engine.registerMotions({
        gesture_test: { dt: [500], vs: { gesture: [['handup', null, true], null] } },
      });
      const motions = engine.getRegisteredMotions();
      expect(motions.gesture_test.vs.gesture[0][1]).toBe(Infinity);
    });

    it('strips _track from animEmoji registration', () => {
      engine.registerMotions({
        track_test: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'mood', _description: 'test' },
      });
      expect(head.animEmojis.track_test._track).toBeUndefined();
      expect(head.animEmojis.track_test._description).toBeUndefined();
    });

    it('synthesizes dt for overlay-only motions', () => {
      engine.registerMotions({
        overlay_only: { _overlay: { bones: {}, duration: 3000 } },
      });
      const motions = engine.getRegisteredMotions();
      expect(motions.overlay_only.dt).toEqual([3000]);
    });

    it('injects mood motions into TH animMoods', () => {
      engine.registerMotions({
        thinking: { dt: [500, 2000, 500], vs: { browInnerUp: [0.3, 0.7, 0.3] }, _track: 'mood' },
      });
      expect(head.animMoods.thinking).toBeDefined();
      expect(head.animMoods.thinking.baseline.browInnerUp).toBe(0.7);
      expect(head.animMoods.thinking.speech).toEqual({ deltaRate: 0, deltaPitch: 0, deltaVolume: 0 });
    });

    it('copies neutral anims into injected mood', () => {
      engine.registerMotions({
        thinking: { dt: [500], vs: { browInnerUp: [0.7] }, _track: 'mood' },
      });
      expect(head.animMoods.thinking.anims).toHaveLength(2);
      expect(head.animMoods.thinking.anims[0].name).toBe('breathing');
    });

    it('picks single value for 1-frame morph arrays', () => {
      engine.registerMotions({
        test_mood: { dt: [500], vs: { browInnerUp: [0.8] }, _track: 'mood' },
      });
      expect(head.animMoods.test_mood.baseline.browInnerUp).toBe(0.8);
    });

    it('skips gesture key in mood baseline', () => {
      engine.registerMotions({
        test_mood: { dt: [500], vs: { gesture: [['wave', null]], browInnerUp: [0.5] }, _track: 'mood' },
      });
      expect(head.animMoods.test_mood.baseline.gesture).toBeUndefined();
      expect(head.animMoods.test_mood.baseline.browInnerUp).toBe(0.5);
    });

    it('skips range arrays and non-numeric values in mood baseline', () => {
      engine.registerMotions({
        nervous: {
          dt: [200, 200, 200],
          vs: {
            browInnerUp: [0.6],
            headRotateZ: [[-0.03, 0.03]],  // range array — should be skipped
            headRotateY: [0.06, -0.06, 0],  // numeric — should pick -0.06
          },
          _track: 'mood',
        },
      });
      const b = head.animMoods.nervous.baseline;
      expect(b.browInnerUp).toBe(0.6);
      expect(b.headRotateZ).toBeUndefined();  // range array skipped
      expect(b.headRotateY).toBe(-0.06);      // numeric value kept
    });

    it('does not inject action motions into animMoods', () => {
      engine.registerMotions({
        nod: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'action' },
      });
      expect(head.animMoods.nod).toBeUndefined();
    });
  });

  // ===========================================================================
  // Track Routing
  // ===========================================================================

  describe('track routing', () => {
    it('routes motion with _track: "mood" to mood track', async () => {
      engine.registerMotions({
        thinking: { dt: [500, 2000, 500], vs: { browInnerUp: [0.7] }, _track: 'mood' },
      });
      await engine.play('thinking');
      expect(engine.tracks.mood.active).toBe(true);
      expect(engine.tracks.mood.name).toBe('thinking');
    });

    it('routes motion with _track: "action" to action track', async () => {
      engine.registerMotions({
        nod_yes: { dt: [250, 250, 300], vs: { mouthSmile: [0.3] }, _track: 'action' },
      });
      // Don't await — action track resolves after timers
      engine.play('nod_yes');
      expect(engine.tracks.action.active).toBe(true);
      expect(engine.tracks.action.name).toBe('nod_yes');
    });

    it('routes poseTemplates match to pose track', async () => {
      await engine.play('standing');
      expect(engine.tracks.pose.active).toBe(true);
      expect(engine.tracks.pose.name).toBe('standing');
      expect(head.setPoseFromTemplate).toHaveBeenCalled();
    });

    it('routes moodTemplates match to mood track', async () => {
      await engine.play('happy');
      expect(engine.tracks.mood.active).toBe(true);
      expect(engine.tracks.mood.name).toBe('happy');
      expect(head.setMood).toHaveBeenCalledWith('happy');
    });

    it('routes known mood names to mood track', async () => {
      await engine.play('neutral');
      expect(engine.tracks.mood.active).toBe(true);
    });

    it('defaults unknown motions to action track', () => {
      engine.play('unknown_motion');
      // Should emit error since not found
      // action track should not be active since it wasn't found
      expect(engine.tracks.action.active).toBe(false);
    });
  });

  // ===========================================================================
  // Multi-track concurrency
  // ===========================================================================

  describe('multi-track concurrency', () => {
    it('mood persists while action plays', async () => {
      engine.registerMotions({
        sad: { dt: [800, 2000, 800], vs: { browInnerUp: [1] }, _track: 'mood' },
        nod_yes: { dt: [250, 250, 300], vs: { mouthSmile: [0.3] }, _track: 'action' },
      });

      await engine.play('sad');
      expect(engine.tracks.mood.active).toBe(true);

      // Start action — mood should stay active
      engine.play('nod_yes');
      expect(engine.tracks.mood.active).toBe(true);
      expect(engine.tracks.action.active).toBe(true);
    });

    it('new action interrupts previous action', async () => {
      engine.registerMotions({
        action1: { dt: [500, 2000, 500], vs: { mouthSmile: [0.5] }, _track: 'action' },
        action2: { dt: [300, 1000, 300], vs: { browInnerUp: [0.8] }, _track: 'action' },
      });

      engine.play('action1');
      expect(engine.tracks.action.name).toBe('action1');

      // Play second action — first should be interrupted
      engine.play('action2');
      expect(engine.tracks.action.name).toBe('action2');
    });
  });

  // ===========================================================================
  // Playback
  // ===========================================================================

  describe('playing getter', () => {
    it('returns true when action is active', () => {
      engine.registerMotions({
        test: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'action' },
      });
      engine.play('test');
      expect(engine.playing).toBe(true);
    });

    it('returns false when no action', () => {
      expect(engine.playing).toBe(false);
    });
  });

  describe('stop', () => {
    it('interrupts current action', () => {
      engine.registerMotions({
        test: { dt: [500, 2000, 500], vs: { mouthSmile: [0.5] }, _track: 'action' },
      });
      engine.play('test');
      expect(engine.tracks.action.active).toBe(true);

      engine.stop();
      expect(engine.tracks.action.active).toBe(false);
      expect(head.stopGesture).toHaveBeenCalled();
    });

    it('clears overlay timer on interrupt', () => {
      engine.registerMotions({
        overlay_action: {
          dt: [500, 2000, 500],
          vs: { mouthSmile: [0.5] },
          _track: 'action',
          _overlay: { bones: {}, duration: 2000, delay: 100 },
        },
      });
      engine.play('overlay_action');
      expect(engine.tracks.action.overlayTimer).not.toBeNull();

      engine.stop();
      expect(engine.tracks.action.overlayTimer).toBeNull();
    });
  });

  describe('playSequence', () => {
    it('plays all moods in sequence', async () => {
      const played = [];
      engine.onStart = (name) => played.push(name);
      engine.registerMotions({
        mood1: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'mood' },
        mood2: { dt: [500], vs: { browInnerUp: [0.8] }, _track: 'mood' },
      });

      await engine.playSequence(['mood1', 'mood2']);
      expect(played).toEqual(['mood1', 'mood2']);
    });

    it('plays mixed sequence (mood + action starts)', async () => {
      const played = [];
      engine.onStart = (name) => played.push(name);
      engine.registerMotions({
        mood1: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'mood' },
        action1: { dt: [100], vs: { mouthSmile: [0.3] }, _track: 'action' },
      });

      // Don't await — action won't resolve in test (no real timers)
      engine.playSequence(['mood1', 'action1']);
      // mood1 plays immediately (sync), then action1 starts
      await vi.waitFor(() => {
        expect(played).toContain('mood1');
        expect(played).toContain('action1');
      });
    });

    it('starts action sequence correctly', async () => {
      engine.registerMotions({
        action1: { dt: [100], vs: { mouthSmile: [0.5] }, _track: 'action' },
      });

      engine.playSequence(['action1']);
      expect(engine.tracks.action.active).toBe(true);
      expect(engine.tracks.action.name).toBe('action1');
    });

    it('stop() cancels remaining sequence items', async () => {
      const played = [];
      engine.onStart = (name) => played.push(name);
      engine.registerMotions({
        mood1: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'mood' },
        mood2: { dt: [500], vs: { browInnerUp: [0.8] }, _track: 'mood' },
      });

      // Start sequence, then stop before second item
      const seqPromise = engine.playSequence(['mood1', 'mood2']);
      // mood1 plays synchronously, now stop before mood2
      engine.stop();
      await seqPromise;
      // mood1 played, mood2 should be skipped
      expect(played).toEqual(['mood1']);
    });
  });

  // ===========================================================================
  // Native mood delegation
  // ===========================================================================

  describe('native mood delegation', () => {
    it('calls setMood for custom mood motions', async () => {
      engine.registerMotions({
        thinking: { dt: [500, 2000, 500], vs: { browInnerUp: [0.7] }, _track: 'mood' },
      });
      await engine.play('thinking');
      expect(head.setMood).toHaveBeenCalledWith('thinking');
    });

    it('calls setMood for TH-native moods', async () => {
      await engine.play('happy');
      expect(head.setMood).toHaveBeenCalledWith('happy');
    });

    it('calls setMood for metadata-only mood entries', async () => {
      engine.registerMotions({
        sleep: { _track: 'mood', _description: 'Deep sleep' },
      });
      await engine.play('sleep');
      expect(engine.tracks.mood.active).toBe(true);
      expect(head.setMood).toHaveBeenCalledWith('sleep');
    });

    it('falls back to neutral if setMood throws', async () => {
      head.setMood.mockImplementation((name) => {
        if (name === 'broken_mood') throw new Error('Unknown mood.');
      });
      engine.registerMotions({
        broken_mood: { dt: [500], vs: { browInnerUp: [0.5] }, _track: 'mood' },
      });
      // Remove the injected animMood to simulate failure
      delete head.animMoods.broken_mood;
      await engine.play('broken_mood');
      expect(head.setMood).toHaveBeenCalledWith('neutral');
    });

    it('does not apply mood morphs when no mood is active', () => {
      engine.update(16);
      expect(head.mtAvatar.browInnerUp.newvalue).toBe(0);
    });

    it('mood switching delegates entirely to TH setMood', async () => {
      engine.registerMotions({
        mood_a: { dt: [500], vs: { browInnerUp: [0.8] }, _track: 'mood' },
        mood_b: { dt: [500], vs: { eyeSquintLeft: [0.5] }, _track: 'mood' },
      });

      await engine.play('mood_a');
      expect(head.setMood).toHaveBeenCalledWith('mood_a');

      await engine.play('mood_b');
      expect(head.setMood).toHaveBeenCalledWith('mood_b');
      // TH's setMood handles clearing old baselines natively
    });
  });

  // ===========================================================================
  // Render loop
  // ===========================================================================

  describe('update', () => {
    it('calls overlay manager update', () => {
      // update() should not throw when called without active moods
      engine.update(16);
    });
  });

  // ===========================================================================
  // getRegisteredMotions
  // ===========================================================================

  describe('getRegisteredMotions', () => {
    it('returns the internal motions dict', () => {
      engine.registerMotions({
        test: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'action' },
      });
      const motions = engine.getRegisteredMotions();
      expect(motions).toHaveProperty('test');
      expect(motions.test.dt).toEqual([500]);
    });
  });

  // ===========================================================================
  // Face Mirror integration
  // ===========================================================================

  describe('mirror integration', () => {
    it('update() ticks mirror when present', () => {
      const mockMirror = { update: vi.fn() };
      engine._mirror = mockMirror;
      engine.update(16);
      expect(mockMirror.update).toHaveBeenCalledWith(16);
    });

    it('update() works without mirror', () => {
      expect(engine._mirror).toBeNull();
      engine.update(16); // should not throw
    });

    it('stopMirror() disposes and nulls mirror', () => {
      const mockMirror = { stop: vi.fn(), dispose: vi.fn() };
      engine._mirror = mockMirror;
      engine.stopMirror();
      expect(mockMirror.stop).toHaveBeenCalled();
      expect(mockMirror.dispose).toHaveBeenCalled();
      expect(engine._mirror).toBeNull();
    });

    it('stopMirror() is safe when no mirror', () => {
      engine.stopMirror(); // should not throw
      expect(engine._mirror).toBeNull();
    });

    it('pauseMirror() delegates to mirror', () => {
      const mockMirror = { pause: vi.fn() };
      engine._mirror = mockMirror;
      engine.pauseMirror();
      expect(mockMirror.pause).toHaveBeenCalled();
    });

    it('resumeMirror() delegates to mirror', () => {
      const mockMirror = { resume: vi.fn() };
      engine._mirror = mockMirror;
      engine.resumeMirror();
      expect(mockMirror.resume).toHaveBeenCalled();
    });

    it('mirror getter returns internal mirror', () => {
      expect(engine.mirror).toBeNull();
      const mockMirror = {};
      engine._mirror = mockMirror;
      expect(engine.mirror).toBe(mockMirror);
    });

    it('startMirror() loads classifiers from registered motions', async () => {
      // Register motions with _detect
      engine.registerMotions({
        happy: {
          _track: 'mood',
          _detect: { mouthSmileLeft: 0.5, mouthSmileRight: 0.5 },
          dt: [500],
          vs: { mouthSmile: [0.6] },
        },
        sad: {
          _track: 'mood',
          _detect: { mouthFrownLeft: 0.3 },
          dt: [500],
          vs: {},
        },
      });

      // Mock FaceMirror's init (avoid real MediaPipe load)
      const initSpy = vi.spyOn(FaceMirror.prototype, 'init').mockResolvedValue();
      const loadSpy = vi.spyOn(FaceMirror.prototype, 'loadMotions');

      const videoEl = {};
      await engine.startMirror(videoEl);

      expect(loadSpy).toHaveBeenCalled();
      expect(initSpy).toHaveBeenCalled();
      expect(engine._mirror).toBeInstanceOf(FaceMirror);
      expect(engine._mirror._active).toBe(true);

      initSpy.mockRestore();
      loadSpy.mockRestore();
    });
  });

  // ===========================================================================
  // Callbacks
  // ===========================================================================

  describe('callbacks', () => {
    it('fires onStart when playing', async () => {
      const onStart = vi.fn();
      engine.onStart = onStart;
      engine.registerMotions({
        mood_test: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'mood' },
      });

      await engine.play('mood_test');
      expect(onStart).toHaveBeenCalledWith('mood_test');
    });

    it('fires onError for unknown motions', () => {
      const onError = vi.fn();
      engine.onError = onError;

      engine.play('nonexistent_motion');
      expect(onError).toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // playMoodAttenuated (empathic API)
  // ===========================================================================

  describe('playMoodAttenuated', () => {
    it('creates _empathic_* animMood at correct intensity', () => {
      engine.playMoodAttenuated('happy', 0.3);
      const empathic = head.animMoods['_empathic_happy'];
      expect(empathic).toBeDefined();
      // happy baseline: { mouthSmile: 0.2, eyesLookDown: 0.1 }
      expect(empathic.baseline.mouthSmile).toBeCloseTo(0.06, 4);
      expect(empathic.baseline.eyesLookDown).toBeCloseTo(0.03, 4);
    });

    it('calls setMood with _empathic_* name', () => {
      engine.playMoodAttenuated('happy', 0.3);
      expect(head.setMood).toHaveBeenCalledWith('_empathic_happy');
    });

    it('cleans up previous empathic mood', () => {
      engine.playMoodAttenuated('happy', 0.3);
      expect(head.animMoods['_empathic_happy']).toBeDefined();

      engine.playMoodAttenuated('neutral', 0.2);
      expect(head.animMoods['_empathic_happy']).toBeUndefined();
      expect(head.animMoods['_empathic_neutral']).toBeDefined();
    });

    it('updates mood track state', () => {
      engine.playMoodAttenuated('happy', 0.3);
      expect(engine.tracks.mood.active).toBe(true);
      expect(engine.tracks.mood.name).toBe('_empathic_happy');
    });

    it('copies neutral anims into empathic mood', () => {
      engine.playMoodAttenuated('happy', 0.3);
      const empathic = head.animMoods['_empathic_happy'];
      expect(empathic.anims).toHaveLength(2);
      expect(empathic.anims[0].name).toBe('breathing');
    });

    it('does nothing if source mood not found', () => {
      engine.playMoodAttenuated('nonexistent', 0.3);
      expect(head.setMood).not.toHaveBeenCalled();
    });
  });

  // ===========================================================================
  // setHeadPose (empathic API)
  // ===========================================================================

  describe('setHeadPose', () => {
    it('sets morph target values for head rotation', () => {
      engine.setHeadPose(0.1, -0.05, 0.02);
      expect(head.mtAvatar.headRotateX.newvalue).toBe(0.1);
      expect(head.mtAvatar.headRotateX.needsUpdate).toBe(true);
      expect(head.mtAvatar.headRotateY.newvalue).toBe(-0.05);
      expect(head.mtAvatar.headRotateY.needsUpdate).toBe(true);
      expect(head.mtAvatar.headRotateZ.newvalue).toBe(0.02);
      expect(head.mtAvatar.headRotateZ.needsUpdate).toBe(true);
    });

    it('handles missing morph targets gracefully', () => {
      head.mtAvatar = {};
      engine.setHeadPose(0.1, 0.1, 0.1); // should not throw
    });

    it('handles null mtAvatar gracefully', () => {
      head.mtAvatar = null;
      engine.setHeadPose(0.1, 0.1, 0.1); // should not throw
    });
  });

  // ===========================================================================
  // startMirror empathic mode
  // ===========================================================================

  describe('startMirror empathic mode', () => {
    let initSpy, loadSpy;

    beforeEach(() => {
      initSpy = vi.spyOn(FaceMirror.prototype, 'init').mockResolvedValue();
      loadSpy = vi.spyOn(FaceMirror.prototype, 'loadMotions');
    });

    afterEach(() => {
      initSpy.mockRestore();
      loadSpy.mockRestore();
    });

    it('defaults to mirror mode', async () => {
      await engine.startMirror({});
      expect(engine._mirror.opt.mode).toBe('mirror');
      expect(engine._mirror.onMood).toBeTypeOf('function');
    });

    it('empathic mode wires onReaction', async () => {
      await engine.startMirror({}, { mode: 'empathic' });
      expect(engine._mirror.opt.mode).toBe('empathic');
      expect(engine._mirror.onReaction).toBeTypeOf('function');
      expect(engine._mirror.onValues).toBeTypeOf('function');
    });

    it('mirror mode does not wire onReaction', async () => {
      await engine.startMirror({});
      expect(engine._mirror.onReaction).toBeNull();
    });

    it('passes custom options through', async () => {
      await engine.startMirror({}, { threshold: 0.5, cooldown: 1000 });
      expect(engine._mirror.opt.threshold).toBe(0.5);
      expect(engine._mirror.opt.cooldown).toBe(1000);
    });
  });

  // ===========================================================================
  // stopMirror cleanup
  // ===========================================================================

  describe('stopMirror cleanup', () => {
    it('cleans up _empathic_* animMood entries', () => {
      head.animMoods['_empathic_happy'] = { baseline: {}, speech: {}, anims: [] };
      head.animMoods['_empathic_sad'] = { baseline: {}, speech: {}, anims: [] };
      const mockMirror = { stop: vi.fn(), dispose: vi.fn() };
      engine._mirror = mockMirror;

      engine.stopMirror();
      expect(head.animMoods['_empathic_happy']).toBeUndefined();
      expect(head.animMoods['_empathic_sad']).toBeUndefined();
      // Regular moods should be preserved
      expect(head.animMoods['happy']).toBeDefined();
    });

    it('resets head pose to zero', () => {
      head.mtAvatar.headRotateX.newvalue = 0.1;
      head.mtAvatar.headRotateY.newvalue = -0.05;
      const mockMirror = { stop: vi.fn(), dispose: vi.fn() };
      engine._mirror = mockMirror;

      engine.stopMirror();
      expect(head.mtAvatar.headRotateX.newvalue).toBe(0);
      expect(head.mtAvatar.headRotateY.newvalue).toBe(0);
      expect(head.mtAvatar.headRotateZ.newvalue).toBe(0);
    });
  });
});

// =============================================================================
// handleTranscript — speech-driven routing
// =============================================================================

describe('handleTranscript', () => {
  let head, engine, playSpy, exprSpy;

  beforeEach(() => {
    head = createMockHead();
    engine = new MotionEngine(head);
    // Only BODY gestures live in motions now; emotions/facial-actions are FACS.
    engine.registerMotions({
      wave_right: { _track: 'action', dt: [300, 1000, 300], vs: {} },
      wave_left: { _track: 'action', dt: [300, 1000, 300], vs: {} },
      celebrate: { _track: 'action', dt: [300, 1000, 300], vs: {} },
    });
    // Spy on both destinations so we can assert which subsystem a channel hits.
    playSpy = vi.spyOn(engine, 'play').mockResolvedValue();
    exprSpy = vi.spyOn(engine, 'expr');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('routes an emotion emoji to the FACS compositor (😊 → expr happy)', () => {
    engine.handleTranscript('😊 hello');
    expect(exprSpy).toHaveBeenCalledWith('happy', undefined);
    expect(playSpy).not.toHaveBeenCalled();
  });

  it('routes a body-gesture emoji to a motion, every occurrence (👋 → play wave_right)', () => {
    engine.handleTranscript('👋 hi 👋 bye');
    expect(playSpy).toHaveBeenNthCalledWith(1, 'wave_right');
    expect(playSpy).toHaveBeenNthCalledWith(2, 'wave_right');
    expect(exprSpy).not.toHaveBeenCalled();
  });

  it('mixes a FACS emotion and a body gesture in one chunk (😊 👋)', () => {
    engine.handleTranscript('😊 hi 👋');
    expect(exprSpy).toHaveBeenCalledWith('happy', undefined);
    expect(playSpy).toHaveBeenCalledWith('wave_right');
  });

  it('splits an array-valued emoji across subsystems (🥳 → celebrate motion + happy FACS)', () => {
    engine.handleTranscript('🥳 we did it');
    expect(playSpy).toHaveBeenCalledWith('celebrate');
    expect(exprSpy).toHaveBeenCalledWith('happy', undefined);
  });

  it('matches an emoji with the U+FE0F variation selector (❤️ → love, FACS)', () => {
    engine.handleTranscript('I love this ❤️');
    expect(exprSpy).toHaveBeenCalledWith('love', undefined);
  });

  it('routes a ::name:: gesture marker to a motion', () => {
    engine.handleTranscript('look ::wave_left:: now');
    expect(playSpy).toHaveBeenCalledWith('wave_left');
  });

  it('routes a ::name:: facial marker to FACS (::look_left:: → gaze)', () => {
    engine.handleTranscript('over there ::look_left::');
    expect(exprSpy).toHaveBeenCalledWith('look_left', undefined);
  });

  it('parses a [emotion:intensity] bracket into FACS', () => {
    engine.handleTranscript("that's [amused:strong] clever");
    expect(exprSpy).toHaveBeenCalledWith('amused', 'strong');
  });

  it('routes a [gesture] bracket to a motion when not a FACS name', () => {
    engine.handleTranscript('say hi [wave_right]');
    expect(playSpy).toHaveBeenCalledWith('wave_right');
    expect(exprSpy).not.toHaveBeenCalled();
  });

  it('ignores an unmapped emoji', () => {
    engine.handleTranscript('pizza 🍕 time');
    expect(playSpy).not.toHaveBeenCalled();
    expect(exprSpy).not.toHaveBeenCalled();
  });

  it('ignores an unresolvable bracket (neither FACS nor motion)', () => {
    engine.handleTranscript('see array[foobar] there');
    expect(playSpy).not.toHaveBeenCalled();
    expect(exprSpy).not.toHaveBeenCalled();
  });

  it('does nothing on empty or text-only input', () => {
    engine.handleTranscript('');
    engine.handleTranscript('plain text, no markers');
    expect(playSpy).not.toHaveBeenCalled();
    expect(exprSpy).not.toHaveBeenCalled();
  });

  it('honors a custom emoji map via setEmojiMap()', () => {
    engine.setEmojiMap({ '🔥': 'wave_right' });
    engine.handleTranscript('😊 🔥'); // 😊 no longer mapped
    expect(playSpy).toHaveBeenCalledWith('wave_right');
    expect(playSpy).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// FACS expressions — emotion name + intensity → Action Unit blend
// =============================================================================

describe('FACS expressions', () => {
  let head, engine;

  // Synthetic FACS so the resolver-math assertions don't couple to real recipe
  // calibration (which is tuned per-model and changes over time).
  const TEST_FACS = {
    au_map: {
      AU12: { mouthSmileLeft: 1, mouthSmileRight: 1 },
      AU6: { cheekSquintLeft: 1, cheekSquintRight: 1 },
    },
    intensity_words: { _default: 0.5, slight: 0.25, strong: 1.0 },
    expressions: {
      grin: { aus: { AU12: 0.8, AU6: 0.5 } },
      wink: { aus: { AU12_L: 0.8 } },
      none: { aus: {} },
    },
    aliases: { chuckles: 'grin' },
  };

  beforeEach(() => {
    head = createMockHead();
    engine = new MotionEngine(head);
    vi.spyOn(performance, 'now').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('scales AU weights by an intensity word (synthetic map)', () => {
    engine.setFacs(TEST_FACS);
    const r = engine.resolveExpression('grin', 'strong'); // AU12:0.8, AU6:0.5 @ 1.0
    expect(r.name).toBe('grin');
    expect(r.vs.mouthSmileLeft).toBeCloseTo(0.8);
    expect(r.vs.mouthSmileRight).toBeCloseTo(0.8);
    expect(r.vs.cheekSquintLeft).toBeCloseTo(0.5);
  });

  it('uses the default intensity when none is given', () => {
    engine.setFacs(TEST_FACS);
    const r = engine.resolveExpression('grin'); // AU12 0.8 @ default 0.5
    expect(r.vs.mouthSmileLeft).toBeCloseTo(0.4);
  });

  it('accepts a numeric intensity and clamps it to 1', () => {
    engine.setFacs(TEST_FACS);
    const r = engine.resolveExpression('grin', 5); // clamp 5→1 → 0.8
    expect(r.vs.mouthSmileLeft).toBeCloseTo(0.8);
  });

  it('applies a unilateral AU to one side only (contempt = AU12_L + AU14_L)', () => {
    const r = engine.resolveExpression('contempt', 'moderate');
    expect(r.vs.mouthSmileLeft).toBeGreaterThan(0);
    expect(r.vs.mouthSmileRight).toBeUndefined();
    expect(r.vs.mouthDimpleLeft).toBeGreaterThan(0);
    expect(r.vs.mouthDimpleRight).toBeUndefined();
  });

  it('resolves free-text emotion words via aliases (smirk→contempt, laughs→laugh)', () => {
    expect(engine.resolveExpression('smirk').name).toBe('contempt');
    expect(engine.resolveExpression('laughs').name).toBe('laugh');
  });

  it('returns null for an unknown or empty emotion', () => {
    expect(engine.resolveExpression('flurb')).toBeNull();
    expect(engine.resolveExpression('')).toBeNull();
  });

  it('resolves facial actions: wink (unilateral blink beat) and look_left (gaze)', () => {
    const w = engine.resolveExpression('winks'); // alias → wink
    expect(w.name).toBe('wink');
    expect(w.kind).toBe('beat');
    expect(w.vs.eyeBlinkLeft).toBeGreaterThan(0);
    expect(w.vs.eyeBlinkRight).toBeUndefined(); // unilateral (AU43_L)
    const g = engine.resolveExpression('look_left'); // gaze AU61
    expect(g.vs.eyeLookOutLeft).toBeGreaterThan(0);
    expect(g.vs.eyeLookInRight).toBeGreaterThan(0);
  });

  it('drives eye morphs via setValue (system slot), not the baseline', () => {
    engine.expr('look_left');
    for (let i = 0; i < 5; i++) engine.update(16); // into the hold
    const eyeCalls = head.setValue.mock.calls.filter(([mt]) => /^eyeLook/.test(mt));
    expect(eyeCalls.length).toBeGreaterThan(0);
    // eye morphs must NOT be written to the baseline (idle would override)
    const eyeBaseline = head.setBaselineValue.mock.calls.filter(([mt]) => /^eyeLook/.test(mt));
    expect(eyeBaseline.length).toBe(0);
  });

  it('clamps additive AU overlap on the same morph to 1', () => {
    engine.setFacs({
      au_map: { AU12: { mouthSmileLeft: 1 }, AUX: { mouthSmileLeft: 1 } },
      intensity_words: { _default: 1 },
      expressions: { test: { aus: { AU12: 0.8, AUX: 0.8 } } },
      aliases: {},
    });
    expect(engine.resolveExpression('test').vs.mouthSmileLeft).toBe(1);
  });

  it('tags recipes with kind (happy=mood, laughs→laugh=beat)', () => {
    expect(engine.resolveExpression('happy').kind).toBe('mood');
    expect(engine.resolveExpression('laughs').kind).toBe('beat');
  });

  it('expr() with a mood-kind sets the sustained mood layer', () => {
    const r = engine.expr('happy', 'moderate');
    expect(r.name).toBe('happy');
    expect(engine._moodExpr).not.toBeNull();
    expect(engine._beats).toHaveLength(0);
  });

  it('expr() with a beat-kind queues a transient beat (laughs)', () => {
    const r = engine.expr('laughs');
    expect(r.name).toBe('laugh');
    expect(engine._beats).toHaveLength(1);
    expect(engine._moodExpr).toBeNull();
  });

  it('composites the mood layer additively over the mood baseline', () => {
    engine.setFacs(TEST_FACS);
    head.mood.baseline = { mouthSmileLeft: 0.1 };
    engine.expr('grin', 'strong'); // AU12 0.8 @ 1.0 → mouthSmileLeft 0.8
    for (let i = 0; i < 40; i++) engine.update(16); // fade in to current = 1
    const last = head.setBaselineValue.mock.calls.filter(([mt]) => mt === 'mouthSmileLeft').pop();
    expect(last).toBeDefined();
    expect(last[1]).toBeCloseTo(0.9, 1); // 0.1 rest + 0.8 expression
  });

  it('a beat blooms then releases its morphs back to rest', () => {
    engine.expr('laughs'); // in250 hold1400 out500 ≈ 2150ms
    for (let i = 0; i < 5; i++) engine.update(16); // blooming
    expect(head.setBaselineValue).toHaveBeenCalled();
    head.setBaselineValue.mockClear();
    for (let i = 0; i < 200; i++) engine.update(16); // run past the beat
    expect(engine._beats).toHaveLength(0);
    expect(engine._exprMorphs.size).toBe(0);
    const released = head.setBaselineValue.mock.calls.filter(([, v]) => v === 0);
    expect(released.length).toBeGreaterThan(0);
  });

  it('expr("neutral") fades any mood layer out', () => {
    engine.expr('happy');
    for (let i = 0; i < 40; i++) engine.update(16);
    engine.expr('neutral');
    expect(engine._moodExpr.target).toBe(0);
    for (let i = 0; i < 40; i++) engine.update(16);
    expect(engine._moodExpr).toBeNull();
  });

  it('resetExpression() clears layers and releases morphs', () => {
    engine.expr('happy', 'strong');
    for (let i = 0; i < 10; i++) engine.update(16);
    engine.resetExpression();
    expect(engine._moodExpr).toBeNull();
    expect(engine._beats).toHaveLength(0);
    expect(engine._exprMorphs.size).toBe(0);
  });

  it('expr() returns null and fires onError for an unknown emotion', () => {
    const onError = vi.fn();
    engine.onError = onError;
    expect(engine.expr('flurb')).toBeNull();
    expect(onError).toHaveBeenCalled();
  });
});
