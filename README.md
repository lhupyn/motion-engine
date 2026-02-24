# MotionEngine

> **Semantic motion layer for LLM-driven 3D avatars.**

A plugin for [TalkingHead](https://github.com/met4citizen/TalkingHead) that turns low-level avatar animation into a simple semantic vocabulary. Instead of making LLMs reason about morph targets, bone rotations, and animation timing, MotionEngine lets them pick from a curated catalog of named motions — saving tokens and improving reliability.

**[Live Demo](https://lhupyn.github.io/motion-engine/)** · **[LLM Playground](https://lhupyn.github.io/motion-engine/playground.html)**

---

## Why

TalkingHead provides powerful low-level animation primitives: morph targets (52+ ARKit blendshapes), gesture templates, pose templates, mood baselines, and `poseDelta` bone control. But asking an LLM to use them directly means:

- Sending the full anatomy (morph names, bone hierarchy, value ranges) in every system prompt
- The LLM must reason about timing arrays, value envelopes, and coordinate systems
- Face, hands, and body are separate API calls that the LLM must orchestrate
- High token cost and frequent malformed output

**MotionEngine solves this with a semantic abstraction layer:**

```
// Without MotionEngine — LLM must produce this:
{"dt":[300,2000,500],"rescale":[0,1,0],
 "vs":{"mouthSmile":[0.6],"eyeSquintLeft":[0.3],"eyeSquintRight":[0.3],
       "browInnerUp":[0.3],"gesture":[["handup",null,true],null]},
 "_overlay":{"bones":{"RightHand":{"freq":8,"amp":[0,0.12,0.12]}},"delay":400,"duration":2500}}

// With MotionEngine — LLM just says:
engine.play('wave_right')
```

### What it adds over vanilla TalkingHead

| | TalkingHead | + MotionEngine |
|---|---|---|
| **LLM interface** | Raw morph targets + timing arrays | Semantic names: `play('thinking')` |
| **Compound motions** | Face, hands, body = separate APIs | One JSON defines all layers |
| **Concurrency** | Manual state management | Multi-track: mood persists while action plays on top |
| **Bone animation** | Manual `poseDelta` per frame | Declarative oscillations with auto fade in/out |
| **Sequencing** | Not built-in | `playSequence(['wave', 'bow'])` with interruption |
| **LLM discovery** | Not built-in | `getLLMContext()` → compact catalog for system prompt |
| **Token cost** | Full anatomy + format + examples | Semantic tags, ~75% fewer tokens |

> **PoC status**: This is a proof of concept for a plugin architecture on top of TalkingHead. The goal is to demonstrate that a semantic layer dramatically simplifies LLM-driven avatar control.

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
| `update(dt)` | — | Frame hook: bone overlays |

#### Properties

| Property | Type | Description |
|---|---|---|
| `playing` | `boolean` (getter) | Whether an action is currently playing |
| `tracks` | `object` | Multi-track state: `{ pose, mood, action }` |
| `onStart` | `function\|null` | Callback when motion starts |
| `onEnd` | `function\|null` | Callback when motion finishes |
| `onError` | `function\|null` | Callback when motion fails |

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
