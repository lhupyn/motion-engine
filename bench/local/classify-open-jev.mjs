// A motion-engine classify() backed by open-jev (https://github.com/nico-martin/open-jev),
// running kev-0.6b or the open-jev model (DeBERTa) locally with Transformers.js.
//
// Translation choices:
// - state: open-jev takes a string, so the line (and the one before) become text
//   that matches the director's wording ("this line").
// - choice: our criteria (option → when to pick it) go in open-jev's per-option
//   descriptions, which the model reads as "option: description".
// - noul: open-jev takes one statement; the true/false criteria are appended to it.
// - descriptions: 'full' sends every criterion; 'short' keeps only the text before
//   its first colon ("Warm, genuine smile"); 'none' sends option names only. DeBERTa's
//   512-token context can't hold the full menus.
import { OpenJev } from 'open-jev';

const WHO = { avatar: 'the avatar', user: 'the person' };

export function stateText({ speaker, text, previous }) {
  const line = `This line, by ${WHO[speaker]}: ${text}`;
  return previous ? `Previous line, by ${WHO[previous.speaker]}: ${previous.text}\n${line}` : line;
}

const SHORTEN = {
  full: (d) => d,
  short: (d) => d.split(':')[0],
  none: () => undefined,
};

export function toOpenJev(questions, descriptions = 'full') {
  const shorten = SHORTEN[descriptions];
  const out = {};
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === 'choice') {
      out[key] = {
        type: 'choice',
        instructions: q.instructions,
        options: Object.keys(q.criteria),
        descriptions: Object.fromEntries(
          Object.entries(q.criteria)
            .map(([o, d]) => [o, shorten(d)])
            .filter(([, d]) => d),
        ),
      };
    } else if (q.type === 'noul') {
      out[key] = { type: 'noul', instructions: `${q.instructions} Yes: ${q.criteria.true} No: ${q.criteria.false}` };
    } else {
      out[key] = { type: 'score', instructions: q.instructions, options: q.criteria };
    }
  }
  return out;
}

export function fromOpenJev(raw) {
  const answers = {};
  for (const [key, a] of Object.entries(raw)) {
    if (a.type === 'choice')
      answers[key] = { choice: a.choice, confidence: a.confidence, probabilities: a.probabilities };
    else if (a.type === 'noul') answers[key] = { noul: a.probability };
    else answers[key] = { score: a.score, confidence: a.confidence };
  }
  return answers;
}

// Tokens of the sequence open-jev builds; DeBERTa cuts the state to fit 512 in all.
// open-jev: [CLS] [STATE] state ([Q] instr ([OPT] option)…)… [SEP]
// kev: <state> state (<q> instr (<opt> option </opt>)… <decide>)…
export function sequenceTokens(count, family, state, questions) {
  const optionTexts = (q) =>
    q.type === 'noul' ? ['no', 'yes'] : q.options.map((o) => (q.descriptions?.[o] ? `${o}: ${q.descriptions[o]}` : o));
  const per = {};
  for (const [k, q] of Object.entries(questions)) {
    const opts = optionTexts(q).map(count);
    per[k] =
      1 +
      count(q.instructions) +
      opts.reduce((s, n) => s + n + (family === 'kev' ? 2 : 1), 0) +
      (family === 'kev' ? 1 : 0);
  }
  const questionsTotal = (family === 'kev' ? 1 : 3) + Object.values(per).reduce((s, n) => s + n, 0);
  const stateTokens = count(state);
  const kept = family === 'kev' ? stateTokens : Math.max(0, Math.min(256, 512 - questionsTotal, stateTokens));
  return {
    per,
    questions: questionsTotal,
    state: stateTokens,
    input: questionsTotal + kept,
    fits: family === 'kev' || questionsTotal <= 512,
  };
}

/**
 * @param {import('open-jev').OpenJevOptions & {descriptions?: 'full'|'short'|'none'}} options - e.g. { model: 'open-jev', dtype: 'q4', descriptions: 'none' }
 * @returns {Promise<import('motion-engine').Classify & {jev: OpenJev}>}
 */
export async function openJevClassify({ descriptions = 'full', ...options } = {}) {
  const jev = await OpenJev.load(options);
  const classify = async (state, questions, { signal } = {}) => {
    signal?.throwIfAborted();
    const started = performance.now();
    // One forward pass can't be cancelled; a late abort still rejects.
    const text = stateText(state);
    const asked = toOpenJev(questions, descriptions);
    const raw = await jev.decide(text, asked);
    signal?.throwIfAborted();
    const ms = Math.round(performance.now() - started);
    const tokens = sequenceTokens((t) => jev.countTokens(t), jev.runtime.family, text, asked);
    return { answers: fromOpenJev(raw), model: jev.runtime.model, usage: { input_tokens: tokens.input }, ms };
  };
  classify.jev = jev;
  return classify;
}
