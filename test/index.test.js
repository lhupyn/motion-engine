import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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

const answer = (expression, gesture = 'none') => ({
  answers: {
    expression: { choice: expression, confidence: 0.9 },
    gesture: { choice: gesture, confidence: 0.9 },
    clear: { noul: 0.95 },
  },
  model: 'jev-test',
  usage: { cost: 0.00002 },
  ms: 120,
});

const flush = () => vi.advanceTimersByTimeAsync(0);

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

  describe('feed', () => {
    let engine, classify, decisions;
    beforeEach(() => {
      vi.useFakeTimers();
      classify = vi.fn(async () => answer('happy'));
      engine = new MotionEngine(fakeHead(), { classify });
      decisions = [];
      engine.onDecision = (d) => decisions.push(d);
    });
    afterEach(() => {
      engine.director.dispose();
      vi.useRealTimers();
    });

    it('does nothing without a classifier (no Jev configured)', () => {
      const plain = new MotionEngine(fakeHead());
      expect(() => plain.feed('Hello there.', { final: true })).not.toThrow();
    });

    it('asks Jev once per sentence, not per fragment', async () => {
      engine.feed(" I'm so");
      engine.feed(' glad you');
      engine.feed(' came! It');
      await flush();
      expect(classify).toHaveBeenCalledTimes(1);
      expect(classify.mock.calls[0][0]).toEqual({ speaker: 'avatar', text: "I'm so glad you came!" });
    });

    it('sends the previous line as context', async () => {
      engine.feed('First line. Second line. ');
      await flush();
      expect(classify.mock.calls[1][0]).toEqual({ speaker: 'avatar', text: 'Second line.', previous_line: 'First line.' });
    });

    it('applies the decision and reports it', async () => {
      engine.feed('Great news!', { final: true });
      await flush();
      expect(engine.face.current).toBe('happy');
      expect(decisions[0]).toMatchObject({
        speaker: 'avatar', text: 'Great news!', model: 'jev-test', ms: 120,
        actions: [{ channel: 'face', name: 'happy', applied: true }],
      });
    });

    it('classifies a dangling fragment after a pause', async () => {
      engine.feed('well I guess');
      await flush();
      expect(classify).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(800);
      expect(classify).toHaveBeenCalledWith({ speaker: 'avatar', text: 'well I guess' }, expect.anything(), expect.anything());
    });

    it('does not ask Jev about the person while the avatar is speaking (too late)', async () => {
      engine.feed('Let me tell you');
      engine.feed("I'm sad.", { speaker: 'user', final: true });
      await flush();
      expect(classify).not.toHaveBeenCalled();
      expect(decisions[0]).toMatchObject({ speaker: 'user', skipped: 'avatar is already speaking' });
    });

    it('reacts to the person when the avatar is quiet', async () => {
      classify.mockResolvedValueOnce(answer('tender'));
      engine.feed("I'm sad today.", { speaker: 'user', final: true });
      await flush();
      expect(classify.mock.calls[0][0]).toEqual({ speaker: 'user', text: "I'm sad today." });
      expect(engine.face.current).toBe('tender');
    });

    it('silence ends the avatar turn even without a final fragment', async () => {
      engine.feed('Let me tell you');
      await vi.advanceTimersByTimeAsync(3000);
      engine.feed('Okay go on.', { speaker: 'user', final: true });
      await flush();
      expect(decisions.at(-1).speaker).toBe('user');
      expect(decisions.at(-1).skipped).toBeUndefined();
    });

    it('an older answer arriving late does not override a newer one', async () => {
      let releaseFirst;
      classify
        .mockImplementationOnce(() => new Promise((r) => { releaseFirst = () => r(answer('sad')); }))
        .mockImplementationOnce(async () => answer('happy'));
      engine.feed('Bad news. Good news! ');
      await flush();
      expect(engine.face.current).toBe('happy');
      releaseFirst();
      await flush();
      expect(engine.face.current).toBe('happy');
      expect(decisions.at(-1)).toMatchObject({ text: 'Bad news.', skipped: 'superseded by a newer line' });
    });

    it('relaxes to neutral after the turn', async () => {
      engine.feed('Great news!', { final: true });
      await flush();
      await vi.advanceTimersByTimeAsync(6000);
      expect(engine.face.current).toBeNull();
    });

    it('interrupt() aborts pending calls and drops buffered text', async () => {
      classify.mockImplementation((_, __, { signal }) => new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
      }));
      engine.feed('One sentence. And a half');
      await flush();
      engine.interrupt();
      await vi.advanceTimersByTimeAsync(1000);
      expect(classify).toHaveBeenCalledTimes(1);
      expect(decisions).toEqual([]);
    });

    it('reports Jev errors without throwing', async () => {
      classify.mockRejectedValueOnce(new Error('Jev 401: No auth'));
      engine.feed('Hello there.', { final: true });
      await flush();
      expect(decisions[0]).toMatchObject({ error: 'Jev 401: No auth', actions: [] });
    });
  });
});
