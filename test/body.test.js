import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Body } from '../src/body.js';
import GESTURES from '../src/gestures.json';

function fakeAdapter() {
  return {
    anims: {},
    props: { 'RightHand.quaternion': { x: 0, y: 0, z: 0 }, 'Hips.position': { x: 0, y: 0, z: 0 } },
    gestureNames: () => ['handup', 'ok'],
    registerAnim(name, t) { this.anims[name] = t; },
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    playAnim: vi.fn(),
    stopAnim: vi.fn(),
    poseDeltaProps() { return this.props; },
  };
}

const TEST_GESTURES = {
  head: {
    nod: { description: 'Nod', dt: [200, 300], vs: { headRotateX: [0.1, 0] } },
  },
  hands: {
    wave: {
      description: 'Wave',
      dt: [100, [800, 1200]],
      vs: { gesture: [['handup', null, true], null] },
      overlay: { bones: { RightHand: { freq: 8, amp: [0, 0.1, 0.1] } }, delay: 100, duration: 1000 },
    },
    jump: { description: 'Jump', dt: [500], vs: {}, overlay: { bones: { Hips: { custom: 'jump' } }, duration: 500 } },
    ok: { description: 'Collides with a built-in', dt: [100], vs: {} },
  },
};

describe('Body', () => {
  let adapter, body;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    adapter = fakeAdapter();
    body = new Body(adapter, { gestures: TEST_GESTURES, fadeIn: 50, fadeOut: 50, cutFade: 10, settle: 100 });
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe('registration', () => {
    it('registers both channels as TalkingHead animations', () => {
      expect(body.names).toEqual(['nod', 'wave', 'jump']);
      expect(Object.keys(adapter.anims)).toEqual(['nod', 'wave', 'jump']);
      expect(body.channelOf('nod')).toBe('head');
      expect(body.channelOf('wave')).toBe('hands');
    });

    it('skips a gesture named like a built-in (it would call itself)', () => {
      expect(adapter.anims.ok).toBeUndefined();
      expect(console.warn).toHaveBeenCalled();
    });

    it('turns null into Infinity in gesture frames (JSON has no Infinity)', () => {
      expect(adapter.anims.wave.vs.gesture).toEqual([['handup', Infinity, true], null]);
      expect(TEST_GESTURES.hands.wave.vs.gesture[0][1]).toBeNull();
    });
  });

  describe('hands', () => {
    it('plays through the gesture system, fades out and resolves true', async () => {
      const done = body.play('wave');
      expect(body.current).toEqual({ head: null, hands: 'wave' });
      expect(adapter.playGesture).toHaveBeenCalledWith('wave', Infinity, false, 50);
      await vi.advanceTimersByTimeAsync(1100); // 100 + midpoint of [800, 1200]
      expect(adapter.stopGesture).toHaveBeenCalledWith(50);
      await vi.advanceTimersByTimeAsync(100);
      expect(await done).toBe(true);
      expect(body.current.hands).toBeNull();
    });

    it('a new hand gesture interrupts the current one, which resolves false', async () => {
      const first = body.play('wave');
      const second = body.play('jump');
      expect(await first).toBe(false);
      expect(adapter.stopGesture).toHaveBeenCalledWith(10);
      body.stop();
      expect(await second).toBe(false);
    });
  });

  describe('head', () => {
    it('plays as a plain animation, outside the gesture system', async () => {
      const done = body.play('nod');
      expect(adapter.playAnim).toHaveBeenCalledWith('nod');
      expect(adapter.playGesture).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(500);
      expect(await done).toBe(true);
      expect(adapter.stopGesture).not.toHaveBeenCalled();
    });

    it('runs alongside a hand gesture: neither interrupts the other', async () => {
      const wave = body.play('wave');
      const nod = body.play('nod');
      expect(body.current).toEqual({ head: 'nod', hands: 'wave' });
      await vi.advanceTimersByTimeAsync(500);
      expect(await nod).toBe(true);
      expect(body.current.hands).toBe('wave');
      body.stop('hands');
      expect(await wave).toBe(false);
    });

    it('stop("head") removes its animation and leaves the hands alone', () => {
      body.play('wave');
      body.play('nod');
      body.stop('head');
      expect(adapter.stopAnim).toHaveBeenCalledWith('nod');
      expect(body.current).toEqual({ head: null, hands: 'wave' });
    });
  });

  it('unknown names resolve false without touching the avatar', async () => {
    expect(await body.play('flurb')).toBe(false);
    expect(adapter.playGesture).not.toHaveBeenCalled();
    expect(adapter.playAnim).not.toHaveBeenCalled();
  });

  describe('oscillation', () => {
    it('waits for its delay, oscillates, then zeroes the bone', () => {
      body.play('wave');
      const q = adapter.props['RightHand.quaternion'];
      body.update(50);
      expect(q.y).toBe(0);
      for (let i = 0; i < 20; i++) body.update(16);
      expect(Math.abs(q.y) + Math.abs(q.z)).toBeGreaterThan(0);
      for (let i = 0; i < 80; i++) body.update(16);
      expect(q).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('stop() zeroes the bones immediately', () => {
      body.play('wave');
      for (let i = 0; i < 30; i++) body.update(16);
      body.stop();
      expect(adapter.props['RightHand.quaternion']).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('jump lifts the hips in an arc and lands', () => {
      body.play('jump');
      for (let i = 0; i < 16; i++) body.update(16);
      expect(adapter.props['Hips.position'].y).toBeGreaterThan(0.1);
      for (let i = 0; i < 20; i++) body.update(16);
      expect(adapter.props['Hips.position'].y).toBe(0);
    });
  });

  it('gestures.json: every gesture has a description and timing, and no face morphs', () => {
    const FACE = /^(mouth|eye|brow|cheek|jaw|nose|tongue)/;
    for (const channel of ['head', 'hands']) {
      for (const [name, g] of Object.entries(GESTURES[channel])) {
        expect(g.description, name).toBeTruthy();
        expect(g.dt, name).toBeDefined();
        expect(Object.keys(g.vs).filter((k) => FACE.test(k)), name).toEqual([]);
      }
    }
  });
});
