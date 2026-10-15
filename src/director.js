/**
 * Director — asks Jev what a line means for the avatar, and decides what
 * actually plays.
 *
 * Jev gets the line, who said it and the previous line, and answers in one
 * call: which expression, which gesture (both may be "none") and, for the
 * person's lines, whether the transcript is intelligible at all. The menu is
 * built from the catalogs: every expression or gesture with a `description`
 * is offered, described in its own words.
 *
 * Jev decides; the director keeps it believable:
 *   - low-confidence answers are ignored (doing nothing beats a wrong face)
 *   - a held expression already showing is not restarted
 *   - one gesture at a time, with a cooldown so the avatar doesn't fidget
 *   - garbled transcripts of the person get no reaction at all
 *   - once the avatar is quiet and no new expression has come for a while,
 *     the face relaxes to neutral
 *
 * @module director
 */

import { ask } from './jev.js';

const NONE = 'none';

const INSTRUCTIONS = {
  avatar: {
    expression: "The facial expression the avatar shows while saying this line. 'none' if the line is emotionally neutral or the current expression should stay.",
    gesture: "A body gesture that naturally goes with the avatar saying this line. Most lines need none.",
  },
  user: {
    expression: "The avatar is listening. The facial expression it shows in reaction to what the person just said. React like an empathetic friend: concern or tenderness for bad news, not a copy of the person's emotion. 'none' if no visible reaction fits.",
    gesture: "A body gesture the listening avatar makes in reaction to what the person said. Most messages need none.",
  },
};

const DEFAULTS = {
  minConfidence: { expression: 0.45, gesture: 0.55 },
  minClarity: 0.5,
  gestureCooldown: 4000,
  relaxAfter: 6000,
};

/**
 * @typedef {object} Action
 * @property {'face'|'body'} channel
 * @property {string} name
 * @property {number} confidence
 * @property {boolean} applied
 * @property {string} [reason] - Why it was not applied
 */

export class Director {
  /**
   * @param {import('./face.js').Face} face
   * @param {import('./body.js').Body} body
   * @param {object} [options] - Thresholds and timings (see DEFAULTS)
   */
  constructor(face, body, options = {}) {
    this.face = face;
    this.body = body;
    this.opt = { ...DEFAULTS, ...options, minConfidence: { ...DEFAULTS.minConfidence, ...options.minConfidence } };
    this._lastGesture = -Infinity;
    this._relaxTimer = null;
    /** Whether the avatar is mid-line; set by the engine. Relaxing waits for it. */
    this.busy = () => false;
    this._questions = {};
  }

  /**
   * The questions for a line, by speaker. Built once from the catalogs.
   * @param {'avatar'|'user'} speaker
   */
  questions(speaker) {
    if (!this._questions[speaker]) {
      const text = INSTRUCTIONS[speaker];
      const q = {
        expression: ask.choice(text.expression, menu(this.face.facs.expressions, 'No change of expression.')),
        gesture: ask.choice(text.gesture, menu(this.body.gestures, 'No gesture.')),
      };
      if (speaker === 'user') {
        q.clear = ask.noul(
          'The text is intelligible speech from the person.',
          'Coherent words or sentences, even if short or informal.',
          'Noise, cut-off fragments or a garbled transcript.',
        );
      }
      this._questions[speaker] = q;
    }
    return this._questions[speaker];
  }

  /**
   * Turn Jev's answers into actions and play the ones that pass the rules.
   * @param {object} answers - Jev answers for questions(speaker)
   * @param {'avatar'|'user'} speaker
   * @returns {Action[]}
   */
  apply(answers, speaker) {
    const actions = [];
    const expr = answers.expression;
    const gest = answers.gesture;
    const unclear = speaker === 'user' && (answers.clear?.noul ?? 1) < this.opt.minClarity;

    if (expr?.choice && expr.choice !== NONE) {
      const a = { channel: 'face', name: expr.choice, confidence: expr.confidence, applied: false };
      const kind = this.face.resolve(a.name)?.kind;
      if (unclear) a.reason = 'unclear transcript';
      else if (!kind) a.reason = 'not in catalog';
      else if (a.confidence < this.opt.minConfidence.expression) a.reason = 'low confidence';
      else if (kind === 'mood' && this.face.current === a.name) a.reason = 'already showing';
      else {
        this.face.play(a.name);
        a.applied = true;
      }
      actions.push(a);
    }

    if (gest?.choice && gest.choice !== NONE) {
      const a = { channel: 'body', name: gest.choice, confidence: gest.confidence, applied: false };
      const now = performance.now();
      if (unclear) a.reason = 'unclear transcript';
      else if (!this.body.gestures[a.name]) a.reason = 'not in catalog';
      else if (a.confidence < this.opt.minConfidence.gesture) a.reason = 'low confidence';
      else if (this.body.current) a.reason = 'another gesture is playing';
      else if (now - this._lastGesture < this.opt.gestureCooldown) a.reason = 'cooldown';
      else {
        this.body.play(a.name);
        this._lastGesture = now;
        a.applied = true;
      }
      actions.push(a);
    }

    return actions;
  }

  /**
   * (Re)start the wait before relaxing to neutral. Call whenever something
   * happens; the face relaxes `relaxAfter` ms after the last call, and not
   * while the avatar is mid-line.
   */
  scheduleRelax() {
    clearTimeout(this._relaxTimer);
    this._relaxTimer = setTimeout(() => {
      if (this.busy()) this.scheduleRelax();
      else this.face.play('neutral');
    }, this.opt.relaxAfter);
  }

  /** Cancel pending timers. */
  dispose() {
    clearTimeout(this._relaxTimer);
  }
}

/** Catalog entries with a description → Jev choice options, plus "none". */
function menu(catalog, noneMeaning) {
  const options = {};
  for (const [name, item] of Object.entries(catalog)) {
    if (item.description) options[name] = item.description;
  }
  options[NONE] = noneMeaning;
  return options;
}
