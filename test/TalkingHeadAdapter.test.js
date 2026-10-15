import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { TalkingHeadAdapter } from '../src/TalkingHeadAdapter.js';

const require = createRequire(import.meta.url);
const read = (path) => readFileSync(path, 'utf8');

// Contract: everything the adapter touches on `head` must exist in the real
// TalkingHead source. The member list is extracted from the adapter itself, so
// a new verb is covered automatically. This is the check that mock-based tests
// can't do — a mock happily fakes members TalkingHead doesn't have.
describe('TalkingHeadAdapter contract (TalkingHead source)', () => {
  const th = read(require.resolve('talkinghead/modules/talkinghead.mjs'));
  const adapter = read(new URL('../src/TalkingHeadAdapter.js', import.meta.url));

  const members = [...new Set([...adapter.matchAll(/this\.head\.(\w+)/g)].map((m) => m[1]))];

  it('extracts the members the adapter uses', () => {
    expect(members.length).toBeGreaterThan(10);
  });

  it.each(members)('TalkingHead defines "%s"', (name) => {
    const isMethod = new RegExp(`^\\s+(async\\s+)?${name}\\s*\\(`, 'm').test(th);
    const isField = new RegExp(`this\\.${name}\\s*=[^=]`).test(th);
    expect(isMethod || isField).toBe(true);
  });

  it.each([
    'avatarIdleEyeContact',
    'avatarIdleHeadMove',
    'avatarSpeakingEyeContact',
    'avatarSpeakingHeadMove',
  ])('TalkingHead has option "%s"', (opt) => {
    expect(th).toMatch(new RegExp(`\\b${opt}\\s*:`));
  });
});

describe('TalkingHeadAdapter verbs', () => {
  const makeHead = () => ({
    animMoods: { neutral: { baseline: {}, anims: [] }, _empathic_happy: {}, _empathic_sad: {} },
    animEmojis: {},
    gestureTemplates: { handup: {}, ok: {} },
    poseTemplates: { straight: {} },
    poseDelta: { props: { 'Head.quaternion': { x: 0, y: 0, z: 0 } } },
    mtAvatar: { headRotateX: { newvalue: 0, needsUpdate: false }, mouthSmile: {} },
    mood: { baseline: { mouthSmile: 0.2 } },
    avatar: { baseline: { browInnerUp: 0.1 } },
    mtBaselineExceptions: { eyeBlinkLeft: 0 },
    mtBaselineDefault: 0,
    opt: { avatarIdleEyeContact: 0.2, avatarIdleHeadMove: 0.5, avatarSpeakingEyeContact: 0.5, avatarSpeakingHeadMove: 0.5 },
    animQueue: [{}],
    setPoseFromTemplate: vi.fn(),
  });

  it('discovers moods, poses, gestures and registered animations', () => {
    const a = new TalkingHeadAdapter(makeHead());
    a.registerAnim('nod', { dt: [100] });
    expect(a.hasMood('neutral')).toBe(true);
    expect(a.hasMood('sad')).toBe(false);
    expect(a.hasPose('straight')).toBe(true);
    expect(a.hasGesture('ok')).toBe(true);
    expect(a.hasAnim('nod')).toBe(true);
    expect(a.gestureNames()).toEqual(['handup', 'ok']);
  });

  it('removes moods by prefix only', () => {
    const head = makeHead();
    new TalkingHeadAdapter(head).removeMoodsWithPrefix('_empathic_');
    expect(Object.keys(head.animMoods)).toEqual(['neutral']);
  });

  it('resolves rest baseline with setMood() precedence', () => {
    const a = new TalkingHeadAdapter(makeHead());
    expect(a.restBaseline('mouthSmile')).toBe(0.2);   // active mood
    expect(a.restBaseline('browInnerUp')).toBe(0.1);  // avatar baseline
    expect(a.restBaseline('eyeBlinkLeft')).toBe(0);   // exception
    expect(a.restBaseline('jawOpen')).toBe(0);        // default
  });

  it('plays a pose template and records its name', () => {
    const head = makeHead();
    new TalkingHeadAdapter(head).playPoseTemplate('straight', 500);
    expect(head.poseName).toBe('straight');
    expect(head.setPoseFromTemplate).toHaveBeenCalledWith(head.poseTemplates.straight, 500);
  });

  it('sets head rotation on the morph slots', () => {
    const head = makeHead();
    new TalkingHeadAdapter(head).setHeadRotation(0.3, 0, 0);
    expect(head.mtAvatar.headRotateX).toEqual({ newvalue: 0.3, needsUpdate: true });
  });

  it('round-trips idle options and clears the animation queue', () => {
    const head = makeHead();
    const a = new TalkingHeadAdapter(head);
    const saved = a.getIdleOptions();
    a.setIdleOptions({ avatarIdleEyeContact: 0, avatarIdleHeadMove: 0 });
    expect(head.opt.avatarIdleEyeContact).toBe(0);
    a.setIdleOptions(saved);
    expect(head.opt).toMatchObject(saved);
    a.clearAnimQueue();
    expect(head.animQueue).toEqual([]);
  });

  it('exposes pose-delta props, or null without pose-delta support', () => {
    expect(new TalkingHeadAdapter(makeHead()).poseDeltaProps()).toHaveProperty('Head.quaternion');
    expect(new TalkingHeadAdapter({}).poseDeltaProps()).toBeNull();
  });
});
