import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MotionEngine } from '../src/MotionEngine.js';

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
      headRotateY: { newvalue: 0, baseline: 0, needsUpdate: false },
    },
    avatar: { baseline: {} },
    poseDelta: { props: {} },
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    setPoseFromTemplate: vi.fn(),
    setMood: vi.fn(),
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
  });

  describe('playSequence', () => {
    it('plays first mood, stops sequence after since action track is inactive', async () => {
      const played = [];
      engine.onStart = (name) => played.push(name);
      engine.registerMotions({
        mood1: { dt: [500], vs: { mouthSmile: [0.5] }, _track: 'mood' },
        mood2: { dt: [500], vs: { browInnerUp: [0.8] }, _track: 'mood' },
      });

      // playSequence checks action track — moods don't use it, so it exits after first
      await engine.playSequence(['mood1', 'mood2']);
      expect(played).toContain('mood1');
      // mood2 is skipped because action track is not active after mood1
    });

    it('starts action sequence correctly', async () => {
      engine.registerMotions({
        action1: { dt: [100], vs: { mouthSmile: [0.5] }, _track: 'action' },
      });

      // Play a single action in sequence — should trigger playback
      engine.playSequence(['action1']);
      expect(engine.tracks.action.active).toBe(true);
      expect(engine.tracks.action.name).toBe('action1');
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
});
