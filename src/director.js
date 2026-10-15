// Asks Jev what a line means for the avatar, then decides what actually plays.
// Only catalog entries with a description are offered to Jev.

import { ask } from './jev.js';

const NONE = 'none';

const INSTRUCTIONS = {
  avatar: {
    expression: "The facial expression the avatar shows while saying this line. 'none' if the line is emotionally neutral or the current expression should stay.",
    head: "A head movement that naturally goes with the avatar saying this line. 'none' if no movement fits.",
    hands: "A hand gesture that naturally goes with the avatar saying this line. Most lines need none.",
  },
  user: {
    expression: "The avatar is listening. The facial expression it shows in reaction to what the person just said. React like an empathetic friend: concern or tenderness for bad news, not a copy of the person's emotion. 'none' if no visible reaction fits.",
    head: "A head movement the listening avatar makes in reaction to what the person said. 'none' if no movement fits.",
    hands: "A hand gesture the listening avatar makes in reaction to what the person said. Most messages need none.",
  },
};

const GESTURE_CHANNELS = ['head', 'hands'];

const DEFAULTS = {
  minConfidence: { expression: 0.45, head: 0.5, hands: 0.55 },
  minClarity: 0.5,
  cooldown: { head: 2500, hands: 4000 },
  relaxAfter: 6000,
};

export class Director {
  constructor(face, body, options = {}) {
    this.face = face;
    this.body = body;
    this.opt = {
      ...DEFAULTS,
      ...options,
      minConfidence: { ...DEFAULTS.minConfidence, ...options.minConfidence },
      cooldown: { ...DEFAULTS.cooldown, ...options.cooldown },
    };
    this.busy = () => false;
    this._lastGesture = { head: -Infinity, hands: -Infinity };
    this._relaxTimer = null;
    this._questions = {};
  }

  questions(speaker) {
    if (!this._questions[speaker]) {
      const text = INSTRUCTIONS[speaker];
      const q = {
        expression: ask.choice(text.expression, menu(this.face.facs.expressions, 'No change of expression.')),
        head: ask.choice(text.head, menu(this.body.gestures.head, 'No head movement.')),
        hands: ask.choice(text.hands, menu(this.body.gestures.hands, 'No hand gesture.')),
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
   * Play what passes the rules and report every choice with the reason it was skipped.
   * @returns {{channel:'face'|'head'|'hands', name:string, confidence:number, applied:boolean, reason?:string}[]}
   */
  apply(answers, speaker) {
    const actions = [];
    const expr = answers.expression;
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

    for (const channel of GESTURE_CHANNELS) {
      const g = answers[channel];
      if (!g?.choice || g.choice === NONE) continue;
      const a = { channel, name: g.choice, confidence: g.confidence, applied: false };
      const now = performance.now();
      if (unclear) a.reason = 'unclear transcript';
      else if (!this.body.gestures[channel][a.name]) a.reason = 'not in catalog';
      else if (a.confidence < this.opt.minConfidence[channel]) a.reason = 'low confidence';
      else if (this.body.current[channel]) a.reason = 'already moving';
      else if (now - this._lastGesture[channel] < this.opt.cooldown[channel]) a.reason = 'cooldown';
      else {
        this.body.play(a.name);
        this._lastGesture[channel] = now;
        a.applied = true;
      }
      actions.push(a);
    }

    return actions;
  }

  /** Relax to neutral `relaxAfter` ms after the last call, never while the avatar is mid-line. */
  scheduleRelax() {
    clearTimeout(this._relaxTimer);
    this._relaxTimer = setTimeout(() => {
      if (this.busy()) this.scheduleRelax();
      else this.face.play('neutral');
    }, this.opt.relaxAfter);
  }

  dispose() {
    clearTimeout(this._relaxTimer);
  }
}

function menu(catalog, noneMeaning) {
  const options = {};
  for (const [name, item] of Object.entries(catalog)) {
    if (item.description) options[name] = item.description;
  }
  options[NONE] = noneMeaning;
  return options;
}
