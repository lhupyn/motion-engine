import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TalkingHeadAdapter } from '../src/adapter.js';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(path, 'utf8');

// Contract: everything the adapter touches on `head` must exist in the real
// TalkingHead source. The member list is extracted from the adapter itself, so
// a new verb is covered automatically. This is the check that mock-based tests
// can't do — a mock happily fakes members TalkingHead doesn't have.
describe('adapter contract (TalkingHead source)', () => {
  const th = read(require.resolve('talkinghead/modules/talkinghead.mjs'));
  const adapter = read(new URL('../src/adapter.js', import.meta.url));
  const members = [...new Set([...adapter.matchAll(/head\.(\w+)/g)].map((m) => m[1]))];

  it('extracts the members the adapter uses', () => {
    expect(members.length).toBeGreaterThan(8);
  });

  it.each(members)('TalkingHead defines "%s"', (name) => {
    const isMethod = new RegExp(`^\\s+(async\\s+)?${name}\\s*\\(`, 'm').test(th);
    const isField = new RegExp(`this\\.${name}\\s*=[^=]`).test(th);
    expect(isMethod || isField).toBe(true);
  });

  it("TalkingHead's playGesture() queues a 'lookat' anim, which the adapter drops", () => {
    const playGesture = th.slice(th.indexOf('playGesture(name'), th.indexOf('stopGesture('));
    expect(playGesture).toMatch(/this\.lookAtCamera\(/);
    expect(th).toMatch(/name:\s*'lookat'/);
    expect(th).toMatch(/\.template\.name === 'lookat'/);
  });

  it('TalkingHead copies mtLimits/mtOnchange into each morph and applies limit() every frame', () => {
    expect(th).toMatch(/limit:\s*this\.mtLimits\.hasOwnProperty\(x\)\s*\?\s*this\.mtLimits\[x\]/);
    expect(th).toMatch(/onchange:\s*this\.mtOnchange\.hasOwnProperty\(x\)\s*\?\s*this\.mtOnchange\[x\]/);
    expect(th).toMatch(/newvalue = o\.limit\(o\.value\)/);
    expect(th).toMatch(/if \( o\.onchange !== null \) o\.onchange\(newvalue\)/);
  });

  it('TalkingHead drives vowels at 0.6 and PP/FF at 0.9 (the ducking peak), and flags speech', () => {
    expect(th).toMatch(/\(viseme === 'PP' \|\| viseme === 'FF'\) \? 0\.9 : 0\.6/);
    expect(th).toMatch(/this\.isSpeaking = true/);
  });

  it('TalkingHead has the "update" frame callback option', () => {
    expect(th).toMatch(/\bupdate\s*:\s*null/);
    expect(th).toMatch(/this\.opt\.update\(\s*dt\s*\)/);
  });
});

describe('adapter verbs', () => {
  const makeHead = () => ({
    opt: { update: null },
    animEmojis: {},
    gestureTemplates: { handup: {}, ok: {} },
    poseDelta: { props: { 'Head.quaternion': { x: 0, y: 0, z: 0 } } },
    mood: { baseline: { mouthSmileLeft: 0.2 } },
    avatar: { baseline: { browInnerUp: 0.1 } },
    mtBaselineExceptions: { eyeBlinkLeft: 0 },
    mtBaselineDefault: 0,
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    setBaselineValue: vi.fn(),
    setValue: vi.fn(),
    animQueue: [],
    animFactory: (t) => ({ template: t }),
  });

  it('onFrame chains an existing update callback instead of replacing it', () => {
    const head = makeHead();
    const app = vi.fn();
    const engine = vi.fn();
    head.opt.update = app;
    new TalkingHeadAdapter(head).onFrame(engine);
    head.opt.update(16);
    expect(app).toHaveBeenCalledWith(16);
    expect(engine).toHaveBeenCalledWith(16);
  });

  it('onFrame returns an unhook that restores the previous callback', () => {
    const head = makeHead();
    const app = vi.fn();
    head.opt.update = app;
    const off = new TalkingHeadAdapter(head).onFrame(vi.fn());
    off();
    expect(head.opt.update).toBe(app);
  });

  it('the unhook leaves a callback the app installed later', () => {
    const head = makeHead();
    const off = new TalkingHeadAdapter(head).onFrame(vi.fn());
    const later = vi.fn();
    head.opt.update = later;
    off();
    expect(head.opt.update).toBe(later);
  });

  it('lists built-in gestures and registers animations', () => {
    const head = makeHead();
    const a = new TalkingHeadAdapter(head);
    a.registerAnim('nod', { dt: [100] });
    expect(a.gestureNames()).toEqual(['handup', 'ok']);
    expect(Object.values(head.animEmojis)).toEqual([{ dt: [100] }]);
  });

  it('keeps a registered animation apart from a gesture template of the same name', () => {
    const head = makeHead();
    const a = new TalkingHeadAdapter(head);
    a.registerAnim('ok', { dt: [100] });
    a.playGesture('ok');
    const [played, dur] = head.playGesture.mock.calls[0];
    expect(dur).toBe(Infinity);
    expect(played).not.toBe('ok');
    expect(head.animEmojis[played]).toEqual({ dt: [100] });
  });

  it('drops the camera look TalkingHead queues with a gesture, keeping one it started before', () => {
    const head = makeHead();
    const idle = { template: { name: 'lookat' } };
    const blink = { template: { name: 'blink' } };
    head.animQueue.push(idle, blink);
    // Like TalkingHead: replace any lookat, then queue the gesture anim.
    head.playGesture = vi.fn(() => {
      head.animQueue.splice(head.animQueue.indexOf(idle), 1);
      head.animQueue.push({ template: { name: 'lookat' } }, { template: {}, gesture: true });
    });
    const a = new TalkingHeadAdapter(head);
    a.registerAnim('wave', { dt: [100] });
    a.playGesture('wave');
    expect(head.animQueue.filter((x) => x.template.name === 'lookat')).toEqual([idle]);
    expect(head.animQueue).toContain(blink);
    expect(head.animQueue.some((x) => x.gesture)).toBe(true);
  });

  it('drops the camera look even when none was running before', () => {
    const head = makeHead();
    head.playGesture = vi.fn(() => head.animQueue.push({ template: { name: 'lookat' } }));
    new TalkingHeadAdapter(head).playGesture('wave');
    expect(head.animQueue).toEqual([]);
  });

  it('registers poses as gesture templates, kept out of gestureNames() so they can be replaced', () => {
    const head = makeHead();
    const a = new TalkingHeadAdapter(head);
    const pose = { 'LeftArm.rotation': { x: 1, y: 0, z: 0.5 } };
    a.registerPose('palm_out', pose);
    expect(Object.entries(head.gestureTemplates.palm_out)).toEqual(Object.entries(pose));
    expect(a.gestureNames()).toEqual(['handup', 'ok']);
  });

  it('hands over: bones the next poses move stay, the rest go back to the stance', () => {
    const head = makeHead();
    head.gestureTemplates.handup = {
      'LeftArm.rotation': { x: 1, y: 0, z: 1 },
      'LeftHand.rotation': { x: 0, y: 0, z: 0 },
    };
    head.gesture = { 'LeftArm.quaternion': {}, 'RightArm.quaternion': {}, 'RightHand.quaternion': {} };
    let released;
    head.stopGesture.mockImplementation(() => {
      released = Object.keys(head.gesture);
    });
    new TalkingHeadAdapter(head).handOver([['handup', true]], 300);
    expect(released).toEqual(['LeftArm.quaternion']);
    expect(head.stopGesture).toHaveBeenCalledWith(300);
  });

  it('runs a head animation untagged, so stopGesture() cannot remove it', () => {
    const head = makeHead();
    const a = new TalkingHeadAdapter(head);
    a.registerAnim('nod', { dt: [100] });
    a.playAnim('nod');
    expect(head.animQueue).toHaveLength(1);
    expect(head.animQueue[0].gesture).toBeUndefined();
    a.stopAnim('nod');
    expect(head.animQueue).toEqual([]);
  });

  it('resolves rest baseline with setMood() precedence', () => {
    const a = new TalkingHeadAdapter(makeHead());
    expect(a.restBaseline('mouthSmileLeft')).toBe(0.2); // active mood
    expect(a.restBaseline('browInnerUp')).toBe(0.1); // avatar baseline
    expect(a.restBaseline('eyeBlinkLeft')).toBe(0); // exception
    expect(a.restBaseline('jawOpen')).toBe(0); // default
  });

  it('shows expression morphs above rest: gaze and blink in the system slot, the rest as baseline', () => {
    const head = makeHead();
    const a = new TalkingHeadAdapter(head);
    a.setExpressionMorph('mouthSmileLeft', 0.5);
    a.setExpressionMorph('eyeBlinkLeft', 0.4);
    expect(head.setBaselineValue).toHaveBeenCalledWith('mouthSmileLeft', 0.7);
    expect(head.setValue).toHaveBeenCalledWith('eyeBlinkLeft', 0.4, 200);
    a.releaseMorph('mouthSmileLeft');
    a.releaseMorph('eyeBlinkLeft');
    expect(head.setBaselineValue).toHaveBeenLastCalledWith('mouthSmileLeft', 0.2);
    expect(head.setBaselineValue).toHaveBeenCalledTimes(2);
  });

  it('offsets a bone through its pose delta; bones without one, or no pose deltas at all, are ignored', () => {
    const head = makeHead();
    const a = new TalkingHeadAdapter(head);
    a.setBoneOffset('Head', 0.1, 0.2, 0.3);
    expect(head.poseDelta.props['Head.quaternion']).toEqual({ x: 0.1, y: 0.2, z: 0.3 });
    expect(() => a.setBoneOffset('Tail', 1, 1, 1)).not.toThrow();
    expect(() => new TalkingHeadAdapter({}).setBoneOffset('Head', 1, 1, 1)).not.toThrow();
  });

  describe('duckMouth', () => {
    // A stand-in for TalkingHead's morph table after showAvatar().
    const mouthHead = () => {
      const blink = (v) => v + 1;
      const head = {
        mtLimits: { eyeBlinkLeft: blink },
        mtOnchange: {},
        mtAvatar: {},
        isSpeaking: false,
      };
      for (const n of ['mouthLowerDownLeft', 'jawOpen', 'eyeBlinkLeft', 'viseme_aa', 'viseme_PP', 'viseme_sil']) {
        head.mtAvatar[n] = { value: 0, limit: head.mtLimits[n] ?? null, onchange: null, needsUpdate: false };
      }
      return head;
    };

    it('mouth morphs drop to the floor at a full viseme, in proportion below it', () => {
      const head = mouthHead();
      new TalkingHeadAdapter(head).duckMouth(['mouthLowerDownLeft', 'jawOpen'], 0.3);
      const limit = head.mtAvatar.mouthLowerDownLeft.limit;
      expect(limit(0.5)).toBe(0.5);
      head.mtAvatar.viseme_aa.value = 0.6;
      expect(limit(0.5)).toBeCloseTo(0.15);
      head.mtAvatar.viseme_aa.value = 0.3;
      expect(limit(0.5)).toBeCloseTo(0.5 * (1 - 0.7 * 0.5));
      head.mtAvatar.viseme_aa.value = 0;
      head.mtAvatar.viseme_PP.value = 0.9;
      expect(limit(0.5)).toBeCloseTo(0.15);
    });

    it('silence is not speech', () => {
      const head = mouthHead();
      new TalkingHeadAdapter(head).duckMouth(['jawOpen'], 0);
      head.mtAvatar.viseme_sil.value = 1;
      expect(head.mtAvatar.jawOpen.limit(0.4)).toBe(0.4);
    });

    it('a viseme change re-evaluates the mouth morphs', () => {
      const head = mouthHead();
      new TalkingHeadAdapter(head).duckMouth(['mouthLowerDownLeft', 'jawOpen'], 0.3);
      head.mtAvatar.jawOpen.needsUpdate = false;
      head.mtAvatar.viseme_aa.onchange(0.6);
      expect(head.mtAvatar.jawOpen.needsUpdate).toBe(true);
      expect(head.mtAvatar.mouthLowerDownLeft.needsUpdate).toBe(true);
    });

    it('wraps hooks already there, survives an avatar reload, and removes cleanly', () => {
      const head = mouthHead();
      const theirs = vi.fn();
      head.mtOnchange.viseme_aa = theirs;
      head.mtAvatar.viseme_aa.onchange = theirs;
      head.mtLimits.jawOpen = (v) => v / 2;
      head.mtAvatar.jawOpen.limit = head.mtLimits.jawOpen;
      const off = new TalkingHeadAdapter(head).duckMouth(['jawOpen'], 0);

      head.mtAvatar.viseme_aa.onchange(0.6);
      expect(theirs).toHaveBeenCalledWith(0.6);
      head.mtAvatar.viseme_aa.value = 0.3;
      expect(head.mtAvatar.jawOpen.limit(0.8)).toBeCloseTo(0.4 * 0.5);
      // showAvatar() copies mtLimits into the new morph table.
      expect(head.mtLimits.jawOpen).toBe(head.mtAvatar.jawOpen.limit);
      expect(head.mtLimits.eyeBlinkLeft).toBe(head.mtAvatar.eyeBlinkLeft.limit);

      off();
      expect(head.mtLimits.jawOpen(0.8)).toBe(0.4);
      expect(head.mtAvatar.jawOpen.limit).toBe(head.mtLimits.jawOpen);
      expect(head.mtAvatar.viseme_aa.onchange).toBe(theirs);
      expect(head.mtOnchange.viseme_aa).toBe(theirs);
      expect(head.mtOnchange.viseme_PP).toBeUndefined();
    });

    it('does nothing on a head without a morph table', () => {
      expect(() => new TalkingHeadAdapter(makeHead()).duckMouth(['jawOpen'], 0.3)()).not.toThrow();
    });

    it('reports whether TalkingHead is speaking', () => {
      const head = mouthHead();
      const a = new TalkingHeadAdapter(head);
      expect(a.isSpeaking()).toBe(false);
      head.isSpeaking = true;
      expect(a.isSpeaking()).toBe(true);
    });
  });
});
