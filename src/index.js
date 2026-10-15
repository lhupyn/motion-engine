/**
 * motion-engine — expressive face and body for TalkingHead avatars.
 *
 *   const engine = new MotionEngine(head, { jev: { apiKey } });
 *   engine.feed(chunk, { speaker: 'avatar' });           // as the transcript streams
 *   engine.feed(fullText, { speaker: 'avatar', final: true });
 *
 * Text goes in; Jev decides what it means for the avatar; the face and body
 * act on it. The main LLM never has to tag its own output.
 *
 * Direct control is always available: engine.face.play('happy'),
 * engine.body.play('nod_yes').
 *
 * @module motion-engine
 */

import { TalkingHeadAdapter } from './adapter.js';
import { Face } from './face.js';
import { Body } from './body.js';
import { Director } from './director.js';
import { Segmenter } from './segmenter.js';
import { jev } from './jev.js';

/** Without a final fragment, this long without avatar text ends its turn (ms). */
const SILENCE_ENDS_TURN = 3000;

/**
 * @typedef {object} Decision
 * @property {'avatar'|'user'} speaker
 * @property {string} text
 * @property {import('./director.js').Action[]} actions - What Jev chose and what played
 * @property {object} [answers] - Raw Jev answers
 * @property {?string} [model]
 * @property {?object} [usage]  - { input_tokens, cost }
 * @property {number} [ms]      - Jev round-trip
 * @property {string} [skipped] - Why Jev was not asked
 * @property {string} [error]
 */

export class MotionEngine {
  /**
   * @param {object} head - TalkingHead instance (after showAvatar())
   * @param {object} [options]
   * @param {object} [options.jev]       - { apiKey, provider, model, url } (see jev.js)
   * @param {function} [options.classify] - Custom classifier with Jev's signature, instead of `jev`
   * @param {object} [options.face]      - Face options
   * @param {object} [options.body]      - Body options
   * @param {object} [options.director]  - Director thresholds and timings
   * @param {number} [options.pause=800] - Classify buffered text after this long without new fragments (ms)
   */
  constructor(head, { jev: jevOptions, classify, face, body, director, pause = 800 } = {}) {
    this.adapter = new TalkingHeadAdapter(head);
    this.face = new Face(this.adapter, face);
    this.body = new Body(this.adapter, body);
    this.director = new Director(this.face, this.body, director);
    this.director.busy = () => this._avatarSpeaking;
    this.classify = classify || (jevOptions ? jev(jevOptions) : null);
    this.pause = pause;

    /** Called for every line the engine handles. @type {?function(Decision):void} */
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

  /**
   * Connect (or reconnect) Jev.
   * @param {object} options - { apiKey, provider, model, url }
   */
  useJev(options) {
    this.classify = jev(options);
  }

  /**
   * Feed transcript text as it arrives.
   *
   * Fragments are grouped into sentences; each sentence is one Jev call. The
   * avatar's own lines drive its expression as it speaks. The person's lines
   * get a listening reaction — unless the avatar is already speaking, in which
   * case the reaction would come too late and Jev is not asked.
   *
   * @param {string} text
   * @param {object} [options]
   * @param {'avatar'|'user'} [options.speaker='avatar']
   * @param {boolean} [options.final=false] - Last fragment of the turn (may repeat the whole turn)
   */
  feed(text, { speaker = 'avatar', final = false } = {}) {
    if (!this.classify || !text) return;
    const seg = this._segments[speaker];
    if (!seg) throw new Error(`Unknown speaker "${speaker}" (use avatar or user)`);

    if (speaker === 'avatar') {
      // Not every provider sends a final fragment: silence also ends the turn.
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
      // Answers can return out of order; an older line must not override a newer one.
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
