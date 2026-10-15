import { TalkingHeadAdapter } from './adapter.js';
import { Face } from './face.js';
import { Body } from './body.js';
import { Director } from './director.js';
import { Segmenter } from './segmenter.js';
import { jev } from './jev.js';
import { llm } from './llm.js';

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
    this._inflight = new Map();
    this._seq = 0;
    this._applied = 0;
    this._previous = null;
    this._avatarSpeaking = false;
    this._cut = false;
    this._disposed = false;

    this._offFrame = this.adapter.onFrame((dt) => {
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
   * @param {boolean} [options.final=false] - Last fragment of the turn; may repeat the whole turn or be empty
   */
  feed(text, { speaker = 'avatar', final = false } = {}) {
    text ??= '';
    if (this._disposed || !this.classify || (!text && !final)) return;
    const seg = this._segments[speaker];
    if (!seg) throw new Error(`Unknown speaker "${speaker}" (use avatar or user)`);

    if (speaker === 'avatar') {
      if (final) clearTimeout(this._timers.silence);
      else this._endTurnAfterSilence();
      // Providers keep sending the cut-off turn after a barge-in (late deltas,
      // then the whole turn as final); none of it was said.
      if (this._cut) {
        if (final) this._cut = false;
        return;
      }
      this._avatarSpeaking = !final;
    } else if (final) {
      // The avatar's next turn answers this line, so the cut-off one is over.
      this._cut = false;
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

  /** The person cut the avatar off: drop the avatar's pending text and calls. Reactions to the person keep going. */
  interrupt() {
    for (const [ctrl, speaker] of this._inflight) if (speaker === 'avatar') ctrl.abort();
    this._segments.avatar.reset();
    clearTimeout(this._timers.avatar);
    if (!this._avatarSpeaking) return;
    this._avatarSpeaking = false;
    this.body.stop();
    this._cut = true;
    this._endTurnAfterSilence();
  }

  /** Unhook from the avatar and stop everything; the engine can't be used afterwards. */
  dispose() {
    this._disposed = true;
    this._offFrame();
    for (const ctrl of this._inflight.keys()) ctrl.abort();
    this._inflight.clear();
    for (const t of Object.values(this._timers)) clearTimeout(t);
    this.director.dispose();
    this.body.stop();
    this.face.reset();
  }

  _endTurnAfterSilence() {
    clearTimeout(this._timers.silence);
    this._timers.silence = setTimeout(() => this._endAvatarTurn(), SILENCE_ENDS_TURN);
  }

  // Silence, not a final fragment: also forget the heard text, or it would
  // grow across turns and break the dedupe of a later final.
  _endAvatarTurn() {
    this._avatarSpeaking = false;
    this._cut = false;
    const seg = this._segments.avatar;
    clearTimeout(this._timers.avatar);
    for (const line of seg.flush()) this._handle(line, 'avatar');
    seg.reset();
  }

  async _handle(text, speaker) {
    if (speaker === 'user' && this._avatarSpeaking) {
      this.onDecision?.({ speaker, text, actions: [], skipped: 'avatar is already speaking' });
      return;
    }

    const seq = ++this._seq;
    const previous = this._previous;
    this._previous = { speaker, text };
    const ctrl = new AbortController();
    this._inflight.set(ctrl, speaker);

    try {
      const state = previous ? { speaker, text, previous } : { speaker, text };
      const r = await this.classify(state, this.director.questions(speaker), { signal: ctrl.signal });
      // A custom classifier may ignore the signal.
      if (ctrl.signal.aborted) return;
      if (seq < this._applied) {
        this.onDecision?.({ speaker, text, ...r, actions: [], skipped: 'superseded by a newer line' });
        return;
      }
      this._applied = seq;
      const actions = this.director.apply(r.answers, speaker);
      this.director.scheduleRelax();
      this.onDecision?.({ speaker, text, ...r, actions });
    } catch (err) {
      if (err.name !== 'AbortError') this.onDecision?.({ speaker, text, actions: [], error: err.message });
    } finally {
      this._inflight.delete(ctrl);
    }
  }
}

export { jev, llm };
