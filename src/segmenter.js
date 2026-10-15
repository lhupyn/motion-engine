/**
 * Segmenter — turns a stream of transcription fragments into sentences.
 *
 * Voice models stream transcripts in fragments (" I'm so", " glad you", …) that
 * rarely line up with sentences. Classifying fragments would waste calls and
 * judge half-thoughts, so fragments are buffered and released one complete
 * sentence at a time.
 *
 * A final fragment may repeat the whole turn (Gemini Live does this); only the
 * part not heard yet is used, so nothing is classified twice.
 *
 * @module segmenter
 */

/**
 * Sentence end: terminal punctuation (plus closing quotes/brackets) followed by
 * whitespace or by the end of what has arrived. Fragments split at word
 * boundaries, so a fragment ending in "!" closes the sentence now instead of
 * waiting for the next fragment or the end of the turn.
 */
const SENTENCE_END = /[.!?…]+["'”’)\]]*(\s|$)/;

const norm = (s) => s.replace(/\s+/g, ' ');

export class Segmenter {
  /**
   * @param {object} [options]
   * @param {number} [options.minChars=4] - Shorter segments ("eh.", "mm") are dropped
   */
  constructor({ minChars = 4 } = {}) {
    this.minChars = minChars;
    this.reset();
  }

  /** Forget the current turn. */
  reset() {
    this._heard = '';
    this._buffer = '';
  }

  /** Whether text is waiting for a sentence end. */
  get pending() {
    return this._buffer.trim().length > 0;
  }

  /**
   * Add a fragment.
   * @param {string} text
   * @param {boolean} [final=false] - Last fragment of the turn: releases everything
   * @returns {string[]} Sentences completed by this fragment
   */
  push(text, final = false) {
    if (final) {
      const all = norm(text).trim();
      const heard = norm(this._heard).trim();
      if (heard && all.startsWith(heard)) text = all.slice(heard.length);
    }
    this._heard += text;
    this._buffer += text;

    const out = [];
    let m;
    while ((m = SENTENCE_END.exec(this._buffer))) {
      const cut = m.index + m[0].length;
      out.push(this._buffer.slice(0, cut));
      this._buffer = this._buffer.slice(cut);
    }
    if (final) {
      out.push(this._buffer);
      this.reset();
    }
    return this._clean(out);
  }

  /**
   * Release whatever is buffered without waiting for a sentence end (e.g. after
   * a pause in the stream).
   * @returns {string[]}
   */
  flush() {
    const out = this._clean([this._buffer]);
    this._buffer = '';
    return out;
  }

  _clean(segments) {
    return segments.map((s) => norm(s).trim()).filter((s) => s.length >= this.minChars);
  }
}
