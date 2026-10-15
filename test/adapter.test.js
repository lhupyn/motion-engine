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
    expect(head.animEmojis.nod).toEqual({ dt: [100] });
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
    expect(a.restBaseline('browInnerUp')).toBe(0.1);    // avatar baseline
    expect(a.restBaseline('eyeBlinkLeft')).toBe(0);     // exception
    expect(a.restBaseline('jawOpen')).toBe(0);          // default
  });

  it('exposes pose-delta props, or null without pose-delta support', () => {
    expect(new TalkingHeadAdapter(makeHead()).poseDeltaProps()).toHaveProperty('Head.quaternion');
    expect(new TalkingHeadAdapter({}).poseDeltaProps()).toBeNull();
  });
});
