# motion-engine

Expressive face and body for [TalkingHead](https://github.com/met4citizen/TalkingHead) avatars, decided by a classifier that reads the transcript — not by tags in the LLM's output.

**[Live demo](https://lhupyn.github.io/motion-engine/)** — try expressions and gestures right away; add an OpenRouter key to let Jev react to text.

https://github.com/user-attachments/assets/456c9c19-f37a-4aff-8274-5e15c5ce0839

- **The main LLM just talks.** No emoji, no `[happy]` markers, no extra rules in its prompt.
- **Jev decides.** Each sentence goes to [Jev](https://typesafe.ai), TypeSafe's decision model, which picks an expression, a head movement and a hand gesture, each with a confidence.
- **A director filters.** Thresholds, cooldowns and a few rules decide what actually plays.
- **FACS faces, two body channels.** Expressions are Action Unit recipes on ARKit blendshapes that give way to lip-sync while speaking; head and hand gestures play together.

## Contents

- [Why it exists](#why-it-exists) · [How it works](#how-it-works) · [Speaker turns](#speaker-turns) · [Quick start](#quick-start) · [Integration recipes](#integration-recipes) · [Keys](#keys) · [Roadmap](#roadmap) · [Licenses and credits](#licenses-and-credits)
- Appendices: [A. Configuration](#appendix-a-configuration) · [B. Catalogs](#appendix-b-catalogs) · [C. Classifiers](#appendix-c-classifiers) · [D. FACS sources](#appendix-d-facs-sources) · [E. Development](#appendix-e-development)

## Why it exists

Asking the LLM to tag its own output (emoji, `::markers::`, `[happy]`) costs tokens and prompt rules on every turn, and leaks in production: models coin marker words, leak reasoning into them, and the TTS reads them aloud.

motion-engine gives that job to a decision model that answers multiple-choice questions instead of writing text, so nothing it returns can be spoken and an answer outside the menu is ignored. Measured in the demo with `typesafe/jev-1.14`: **0.4–0.75 s** and **~$0.00008 per sentence** (~2,000 input tokens, one call per sentence).

## How it works

`feed()` → **segmenter** (sentences; a repeated final turn deduped; under two letters or only filler like `"mm"` dropped, `"No."` kept; `"3."` + `"50"` stays one number; an unfinished sentence goes after `pause` ms) → **classifier**, one call per sentence: expression? head? hands? (+ "intelligible?" for the person's lines) → **director** (rules below) → **face** (FACS compositor) and **body** (head + hands channels) → **adapter**, the only module that touches TalkingHead, contract-tested against 1.7.

**Director rules.** A skipped choice reports why in its action's `reason`: `low confidence` (below `minConfidence`), `already showing` (that held expression is on), `avatar is speaking` (a beat with `whileSpeaking: false`), `already moving` / `cooldown` (channel busy, or played less than `cooldown` ms ago), `unclear transcript` (the person's line was unintelligible), `not in catalog`. A whole line reports `skipped` instead: `avatar is already speaking` (a line from the person, not sent) or `superseded by a newer line` (an older line's answer arrived late). The face relaxes to `neutral` `relaxAfter` ms after the last decision, never mid-line.

## Speaker turns

```js
engine.feed(text, { speaker: 'avatar' | 'user', final });
```

The same text gets a different reaction depending on who says it: *"My grandma passed away"* from the avatar is a sad face; from the person, the listening avatar shows concern, not a copy of their emotion.

- **Avatar lines** drive the face and body while it speaks. They're the main input, and `speaker` defaults to `'avatar'`.
- **The person's lines** are optional (not fed → not billed). They're skipped while the avatar speaks (the avatar's next line still sees them as `previous`), and garbled ones get no reaction.
- **`context(text)`** passes the person's line as context only: no call, no reaction, and the avatar's next line is classified knowing what it answers. Use it instead of `feed()` when you don't want listening reactions ([realtime voice](#integration-recipes)).
- **`final: true`** ends a turn; it may repeat the whole turn or be empty. 3 s without avatar fragments also ends its turn.
- **`interrupt()`** is barge-in on the avatar's side only: it drops the avatar's pending text and calls and, if it was speaking, its gestures and the rest of the cut-off turn, whose late fragments are ignored until a final from either side, `context()`, or 3 s after the interrupt. Reactions to the person keep going, so call it whenever the person starts talking.
- **Languages:** the line can be in any language; descriptions stay in English. Sentences also end at CJK, Arabic, Urdu, Devanagari, Armenian, Ethiopic and Burmese marks. Tested with English and Spanish.

## Quick start

Plain ES modules, no build step. From a CDN with an import map:

```html
<script type="importmap">
{ "imports": {
  "three": "https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js/+esm",
  "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.180.0/examples/jsm/",
  "talkinghead": "https://cdn.jsdelivr.net/gh/met4citizen/TalkingHead@1.7/modules/talkinghead.mjs",
  "motion-engine": "https://cdn.jsdelivr.net/gh/lhupyn/motion-engine@2.1.0/src/index.js"
} }
</script>
```

Or with a bundler: `npm i github:lhupyn/motion-engine` (not on npm yet). The catalogs load as JSON modules, which need Chrome/Edge 123+, Safari 17.2+, Firefox 138+ or Node 22+. TalkingHead is not a dependency; bring your own (1.7). TypeScript types are included (generated from the JSDoc, in `types/`).

**Avatar:** TalkingHead's [requirements](https://github.com/met4citizen/TalkingHead#appendix-a-create-your-own-3d-avatar): a Mixamo-compatible rig with the 52 ARKit and 15 Oculus viseme blend shapes. The bundled poses and expression levels are fitted to the demo avatar; another avatar may need them retuned ([catalogs](#appendix-b-catalogs)).

```js
import { TalkingHead } from 'talkinghead';
import { MotionEngine, systemOne } from 'motion-engine';

const head = new TalkingHead(document.getElementById('avatar'), { /* ... */ });
await head.showAvatar({ url: './avatar.glb', body: 'F' });

const engine = new MotionEngine(head, { classify: systemOne({ apiKey: userKey }) }); // Jev via OpenRouter
engine.onDecision = (d) => console.log(d.text, d.actions, d.ms, d.usage);
engine.feed('Hello! It is so nice to see you again.', { speaker: 'avatar', final: true });
```

Create the engine after `showAvatar()`; it hooks TalkingHead's `opt.update` itself, keeping any callback you set. Without `classify`, `feed()` does nothing.

**`onDecision(d)`**, once per sentence:

| Field | Meaning |
| --- | --- |
| `speaker`, `text` | The line |
| `actions` | `[{ channel: 'face' \| 'head' \| 'hands', name, confidence, applied, reason? }]` |
| `answers` | The classifier's raw answers |
| `ms`, `model`, `usage` | Latency, model id, provider usage (e.g. `input_tokens`, `cost`) |
| `skipped` | Why the line wasn't sent, or its answer was dropped |
| `error` | The request failed |

**Direct control**, no classifier needed:

```js
engine.face.play('happy');        // mood: held, cross-fades
engine.face.play('wink');         // beat: plays once on top
engine.face.play('neutral');      // fade the held expression out
engine.body.play('nod');          // head channel; resolves true when done
engine.body.play('thumbs_up');    // hands channel; plays with the nod
engine.body.play('wave', { mirror: true }); // the same hand gesture with the other (left) hand
engine.body.stop();               // both, or stop('head') / stop('hands')
```

Hand gestures play with the right hand by default; `mirror: true` flips every frame to the other hand and moves the overlay with it. Head movements have no side. `face.play` returns `false` for an unknown name; `body.play` resolves `false` when unknown or interrupted. `engine.face.names` and `engine.body.names` list what's available. `engine.face.current` and `engine.body.current` (`{ head, hands }`) say what's showing now.

Besides `feed()`, `context()` and `interrupt()`: `useClassifier(classify)` sets or replaces the classifier at any time (e.g. once the visitor pastes a key); `dispose()` unhooks from TalkingHead, aborts calls, clears timers, stops the body and resets the face.

## Integration recipes

Feed whatever transcript your stack produces.

**Gemini Live** — enable `outputAudioTranscription` and `inputAudioTranscription`:

```js
onmessage: (msg) => {
  const sc = msg.serverContent;
  const out = sc?.outputTranscription, inp = sc?.inputTranscription;
  if (out) engine.feed(out.text ?? '', { speaker: 'avatar', final: !!out.finished });
  if (inp) engine.feed(inp.text ?? '', { speaker: 'user', final: !!inp.finished });
  if (sc?.interrupted) engine.interrupt();
}
```

**OpenAI Realtime** — with input audio transcription enabled:

```js
switch (event.type) {
  case 'response.output_audio_transcript.delta': engine.feed(event.delta, { speaker: 'avatar' }); break;
  case 'response.output_audio_transcript.done': engine.feed(event.transcript, { speaker: 'avatar', final: true }); break;
  case 'conversation.item.input_audio_transcription.completed': engine.feed(event.transcript, { speaker: 'user', final: true }); break;
  case 'input_audio_buffer.speech_started': engine.interrupt(); break;
}
```

With realtime voice the person's transcript often arrives after the avatar has started answering, too late to react to. To skip listening reactions, pass it with `engine.context(transcript)` instead of `feed()`.

**Text chat:**

```js
engine.feed(userMessage, { speaker: 'user', final: true });
for await (const chunk of llmStream) engine.feed(chunk, { speaker: 'avatar' });
engine.feed(fullReply, { speaker: 'avatar', final: true });
```

## Keys

`systemOne()` defaults to OpenRouter, which accepts browser requests, so a public page can use the **visitor's own key**. TypeSafe's own API is server-only. Options, other models and custom classifiers: [Appendix C](#appendix-c-classifiers).

**Never ship a key in a bundle** (Vite inlines every `VITE_*`). Let the visitor bring their own, or point `url` at a proxy that holds it. The demo keeps the key in `localStorage` and sends it only to openrouter.ai.

## Roadmap

Planned, not built yet: blending the top two expressions by Jev's probabilities · an intensity question (softer or stronger expressions and head movements) · a torso posture channel (leaning in or back, shrinking) · a demo avatar with hair and clothes physics (TalkingHead's Dynamic Bones) · a pose authoring tool that fits poses to a new avatar · camera-based listening (FaceMirror) as an optional plugin · the classifier picks the hand when the text asks for it ("raise your left hand"); today the director always plays the right hand.

## Licenses and credits

**Code:** [MIT](LICENSE), Copyright (c) 2026 lhupyn.

**Demo avatar — not MIT.** `demo/public/female_1.glb` was made with Ready Player Me, whose terms license such avatars under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/) (non-commercial). Don't use it in commercial products.

**Credits:** [TalkingHead](https://github.com/met4citizen/TalkingHead) by Mika Suominen (MIT) and [three.js](https://threejs.org) (MIT), loaded from a CDN in the demo · [Jev](https://typesafe.ai) by TypeSafe, the default decision model, called through its API · FACS sources in [Appendix D](#appendix-d-facs-sources).

---

## Appendix A: Configuration

`new MotionEngine(head, { classify, pause, director: {…}, face: {…}, body: {…} })`

| Option | Default | Description |
| --- | --- | --- |
| `classify` | `null` | The classifier ([Appendix C](#appendix-c-classifiers)). Without it, `feed()` does nothing. |
| `pause` | `800` | Send an unfinished sentence after this many ms without fragments. |

**`director`** (partial objects merge with the defaults)

| Option | Default | Description |
| --- | --- | --- |
| `minConfidence` | `{ expression: 0.45, head: 0.5, hands: 0.55 }` | Minimum confidence per channel. |
| `minClarity` | `0.5` | Person's lines: below this "intelligible" score, nothing plays. |
| `cooldown` | `{ head: 2500, hands: 4000 }` | Minimum ms between gestures per channel. |
| `relaxAfter` | `6000` | Ms after the last decision before relaxing to `neutral`. |

**`face`**

| Option | Default | Description |
| --- | --- | --- |
| `facs` | built-in `facs.json` | Expression catalog ([Appendix B](#appendix-b-catalogs)). |
| `fade` | `400` | Mood cross-fade, ms. Beats without an `envelope` use `{ in: 300, hold: 1500, out: 600 }`. |
| `speechMouth` | `0.3` | While a viseme plays, mouth-opening morphs (from AU10, AU16, AU20, AU25, AU26, AU27) drop to this share, so speech doesn't over-open the mouth or bare the teeth, and p/b/m still close. `1` = off. |
| `speechSmile` | `0.5` | The same for the lip corners (AU12, AU14: smile, dimple), which over-stretch the mouth on visemes. `1` = off. |

**`body`**

| Option | Default | Description |
| --- | --- | --- |
| `gestures` | built-in `gestures.json` | Gesture catalog, `{ head, hands, poses }`. |
| `fadeIn` | `800` | Arm transition into a pose, ms, unless the frame sets its own. |
| `fadeOut` | `800` | Hand gesture fade-out, ms. |
| `cutFade` | `100` | Arms back to the stance when a hand gesture is stopped early (`stop()`, `interrupt()`), ms. Another hand gesture takes the arms over instead. |
| `settle` | `1000` | Wait after a hand fade-out before the channel is free, ms. |

## Appendix B: Catalogs

Both catalogs ship as package exports (`motion-engine/facs.json`, `motion-engine/gestures.json`, or `…@2.1.0/src/facs.json` on the CDN). Pass your own:

```js
import facs from './my-facs.json' with { type: 'json' };
import gestures from './my-gestures.json' with { type: 'json' };

new MotionEngine(head, { classify: systemOne({ apiKey }), face: { facs }, body: { gestures } });
```

**Rules**

- Only entries with a `description` are offered to the classifier; the rest are manual-only (`face.play` / `body.play`). Bundled manual-only: `look_left`, `look_right`, `open_mouth`, `squint`, `neutral`.
- The description says *when* to use it: *"Warm, genuine smile: glad, pleased, friendly, good news."* A narrow one keeps a novelty for its cue: `vulcan_salute` (🖖) only on "live long and prosper" or a mention of Star Trek or Vulcans.
- Keep options distinct: similar options split the confidence and can both fall under the threshold.
- Check faces still and while talking; keep jaw opening out of held moods, or it fights the visemes.
- Keep an entry named `neutral`: the director relaxes to it.

### `facs.json`

Values are illustrative.

```json
{
  "au_map": { "AU12": { "mouthSmileLeft": 1, "mouthSmileRight": 1 } },
  "expressions": {
    "happy": { "description": "Warm, genuine smile: glad, pleased, friendly, good news.",
               "facs": "EMFACS-7 happiness: AU6+AU12", "aus": { "AU6": 0.25, "AU12": 0.5 } },
    "wink": { "description": "A playful wink: a shared secret, a joke, flirting.", "kind": "beat",
              "aus": { "AU43_L": 0.7 }, "envelope": { "in": 120, "hold": 140, "out": 220 } }
  }
}
```

| Field | Meaning |
| --- | --- |
| `au_map` | Action Unit → ARKit blendshapes with weights, calibrated per avatar. |
| `au_limits` | Optional, per avatar: `{ AU: { max, beatMax?, note } }`, the highest natural level in a held mood (`beatMax` for beats, default `max`). `AU12_L` counts as `AU12`. |
| `avoid` | Optional, per avatar: `[{ aus: { AU: level, … }, note }]`. No recipe may exceed every listed level at once. |
| `expressions.<name>.description` | When to use it; without it, the classifier never picks it. |
| `facs` | Provenance note; not used at runtime. |
| `kind` | `'mood'` (default) holds and cross-fades; `'beat'` plays once on top. |
| `aus` | AU → level. `_L` / `_R` makes it one-sided. Each AU adds level × `au_map` weight to the avatar's rest level, capped at 1. |
| `envelope` | Beats: `{ in, hold, out }` ms. |
| `whileSpeaking` | Beats, default `true`. `false`: the director never starts it while the avatar speaks (`yawn`); `face.play` still can. |
| `offset` | Beats: `{ AU: ms }`. That AU starts `ms` later and ends `ms` earlier, nested inside the rest (`tongue_out`); capped at half of `hold`. |

`au_limits` and `avoid` don't clamp: the tests fail if a bundled recipe breaks them, and a custom one plays as written with a console warning.

### `gestures.json`

`head` and `hands` hold gestures; `poses` holds custom arm poses. Trimmed example (the real `wave` also sways the forearm, and its pose sets shoulder, hand and finger bones):

```json
{
  "head": {
    "nod": { "description": "A head nod: agreeing, saying yes, confirming.", "dt": [260, 240, 240, 320],
             "vs": { "headMove": [0], "headRotateX": [0.18, -0.03, 0.13, 0], "headRotateZ": [0] } }
  },
  "hands": {
    "wave": { "description": "A wave: hello or goodbye.", "dt": [100, 1500], "rescale": [0, 1],
              "vs": { "gesture": [["hand_wave_low", null, true, 500], null] },
              "overlay": { "bones": { "RightHand": { "freq": 14, "amp": [0, 0.1, 0.125], "phase": 0 } },
                           "delay": 300, "duration": 1200 } }
  },
  "poses": {
    "hand_wave_low": { "LeftArm.rotation": { "x": 1.168, "y": 0.181, "z": 0.688 },
                       "LeftForeArm.rotation": { "x": -1.027, "y": -0.667, "z": 1.58 } }
  }
}
```

**Gestures** are TalkingHead animation templates ([TalkingHead README](https://github.com/met4citizen/TalkingHead), Appendix D): `dt` frame timings (a `[min, max]` pair is random; motion-engine times it by the midpoint), optional `rescale`, `vs` values per frame. Body only: a test keeps expression blendshapes out of `gestures.json`; only gaze (`eyeLook*`) may follow the head, as in `bow`.

**Hand frames** in `vs.gesture` are `[pose, duration, mirror, transitionMs]`:

| Item | Meaning |
| --- | --- |
| `pose` | A built-in (`handup`, `index`, `ok`, `thumbup`, `thumbdown`, `side`, `shrug`, `namaste`) or one from `poses`. |
| `duration` | `null` holds until the gesture ends. |
| `mirror` | `true` plays a one-hand pose with the right arm. Default `false`. |
| `transitionMs` | Time to reach the pose. Default: `fadeIn`. |

Frames fire at the `dt` boundaries, so several frames chain poses (`applause`). A new hand gesture moves the arms straight from pose to pose.

**Poses**: name → bone rotations in radians (Euler XYZ), as in TalkingHead's `gestureTemplates`. One-hand poses are written for the left arm. A pose can't reuse a built-in's name. The bundled poses fit the demo avatar; another avatar may need them re-solved.

**Overlays**: sine oscillations per bone: `freq` (rad/s), `amp` `[x, y, z]` (radians), `phase` (z only); `delay` (default 0) and `duration` (default: the gesture's length) in ms.

## Appendix C: Classifiers

### `systemOne()`

A client for the System One API; by default, Jev through OpenRouter.

| Option | Default | Description |
| --- | --- | --- |
| `apiKey` | — | OpenRouter or TypeSafe key. |
| `provider` | `'openrouter'` | `'openrouter'` (`https://openrouter.ai/api/v1/systemone`, browser OK) or `'typesafe'` (`https://api.typesafe.ai/v1/systemone`, server only). |
| `model` | `'~typesafe/jev-latest'` (OpenRouter), `'jev-latest'` (TypeSafe) | Model id. |
| `url` | provider endpoint | Your own proxy or a self-hosted model. |

Errors reject as `System One <status>: <message>` and reach `onDecision({ error })`.

### Other decision models

Other decision models speak the same API:

- **OpenRouter:** pick an id from its [decision models](https://openrouter.ai/api/v1/models?output_modalities=decisions) (JSON): `systemOne({ apiKey, model: '<id>' })`.
- **Self-hosted:** [Kev](https://github.com/jaredpalmer/kev) or [Laya](https://github.com/NandhaKishorM/laya) serve `POST /v1/systemone`: `systemOne({ url: 'http://localhost:8009/v1/systemone', model: '<id>' })`. A web page needs CORS on your server, or call it from your backend.
- **Local / in the browser:** [open-jev](https://github.com/nico-martin/open-jev) runs decision models with Transformers.js and can be wrapped as a custom `classify`. Measured in Node on CPU ([bench/](bench/#local-models)), kev-0.6b and open-jev don't replace Jev yet, and DeBERTa's 512 tokens don't hold the questions; kev-4b (below, through OpenRouter) is promising with low thresholds. In Chrome, kev-0.6b runs on WebGPU (not WASM) and gives the same answers, at the same speed as the CPU on a 2015 laptop's integrated GPU.

The default thresholds are tuned for Jev. [bench/](bench/) compares 15 models on 150 annotated lines with the director's real questions, and most of the difference between them is how they spread their confidence. A few, cross-validated with thresholds fitted per model:

| model | acts | wrong | $/line | suggested `minConfidence` (expression / head / hands) |
| --- | --- | --- | --- | --- |
| typesafe/jev-1.14 (default) | 95% | 25 | 0.000081 | 0.35 / 0.70 / 0.55 |
| liquid/d1 | 97% | 9 | 0.000022 | 0.00 / 0.65 / 0.45 |
| perplexity/pplx-decider-v1.2 | 93% | 19 | 0.000025 | 0.00 / 0.40 / 0.40 |
| cloudflare/clef | 93% | 16 | 0.000104 | 0.20 / 0.65 / 0.45 |
| liquid/d1-ultra | 93% | 20 | 0.000047 | 0.30 / 0.60 / 0.50 |
| jaredpalmer/kev-4b | 89% | 21 | 0.000048 | 0.10 / 0.35 / 0.25 |

acts: the right expression + hand gesture where one is needed; wrong: actions played that aren't acceptable, in one pass over the 150 lines. The suggested thresholds were fit on the same lines: start from them for another model and check its answers in `onDecision`.

### Custom classifier

```js
new MotionEngine(head, { classify: async (state, questions, { signal }) => ({ answers }) });
```

**`state`** (`previous` omitted on the first line):

```js
{ speaker: 'avatar' | 'user', text: 'Wait, really?', previous: { speaker: 'user', text: 'I got the job.' } }
```

**`questions`** (`clear` only for the person's lines; `criteria` maps option names to catalog descriptions, plus `none`):

```js
{
  expression: { type: 'choice', instructions: '…', criteria: { happy: 'Warm, genuine smile: …', /* … */ none: 'No change of expression.' } },
  head:       { type: 'choice', instructions: '…', criteria: { nod: 'A head nod: …', /* … */ none: 'No head movement.' } },
  hands:      { type: 'choice', instructions: '…', criteria: { /* … */ none: 'No hand gesture.' } },
  clear:      { type: 'noul', instructions: '…', criteria: { true: '…', false: '…' } },
}
```

**Return** `Promise<{ answers, model?, usage?, ms? }>`:

| Key | Shape | Meaning |
| --- | --- | --- |
| `answers.expression`, `.head`, `.hands` | `{ choice, confidence }` | `choice` is a `criteria` key; `'none'` or missing plays nothing. `confidence` 0–1; missing counts as below `minConfidence`. |
| `answers.clear` | `{ noul }` | 0–1, how likely the line is intelligible; missing counts as clear. |

`model`, `usage` and `ms` pass through to `onDecision`. Honor `signal`: reject with an `AbortError` and nothing is reported; any other rejection becomes `onDecision({ error })`. The avatar's answers arriving after `interrupt()`, and all answers after `dispose()`, are dropped either way.

## Appendix D: FACS sources

The seven core emotions use the canonical EMFACS-7 AU combinations; the other expressions are blends of the same AUs, with provenance in each `facs` field.

- **EMFACS-7** (Ekman & Friesen, 1983) — [paulekman.com](https://www.paulekman.com/facial-action-coding-system/)
- **ARKit ↔ FACS** — [Melinda Ozel's cheat sheet](https://melindaozel.com/arkit-to-facs-cheat-sheet/) · [clinical blendshape ↔ AU mapping](https://www.sciencedirect.com/science/article/pii/S2451958826001995) · [interactive ARKit-52 ↔ AU guide](https://arkit.miniface.org/faces)
- **AU-Blendshape**, per-model AU calibration — [arXiv:2507.12001](https://arxiv.org/abs/2507.12001)

## Appendix E: Development

```bash
npm install
npm run demo     # Vite dev server for demo/
npm test         # Vitest, incl. the adapter contract test against TalkingHead's source
npm run build    # Build the demo into dist/
npm run lint     # ESLint
npm run format   # Prettier (format:check to verify only)
npm run types    # Regenerate types/ from the JSDoc
```

Commit the regenerated `types/` with any change to the public JSDoc, or CI fails. CI runs lint, format, types, tests and build on every push and PR; pushing to `main` also deploys the demo to GitHub Pages.
