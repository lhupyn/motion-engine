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
    head: { choice: 'none', confidence: 0.9 },
    hands: { choice: gesture, confidence: 0.9 },
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
    expect(Object.keys(head.animEmojis)).toHaveLength(engine.body.names.length);
    expect(head.gestureTemplates).toHaveProperty('palms_up');
  });

  it('the removed jev option fails loudly instead of doing nothing', () => {
    expect(() => new MotionEngine(fakeHead(), { jev: { apiKey: 'k' } })).toThrow(/jev option was removed.*systemOne/);
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

    it('does nothing without a classifier', () => {
      const plain = new MotionEngine(fakeHead());
      expect(() => plain.feed('Hello there.', { final: true })).not.toThrow();
    });

    it('useClassifier() sets or replaces the classifier later', async () => {
      const later = new MotionEngine(fakeHead());
      later.feed('Too early.', { final: true });
      later.useClassifier(classify);
      later.feed('Hello there.', { final: true });
      await flush();
      expect(classify).toHaveBeenCalledTimes(1);
      const other = vi.fn(async () => answer('none'));
      later.useClassifier(other);
      later.feed('And again.', { final: true });
      await flush();
      expect(other).toHaveBeenCalledTimes(1);
      expect(classify).toHaveBeenCalledTimes(1);
      later.dispose();
    });

    it('removing the classifier drops buffered text quietly', async () => {
      engine.feed('well I guess');
      engine.useClassifier(null);
      await vi.advanceTimersByTimeAsync(3000);
      expect(classify).not.toHaveBeenCalled();
      expect(decisions).toEqual([]);
    });

    it('asks the classifier once per sentence, not per fragment', async () => {
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
      expect(classify.mock.calls[1][0]).toEqual({
        speaker: 'avatar',
        text: 'Second line.',
        previous: { speaker: 'avatar', text: 'First line.' },
      });
    });

    it('says who said the previous line', async () => {
      engine.feed('I got the job.', { speaker: 'user', final: true });
      engine.feed('Wait, really? ');
      await flush();
      expect(classify.mock.calls[1][0]).toEqual({
        speaker: 'avatar',
        text: 'Wait, really?',
        previous: { speaker: 'user', text: 'I got the job.' },
      });
    });

    it('a final with no text field ends the turn instead of throwing', async () => {
      engine.feed('well I guess');
      expect(() => engine.feed(undefined, { final: true })).not.toThrow();
      await flush();
      expect(classify).toHaveBeenCalledWith(
        { speaker: 'avatar', text: 'well I guess' },
        expect.anything(),
        expect.anything(),
      );
    });

    it('silence forgets the heard text, so a later final is still deduped', async () => {
      engine.feed('Hello there. ');
      await vi.advanceTimersByTimeAsync(3000);
      engine.feed('Bye for now. ');
      engine.feed('Bye for now.', { final: true });
      await flush();
      expect(classify.mock.calls.map((c) => c[0].text)).toEqual(['Hello there.', 'Bye for now.']);
    });

    it('applies the decision and reports it', async () => {
      engine.feed('Great news!', { final: true });
      await flush();
      expect(engine.face.current).toBe('happy');
      expect(decisions[0]).toMatchObject({
        speaker: 'avatar',
        text: 'Great news!',
        model: 'jev-test',
        ms: 120,
        actions: [{ channel: 'face', name: 'happy', applied: true }],
      });
    });

    it('classifies a dangling fragment after a pause', async () => {
      engine.feed('well I guess');
      await flush();
      expect(classify).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(800);
      expect(classify).toHaveBeenCalledWith(
        { speaker: 'avatar', text: 'well I guess' },
        expect.anything(),
        expect.anything(),
      );
    });

    it('does not ask about the person while the avatar is speaking (too late)', async () => {
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
        .mockImplementationOnce(
          () =>
            new Promise((r) => {
              releaseFirst = () => r(answer('sad'));
            }),
        )
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
      classify.mockImplementation(
        (_, __, { signal }) =>
          new Promise((_, reject) => {
            signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
          }),
      );
      engine.feed('One sentence. And a half');
      await flush();
      engine.interrupt();
      await vi.advanceTimersByTimeAsync(1000);
      expect(classify).toHaveBeenCalledTimes(1);
      expect(decisions).toEqual([]);
    });

    it('an empty final releases the buffered sentence and ends the avatar turn', async () => {
      engine.feed('well I guess');
      engine.feed('', { final: true });
      await flush();
      expect(classify).toHaveBeenCalledWith(
        { speaker: 'avatar', text: 'well I guess' },
        expect.anything(),
        expect.anything(),
      );
      engine.feed('Okay go on.', { speaker: 'user', final: true });
      await flush();
      expect(decisions.at(-1)).toMatchObject({ speaker: 'user' });
      expect(decisions.at(-1).skipped).toBeUndefined();
    });

    it('empty text without final changes nothing', async () => {
      engine.feed('well I guess');
      await vi.advanceTimersByTimeAsync(500);
      engine.feed('');
      await vi.advanceTimersByTimeAsync(300);
      expect(classify).toHaveBeenCalledTimes(1);
    });

    describe('interrupt', () => {
      const pending = () => {
        const calls = [];
        classify.mockImplementation(
          (state, _, { signal }) =>
            new Promise((resolve, reject) => {
              calls.push({ state, resolve });
              signal.addEventListener('abort', () =>
                reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
              );
            }),
        );
        return calls;
      };

      it('aborts calls for avatar lines only', async () => {
        const calls = pending();
        engine.feed("I'm sad today.", { speaker: 'user', final: true });
        engine.feed('Oh no. ');
        await flush();
        expect(calls.map((c) => c.state.speaker)).toEqual(['user', 'avatar']);
        engine.interrupt();
        calls[0].resolve(answer('tender'));
        await flush();
        expect(engine.face.current).toBe('tender');
        expect(decisions).toHaveLength(1);
        expect(decisions[0]).toMatchObject({ speaker: 'user' });
      });

      it("keeps the person's buffered text", async () => {
        engine.feed('well I guess', { speaker: 'user' });
        engine.interrupt();
        await vi.advanceTimersByTimeAsync(800);
        expect(classify).toHaveBeenCalledWith(
          { speaker: 'user', text: 'well I guess' },
          expect.anything(),
          expect.anything(),
        );
      });

      it('ends the avatar turn', async () => {
        engine.feed('Let me tell you');
        engine.interrupt();
        engine.feed('Wait, stop.', { speaker: 'user', final: true });
        await flush();
        expect(decisions.at(-1).skipped).toBeUndefined();
      });

      it('drops the rest of a cut-off turn (Realtime: late delta, then the whole turn as final)', async () => {
        engine.feed('Let me tell you about');
        engine.interrupt();
        engine.feed(' my day');
        engine.feed('Let me tell you about my day. It was long.', { final: true });
        engine.feed('Sorry, go on.', { speaker: 'user', final: true });
        await flush();
        expect(classify.mock.calls.map((c) => c[0].speaker)).toEqual(['user']);
        expect(decisions.at(-1)).toMatchObject({ speaker: 'user' });
        expect(decisions.at(-1).skipped).toBeUndefined();
      });

      it('without a final, silence ends the cut and the next turn is classified', async () => {
        engine.feed('Let me tell');
        engine.interrupt();
        await vi.advanceTimersByTimeAsync(1000);
        engine.feed(' you more');
        await vi.advanceTimersByTimeAsync(2999);
        engine.feed('Still the old turn. ');
        await vi.advanceTimersByTimeAsync(3000);
        engine.feed('A new turn. ');
        await flush();
        expect(classify.mock.calls.map((c) => c[0].text)).toEqual(['A new turn.']);
      });

      it("the person's final also ends the cut: the avatar's next turn answers it", async () => {
        engine.feed('Let me tell');
        engine.interrupt();
        engine.feed('Stop.', { speaker: 'user', final: true });
        engine.feed('Okay, sorry. ');
        await flush();
        expect(classify.mock.calls.map((c) => c[0].text)).toEqual(['Stop.', 'Okay, sorry.']);
      });

      it('interrupting a quiet avatar cuts nothing', async () => {
        engine.interrupt();
        engine.feed('Hello there. ');
        await flush();
        expect(classify).toHaveBeenCalledTimes(1);
      });

      it('stops the body only if the avatar was speaking', () => {
        const stop = vi.spyOn(engine.body, 'stop');
        engine.interrupt();
        expect(stop).not.toHaveBeenCalled();
        engine.feed('Let me tell you');
        engine.interrupt();
        expect(stop).toHaveBeenCalledTimes(1);
      });

      it('drops an answer from a classifier that ignores the abort signal', async () => {
        let release;
        classify.mockImplementationOnce(
          () =>
            new Promise((r) => {
              release = () => r(answer('sad'));
            }),
        );
        engine.feed('Bad news. ');
        await flush();
        engine.interrupt();
        release();
        await flush();
        expect(engine.face.current).toBeNull();
        expect(decisions).toEqual([]);
      });
    });

    describe('dispose', () => {
      it('unhooks from the render loop and restores the app callback', () => {
        const head = fakeHead();
        const app = vi.fn();
        head.opt.update = app;
        const e = new MotionEngine(head, { classify });
        e.dispose();
        expect(head.opt.update).toBe(app);
      });

      it('stops everything and ignores later input', async () => {
        const head = fakeHead();
        const e = new MotionEngine(head, { classify });
        const stop = vi.spyOn(e.body, 'stop');
        e.onDecision = (d) => decisions.push(d);
        e.feed('Great news! And then');
        await flush();
        expect(e.face.current).toBe('happy');
        let signal;
        classify.mockImplementationOnce((_, __, opts) => {
          signal = opts.signal;
          return new Promise(() => {});
        });
        e.feed('One more. ');
        e.feed('well I guess', { speaker: 'user' });
        e.dispose();
        expect(head.opt.update).toBeNull();
        expect(e.face.current).toBeNull();
        expect(stop).toHaveBeenCalled();
        expect(signal.aborted).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        e.feed('More text.', { final: true });
        await vi.advanceTimersByTimeAsync(10000);
        expect(classify).toHaveBeenCalledTimes(2);
        expect(decisions).toHaveLength(1);
      });
    });

    it("asks TalkingHead whether it's speaking: a yawn waits, a laugh plays over the words", async () => {
      const head = fakeHead();
      const e = new MotionEngine(head, {
        classify: async (state) => answer(state.text.startsWith('Ha') ? 'laugh' : 'yawn'),
      });
      e.onDecision = (d) => decisions.push(d);
      head.isSpeaking = true;
      e.feed('So tired today. Ha, good one!', { final: true });
      await flush();
      expect(decisions.map((d) => d.actions[0])).toMatchObject([
        { name: 'yawn', applied: false, reason: 'avatar is speaking' },
        { name: 'laugh', applied: true },
      ]);
      e.dispose();
    });

    it('reports classifier errors without throwing', async () => {
      classify.mockRejectedValueOnce(new Error('System One 401: No auth'));
      engine.feed('Hello there.', { final: true });
      await flush();
      expect(decisions[0]).toMatchObject({ error: 'System One 401: No auth', actions: [] });
    });
  });
});
