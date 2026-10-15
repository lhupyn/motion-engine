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
    poseDeltaProps() { return this.props; },
  };
}

const TEST_GESTURES = {
  nod: { description: 'Nod', dt: [200, 300], vs: { headRotateX: [0.1, 0] } },
  wave: {
    description: 'Wave',
    dt: [100, [800, 1200]],
    vs: { gesture: [['handup', null, true], null] },
    overlay: { bones: { RightHand: { freq: 8, amp: [0, 0.1, 0.1] } }, delay: 100, duration: 1000 },
  },
  jump: { description: 'Jump', dt: [500], vs: {}, overlay: { bones: { Hips: { custom: 'jump' } }, duration: 500 } },
  ok: { description: 'Collides with a built-in', dt: [100], vs: {} },
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
    it('registers every gesture as a TalkingHead animation', () => {
      expect(body.names).toEqual(['nod', 'wave', 'jump']);
      expect(Object.keys(adapter.anims)).toEqual(['nod', 'wave', 'jump']);
    });

    it('skips a gesture named like a built-in (it would call itself)', () => {
      expect(adapter.anims.ok).toBeUndefined();
      expect(console.warn).toHaveBeenCalled();
    });

    it('turns null into Infinity in gesture frames (JSON has no Infinity)', () => {
      expect(adapter.anims.wave.vs.gesture).toEqual([['handup', Infinity, true], null]);
      expect(TEST_GESTURES.wave.vs.gesture[0][1]).toBeNull(); // source data untouched
    });

    it('registers only template fields', () => {
      expect(Object.keys(adapter.anims.wave).sort()).toEqual(['dt', 'vs']);
    });
  });

  describe('playback', () => {
    it('plays, fades out at the end and resolves true', async () => {
      const done = body.play('nod');
      expect(body.current).toBe('nod');
      expect(adapter.playGesture).toHaveBeenCalledWith('nod', Infinity, false, 50);
      await vi.advanceTimersByTimeAsync(500);
      expect(adapter.stopGesture).toHaveBeenCalledWith(50);
      await vi.advanceTimersByTimeAsync(100);
      expect(await done).toBe(true);
      expect(body.current).toBeNull();
    });

    it('counts a [min, max] timing as its midpoint', async () => {
      const done = body.play('wave'); // 100 + (800+1200)/2 = 1100 ms
      await vi.advanceTimersByTimeAsync(1099);
      expect(adapter.stopGesture).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(adapter.stopGesture).toHaveBeenCalled();
      body.stop();
      await done;
    });

    it('a new gesture interrupts the current one, which resolves false', async () => {
      const first = body.play('nod');
      const second = body.play('wave');
      expect(await first).toBe(false);
      expect(adapter.stopGesture).toHaveBeenCalledWith(10);
      expect(body.current).toBe('wave');
      body.stop();
      expect(await second).toBe(false);
    });

    it('unknown names resolve false without touching the avatar', async () => {
      expect(await body.play('flurb')).toBe(false);
      expect(adapter.playGesture).not.toHaveBeenCalled();
    });
  });

  describe('oscillation', () => {
    it('waits for its delay, oscillates, then zeroes the bone', () => {
      body.play('wave');
      const q = adapter.props['RightHand.quaternion'];
      body.update(50);
      expect(q.y).toBe(0); // still inside the 100 ms delay
      for (let i = 0; i < 20; i++) body.update(16);
      expect(Math.abs(q.y) + Math.abs(q.z)).toBeGreaterThan(0);
      for (let i = 0; i < 80; i++) body.update(16); // past the 1000 ms duration
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
      for (let i = 0; i < 16; i++) body.update(16); // ~mid-arc
      expect(adapter.props['Hips.position'].y).toBeGreaterThan(0.1);
      for (let i = 0; i < 20; i++) body.update(16);
      expect(adapter.props['Hips.position'].y).toBe(0);
    });
  });

  it('every gesture in gestures.json has a description and timing', () => {
    for (const [name, g] of Object.entries(GESTURES)) {
      expect(g.description, name).toBeTruthy();
      expect(g.dt, name).toBeDefined();
    }
  });
});
