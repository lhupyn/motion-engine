import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Director } from '../src/director.js';

function fakes() {
  const face = {
    facs: {
      expressions: {
        neutral: { aus: {} },
        happy: { description: 'Glad', aus: { AU12: 0.5 } },
        tender: { description: 'Caring', aus: { AU1: 0.3 } },
        wink: { description: 'Playful wink', kind: 'beat', aus: { AU46: 0.7 } },
        laugh: { description: 'Laugh', kind: 'beat', aus: { AU26: 0.3 } },
        yawn: { description: 'Yawn', kind: 'beat', whileSpeaking: false, aus: { AU26: 1 } },
        look_left: { kind: 'beat', aus: { AU61: 0.5 } }, // no description → not offered
      },
    },
    current: null,
    resolve(name) {
      const e = this.facs.expressions[name];
      return e ? { name, kind: e.kind || 'mood' } : null;
    },
    play: vi.fn(function (name) {
      if (this.resolve(name).kind === 'mood') this.current = name;
    }),
  };
  const body = {
    gestures: {
      head: { nod: { description: 'Agree' } },
      hands: { wave: { description: 'Greet' }, clap: { description: 'Applaud' } },
    },
    current: { head: null, hands: null },
    play: vi.fn(),
  };
  return { face, body };
}

const choice = (choice, confidence = 0.9) => ({ type: 'choice', choice, confidence });

describe('Director', () => {
  let face, body, d;
  beforeEach(() => {
    vi.useFakeTimers();
    ({ face, body } = fakes());
    d = new Director(face, body, { cooldown: { hands: 1000 }, relaxAfter: 2000 });
  });
  afterEach(() => vi.useRealTimers());

  describe('questions', () => {
    it('offers only described items, plus none', () => {
      const q = d.questions('avatar');
      expect(Object.keys(q.expression.criteria)).toEqual(['happy', 'tender', 'wink', 'laugh', 'yawn', 'none']);
      expect(Object.keys(q.head.criteria)).toEqual(['nod', 'none']);
      expect(Object.keys(q.hands.criteria)).toEqual(['wave', 'clap', 'none']);
      expect(q.expression.criteria.happy).toBe('Glad');
    });

    it("asks the person's lines whether they are intelligible; the avatar's are not asked", () => {
      expect(d.questions('user').clear).toMatchObject({ type: 'noul' });
      expect(d.questions('avatar').clear).toBeUndefined();
    });

    it("frames the person's lines as a reaction, not a copy", () => {
      expect(d.questions('user').expression.instructions).toMatch(/reaction/);
      expect(d.questions('avatar').expression.instructions).toMatch(/while saying/);
    });
  });

  describe('apply', () => {
    it('plays a confident expression, head movement and hand gesture together', () => {
      const actions = d.apply({ expression: choice('happy'), head: choice('nod'), hands: choice('wave') }, 'avatar');
      expect(face.play).toHaveBeenCalledWith('happy');
      expect(body.play).toHaveBeenCalledWith('nod');
      expect(body.play).toHaveBeenCalledWith('wave');
      expect(actions.map((a) => a.channel)).toEqual(['face', 'head', 'hands']);
      expect(actions.every((a) => a.applied)).toBe(true);
    });

    it('a missing confidence fails the threshold', () => {
      const [a, g] = d.apply({ expression: { choice: 'happy' }, hands: { choice: 'wave', confidence: NaN } }, 'avatar');
      expect(a).toMatchObject({ applied: false, reason: 'low confidence' });
      expect(g).toMatchObject({ applied: false, reason: 'low confidence' });
    });

    it('none means no action at all', () => {
      expect(d.apply({ expression: choice('none'), head: choice('none'), hands: choice('none') }, 'avatar')).toEqual(
        [],
      );
    });

    it('ignores low confidence', () => {
      const [a, g] = d.apply({ expression: choice('happy', 0.2), hands: choice('wave', 0.3) }, 'avatar');
      expect(a).toMatchObject({ applied: false, reason: 'low confidence' });
      expect(g).toMatchObject({ applied: false, reason: 'low confidence' });
      expect(face.play).not.toHaveBeenCalled();
    });

    it('does not restart a held expression already showing', () => {
      d.apply({ expression: choice('happy') }, 'avatar');
      const [a] = d.apply({ expression: choice('happy') }, 'avatar');
      expect(a.reason).toBe('already showing');
      expect(face.play).toHaveBeenCalledTimes(1);
    });

    it('a beat marked whileSpeaking: false is skipped while TalkingHead speaks; others play over the words', () => {
      d.talking = () => true;
      expect(d.apply({ expression: choice('yawn') }, 'avatar')[0]).toMatchObject({
        applied: false,
        reason: 'avatar is speaking',
      });
      expect(d.apply({ expression: choice('laugh') }, 'avatar')[0].applied).toBe(true);
      expect(d.apply({ expression: choice('happy') }, 'avatar')[0].applied).toBe(true);
      d.talking = () => false;
      expect(d.apply({ expression: choice('yawn') }, 'avatar')[0].applied).toBe(true);
    });

    it('beats always play (a second wink is a new wink)', () => {
      d.apply({ expression: choice('wink') }, 'avatar');
      d.apply({ expression: choice('wink') }, 'avatar');
      expect(face.play).toHaveBeenCalledTimes(2);
    });

    it('one gesture per channel at a time, then a cooldown per channel', () => {
      body.current = { head: null, hands: 'clap' };
      expect(d.apply({ hands: choice('wave') }, 'avatar')[0].reason).toBe('already moving');
      expect(d.apply({ head: choice('nod') }, 'avatar')[0].applied).toBe(true);
      body.current = { head: null, hands: null };
      d.apply({ hands: choice('wave') }, 'avatar');
      vi.advanceTimersByTime(500);
      expect(d.apply({ hands: choice('clap') }, 'avatar')[0].reason).toBe('cooldown');
      vi.advanceTimersByTime(600);
      expect(d.apply({ hands: choice('clap') }, 'avatar')[0].applied).toBe(true);
    });

    it('rejects a gesture offered on the wrong channel', () => {
      expect(d.apply({ head: choice('wave') }, 'avatar')[0].reason).toBe('not in catalog');
    });

    it('no reaction at all to a garbled transcript of the person', () => {
      const actions = d.apply({ expression: choice('tender'), hands: choice('wave'), clear: { noul: 0.1 } }, 'user');
      expect(actions.map((a) => a.reason)).toEqual(['unclear transcript', 'unclear transcript']);
      expect(face.play).not.toHaveBeenCalled();
    });

    it('rejects names outside the catalog', () => {
      expect(d.apply({ expression: choice('flurb') }, 'avatar')[0].reason).toBe('not in catalog');
    });
  });

  describe('relax', () => {
    it('returns to neutral after a quiet while', () => {
      d.scheduleRelax();
      vi.advanceTimersByTime(2000);
      expect(face.play).toHaveBeenCalledWith('neutral');
    });

    it('rescheduling restarts the wait', () => {
      d.scheduleRelax();
      vi.advanceTimersByTime(1500);
      d.scheduleRelax();
      vi.advanceTimersByTime(1500);
      expect(face.play).not.toHaveBeenCalledWith('neutral');
      vi.advanceTimersByTime(500);
      expect(face.play).toHaveBeenCalledWith('neutral');
    });

    it('waits while the avatar is mid-line', () => {
      let speaking = true;
      d.busy = () => speaking;
      d.scheduleRelax();
      vi.advanceTimersByTime(4000);
      expect(face.play).not.toHaveBeenCalledWith('neutral');
      speaking = false;
      vi.advanceTimersByTime(2000);
      expect(face.play).toHaveBeenCalledWith('neutral');
    });
  });
});
