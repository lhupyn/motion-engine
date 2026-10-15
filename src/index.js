import { TalkingHeadAdapter } from './adapter.js';
import { Face } from './face.js';
import { Body } from './body.js';
import { Director } from './director.js';
import { Segmenter } from './segmenter.js';
import { jev } from './jev.js';

// Not every provider sends a final fragment, so silence also ends the avatar's turn.
const SILENCE_ENDS_TURN = 3000;

export class MotionEngine {
  /**
   * @param {object} head - TalkingHead instance, after showAvatar()
   * @param {object} [options]
   * @param {object} [options.jev] - { apiKey, provider, model, url }
   * @param {function} [options.classify] - Replaces Jev; same signature as jev()
   * @param {object} [options.face]
   * @param {object} [options.body]
   * @param {object} [options.director] - Thresholds and timings
   * @param {number} [options.pause=800] - Classify unfinished text after this many ms without fragments
   */
  constructor(head, { jev: jevOptions, classify, face, body, director, pause = 800 } = {}) {
    this.adapter = new TalkingHeadAdapter(head);
    this.face = new Face(this.adapter, face);
    this.body = new Body(this.adapter, body);
    this.director = new Director(this.face, this.body, director);
    this.director.busy = () => this._avatarSpeaking;
    this.classify = classify || (jevOptions ? jev(jevOptions) : null);
    this.pause = pause;
    this.onDecision = null;

    this._segments = { avatar: new Segmenter(), user: new Segmenter() };
    this._timers = {};
    this._inflight = new Set();
    this._seq = 0;
    this._applied = 0;
    this._previous = '';
    this._avatarSpeaking = false;

    this.adapter.onFrame((dt) => {
      this.body.update(dt);
      this.face.update(dt);
    });
  }

  useJev(options) {
    this.classify = jev(options);
  }

  /**
   * Feed transcript text as it arrives. Each sentence is one Jev call. Lines
   * from the person are not classified while the avatar is speaking: the
   * reaction would come too late.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {'avatar'|'user'} [options.speaker='avatar']
   * @param {boolean} [options.final=false] - Last fragment of the turn; may repeat the whole turn
   */
  feed(text, { speaker = 'avatar', final = false } = {}) {
    if (!this.classify || !text) return;
    const seg = this._segments[speaker];
    if (!seg) throw new Error(`Unknown speaker "${speaker}" (use avatar or user)`);

    if (speaker === 'avatar') {
      this._avatarSpeaking = !final;
      clearTimeout(this._timers.silence);
      if (!final) this._timers.silence = setTimeout(() => { this._avatarSpeaking = false; }, SILENCE_ENDS_TURN);
    }
    clearTimeout(this._timers[speaker]);

    for (const line of seg.push(text, final)) this._handle(line, speaker);

    if (seg.pending) {
      this._timers[speaker] = setTimeout(() => {
        for (const line of seg.flush()) this._handle(line, speaker);
      }, this.pause);
    }
    if (final) this.director.scheduleRelax();
  }

  /** The person cut the avatar off: drop pending text and calls, stop the gesture. */
  interrupt() {
    for (const c of this._inflight) c.abort();
    this._inflight.clear();
    for (const s of Object.values(this._segments)) s.reset();
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this._avatarSpeaking = false;
    this.body.stop();
  }

  async _handle(text, speaker) {
    if (speaker === 'user' && this._avatarSpeaking) {
      this._emit({ speaker, text, actions: [], skipped: 'avatar is already speaking' });
      return;
    }

    const seq = ++this._seq;
    const previous = this._previous;
    this._previous = text;
    const ctrl = new AbortController();
    this._inflight.add(ctrl);

    try {
      const state = previous ? { speaker, text, previous_line: previous } : { speaker, text };
      const r = await this.classify(state, this.director.questions(speaker), { signal: ctrl.signal });
      if (seq < this._applied) {
        this._emit({ speaker, text, ...r, actions: [], skipped: 'superseded by a newer line' });
        return;
      }
      this._applied = seq;
      const actions = this.director.apply(r.answers, speaker);
      this.director.scheduleRelax();
      this._emit({ speaker, text, ...r, actions });
    } catch (err) {
      if (err.name !== 'AbortError') this._emit({ speaker, text, actions: [], error: err.message });
    } finally {
      this._inflight.delete(ctrl);
    }
  }

  _emit(decision) {
    this.onDecision?.(decision);
  }
}

export { TalkingHeadAdapter, Face, Body, Director, Segmenter, jev };
