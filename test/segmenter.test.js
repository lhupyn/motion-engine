import { describe, it, expect } from 'vitest';
import { Segmenter } from '../src/segmenter.js';

describe('Segmenter', () => {
  it('holds fragments until a sentence ends', () => {
    const s = new Segmenter();
    expect(s.push(" I'm so")).toEqual([]);
    expect(s.push(' glad you')).toEqual([]);
    expect(s.push(' came! How')).toEqual(["I'm so glad you came!"]);
    expect(s.pending).toBe(true);
  });

  it('a fragment ending in terminal punctuation closes the sentence at once', () => {
    const s = new Segmenter();
    s.push('¡Qué buena');
    expect(s.push(' noticia!')).toEqual(['¡Qué buena noticia!']);
  });

  it('releases several sentences from one fragment', () => {
    const s = new Segmenter();
    expect(s.push('Oh no. That is awful! Are you ok? ')).toEqual(['Oh no.', 'That is awful!', 'Are you ok?']);
  });

  it('does not cut on punctuation without a following space (3.5, a URL)', () => {
    const s = new Segmenter();
    expect(s.push('It costs 3.5 euros at example.com')).toEqual([]);
    expect(s.push(' today.', true)).toEqual(['It costs 3.5 euros at example.com today.']);
  });

  it('keeps closing quotes with their sentence', () => {
    const s = new Segmenter();
    expect(s.push('She said "wow!" and left. ')).toEqual(['She said "wow!"', 'and left.']);
  });

  it('a final fragment repeating the whole turn only adds what was not heard', () => {
    const s = new Segmenter();
    expect(s.push(' Hello there. How')).toEqual(['Hello there.']);
    expect(s.push(' are you')).toEqual([]);
    expect(s.push('Hello there. How are you today?', true)).toEqual(['How are you today?']);
  });

  it('a final fragment that is just the last piece is appended', () => {
    const s = new Segmenter();
    s.push('See you');
    expect(s.push(' tomorrow', true)).toEqual(['See you tomorrow']);
  });

  it('an empty final releases what is buffered', () => {
    const s = new Segmenter();
    expect(s.push('Hello there. See you')).toEqual(['Hello there.']);
    expect(s.push('', true)).toEqual(['See you']);
    expect(s.pending).toBe(false);
  });

  it('a final without earlier fragments (plain chat) is one turn', () => {
    const s = new Segmenter();
    expect(s.push("I'm sad today. Cheer me up?", true)).toEqual(["I'm sad today.", 'Cheer me up?']);
  });

  it('starts clean after a final', () => {
    const s = new Segmenter();
    s.push('First turn.', true);
    expect(s.push('Second turn.', true)).toEqual(['Second turn.']);
  });

  it('flush() releases an unfinished sentence', () => {
    const s = new Segmenter();
    s.push('well I guess');
    expect(s.flush()).toEqual(['well I guess']);
    expect(s.pending).toBe(false);
  });

  it('drops filler too short to mean anything', () => {
    const s = new Segmenter();
    expect(s.push('Mm. Eh. Okay then. ')).toEqual(['Okay then.']);
  });
});
