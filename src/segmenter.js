// Voice models stream transcripts in fragments that rarely match sentences.
// Fragments are buffered and released one sentence at a time.

// Fragments split at word boundaries, so punctuation at the end of what has
// arrived already closes the sentence.
const SENTENCE_END = /[.!?…]+["'”’)\]]*(\s|$)/;

const norm = (s) => s.replace(/\s+/g, ' ');

export class Segmenter {
  /** @param {{minChars?: number}} [options] - Shorter segments ("eh.", "mm") are dropped */
  constructor({ minChars = 4 } = {}) {
    this.minChars = minChars;
    this.reset();
  }

  reset() {
    this._heard = '';
    this._buffer = '';
  }

  get pending() {
    return this._buffer.trim().length > 0;
  }

  /**
   * @param {string} text
   * @param {boolean} [final=false] - Releases everything; if it repeats the whole turn, only the unheard part is used
   * @returns {string[]} Completed sentences
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

  /** Release an unfinished sentence, e.g. after a pause in the stream. */
  flush() {
    const out = this._clean([this._buffer]);
    this._buffer = '';
    return out;
  }

  _clean(segments) {
    return segments.map((s) => norm(s).trim()).filter((s) => s.length >= this.minChars);
  }
}
