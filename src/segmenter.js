// Voice models stream transcripts in fragments that rarely match sentences.
// Fragments are buffered and released one sentence at a time.

// Fragments split at word boundaries, so punctuation at the end of what has
// arrived already closes the sentence. CJK puts no space after it.
const SENTENCE_END = /[.!?…]+["'”’)\]]*(\s|$)|[。！？]+[」』”’）]*/;

// Hesitation sounds, not reactions ("oh" is one).
const FILLER = /^(m+|h+m+|u+h+|u+m+|e+h+|a+h+|e+r+)$/;

// Drops what has under two letters or is only filler ("Mm.", "Uh, um…").
function clean(segments) {
  return segments
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => {
      const words = s.toLowerCase().match(/\p{L}+/gu) || [];
      return words.join('').length >= 2 && !words.every((w) => FILLER.test(w));
    });
}

// What the streamed fragments and the final text of the same turn share; they
// can differ in spacing, punctuation and casing.
const key = (s) => s.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]/gu, '');

// Index in s just past its first n key characters.
function cutAt(s, n) {
  let i = 0;
  let k = 0;
  for (const ch of s) {
    if (k >= n) break;
    k += key(ch).length;
    i += ch.length;
  }
  return i;
}

/** @internal */
export class Segmenter {
  constructor() {
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
      const heard = key(this._heard);
      if (heard && key(text).startsWith(heard)) {
        // The unreleased sentence is taken from the final, which is the cleaner transcript.
        text = text.slice(cutAt(text, heard.length - key(this._buffer).length));
        this._buffer = '';
      }
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
    return clean(out);
  }

  /** Release an unfinished sentence, e.g. after a pause in the stream. */
  flush() {
    const out = clean([this._buffer]);
    this._buffer = '';
    return out;
  }
}
