# Decision models on motion-engine's questions

A comparison of 15 System One decision models on the job motion-engine gives them: for each line of a conversation, pick an expression, a head movement and a hand gesture, each with a confidence, from the director's real questions and catalog descriptions. The director then plays only what passes its thresholds (`minConfidence`), so a model is judged on what would actually play, not only on its raw choice.

**In short.**

- The director's default thresholds are tuned for Jev. Most of the difference between models is how they spread their confidence, not what they pick.
- With thresholds fitted per model, 12 of the 15 play the right expression and hand gesture on 91–97% of the lines that need one (cross-validated), with very different numbers of wrong actions.
- The small local models tested through the open-jev library don't replace Jev yet.

Every number below is printed by `npm run bench:score` from [`results.json`](results.json) and [`gold.json`](gold.json), except the incompatible models' errors and the local models, which come from separate runs described there.

## Method

**Lines.** 150 lines written for this study. Each channel lists every acceptable answer; `none` means no visible action.

| | lines |
| --- | --- |
| An action is required (`none` not acceptable): expression / head / hands | 72 / 30 / 50 |
| Neutral: only `none` is acceptable on every channel (facts, plain questions) | 30 |
| In Spanish | 60 (40%) |
| The person's lines (judged as the listening avatar's reaction) | 32 |
| With a `previous` line as context | 18 |

Hard negatives mention a gesture without doing it ("In some countries, a thumbs up is considered rude": `none` on every channel) or use sarcasm ("Oh great, it's raining again. Just perfect.": an eye roll, not a smile).

**Run.** 15 decision models through OpenRouter's `/api/v1/systemone`, called from a page on the demo's origin with the library's own client (`src/systemone.js`) and the director's questions at commit 88a5152 (motion-engine 2.1.0). [`run.js`](run.js) is the same run in Node, to reproduce it. Two full passes per model, 2026-10-17; 4500 calls, no errors.

**Metrics.** *Played* is what the director plays with its default thresholds (expression 0.45, head 0.5, hands 0.55; on the person's lines nothing plays when `clear` < 0.5). *Raw*, in brackets, is the model's own top choice.

- **acts**: the right action on the lines where `none` is wrong, both passes pooled. Tables sort by expression + hands.
- **extra**: actions on the 30 neutral lines, mean per pass.
- **wrong**: actions played that aren't acceptable, all channels, mean per pass.
- **stable**: of the decisions where either pass acted, the share where both acted the same.

## Results with the default thresholds

| model | acts expr+hands | acts expr | acts head | acts hands | extra expr / head / hands | wrong | stable |
| --- | --- | --- | --- | --- | --- | --- | --- |
| inception/mercury-decide | 94% (96%) | 91% (93%) | 97% (100%) | 98% (100%) | 0 (0) / 4.5 (10.5) / 2 (2) | 37.5 (60.5) | 97% |
| typesafe/jev-1.13 | 94% (98%) | 92% (97%) | 90% (100%) | 96% (100%) | 0 (0) / 2 (4) / 2 (5) | 43.5 (72.5) | 95% |
| typesafe/jev-1.14 | 92% (98%) | 88% (96%) | 93% (100%) | 99% (100%) | 0 (0) / 1.5 (6.5) / 1 (5) | 32.5 (72) | 96% |
| respan/span-02 | 92% (96%) | 90% (93%) | 97% (100%) | 94% (100%) | 3 (3) / 22 (22) / 2 (3) | 76.5 (92) | 99% |
| liquid/d1-ultra | 87% (98%) | 83% (97%) | 92% (97%) | 94% (100%) | 1.5 (3) / 0 (3.5) / 2.5 (10) | 18 (67.5) | 93% |
| microsoft/microsoft-decision-1 | 84% (95%) | 85% (98%) | 97% (100%) | 83% (90%) | 1.5 (2) / 2.5 (6) / 0 (4) | 33.5 (92.5) | 95% |
| openai/gpt-6-luna-decisions | 84% (96%) | 79% (93%) | 73% (100%) | 92% (100%) | 0 (0) / 0 (9) / 2 (3) | 29 (79) | 100% |
| nace-ai/drex-v2.0 | 80% (90%) | 75% (90%) | 93% (100%) | 86% (90%) | 1 (2) / 0 (2) / 0 (2) | 6 (38) | 100% |
| liquid/d1 | 80% (100%) | 74% (99%) | 83% (100%) | 88% (100%) | 0 (0) / 0.5 (3.5) / 0 (2) | 11 (40.5) | 95% |
| nace-ai/drex-v1.5 | 75% (90%) | 71% (90%) | 90% (100%) | 82% (90%) | 0 (1) / 0 (3) / 0 (1) | 22 (50.5) | 99% |
| cloudflare/clef | 74% (98%) | 65% (96%) | 83% (97%) | 88% (100%) | 0 (3) / 1 (13) / 0 (2) | 9 (68.5) | 98% |
| perplexity/pplx-decider-v1.2 | 73% (98%) | 62% (96%) | 90% (100%) | 88% (100%) | 0 (3) / 0 (2) / 1 (3) | 6 (32) | 100% |
| perplexity/pplx-decider-flash-v1.2 | 61% (95%) | 42% (92%) | 77% (100%) | 88% (100%) | 0 (0) / 0 (4) / 1 (8) | 15 (72) | 100% |
| cloudflare/clef-flash | 52% (97%) | 35% (96%) | 78% (100%) | 76% (98%) | 0 (2) / 0 (3) / 0 (1) | 2.5 (54) | 77% |
| jaredpalmer/kev-4b | 46% (92%) | 35% (90%) | 73% (87%) | 62% (94%) | 0 (3) / 0 (0) / 1 (2) | 1 (32) | 100% |

Raw, every model picks a right expression + hand gesture on 90–100% of the lines that need one. After the thresholds the range is 46–94%: the gap is mostly how each model spreads its confidence, not what it picks.

## Results with thresholds fitted per model

For each model and channel, `minConfidence` is picked from 0 to 0.70 in steps of 0.05 to maximize right actions minus wrong ones.

- **cross-validated**: 5 folds by line (lines sorted by speaker + text; line *i* goes to fold *i* mod 5). Thresholds are fit on pass 1 of the other four folds and measured on pass 2 of the held-out fold.
- **defaults**: pass 2 with the director's thresholds, for comparison.
- **suggested**: fit on pass 1 of all 150 lines. They were tuned on this same set, so take them as a starting point, not a measured result.

acts = expression + hands; wrong = all channels, pass 2.

| model | cross-validated acts | wrong | defaults acts | wrong | suggested expression / head / hands |
| --- | --- | --- | --- | --- | --- |
| liquid/d1 | 97% | 9 | 80% | 11 | 0.00 / 0.65 / 0.45 |
| cloudflare/clef-flash | 97% | 28 | 51% | 3 | 0.05 / 0.35 / 0.20 |
| typesafe/jev-1.14 | 95% | 25 | 93% | 33 | 0.35 / 0.70 / 0.55 |
| typesafe/jev-1.13 | 94% | 30 | 93% | 44 | 0.00 / 0.65 / 0.65 |
| cloudflare/clef | 93% | 16 | 74% | 9 | 0.20 / 0.65 / 0.45 |
| perplexity/pplx-decider-v1.2 | 93% | 19 | 73% | 6 | 0.00 / 0.40 / 0.40 |
| liquid/d1-ultra | 93% | 20 | 87% | 18 | 0.30 / 0.60 / 0.50 |
| inception/mercury-decide | 93% | 39 | 93% | 37 | 0.40 / 0.70 / 0.60 |
| respan/span-02 | 93% | 54 | 92% | 76 | 0.00 / 0.70 / 0.50 |
| perplexity/pplx-decider-flash-v1.2 | 92% | 16 | 61% | 15 | 0.00 / 0.70 / 0.50 |
| microsoft/microsoft-decision-1 | 92% | 27 | 84% | 36 | 0.00 / 0.70 / 0.70 |
| openai/gpt-6-luna-decisions | 91% | 25 | 84% | 29 | 0.20 / 0.70 / 0.65 |
| jaredpalmer/kev-4b | 89% | 21 | 46% | 1 | 0.10 / 0.35 / 0.25 |
| nace-ai/drex-v2.0 | 88% | 13 | 80% | 6 | 0.20 / 0.55 / 0.55 |
| nace-ai/drex-v1.5 | 84% | 26 | 75% | 22 | 0.25 / 0.70 / 0.45 |

**The director's defaults are tuned for Jev.** Jev 1.14 gains little from its own thresholds (93% → 95%), while models with lower confidences gain the most: liquid/d1 80% → 97%, perplexity/pplx-decider-v1.2 73% → 93%, jaredpalmer/kev-4b 46% → 89%. Lower thresholds can also mean more wrong actions (cloudflare/clef-flash 3 → 28, kev-4b 1 → 21), so check them against your own lines in `onDecision`.

## Cost and latency

| model | p50 ms | p90 ms | tokens avatar / user | $/line |
| --- | --- | --- | --- | --- |
| inception/mercury-decide | 876 | 1174 | 1777 / 1892 | 0.000036 |
| typesafe/jev-1.13 | 399 | 442 | 1918 / 2005 | 0.000081 |
| typesafe/jev-1.14 | 394 | 438 | 1918 / 2005 | 0.000081 |
| respan/span-02 | 1244 | 2351 | 1283 / 1451 | 0.000013 |
| liquid/d1-ultra | 410 | 624 | 1084 / 1193 | 0.000047 |
| microsoft/microsoft-decision-1 | 501 | 559 | 1079 / 1156 | 0.000046 |
| openai/gpt-6-luna-decisions | 360 | 480 | 1367 / 1574 | 0.000141 |
| nace-ai/drex-v2.0 | 454 | 717 | 1138 / 1208 | 0.000069 |
| liquid/d1 | 426 | 583 | 1084 / 1193 | 0.000022 |
| nace-ai/drex-v1.5 | 432 | 731 | 1138 / 1208 | 0.000046 |
| cloudflare/clef | 579 | 904 | 1921 / 2036 | 0.000104 |
| perplexity/pplx-decider-v1.2 | 432 | 473 | 1252 / 1330 | 0.000025 |
| perplexity/pplx-decider-flash-v1.2 | 348 | 396 | 1252 / 1330 | 0.000013 |
| cloudflare/clef-flash | 488 | 740 | 1921 / 2036 | 0.000044 |
| jaredpalmer/kev-4b | 637 | 703 | 1138 / 1208 | 0.000048 |

Latency is the round trip from one browser client (on a 2015 laptop, three models in parallel): compare models with each other, not as absolute numbers. Prices are OpenRouter's `usage.cost` on 2026-10-17.

## Incompatible models

Three decision models on OpenRouter reject the director's questions:

- **upstage/solar-decide-flash**: 422, the expression question has 36 options and the route supports 26 labels.
- **togethercomputer/tev1-4b-experimental**: 400, it takes 2–20 options per question.
- **scaledown/classify-1**: 400, its state only accepts `text` / `document`, not motion-engine's `{ speaker, text, previous }`.

## Local models

The [open-jev](https://github.com/nico-martin/open-jev) library runs decision models locally with Transformers.js. It ships three models: kev-0.6b, kev-4b and one also named open-jev, on DeBERTa-v3-large with a 512-token context. kev-0.6b and the open-jev model were run in Node on the CPU of a 2015 MacBook Pro (Intel i5, 2 cores, 8 GB), q4 weights, on the **first 40 lines** of the gold set, not all 150. Setup and adapter: [`local/`](local/).

| model | right expression / hand gesture where one is needed | hand gestures where only none is right | p50 per line | peak RAM |
| --- | --- | --- | --- | --- |
| kev-0.6b, full criteria | 12/18 · 9/14 | 3/13 | 19.8 s | 1.06 GB |
| kev-0.6b, option names only | 12/18 · 3/14 | 0/13 | 4.4 s | 0.86 GB |
| open-jev (DeBERTa), option names only | 4/18 · 2/14 | 0/13 | 2.6 s | 0.93 GB |
| typesafe/jev-1.14 (OpenRouter) | 17/18 · 14/14 | 2/13 | 0.4 s | — |

- **Neither replaces Jev yet.** The open-jev model spreads its probability over the 36 expressions, so little passes the default thresholds.
- **The open-jev model doesn't fit the questions.** With their criteria they take about 1010 tokens on the avatar's lines and 1080 on the person's, against its 512. Only option names fit (230 / 300).
- **kev-4b is the promising size.** The OpenRouter version (above) reaches 89% cross-validated acts with low thresholds (0.10 / 0.35 / 0.25), against 46% at the defaults. Its [ONNX conversion](https://huggingface.co/onnx-community/kev-4b-ONNX) for Transformers.js declares a different base model than OpenRouter's, so it may not behave the same; not tested.

### In the browser

kev-0.6b ran in Chrome 150 on the same 2015 MacBook Pro (macOS 12.7, Intel Iris 6100), through open-jev 0.1.2 and Transformers.js 4.3.1, with the same adapter and questions, on 10 of the avatar's lines.

| backend | result |
| --- | --- |
| WebGPU, q4f16 (no flag needed) | 355 MB download; first load 23.5 s, from cache 10.65 s; p50 19.8 s per line. All 10 lines give the same choices as in Node. About 330 MB in the tab's renderer while answering. |
| WASM, q4 and q4f16 | Doesn't load: onnxruntime-web's CPU provider has no `GatherBlockQuantized` kernel, and the model ships only q4 and q4f16. |

On this integrated GPU, WebGPU is as slow as the CPU in Node (p50 19.8 s both). It is one 2015 machine; don't extrapolate to modern GPUs. The open-jev model and kev-4b were not tested in the browser.

## Reproduce

Scoring is free and calls nothing:

```sh
npm run bench:score              # or: node bench/score.js [bench/results.json]
```

`run.js` runs the models in Node with the same client and questions. It costs money (this round: $0.245 for 4500 calls); `--max-cost` stops new calls near a budget:

```sh
OPENROUTER_API_KEY=… node bench/run.js --models typesafe/jev-1.14,liquid/d1   # 2 passes, 3 models in parallel, $1 cap by default
```

`--dry-run` answers `none` everywhere without a key; `--limit 10` runs the first lines only.

## Limitations

- The acceptable answers are a judgment call; other lines or other judges could rank the models differently.
- One catalog (the bundled `facs.json` and `gestures.json`) and one set of questions; another catalog changes the task.
- Two languages (English and Spanish), 150 lines.
- The fitted thresholds were tuned on these same lines; cross-validation reduces, but doesn't remove, that bias.
- Prices and model versions are OpenRouter's on 2026-10-17; both change.
