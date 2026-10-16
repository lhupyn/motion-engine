import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Body } from '../src/body.js';
import GESTURES from '../src/gestures.json';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

// TalkingHead's built-in arm poses, read from its source.
const th = readFileSync(createRequire(import.meta.url).resolve('talkinghead/modules/talkinghead.mjs'), 'utf8');
const BUILT_IN = [
  ...th.slice(th.indexOf('this.gestureTemplates = {'), th.indexOf('this.poseDelta = {')).matchAll(/^\s+'(\w+)': \{/gm),
].map((m) => m[1]);

function fakeAdapter() {
  return {
    anims: {},
    poses: {},
    offsets: {},
    gestureNames: () => ['handup', 'ok'],
    registerAnim(name, t) {
      this.anims[name] = t;
    },
    registerPose(name, p) {
      this.poses[name] = p;
    },
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    handOver: vi.fn(),
    playAnim: vi.fn(),
    stopAnim: vi.fn(),
    setBoneOffset(bone, x, y, z) {
      this.offsets[bone] = { x, y, z };
    },
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
    clap: { description: 'Clap', dt: [500], vs: {} },
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
      expect(body.names).toEqual(['nod', 'wave', 'clap', 'shrug']);
      expect(Object.keys(adapter.anims)).toEqual([
        'nod',
        'wave',
        'wave:mirror',
        'clap',
        'clap:mirror',
        'shrug',
        'shrug:mirror',
      ]);
      expect(body.channelOf('nod')).toBe('head');
      expect(body.channelOf('wave')).toBe('hands');
    });

    it('fills gesture frames: a null duration holds (JSON has no Infinity), a missing transition is fadeIn', () => {
      expect(adapter.anims.wave.vs.gesture).toEqual([['handup', Infinity, true, 50], null]);
      expect(TEST_GESTURES.hands.wave.vs.gesture[0]).toEqual(['handup', null, true]);
    });

    it('keeps a transition set in the frame', () => {
      const a = fakeAdapter();
      new Body(a, {
        gestures: { head: {}, hands: { quick: { dt: [100], vs: { gesture: [['ok', null, false, 300]] } } } },
      });
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
      expect(adapter.playGesture).toHaveBeenCalledWith('wave');
      await vi.advanceTimersByTimeAsync(1100); // 100 + midpoint of [800, 1200]
      expect(adapter.stopGesture).toHaveBeenCalledWith(50);
      await vi.advanceTimersByTimeAsync(100);
      expect(await done).toBe(true);
      expect(body.current.hands).toBeNull();
    });

    it('a new hand gesture takes the arms over: the current one resolves false, nothing drops to the stance', async () => {
      const first = body.play('wave');
      const second = body.play('clap');
      expect(await first).toBe(false);
      expect(adapter.stopGesture).not.toHaveBeenCalled();
      expect(adapter.handOver).toHaveBeenCalledWith([], 50);
      body.stop();
      expect(adapter.stopGesture).toHaveBeenCalledWith(10);
      expect(await second).toBe(false);
    });

    it('hands over the poses the next gesture moves to, with its first transition', () => {
      const a = fakeAdapter();
      const b = new Body(a, {
        gestures: {
          head: {},
          hands: {
            one: { dt: [100, 500], vs: { gesture: [['handup', null, true], null] } },
            two: { dt: [100, 500], vs: { gesture: [['namaste', null, false, 400], ['ok', null, true], null] } },
          },
        },
      });
      b.play('one');
      b.play('two');
      expect(a.handOver).toHaveBeenCalledWith(
        [
          ['namaste', false],
          ['ok', true],
        ],
        400,
      );
      b.stop();
    });
  });

  describe('mirror', () => {
    it('plays a hand gesture with the other hand: every frame flips, current still names it', () => {
      body.play('wave', { mirror: true });
      expect(adapter.playGesture).toHaveBeenCalledWith('wave:mirror');
      expect(adapter.anims['wave:mirror'].vs.gesture[0][2]).toBe(false);
      expect(adapter.anims.wave.vs.gesture[0][2]).toBe(true);
      expect(body.current.hands).toBe('wave');
    });

    it('moves the overlay to the other side, its y and z reversed', () => {
      const at = (mirror) => {
        body.stop();
        body.play('wave', { mirror });
        for (let i = 0; i < 20; i++) body.update(16);
        return { ...adapter.offsets[mirror ? 'LeftHand' : 'RightHand'] };
      };
      const right = at(false);
      const left = at(true);
      expect(Math.abs(right.y)).toBeGreaterThan(0);
      expect(left).toEqual({ x: right.x, y: -right.y, z: -right.z });
    });

    it('hands over to a mirrored gesture with its flipped frames', () => {
      body.play('wave');
      body.play('wave', { mirror: true });
      expect(adapter.handOver).toHaveBeenLastCalledWith([['handup', false]], 50);
    });

    it('turns and tilts of a custom hand gesture go the other way', () => {
      const a = fakeAdapter();
      const vs = {
        gesture: [['handup', null, false, 300]],
        bodyRotateY: [0.1, [0.2, 0.3], null],
        headRotateZ: [-0.05],
        eyesRotateY: [0.2],
        headRotateX: [0.1],
        eyeLookInLeft: [0.5],
      };
      new Body(a, { gestures: { head: {}, hands: { turn: { dt: [100, 500], vs } } } });
      const m = a.anims['turn:mirror'].vs;
      expect(m.bodyRotateY).toEqual([-0.1, [-0.2, -0.3], null]);
      expect(m.headRotateZ).toEqual([0.05]);
      expect(m.eyesRotateY).toEqual([-0.2]);
      expect(m.headRotateX).toEqual([0.1]);
      expect(m.eyeLookInRight).toEqual([0.5]);
      expect(a.anims.turn.vs.bodyRotateY).toEqual([0.1, [0.2, 0.3], null]);
    });

    it('head movements have no side', () => {
      body.play('nod', { mirror: true });
      expect(adapter.playAnim).toHaveBeenCalledWith('nod');
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
      body.update(50);
      expect(adapter.offsets.RightHand).toBeUndefined();
      for (let i = 0; i < 20; i++) body.update(16);
      const q = adapter.offsets.RightHand;
      expect(Math.abs(q.y) + Math.abs(q.z)).toBeGreaterThan(0);
      for (let i = 0; i < 80; i++) body.update(16);
      expect(adapter.offsets.RightHand).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('stop() zeroes the bones immediately', () => {
      body.play('wave');
      for (let i = 0; i < 30; i++) body.update(16);
      body.stop();
      expect(adapter.offsets.RightHand).toEqual({ x: 0, y: 0, z: 0 });
    });

    it('stop() also clears an overlay that outlasts its gesture', async () => {
      const b = new Body(adapter, {
        gestures: {
          head: {
            sway: {
              dt: [200],
              vs: {},
              overlay: { bones: { RightHand: { freq: 8, amp: [0, 0.1, 0.1] } }, duration: 2000 },
            },
          },
          hands: {},
        },
      });
      b.play('sway');
      await vi.advanceTimersByTimeAsync(200);
      for (let i = 0; i < 20; i++) b.update(16);
      expect(b.current.head).toBeNull();
      expect(Math.abs(adapter.offsets.RightHand.y)).toBeGreaterThan(0);
      b.stop();
      expect(adapter.offsets.RightHand).toEqual({ x: 0, y: 0, z: 0 });
    });
  });

  it('gestures.json: every gesture has timing and no face morphs (the gaze may follow the head)', () => {
    const FACE = /^(mouth|eye(?!Look)|brow|cheek|jaw|nose|tongue)/;
    for (const channel of ['head', 'hands']) {
      for (const [name, g] of Object.entries(GESTURES[channel])) {
        expect(g.dt, name).toBeDefined();
        expect(
          Object.keys(g.vs).filter((k) => FACE.test(k)),
          name,
        ).toEqual([]);
      }
    }
  });

  it("gestures.json: the classifier's menu (described entries) has distinct options and no left/right pairs", () => {
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
