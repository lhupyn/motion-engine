import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MotionEngine } from '../src/MotionEngine.js';
import { MotionStudio } from '../src/MotionStudio.js';

// --- TalkingHead mock ---
function createMockHead() {
  return {
    gestureTemplates: {},
    poseTemplates: {},
    moodTemplates: {},
    animEmojis: {},
    poseName: null,
    mtAvatar: {
      browInnerUp: { newvalue: 0, needsUpdate: false },
      mouthSmile: { newvalue: 0, needsUpdate: false },
      mouthSmileLeft: { newvalue: 0, needsUpdate: false },
      mouthSmileRight: { newvalue: 0, needsUpdate: false },
      eyeBlinkLeft: { newvalue: 0, needsUpdate: false },
      eyeBlinkRight: { newvalue: 0, needsUpdate: false },
      eyeSquintLeft: { newvalue: 0, needsUpdate: false },
      eyeSquintRight: { newvalue: 0, needsUpdate: false },
      cheekPuff: { newvalue: 0, needsUpdate: false },
      jawOpen: { newvalue: 0, needsUpdate: false },
    },
    poseDelta: { props: {} },
    armature: null,
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    setPoseFromTemplate: vi.fn(),
    setMood: vi.fn(),
  };
}

describe('MotionStudio', () => {
  let head, engine, studio;

  beforeEach(() => {
    head = createMockHead();
    engine = new MotionEngine(head);
    studio = new MotionStudio(engine);
    vi.spyOn(performance, 'now').mockReturnValue(0);

    // Register sample motions
    engine.registerMotions({
      wave_right: {
        dt: [300, 2500, 500],
        vs: { mouthSmile: [0.6] },
        _description: 'Friendly wave',
        _tags: ['greeting', 'friendly'],
        _track: 'action',
      },
      thinking: {
        dt: [500, 2000, 500],
        vs: { browInnerUp: [0.7] },
        _description: 'Deep thought',
        _tags: ['thinking', 'contemplation'],
        _track: 'mood',
      },
      nod_yes: {
        dt: [250, 250, 300],
        vs: { mouthSmile: [0.3] },
        _description: 'Affirmative nod',
        _tags: ['agreement', 'positive'],
        _track: 'action',
      },
    });
  });

  // ===========================================================================
  // Discovery
  // ===========================================================================

  describe('getMotions', () => {
    it('returns name, description, tags, and track', () => {
      const motions = studio.getMotions();
      expect(motions).toHaveLength(3);

      const wave = motions.find(m => m.name === 'wave_right');
      expect(wave).toBeDefined();
      expect(wave.description).toBe('Friendly wave');
      expect(wave.tags).toEqual(['greeting', 'friendly']);
      expect(wave.track).toBe('action');

      const thinking = motions.find(m => m.name === 'thinking');
      expect(thinking.track).toBe('mood');
    });
  });

  describe('getMotionNames', () => {
    it('returns all registered motion names', () => {
      const names = studio.getMotionNames();
      expect(names).toContain('wave_right');
      expect(names).toContain('thinking');
      expect(names).toContain('nod_yes');
    });
  });

  describe('getMotionsCompact', () => {
    it('groups motions by primary tag', () => {
      const compact = studio.getMotionsCompact();
      expect(compact.greeting).toContain('wave_right');
      expect(compact.thinking).toContain('thinking');
      expect(compact.agreement).toContain('nod_yes');
    });
  });

  describe('getMotionsForPrompt', () => {
    it('full: returns description per motion', () => {
      const prompt = studio.getMotionsForPrompt('full');
      expect(prompt).toContain('wave_right: Friendly wave');
      expect(prompt).toContain('thinking: Deep thought');
    });

    it('compact: groups by tag', () => {
      const prompt = studio.getMotionsForPrompt('compact');
      expect(prompt).toContain('greeting:');
      expect(prompt).toContain('wave_right');
    });

    it('minimal: comma-separated names', () => {
      const prompt = studio.getMotionsForPrompt('minimal');
      expect(prompt).toContain('wave_right');
      expect(prompt).toContain(',');
    });

    it('defaults to compact', () => {
      const prompt = studio.getMotionsForPrompt();
      expect(prompt).toContain('greeting:');
    });
  });

  describe('getAvatarCapabilities', () => {
    it('returns morph targets from whitelist', () => {
      const caps = studio.getAvatarCapabilities();
      expect(caps.morphTargets).toContain('browInnerUp');
      expect(caps.morphTargets).toContain('eyeBlinkLeft');
    });

    it('includes smile/blink morphs even outside whitelist', () => {
      const caps = studio.getAvatarCapabilities();
      expect(caps.morphTargets).toContain('mouthSmileLeft');
      expect(caps.morphTargets).toContain('mouthSmileRight');
    });

    it('respects custom whitelist', () => {
      const customStudio = new MotionStudio(engine, { morphWhitelist: ['jawOpen'] });
      const caps = customStudio.getAvatarCapabilities();
      expect(caps.morphTargets).toContain('jawOpen');
      // browInnerUp not in custom whitelist and doesn't have smile/blink in name
      expect(caps.morphTargets).not.toContain('browInnerUp');
    });

    it('returns empty bones when no armature', () => {
      const caps = studio.getAvatarCapabilities();
      expect(caps.bones).toEqual([]);
    });

    it('discovers bones from armature traverse', () => {
      const bones = [];
      head.armature = {
        traverse: (fn) => {
          [{ isBone: true, name: 'Hips' }, { isBone: true, name: 'Spine' }, { isBone: false, name: 'mesh' }]
            .forEach(fn);
        },
      };
      const caps = studio.getAvatarCapabilities();
      expect(caps.bones).toContain('Hips');
      expect(caps.bones).toContain('Spine');
      expect(caps.bones).not.toContain('mesh');
    });
  });

  describe('getLLMContext', () => {
    it('returns formatted context string', () => {
      const ctx = studio.getLLMContext();
      expect(ctx).toContain('MOTION ENGINE');
      expect(ctx).toContain('Morphs:');
      expect(ctx).toContain('Presets:');
    });
  });

  // ===========================================================================
  // Dynamic Motions
  // ===========================================================================

  describe('parseDynamic', () => {
    it('unwraps { "name": { ...motion } } wrapper', () => {
      const { name, motion } = studio.parseDynamic('{"wave": {"dt": [500], "vs": {"mouthSmile": [0.5]}}}');
      expect(name).toBe('wave');
      expect(motion.dt).toEqual([500]);
    });

    it('handles direct motion objects', () => {
      const { name, motion } = studio.parseDynamic('{"dt": [500], "vs": {"mouthSmile": [0.5]}}');
      expect(name).toMatch(/^dynamic_/);
      expect(motion.dt).toEqual([500]);
    });

    it('normalizes scalar vs values to arrays', () => {
      const { motion } = studio.parseDynamic({ dt: [500], vs: { mouthSmile: 0.8 } });
      expect(motion.vs.mouthSmile).toEqual([0.8]);
    });

    it('accepts object input (not just strings)', () => {
      const { motion } = studio.parseDynamic({ dt: [300, 1000], vs: { browInnerUp: [0.5] } });
      expect(motion.dt).toEqual([300, 1000]);
    });

    it('does not unwrap reserved keys as wrapper names', () => {
      const { name } = studio.parseDynamic('{"dt": [500]}');
      expect(name).toMatch(/^dynamic_/);
    });
  });

  describe('playDynamic', () => {
    it('parses, registers, and plays', async () => {
      const playSpy = vi.spyOn(engine, 'play').mockResolvedValue();
      const registerSpy = vi.spyOn(engine, 'registerMotions');

      await studio.playDynamic('{"custom_wave": {"dt": [500], "vs": {"mouthSmile": [0.5]}, "_track": "mood"}}');

      expect(registerSpy).toHaveBeenCalled();
      expect(playSpy).toHaveBeenCalledWith('custom_wave');
    });
  });

  describe('registerDynamic', () => {
    it('registers motion on the engine', () => {
      studio.registerDynamic('test_dynamic', { dt: [500], vs: { mouthSmile: [0.5] } });
      expect(engine.getMotionNames()).toContain('test_dynamic');
    });
  });

  // ===========================================================================
  // Aliases
  // ===========================================================================

  describe('applyMorphAliases', () => {
    it('expands aliases', () => {
      studio.setAliases({ eyesClosed: ['eyeBlinkLeft', 'eyeBlinkRight'] });
      const result = studio.applyMorphAliases({ eyesClosed: [0.8], mouthSmile: [0.5] });
      expect(result.eyeBlinkLeft).toEqual([0.8]);
      expect(result.eyeBlinkRight).toEqual([0.8]);
      expect(result.eyesClosed).toBeUndefined();
      expect(result.mouthSmile).toEqual([0.5]);
    });

    it('passes through non-aliased keys', () => {
      studio.setAliases({});
      const result = studio.applyMorphAliases({ mouthSmile: [0.5] });
      expect(result.mouthSmile).toEqual([0.5]);
    });
  });

  describe('applyBoneAliases', () => {
    it('maps bone names through aliases', () => {
      studio.setBoneAliases({ Head: 'Neck', Spine: 'Spine2' });
      const result = studio.applyBoneAliases({
        Head: { freq: 10, amp: [0.01, 0, 0.01] },
        Hips: { freq: 5, amp: [0, 0.04, 0] },
      });
      expect(result).toHaveProperty('Neck');
      expect(result).toHaveProperty('Hips');
      expect(result).not.toHaveProperty('Head');
    });
  });

  describe('registerDynamic with aliases', () => {
    it('applies morph aliases during registration', () => {
      studio.setAliases({ eyesClosed: ['eyeBlinkLeft', 'eyeBlinkRight'] });
      studio.registerDynamic('aliased_motion', {
        dt: [500],
        vs: { eyesClosed: [0.8] },
      });
      const motions = engine.getRegisteredMotions();
      expect(motions.aliased_motion.vs.eyeBlinkLeft).toEqual([0.8]);
      expect(motions.aliased_motion.vs.eyeBlinkRight).toEqual([0.8]);
    });

    it('applies bone aliases during registration', () => {
      studio.setBoneAliases({ Head: 'Neck' });
      studio.registerDynamic('bone_aliased', {
        dt: [500],
        vs: {},
        _overlay: { bones: { Head: { freq: 10, amp: [0.01, 0, 0.01] } }, duration: 1000 },
      });
      const motions = engine.getRegisteredMotions();
      expect(motions.bone_aliased._overlay.bones).toHaveProperty('Neck');
      expect(motions.bone_aliased._overlay.bones).not.toHaveProperty('Head');
    });
  });

  // ===========================================================================
  // Auto-wrap
  // ===========================================================================

  describe('wrapMorph', () => {
    it('generates a valid motion from a morph name', () => {
      const motion = studio.wrapMorph('cheekPuff');
      expect(motion.dt).toEqual([300, 1500, 500]);
      expect(motion.rescale).toEqual([0, 1, 0]);
      expect(motion.vs.cheekPuff).toEqual([0.8]);
    });

    it('respects custom intensity', () => {
      const motion = studio.wrapMorph('mouthSmile', { intensity: 0.5 });
      expect(motion.vs.mouthSmile).toEqual([0.5]);
    });

    it('respects custom timing', () => {
      const motion = studio.wrapMorph('jawOpen', { dt: [200, 1000, 200] });
      expect(motion.dt).toEqual([200, 1000, 200]);
    });
  });
});
