import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Face } from '../src/face.js';
import { TalkingHeadAdapter } from '../src/adapter.js';

/** The real adapter over a stand-in avatar that records every morph write; `rest` is its mood baseline. */
function fakeAdapter(rest = {}) {
  const baseline = {};
  const system = {};
  const adapter = new TalkingHeadAdapter({
    mood: { baseline: rest },
    setBaselineValue: (mt, v) => {
      baseline[mt] = v;
    },
    setValue: (mt, v) => {
      system[mt] = v;
    },
  });
  return Object.assign(adapter, { baseline, system });
}

// Synthetic data so the math doesn't couple to per-model calibration.
const TEST_FACS = {
  au_map: {
    AU12: { mouthSmileLeft: 1, mouthSmileRight: 1 },
    AU6: { cheekSquintLeft: 1, cheekSquintRight: 1 },
    AU61: { eyeLookOutLeft: 1, eyeLookInRight: 1 },
    AU26: { jawOpen: 0.7 },
    AU19: { tongueOut: 1 },
    AU25: { mouthLowerDownLeft: 0.5 },
  },
  expressions: {
    neutral: { aus: {} },
    grin: { aus: { AU12: 0.8, AU6: 0.5 } },
    smirk: { aus: { AU12_L: 0.6 } },
    cheeky: { aus: { AU6: 0.4 } },
    overlap: { aus: { AU12: 0.8, AU6: 0.8 } },
    glance: { kind: 'beat', aus: { AU61: 0.7 }, envelope: { in: 100, hold: 200, out: 100 } },
    tongue: {
      kind: 'beat',
      aus: { AU19: 0.8, AU25: 0.6 },
      envelope: { in: 150, hold: 700, out: 300 },
      offset: { AU19: 150 },
    },
  },
};

const run = (face, ms, step = 16) => {
  for (let t = 0; t < ms; t += step) face.update(step);
};

describe('Face', () => {
  let adapter, face;
  beforeEach(() => {
    adapter = fakeAdapter({ mouthSmileLeft: 0.1 });
    face = new Face(adapter, { facs: TEST_FACS, fade: 400 });
  });

  describe('resolve', () => {
    it('turns AU weights into blendshape weights', () => {
      const r = face.resolve('grin');
      expect(r).toMatchObject({ name: 'grin', kind: 'mood' });
      expect(r.vs).toEqual({ mouthSmileLeft: 0.8, mouthSmileRight: 0.8, cheekSquintLeft: 0.5, cheekSquintRight: 0.5 });
    });

    it('applies a unilateral AU to one side only', () => {
      expect(face.resolve('smirk').vs).toEqual({ mouthSmileLeft: 0.6 });
    });

    it('tags beats and keeps their envelope', () => {
      expect(face.resolve('glance')).toMatchObject({ kind: 'beat', envelope: { in: 100, hold: 200, out: 100 } });
    });

    it('returns null for names outside the catalog', () => {
      expect(face.resolve('flurb')).toBeNull();
    });
  });

  describe('moods', () => {
    it('fade in on top of the rest level', () => {
      expect(face.play('grin')).toBe(true);
      run(face, 200);
      expect(adapter.baseline.mouthSmileLeft).toBeGreaterThan(0.1);
      expect(adapter.baseline.mouthSmileLeft).toBeLessThan(0.9);
      run(face, 400);
      expect(adapter.baseline.mouthSmileLeft).toBeCloseTo(0.9); // 0.1 rest + 0.8
    });

    it('cross-fade: the old expression fades out while the new one fades in', () => {
      face.play('grin');
      run(face, 600);
      face.play('smirk');
      run(face, 200); // halfway
      expect(adapter.baseline.mouthSmileRight).toBeGreaterThan(0); // grin still fading out
      expect(adapter.baseline.mouthSmileRight).toBeLessThan(0.8);
      run(face, 400);
      expect(adapter.baseline.mouthSmileRight).toBe(0); // released to rest
      expect(adapter.baseline.mouthSmileLeft).toBeCloseTo(0.7); // 0.1 rest + 0.6 smirk
    });

    it('neutral fades the held expression out and releases its morphs', () => {
      face.play('grin');
      run(face, 600);
      face.play('neutral');
      run(face, 600);
      expect(adapter.baseline.mouthSmileLeft).toBe(0.1);
      expect(adapter.baseline.cheekSquintLeft).toBe(0);
    });

    it('clamps overlapping weights to 1', () => {
      face.facs = { ...TEST_FACS, au_map: { AU12: { mouthSmileLeft: 1 }, AU6: { mouthSmileLeft: 1 } } };
      expect(face.resolve('overlap').vs.mouthSmileLeft).toBe(1);
    });
  });

  describe('beats', () => {
    it('hold every morph exactly while alive, even at 0, then settle one frame before letting go', () => {
      const set = vi.spyOn(adapter, 'setExpressionMorph');
      const release = vi.spyOn(adapter, 'releaseMorph');
      const tongue = () => set.mock.calls.filter(([mt]) => mt === 'tongueOut');
      face.play('tongue'); // 150/700/300, AU19 offset 150: the tongue is at 0 for its first and last 150 ms
      face.update(16);
      expect(tongue().at(-1)).toEqual(['tongueOut', 0, true]);
      run(face, 1150 - 16 - 16); // last frame of the beat: the tongue's ramp is already over
      expect(tongue().at(-1)).toEqual(['tongueOut', 0, true]);
      expect(release).not.toHaveBeenCalledWith('tongueOut');
      face.update(16); // the beat is gone: one exact frame at rest
      expect(tongue().at(-1)).toEqual(['tongueOut', 0, true]);
      expect(release).not.toHaveBeenCalledWith('tongueOut');
      face.update(16);
      expect(release).toHaveBeenCalledWith('tongueOut');
    });

    it('are written exactly, without TalkingHead easing; a mood alone is eased', () => {
      const set = vi.spyOn(adapter, 'setExpressionMorph');
      face.play('grin');
      face.update(16);
      expect(set).toHaveBeenCalledWith('mouthSmileLeft', expect.any(Number), false);
      face.play('tongue');
      face.update(16);
      expect(set).toHaveBeenLastCalledWith('mouthLowerDownLeft', expect.any(Number), true);
      expect(set).toHaveBeenCalledWith('mouthSmileLeft', expect.any(Number), false);
      run(face, 1200);
      set.mockClear();
      face.update(16);
      expect(set.mock.calls.every(([, , exact]) => exact === false)).toBe(true);
    });

    it('drive eye morphs through the system slot, never the baseline', () => {
      face.play('glance');
      run(face, 150);
      expect(adapter.system.eyeLookOutLeft).toBeGreaterThan(0);
      expect(adapter.baseline.eyeLookOutLeft).toBeUndefined();
    });

    it('an offset AU comes out after the others and goes back before them', () => {
      face.play('tongue');
      const frames = [];
      for (let t = 16; t < 1200; t += 16) {
        face.update(16);
        frames.push({ t, tongue: adapter.baseline.tongueOut ?? 0, lips: adapter.baseline.mouthLowerDownLeft ?? 0 });
      }
      expect(frames.filter((f) => f.t < 150).every((f) => f.tongue === 0 && f.lips > 0)).toBe(true);
      expect(frames.find((f) => f.t === 304)).toMatchObject({ tongue: 0.8, lips: 0.3 });
      const tongueGone = frames.find((f) => f.t > 304 && f.tongue === 0).t;
      const lipsGone = frames.find((f) => f.t > 304 && f.lips === 0).t;
      expect(tongueGone).toBeLessThan(1000 + 16);
      expect(lipsGone - tongueGone).toBeGreaterThanOrEqual(140);
    });

    it('an offset never takes more than half the hold', () => {
      const f = new Face(adapter, {
        facs: {
          ...TEST_FACS,
          expressions: {
            blip: {
              kind: 'beat',
              aus: { AU19: 1, AU25: 1 },
              envelope: { in: 100, hold: 200, out: 100 },
              offset: { AU19: 5000 },
            },
          },
        },
      });
      f.play('blip');
      let peak = 0;
      for (let t = 0; t < 300; t += 16) {
        f.update(16);
        peak = Math.max(peak, adapter.baseline.tongueOut ?? 0);
      }
      expect(peak).toBeGreaterThan(0.9); // offset clamped to 100: up by 200 ms, down by 300
      expect(adapter.baseline.tongueOut).toBe(0);
      expect(adapter.baseline.mouthLowerDownLeft).toBeGreaterThan(0);
    });

    it('play on top of a mood and then disappear', () => {
      face.play('grin');
      face.play('glance');
      run(face, 600);
      expect(face._beats).toHaveLength(0);
      expect(adapter.baseline.mouthSmileLeft).toBeCloseTo(0.9); // the mood is untouched
    });
  });

  it('a partial envelope keeps the default for what it leaves out', () => {
    const f = new Face(adapter, {
      facs: { ...TEST_FACS, expressions: { blip: { kind: 'beat', aus: { AU6: 0.5 }, envelope: { hold: 100 } } } },
    });
    f.play('blip');
    run(f, 1200);
    expect(f._beats).toHaveLength(0);
    expect(adapter.baseline.cheekSquintLeft).toBe(0);
  });

  describe('speech', () => {
    it('hands the mouth-opening blendshapes to the lip-sync at the speechMouth floor, and takes them back on dispose', () => {
      const off = vi.fn();
      const duck = vi.spyOn(adapter, 'duckMouth').mockReturnValue(off);
      const f = new Face(adapter, { facs: TEST_FACS, speechMouth: 0.2 });
      expect(duck).toHaveBeenCalledWith(['mouthLowerDownLeft', 'jawOpen'], 0.2);
      f.dispose();
      expect(off).toHaveBeenCalled();
    });

    it('defaults to 0.3; speechMouth: 1 turns it off', () => {
      const duck = vi.spyOn(adapter, 'duckMouth');
      new Face(adapter, { facs: TEST_FACS });
      expect(duck).toHaveBeenLastCalledWith(expect.any(Array), 0.3);
      duck.mockClear();
      new Face(adapter, { facs: TEST_FACS, speechMouth: 1 });
      expect(duck).not.toHaveBeenCalled();
    });
  });

  it('reset() returns every driven morph to rest at once', () => {
    face.play('grin');
    run(face, 600);
    face.reset();
    expect(adapter.baseline.mouthSmileLeft).toBe(0.1);
    expect(adapter.baseline.cheekSquintLeft).toBe(0);
  });

  it('play() refuses names outside the catalog', () => {
    expect(face.play('flurb')).toBe(false);
  });

  it('every expression in facs.json resolves to known blendshapes', () => {
    const real = new Face(fakeAdapter());
    for (const name of real.names) {
      const r = real.resolve(name);
      if (name === 'neutral') continue;
      expect(Object.keys(r.vs).length, name).toBeGreaterThan(0);
      for (const w of Object.values(r.vs)) expect(w).toBeLessThanOrEqual(1);
    }
  });
});
