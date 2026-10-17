// Runs decision models over the gold lines through OpenRouter, with the library's
// own client (src/systemone.js) and the director's own questions. Costs money:
// every line is one paid call per model and pass.
//
//   OPENROUTER_API_KEY=… node bench/run.js --models typesafe/jev-1.14,liquid/d1 [--passes 2]
//     [--parallel 3] [--max-cost 1] [--limit 10] [--out bench/results.json] [--force] [--dry-run]
//
// Each model runs one call at a time; --parallel models run side by side. A 429 is
// retried twice. New calls stop once the spend reaches 90% of --max-cost (dollars,
// from the provider's usage.cost), so calls already in flight stay under it.
// --dry-run answers every question with 'none' and calls nothing (no key needed).

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { execSync } from 'node:child_process';
import { systemOne } from '../src/systemone.js';
import { Director } from '../src/director.js';

const here = (p) => new URL(p, import.meta.url);
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const CHANNELS = ['expression', 'head', 'hands'];

/** One call in the compact results format: [choice, confidence] per channel, clear as p(intelligible). */
export function compact(model, pass, state, r) {
  const call = { model, pass, speaker: state.speaker, text: state.text };
  if (r.error) return { ...call, error: r.error, ms: r.ms };
  for (const ch of CHANNELS) {
    const a = r.answers[ch];
    call[ch] = a ? [a.choice ?? null, a.confidence ?? null] : null;
  }
  if (state.speaker === 'user') call.clear = r.answers.clear?.noul ?? null;
  return { ...call, input_tokens: r.usage?.input_tokens ?? null, cost: r.usage?.cost ?? null, ms: r.ms ?? null };
}

/** Results file with one call per line, so diffs and greps stay readable. */
export function write(path, { calls, ...meta }) {
  const head = JSON.stringify(meta, null, 1).slice(0, -2);
  writeFileSync(path, `${head},\n "calls": [\n${calls.map((c) => '  ' + JSON.stringify(c)).join(',\n')}\n ]\n}\n`);
}

// What a model answers in --dry-run: nothing, for free.
const dry = async (state, questions) => ({
  answers: Object.fromEntries(
    Object.entries(questions).map(([k, q]) => [k, q.type === 'noul' ? { noul: 1 } : { choice: 'none', confidence: 1 }]),
  ),
  model: null,
  usage: { input_tokens: 0, cost: 0 },
  ms: 0,
});

async function main() {
  const { values: opt } = parseArgs({
    options: {
      models: { type: 'string' },
      passes: { type: 'string', default: '2' },
      parallel: { type: 'string', default: '3' },
      'max-cost': { type: 'string', default: '1' },
      limit: { type: 'string' },
      out: { type: 'string', default: 'bench/results.json' },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
    },
  });
  const models = (opt.models ?? '').split(',').filter(Boolean);
  if (!models.length) throw new Error('Pass --models a,b (OpenRouter ids)');
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey && !opt['dry-run']) throw new Error('Set OPENROUTER_API_KEY, or use --dry-run');
  if (existsSync(opt.out) && !opt.force) throw new Error(`${opt.out} exists: pass another --out, or --force`);
  const passes = +opt.passes;
  const maxCost = +opt['max-cost'];

  const director = new Director(
    { facs: json(here('../src/facs.json')) },
    { gestures: json(here('../src/gestures.json')) },
  );
  const lines = json(here('gold.json')).lines.slice(0, opt.limit ? +opt.limit : undefined);
  const commit = execSync('git rev-parse --short HEAD').toString().trim();
  const data = { commit, date: new Date().toISOString(), gold: 'gold.json', passes, models, served: {}, calls: [] };
  let spent = 0;
  let stopped = null;
  const save = () => write(opt.out, data);
  process.on('SIGINT', () => {
    save();
    process.exit(130);
  });

  async function runModel(model) {
    const classify = opt['dry-run'] ? dry : systemOne({ apiKey, model });
    let rejected = 0;
    for (let pass = 1; pass <= passes; pass++) {
      for (const line of lines) {
        if (stopped) return;
        const state = {
          speaker: line.speaker || 'avatar',
          text: line.text,
          ...(line.previous && { previous: line.previous }),
        };
        let r;
        for (let attempt = 0; ; attempt++) {
          const started = performance.now();
          try {
            r = await classify(state, director.questions(state.speaker));
            break;
          } catch (e) {
            const error = String(e.message || e);
            const status = +(error.match(/System One (\d{3})/)?.[1] || 0);
            if (status === 429 && attempt < 2) {
              await wait(3000 * (attempt + 1));
              continue;
            }
            r = { error, status, ms: Math.round(performance.now() - started) };
            break;
          }
        }
        data.calls.push(compact(model, pass, state, r));
        if (r.error) {
          // A model the route rejects (bad id, unsupported questions): stop after three.
          if (r.status >= 400 && r.status < 500 && r.status !== 429 && ++rejected >= 3) {
            console.log(`${model}: stopped, ${r.error}`);
            return;
          }
        } else {
          rejected = 0;
          if (r.model) data.served[model] = r.model;
          spent += +(r.usage?.cost || 0);
        }
        if (spent >= maxCost * 0.9) stopped = `spent $${spent.toFixed(4)}, 90% of --max-cost ${maxCost}`;
      }
    }
    console.log(`${model}: done`);
  }

  const queue = [...models];
  const worker = async () => {
    for (let m; (m = queue.shift()) && !stopped;) {
      await runModel(m);
      save();
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, +opt.parallel) }, worker));
  save();
  console.log(`${data.calls.length} calls, $${spent.toFixed(4)}${stopped ? `; stopped: ${stopped}` : ''} → ${opt.out}`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
