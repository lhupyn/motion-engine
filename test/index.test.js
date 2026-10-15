import { describe, it, expect, vi } from 'vitest';
import { MotionEngine } from '../src/index.js';

function fakeHead() {
  return {
    opt: { update: null },
    animEmojis: {},
    gestureTemplates: { handup: {} },
    poseDelta: { props: {} },
    mood: { baseline: {} },
    playGesture: vi.fn(),
    stopGesture: vi.fn(),
    setBaselineValue: vi.fn(),
    setValue: vi.fn(),
  };
}

describe('MotionEngine', () => {
  it('registers the gesture catalog on the avatar', () => {
    const head = fakeHead();
    const engine = new MotionEngine(head);
    expect(engine.body.names.length).toBeGreaterThan(0);
    expect(Object.keys(head.animEmojis)).toEqual(engine.body.names);
  });

  it('hooks into the render loop: a frame drives the face', () => {
    const head = fakeHead();
    const engine = new MotionEngine(head);
    engine.face.play('happy');
    head.opt.update(16);
    expect(head.setBaselineValue).toHaveBeenCalled();
  });
});
