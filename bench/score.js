// Scores a results file against the gold lines and prints the tables in Markdown.
// Calls nothing.
//
//   node bench/score.js [bench/results.json]
//
// Played = what the director plays with its default thresholds (minConfidence per
// channel; on the person's lines nothing plays when clear < minClarity); raw = the
// model's own choice. Both passes are pooled unless a column says otherwise.

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { Director } from '../src/director.js';

const CH = ['expression', 'head', 'hands'];
const GRID = Array.from({ length: 15 }, (_, i) => i / 20); // 0 to 0.70
const FOLDS = 5;

const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const keyOf = (speaker, text) => `${speaker}\n${text}`;
// Half to even, like Python's round(), so the numbers match the first analysis.
const round = (x) => {
  const r = Math.round(x);
  return Math.abs(x % 1) === 0.5 && r % 2 ? r - 1 : r;
};
const pct = (a, b) => (b ? round((100 * a) / b) : null);
const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const quantile = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, round(p * (s.length - 1)))] : null;
};

export function score(results, gold, { facs, gestures }) {
  const director = new Director({ facs }, { gestures });
  const minConf = director.opt.minConfidence;
  const minClarity = director.opt.minClarity;
  const described = (o) => new Set(Object.keys(o).filter((k) => o[k].description));
  const catalog = {
    expression: described(facs.expressions),
    head: described(gestures.head),
    hands: described(gestures.hands),
  };

  const lines = new Map(gold.lines.map((l) => [keyOf(l.speaker || 'avatar', l.text), l]));
  const keys = [...lines.keys()];
  const act = Object.fromEntries(CH.map((ch) => [ch, keys.filter((k) => !lines.get(k)[ch].includes('none'))]));
  const neutral = keys.filter((k) => CH.every((ch) => lines.get(k)[ch].join() === 'none'));

  // What plays for a channel at a threshold (null = the model's raw choice).
  const play = (c, ch, t) => {
    const [choice, confidence] = c[ch] ?? [];
    if (!choice || choice === 'none') return 'none';
    if (t === null) return choice;
    if (c.speaker === 'user' && (c.clear ?? 1) < minClarity) return 'none';
    if (!catalog[ch].has(choice) || !((confidence ?? 0) >= t)) return 'none';
    return choice;
  };
  const ok = (ch, k, choice) => lines.get(k)[ch].includes(choice);

  // Hits on the lines that need an action, and played answers that aren't acceptable.
  function tally(calls, ch, t) {
    let hit = 0,
      need = 0,
      wrong = 0;
    for (const c of calls) {
      const k = keyOf(c.speaker, c.text);
      const p = play(c, ch, t);
      if (!lines.get(k)[ch].includes('none')) {
        need++;
        hit += ok(ch, k, p);
      }
      if (p !== 'none' && !ok(ch, k, p)) wrong++;
    }
    return { hit, need, wrong };
  }
  // The threshold with the most hits minus wrong answers; ties go to the lowest.
  const fit = (calls, ch) =>
    GRID.reduce(
      (best, t) => {
        const s = tally(calls, ch, t);
        return s.hit - s.wrong > best.v ? { t, v: s.hit - s.wrong } : best;
      },
      { t: null, v: -Infinity },
    ).t;
  const actsEh = (s) => pct(s.expression.hit + s.hands.hit, s.expression.need + s.hands.need);
  const wrongAll = (s) => CH.reduce((n, ch) => n + s[ch].wrong, 0);

  // Folds by line: keys in alphabetical (speaker, text) order, the i-th line in fold i % 5.
  const sorted = gold.lines
    .map((l) => [l.speaker || 'avatar', l.text])
    .sort((a, b) => (a[0] !== b[0] ? (a[0] < b[0] ? -1 : 1) : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([s, t]) => keyOf(s, t));
  const fold = new Map(sorted.map((k, i) => [k, i % FOLDS]));

  const models = results.models ?? [...new Set(results.calls.map((c) => c.model))];
  const rows = models.map((model) => {
    const calls = results.calls.filter((c) => c.model === model);
    const answered = calls.filter((c) => !c.error);
    const by = new Map(answered.map((c) => [`${c.pass}\n${keyOf(c.speaker, c.text)}`, c]));
    const passes = [...new Set(answered.map((c) => c.pass))].sort();
    const row = { model, calls: calls.length, errors: calls.length - answered.length };
    row.errorSamples = [...new Set(calls.filter((c) => c.error).map((c) => c.error.slice(0, 140)))].sort().slice(0, 3);

    for (const [tag, th] of [
      ['', minConf],
      ['Raw', null],
    ]) {
      const t = (ch) => (th ? th[ch] : null);
      let all = 0,
        allHit = 0;
      for (const ch of CH) {
        let hit = 0,
          n = 0;
        for (const p of passes) {
          for (const k of act[ch]) {
            const c = by.get(`${p}\n${k}`);
            if (c) {
              n++;
              hit += ok(ch, k, play(c, ch, t(ch)));
            }
          }
          for (const k of keys) {
            const c = by.get(`${p}\n${k}`);
            if (c) {
              all++;
              allHit += ok(ch, k, play(c, ch, t(ch)));
            }
          }
        }
        row[`act${tag}`] = { ...row[`act${tag}`], [ch]: { hit, n } };
        const extra = passes.map((p) =>
          neutral.reduce((s, k) => s + (by.has(`${p}\n${k}`) && play(by.get(`${p}\n${k}`), ch, t(ch)) !== 'none'), 0),
        );
        row[`extra${tag}`] = { ...row[`extra${tag}`], [ch]: mean(extra) };
      }
      row[`overall${tag}`] = pct(allHit, all);
      const eh = ['expression', 'hands'].map((ch) => row[`act${tag}`][ch]);
      row[`actEh${tag}`] = pct(eh[0].hit + eh[1].hit, eh[0].n + eh[1].n);
      row[`wrong${tag}`] = mean(
        passes.map((p) =>
          CH.reduce(
            (n, ch) =>
              n +
              tally(
                answered.filter((c) => c.pass === p),
                ch,
                t(ch),
              ).wrong,
            0,
          ),
        ),
      );
      let same = 0,
        moved = 0;
      for (const k of keys) {
        const [a, b] = [by.get(`1\n${k}`), by.get(`2\n${k}`)];
        if (!a || !b) continue;
        for (const ch of CH) {
          const [x, y] = [play(a, ch, t(ch)), play(b, ch, t(ch))];
          if (x !== 'none' || y !== 'none') {
            moved++;
            same += x === y;
          }
        }
      }
      row[`stable${tag}`] = pct(same, moved);
    }

    const ms = answered.map((c) => c.ms).filter((x) => x != null);
    row.p50 = quantile(ms, 0.5);
    row.p90 = quantile(ms, 0.9);
    for (const s of ['avatar', 'user']) {
      const t = answered.filter((c) => c.speaker === s && c.input_tokens != null).map((c) => c.input_tokens);
      row[`tokens_${s}`] = t.length ? round(mean(t)) : null;
    }
    const cost = answered.map((c) => +(c.cost || 0));
    row.costPerLine = mean(cost);
    row.cost = cost.reduce((s, x) => s + x, 0);

    // Thresholds per model: fit on pass 1, measured on pass 2 of lines the fit never saw.
    const p1 = answered.filter((c) => c.pass === 1);
    const p2 = answered.filter((c) => c.pass === 2);
    if (p1.length && p2.length) {
      const cv = Object.fromEntries(CH.map((ch) => [ch, { hit: 0, need: 0, wrong: 0 }]));
      for (let f = 0; f < FOLDS; f++) {
        const train = p1.filter((c) => fold.get(keyOf(c.speaker, c.text)) !== f);
        const test = p2.filter((c) => fold.get(keyOf(c.speaker, c.text)) === f);
        for (const ch of CH) {
          const s = tally(test, ch, fit(train, ch));
          for (const k of ['hit', 'need', 'wrong']) cv[ch][k] += s[k];
        }
      }
      const base = Object.fromEntries(CH.map((ch) => [ch, tally(p2, ch, minConf[ch])]));
      row.tuned = {
        acts: actsEh(cv),
        wrong: wrongAll(cv),
        defaultActs: actsEh(base),
        defaultWrong: wrongAll(base),
        thresholds: Object.fromEntries(CH.map((ch) => [ch, fit(p1, ch)])),
      };
    }
    return row;
  });

  return { rows, minConf, minClarity, lines: keys.length, act, neutral, passes: results.passes };
}

const f = (v, s = '') => (v == null ? '—' : `${v}${s}`);
const num = (v) => (v == null ? '—' : String(+v.toFixed(2)));

export function markdown(s, results) {
  const { rows, minConf, minClarity } = s;
  const hn = (r, ch) => {
    const [a, b] = [r.act[ch], r.actRaw[ch]];
    return a.n ? `${pct(a.hit, a.n)}% (${pct(b.hit, b.n)}%)` : '—';
  };
  const byActs = [...rows].sort(
    (a, b) => (a.actEh == null) - (b.actEh == null) || b.actEh - a.actEh || b.overall - a.overall,
  );
  const tuned = rows
    .filter((r) => r.tuned)
    .sort((a, b) => b.tuned.acts - a.tuned.acts || a.tuned.wrong - b.tuned.wrong);
  const out = [
    `${s.lines} gold lines (bench/gold.json), ${s.passes ?? '?'} passes per model, questions from src/director.js at ${results.commit}.`,
    '',
    `Played = after the director's defaults (minConfidence expression ${minConf.expression}, head ${minConf.head}, hands ${minConf.hands}; ` +
      `on the person's lines nothing plays when clear < ${minClarity}). Raw in brackets.`,
    '',
    `- **acts**: right action on the lines where none is wrong (expression ${s.act.expression.length}, head ${s.act.head.length}, hands ${s.act.hands.length} lines), passes pooled. Sorted by acts expr+hands.`,
    `- **extra**: actions on the ${s.neutral.length} lines where only none is right, mean per pass.`,
    "- **wrong**: actions played that aren't acceptable, all channels, mean per pass.",
    '- **overall**: every line × channel acceptable. **stable**: of the decisions where either pass acted, % where both acted the same.',
    '',
    '| model | acts expr+hands | acts expr | acts head | acts hands | extra expr / head / hands | wrong | overall | stable | p50 ms | p90 ms | tokens avatar / user | $/line | errors |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|',
    ...byActs.map(
      (r) =>
        `| ${r.model} | ${f(r.actEh, '%')} (${f(r.actEhRaw, '%')}) | ${hn(r, 'expression')} | ${hn(r, 'head')} | ${hn(r, 'hands')} ` +
        `| ${CH.map((ch) => `${num(r.extra[ch])} (${num(r.extraRaw[ch])})`).join(' / ')} | ${num(r.wrong)} (${num(r.wrongRaw)}) ` +
        `| ${f(r.overall, '%')} (${f(r.overallRaw, '%')}) | ${f(r.stable, '%')} | ${f(r.p50)} | ${f(r.p90)} ` +
        `| ${f(r.tokens_avatar)} / ${f(r.tokens_user)} | ${r.costPerLine == null ? '—' : r.costPerLine.toFixed(6)} | ${r.errors}/${r.calls} |`,
    ),
    '',
    `Total cost: $${rows.reduce((t, r) => t + r.cost, 0).toFixed(4)} for ${rows.reduce((t, r) => t + r.calls - r.errors, 0)} answered calls.`,
    '',
  ];
  const errs = rows.filter((r) => r.errors);
  if (errs.length)
    out.push('Errors:', ...errs.map((r) => `- ${r.model}: ${r.errors}/${r.calls} — ${r.errorSamples.join('; ')}`), '');
  if (tuned.length) {
    out.push(
      '## Thresholds per model',
      '',
      `Each channel's minConfidence picked from 0 to 0.70 in steps of 0.05, for the most right actions minus wrong ones. ` +
        `**cross-validated**: ${FOLDS} folds by line (alphabetical speaker + text, line i in fold i % ${FOLDS}); thresholds fit on pass 1 of the other folds, ` +
        "measured on pass 2 of the fold. **defaults**: pass 2 with the director's thresholds. **suggested**: fit on pass 1 of all lines. " +
        'acts = expression + hands; wrong = all channels, pass 2.',
      '',
      '| model | cross-validated acts | wrong | defaults acts | wrong | suggested expression / head / hands |',
      '|---|---|---|---|---|---|',
      ...tuned.map(
        (r) =>
          `| ${r.model} | ${r.tuned.acts}% | ${r.tuned.wrong} | ${r.tuned.defaultActs}% | ${r.tuned.defaultWrong} ` +
          `| ${CH.map((ch) => r.tuned.thresholds[ch].toFixed(2)).join(' / ')} |`,
      ),
      '',
    );
  }
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = (p) => new URL(p, import.meta.url);
  const results = json(process.argv[2] ?? here('results.json'));
  const s = score(results, json(here('gold.json')), {
    facs: json(here('../src/facs.json')),
    gestures: json(here('../src/gestures.json')),
  });
  console.log(markdown(s, results));
}
