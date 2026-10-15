import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Body } from '../src/body.js';
import GESTURES from '../src/gestures.json';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// TalkingHead's built-in arm poses, read from its source.
const th = readFileSync(createRequire(import.meta.url).resolve('talkinghead/modules/talkinghead.mjs'), 'utf8');
const BUILT_IN = [...th.slice(th.indexOf('this.gestureTemplates = {'), th.indexOf('this.poseDelta = {')).matchAll(/^\s+'(\w+)': \{/gm)].map((m) => m[1]);

function fakeAdapter() {
  return {
    anims: {},
    poses: {},
    props: { 'RightHand.quaternion': { x: 0, y: 0, z: 0 }, 'Hips.position': { x: 0, y: 0, z: 0 } },
    gestureNames: () => ['handup', 'ok'],
    registerAnim(name, t) { this.anims[name] = t; },
    registerPose(name, p) { this.poses[name] = p; },
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    handOver: vi.fn(),
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
    shrug: { description: 'Named like a built-in pose', dt: [100], vs: {} },
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
      expect(body.names).toEqual(['nod', 'wave', 'jump', 'shrug']);
      expect(Object.keys(adapter.anims)).toEqual(['nod', 'wave', 'jump', 'shrug']);
      expect(body.channelOf('nod')).toBe('head');
      expect(body.channelOf('wave')).toBe('hands');
    });

    it('fills gesture frames: a null duration holds (JSON has no Infinity), a missing transition is fadeIn', () => {
      expect(adapter.anims.wave.vs.gesture).toEqual([['handup', Infinity, true, 50], null]);
      expect(TEST_GESTURES.hands.wave.vs.gesture[0]).toEqual(['handup', null, true]);
    });

    it('keeps a transition set in the frame', () => {
      const a = fakeAdapter();
      new Body(a, { gestures: { head: {}, hands: { quick: { dt: [100], vs: { gesture: [['ok', null, false, 300]] } } } } });
      expect(a.anims.quick.vs.gesture).toEqual([['ok', Infinity, false, 300]]);
    });
  });

  describe('poses', () => {
    const palm = { 'LeftArm.rotation': { x: 1.6, y: -0.2, z: 0.4 } };
    const withPoses = {
      head: {},
      hands: {
        stop: { description: 'Stop', dt: [100, 500], vs: { gesture: [['palm_out', null, true], null] } },
      },
      poses: { palm_out: palm, handup: palm },
    };

    it('registers catalog poses so gesture frames can use them', () => {
      const a = fakeAdapter();
      const b = new Body(a, { gestures: withPoses });
      expect(a.poses.palm_out).toEqual(palm);
      expect(b.names).toEqual(['stop']);
      expect(a.anims.stop.vs.gesture[0][0]).toBe('palm_out');
    });

    it('never replaces a TalkingHead built-in', () => {
      const a = fakeAdapter();
      new Body(a, { gestures: withPoses });
      expect(a.poses.handup).toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('"handup"'));
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

    it('a new hand gesture takes the arms over: the current one resolves false, nothing drops to the stance', async () => {
      const first = body.play('wave');
      const second = body.play('jump');
      expect(await first).toBe(false);
      expect(adapter.stopGesture).not.toHaveBeenCalled();
      expect(adapter.handOver).toHaveBeenCalledWith([], 50);
      body.stop();
      expect(adapter.stopGesture).toHaveBeenCalledWith(10);
      expect(await second).toBe(false);
    });

    it('hands over the poses the next gesture moves to, with its first transition', () => {
      const a = fakeAdapter();
      const b = new Body(a, { gestures: { head: {}, hands: {
        one: { dt: [100, 500], vs: { gesture: [['handup', null, true], null] } },
        two: { dt: [100, 500], vs: { gesture: [['namaste', null, false, 400], ['ok', null, true], null] } },
      } } });
      b.play('one');
      b.play('two');
      expect(a.handOver).toHaveBeenCalledWith([['namaste', false], ['ok', true]], 400);
      b.stop();
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

  it('gestures.json: every gesture has timing and no face morphs', () => {
    const FACE = /^(mouth|eye|brow|cheek|jaw|nose|tongue)/;
    for (const channel of ['head', 'hands']) {
      for (const [name, g] of Object.entries(GESTURES[channel])) {
        expect(g.dt, name).toBeDefined();
        expect(Object.keys(g.vs).filter((k) => FACE.test(k)), name).toEqual([]);
      }
    }
  });

  it("gestures.json: Jev's menu (described entries) has distinct options and no left/right pairs", () => {
    const menu = ['head', 'hands'].flatMap((c) => Object.entries(GESTURES[c]).filter(([, g]) => g.description));
    expect(new Set(menu.map(([, g]) => g.description)).size).toBe(menu.length);
    expect(menu.map(([name]) => name).filter((n) => /_(left|right)$/.test(n))).toEqual([]);
  });

  it('gestures.json: every hand frame uses a TalkingHead built-in or a catalog pose', () => {
    expect(BUILT_IN).toEqual(expect.arrayContaining(['handup', 'namaste', 'shrug']));
    const known = [...BUILT_IN, ...Object.keys(GESTURES.poses)];
    for (const [name, g] of Object.entries(GESTURES.hands)) {
      for (const frame of g.vs.gesture || []) if (frame) expect(known, name).toContain(frame[0]);
    }
  });

  it('gestures.json: poses only set bone rotations', () => {
    for (const [name, pose] of Object.entries(GESTURES.poses)) {
      for (const [bone, r] of Object.entries(pose)) {
        expect(bone, name).toMatch(/^(Left|Right)\w+\.rotation$/);
        for (const axis of ['x', 'y', 'z']) expect(Number.isFinite(r[axis]), `${name} ${bone}.${axis}`).toBe(true);
      }
    }
  });
});
