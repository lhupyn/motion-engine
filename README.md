# MotionEngine

> **Semantic motion layer for LLM-driven 3D avatars.**

A plugin for [TalkingHead](https://github.com/met4citizen/TalkingHead) that turns low-level avatar animation into a simple semantic vocabulary. Instead of making LLMs reason about morph targets, bone rotations, and animation timing, MotionEngine lets them pick from a curated catalog of named motions — saving tokens and improving reliability.

**[Live Demo](https://lhupyn.github.io/motion-engine/)** · **[LLM Playground](https://lhupyn.github.io/motion-engine/playground.html)** · **[Face Mirror](https://lhupyn.github.io/motion-engine/mirror.html)**

---

## What this PoC explores

TalkingHead already includes a solid animation system. MotionEngine builds on top of it to explore a few ideas:

- **Compound motions as data** — Define face + hands + body + bone overlays in a single JSON object, instead of coordinating multiple API calls
- **Multi-track playback** — Keep a persistent mood active while temporal actions (gestures, expressions) play on top and finish
- **Expanded vocabulary** — 137+ data-driven motions with fine-grained nuance (`shy`, `nervous`, `curious`, `smirk`...) that extend TH's built-in set
- **Declarative bone overlays** — Sinusoidal oscillations on bones (body shakes, arm waves, shivers) with automatic fade in/out, defined as parameters instead of per-frame code
- **LLM-friendly discovery** — `getLLMContext()` produces a compact, token-efficient catalog that can be injected into system prompts
- **LLM-generated motions** — The [Playground](https://lhupyn.github.io/motion-engine/playground.html) demonstrates using an LLM to create new motions from natural language descriptions, which can then be played directly or saved to the catalog
- **Motion sequencing** — Chain motions with interruption support
- **Face mirroring** — Detect user facial expressions via MediaPipe and mirror them as avatar moods in real-time

```js
// Mood persists while action plays on top:
engine.play('happy');       // mood stays active...
engine.play('wave_right');  // ...compound action plays and finishes
```

> This is a **proof of concept** for a plugin architecture on top of TalkingHead. None of this replaces TH's built-in system — it's an exploration of what a data-driven semantic layer could look like for LLM-driven avatar control.

---

## Architecture

### `MotionEngine` — The Player (runtime)
Core playback engine. Every consumer imports this.

- **Multi-track state machine**: 3 parallel tracks (`pose`, `mood`, `action`)
- **Track routing**: reads `_track` from motion metadata, falls back to heuristics
- **Native mood injection**: custom moods are registered into TH's `animMoods` for seamless transitions
- **Registration**: `registerMotions()` — parses metadata, registers animEmojis
- **Playback**: `play(name, dur)`, `playSequence(names)`, `stop()`
- **Render loop**: `update(dt)` — bone overlay oscillations per-frame

### `MotionStudio` — Authoring & Discovery (optional)
Wraps a MotionEngine instance. LLM integration, discovery, dynamic creation, aliases.

- **Discovery**: `getMotions()`, `getMotionsCompact()`, `getMotionsForPrompt()`, `getLLMContext()`
- **Avatar inspection**: `getAvatarCapabilities()` — morph targets + bones
- **Dynamic motions**: `parseDynamic()`, `playDynamic()`, `registerDynamic()`
- **Aliases**: morph name mapping, bone name mapping
- **Utilities**: `wrapMorph()` — bare morph target → full motion definition

### Track System

| Track | Behavior | Example |
|-------|----------|---------|
| **pose** | Persistent body position | `standing`, `sitting` |
| **mood** | Persistent emotional state | `thinking`, `angry`, `shy` |
| **action** | Temporal, interrupts previous | `wave_right`, `nod_yes`, `laugh` |

Moods persist while actions play on top. Actions interrupt each other. Poses and moods apply immediately.

---

## Install

```bash
npm install github:lhupyn/motion-engine
```

## Usage

### Player only (most consumers)

```js
import { MotionEngine } from 'motion-engine';
import motions from 'motion-engine/motions';

const engine = new MotionEngine(talkingHead);
engine.registerMotions(motions);

// Hook into TalkingHead render loop (required for overlays)
talkingHead.opt.update = (dt) => engine.update(dt);

// Set a mood (persists)
await engine.play('thinking');

// Play an action on top (mood stays active)
await engine.play('nod_yes');

// Play a sequence
await engine.playSequence(['wave_right', 'thumbup_right']);
```

### Player + Studio (LLM integration)

```js
import { MotionEngine } from 'motion-engine';
import { MotionStudio } from 'motion-engine/studio';
import motions from 'motion-engine/motions';

const engine = new MotionEngine(talkingHead);
const studio = new MotionStudio(engine, {
  aliases: { eyesClosed: ['eyeBlinkLeft', 'eyeBlinkRight'] },
});

engine.registerMotions(motions);
talkingHead.opt.update = (dt) => engine.update(dt);

// Get compact LLM context for system prompt
const context = studio.getLLMContext();

// Play a dynamic motion from LLM JSON
await studio.playDynamic('{"dt": [500, 2000, 500], "vs": {"mouthSmile": [0.8]}}');
```

### Face Mirror (webcam expression mirroring)

```js
import { MotionEngine } from 'motion-engine';
import motions from 'motion-engine/motions';

const engine = new MotionEngine(talkingHead);
engine.registerMotions(motions);
talkingHead.opt.update = (dt) => engine.update(dt);

// Start mirroring from a video element
await engine.startMirror(videoEl, { threshold: 0.3, cooldown: 2000 });

// Pause/resume (e.g. while avatar is speaking)
engine.pauseMirror();
engine.resumeMirror();

// Stop and dispose
engine.stopMirror();
```

#### Standalone usage (without MotionEngine)

```js
import { FaceMirror } from 'motion-engine/mirror';
import motions from 'motion-engine/motions';

const mirror = new FaceMirror({ threshold: 0.3, cooldown: 2000 });
mirror.loadMotions(motions);
await mirror.init();

mirror.onMood = (mood, score, blendshapes) => {
  console.log(`Detected: ${mood} (${score.toFixed(2)})`);
};

mirror.start(videoEl);

// Call in your render loop:
mirror.update(dt);
```

> **Peer dependency:** `@mediapipe/tasks-vision >= 0.10.0` (optional — only needed when using FaceMirror).

---

## API

### `new MotionEngine(talkingHead, options?)`

| Option | Default | Description |
|---|---|---|
| `gestureFadeIn` | `800` | Fade-in for gesture playback (ms) |
| `gestureFadeOut` | `800` | Fade-out when stopping a gesture (ms) |
| `stopFade` | `100` | Quick fade for interrupt stops (ms) |
| `stopSettleTime` | `1000` | Wait after stopGesture before cleanup (ms) |
| `poseFadeIn` | `1500` | Transition time for pose changes (ms) |
| `poseSettleTime` | `1700` | Wait after setPoseFromTemplate (ms) |
| `nativeDuration` | `3` | Default duration for native gestures (s) |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `registerMotions(motions)` | `number` | Register motion dictionary, returns count |
| `play(name, dur?)` | `Promise<void>` | Play motion with multi-track routing |
| `playSequence(names)` | `Promise<void>` | Play motions sequentially |
| `stop()` | — | Force-stop current action |
| `freeze(enabled?)` | — | Stop all idle animations (breathing, blinking, etc.) |
| `getMotionNames()` | `string[]` | All registered motion names |
| `getRegisteredMotions()` | `object` | Internal motions dict (for Studio) |
| `update(dt)` | — | Frame hook: bone overlays + face mirror |
| `startMirror(videoEl, opts?)` | `Promise<void>` | Start face mirroring from webcam |
| `stopMirror()` | — | Stop and dispose face mirror |
| `pauseMirror()` | — | Pause face detection |
| `resumeMirror()` | — | Resume face detection |

#### Properties

| Property | Type | Description |
|---|---|---|
| `playing` | `boolean` (getter) | Whether an action is currently playing |
| `tracks` | `object` | Multi-track state: `{ pose, mood, action }` |
| `onStart` | `function\|null` | Callback when motion starts |
| `onEnd` | `function\|null` | Callback when motion finishes |
| `onError` | `function\|null` | Callback when motion fails |
| `mirror` | `FaceMirror\|null` (getter) | Access FaceMirror for advanced config |

### `new FaceMirror(options?)`

| Option | Default | Description |
|---|---|---|
| `threshold` | `0.3` | Min score to trigger mood change |
| `cooldown` | `2000` | Ms between mood changes |
| `detectInterval` | `200` | Ms between detections (5 FPS) |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `loadMotions(motions)` | `number` | Extract classifiers from `_detect` in mood entries |
| `init(opts?)` | `Promise<void>` | Load MediaPipe FaceLandmarker |
| `start(videoEl)` | — | Start detection from video element |
| `stop()` | — | Stop detection, keep MediaPipe loaded |
| `pause()` / `resume()` | — | Pause/resume detection |
| `_classify(blendshapes)` | `{mood, score}` | Score blendshapes (public for testing) |
| `dispose()` | — | Release all resources |

#### Callbacks

| Callback | Signature | Description |
|---|---|---|
| `onMood` | `(mood, score, blendshapes)` | Fired on mood change (after cooldown) |
| `onDetect` | `(blendshapes)` | Fired on every detection frame |

### `_detect` schema

Mood entries in `motions.json` can include a `_detect` object for face mirroring:

```json
{
  "happy": {
    "_track": "mood",
    "_detect": {
      "mouthSmileLeft": 0.5,
      "mouthSmileRight": 0.5
    }
  }
}
```

Keys are MediaPipe ARKit blendshape names, values are linear weights. The classifier computes a weighted average: `score = sum(blendshape * weight) / sum(weights)`. The highest-scoring mood above `threshold` wins; otherwise falls back to `neutral`.

### `new MotionStudio(engine, options?)`

| Option | Default | Description |
|---|---|---|
| `aliases` | `{}` | Morph name aliases |
| `boneAliases` | `{}` | Bone name aliases |
| `morphWhitelist` | ARKit standard | For `getAvatarCapabilities()` |
| `boneWhitelist` | Common anchors | For `getAvatarCapabilities()` |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `getAvatarCapabilities()` | `{morphTargets, bones}` | Scan avatar anatomy |
| `getMotions()` | `Array<{name, description, tags, track}>` | Full metadata |
| `getMotionsCompact()` | `Object<tag, names[]>` | Grouped by primary tag |
| `getMotionsForPrompt(level?)` | `string` | `'full'` / `'compact'` / `'minimal'` |
| `getLLMContext()` | `string` | Compact context for system prompts |
| `parseDynamic(json)` | `{name, motion}` | Parse raw JSON from LLM |
| `playDynamic(json)` | `Promise<void>` | Parse + register + play |
| `registerDynamic(name, obj)` | — | Register with alias normalization |
| `wrapMorph(name, opts?)` | `object` | Bare morph → full motion definition |

---

## Motion Format

```json
{
  "my_motion": {
    "_description": "Human-readable description for LLM discovery",
    "_tags": ["emotion", "category"],
    "_track": "action",
    "dt": [300, 2000, 500],
    "rescale": [0, 1, 0],
    "vs": {
      "mouthSmile": [0.6],
      "gesture": [["handup", null, true], null]
    },
    "_overlay": {
      "bones": {
        "RightHand": { "freq": 8, "amp": [0, 0.12, 0.12], "phase": 0 }
      },
      "delay": 400,
      "duration": 2500
    }
  }
}
```

The `_track` field controls routing:
- `"mood"` — persistent emotional state, injected into TH's native mood system
- `"action"` — temporal gesture, uses TalkingHead gesture playback (default)

---

## Development

```bash
git clone https://github.com/lhupyn/motion-engine.git
cd motion-engine
npm install
npm run demo        # dev server with hot reload
npm test            # run tests
npm run test:watch  # watch mode
```

---

## Credits

- **[TalkingHead](https://github.com/met4citizen/TalkingHead)** by Mika Suominen — MIT License.
- **Demo avatar**: Created with [Ready Player Me](https://readyplayer.me/).

## License

MIT
