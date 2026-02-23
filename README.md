# MotionEngine

> **Proof of concept** — Data-driven motion control for 3D avatars.

MotionEngine is a plugin for [TalkingHead](https://github.com/met4citizen/TalkingHead) that adds expressive, multi-layered animations (gestures + facial expressions + procedural bone oscillations). It is designed specifically for **AI Agents** that need a semantic vocabulary to control avatars.

**[Live Demo](https://lhupyn.github.io/motion-engine/)** · **[LLM Playground](https://lhupyn.github.io/motion-engine/playground.html)**

---

## Features

- **54 built-in motions** with synchronized facial expressions, gestures, and body movement
- **Bone oscillation overlays** (e.g., hand waving, hip bounce, laugh tremor) via `poseDelta`
- **Motion sequencing** — chain motions for multi-step animations
- **Motion interruption** — new motions cleanly interrupt running ones
- **LLM Autodiscovery** — `getAvatarCapabilities()` scans the 3D model's morph targets and bones dynamically
- **Configurable timing** — all fade/settle durations are constructor options
- **Morph & bone aliases** — map LLM-friendly names to real targets (e.g., `eyesClosed` → `eyeBlinkLeft` + `eyeBlinkRight`)
- **Raw JSON dynamic motions** — LLMs can send motion definitions as JSON strings
- **LLM-safe normalization** — auto-wraps scalar values as arrays, applies aliases
- **Fallback** to native TalkingHead gestures, emojis, and poses
- **No DOM dependencies** — works as a pure plugin
- **Data-driven** — motions are pure JSON, no code changes needed to add new ones

---

## Install

```bash
npm install github:lhupyn/motion-engine
```

## Usage

```js
import { MotionEngine } from 'motion-engine';
import motions from 'motion-engine/motions';

const engine = new MotionEngine(talkingHead);
engine.registerMotions(motions);

// Hook into TalkingHead render loop
talkingHead.opt.update = (dt) => engine.update(dt);

// Play a motion
await engine.play('wave_right');

// Play a sequence
await engine.playSequence(['thinking', 'nod_yes', 'celebrate']);

// Discover avatar capabilities
const caps = engine.getAvatarCapabilities();
console.log(caps.morphTargets); // ['mouthSmile', 'eyeBlinkLeft', ...]
console.log(caps.bones);        // ['Neck', 'RightHand', ...]

// Get compact LLM context
const context = engine.getLLMContext();
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
| `aliases` | `{}` | Morph name aliases (e.g., `{eyesClosed: ['eyeBlinkLeft','eyeBlinkRight']}`) |
| `boneAliases` | `{}` | Bone name aliases (e.g., `{Head: 'Neck', Spine: 'Spine2'}`) |
| `autoWrapMorphs` | `false` | Auto-wrap bare morph target names as dynamic motions |
| `morphWhitelist` | ARKit standard | Custom morph target whitelist for `getAvatarCapabilities()` |
| `boneWhitelist` | Common anchors | Custom bone whitelist for `getAvatarCapabilities()` |

### `engine.registerMotions(motions) → number`

Register a dictionary of custom motions. Returns the number registered.

### `engine.play(name, dur?) → Promise<void>`

Play a motion by name. Resolution order: custom → raw JSON → native gesture/emoji → pose → bare morph (if `autoWrapMorphs`).

### `engine.playSequence(names) → Promise<void>`

Play an array of motions sequentially.

### `engine.stop()`

Force-stop the current motion with clean cancellation.

### `engine.getMotionNames() → string[]`

Get all registered custom motion names.

### `engine.getMotions() → Array<{name, description, tags}>`

Get full motion metadata for LLM tool discovery (~660 tokens).

### `engine.getMotionsCompact() → Object<string, string[]>`

Get motions grouped by primary tag — 75% fewer tokens (~164 tokens).

### `engine.getMotionsForPrompt(level?) → string`

| Level | ~Tokens | Output |
|---|---|---|
| `'full'` | ~660 | `- wave_right: Friendly wave with hand oscillation...` |
| `'compact'` (default) | ~164 | `greeting: wave_right, wave_left, namaste_bow` |
| `'minimal'` | ~103 | `wave_right, wave_left, thumbup_right, ...` |

### `engine.getAvatarCapabilities() → {morphTargets: string[], bones: string[]}`

Scans the TalkingHead instance to discover morph targets and bones. Filters through configurable whitelists.

### `engine.getLLMContext() → string`

Get a compact context string for LLM system prompts. Includes avatar capabilities and available presets grouped by tag.

### `engine.update(dt)`

Frame update hook for oscillation overlays. Connect via `head.opt.update = (dt) => engine.update(dt);`

### Callbacks

```js
engine.onStart = (name) => { /* motion started */ };
engine.onEnd = (name) => { /* motion finished */ };
engine.onError = (name, error) => { /* motion failed */ };
```

---

## Built-in motions (54)

### Gestures
| Motion | Description |
|---|---|
| `wave_right` / `wave_left` | Waving with hand oscillation overlay |
| `thumbup_right` | Thumbs up with smile and raised brows |
| `thumbdown_right` | Thumbs down with frown |
| `point` | Pointing gesture with focused expression |
| `ok_wink` | OK sign with playful wink |
| `shrug_confused` | Confused shrug with uncertain mouth |
| `namaste_bow` | Namaste with prayer hands and bow |

### Head & Body
| Motion | Description |
|---|---|
| `nod_yes` / `shake_no` | Affirmative nod / disapproving shake |
| `look_up` / `look_down` | Looking up (pondering) / down (reflective) |
| `bow` | Respectful bow with closed eyes |
| `jump` | Excited jump with Hips position arc |
| `celebrate` | Joyful celebration with hand wave overlay |
| `turn_around` | Playful 360-degree spin |

### Expressions
| Motion | Description |
|---|---|
| `thinking` | Deep thought with asymmetric brow |
| `surprised` | Shocked with wide eyes and open mouth |
| `wink` | Playful wink with body lean |
| `angry` / `sad` | Intense anger / deep sadness |
| `laugh` | Hearty laugh with spine oscillation overlay |
| `yawn` | Tired yawn with wide jaw |
| `nervous` | Nervous fidgeting with quick head shifts |
| `shy` | Bashful head turn with downcast gaze |
| `listen` | Attentive listening with tilted head |
| `excited` | Bursting excitement with rapid hand wave |

### Advanced
| Motion | Description |
|---|---|
| `tongueout` | Playful tongue sticking out |
| `kiss` | Blowing a kiss with wink |
| `eyeroll` | Dramatic eye roll |
| `smirk` | Sly one-sided smirk |
| `grimace` | Pained grimace with clenched teeth |
| `pleading` | Puppy-dog pleading face |
| `sleeping` | Peacefully sleeping |
| `sigh` | Deep sigh with visible breathing (`chestInhale`) |

### Utility
| Motion | Description |
|---|---|
| `applause` | Clapping with hand oscillation |
| `dance` | Rhythmic dance with hip bounce |
| `facepalm` | Hand to forehead with slump |
| `dismiss` | Dismissive wave-off with head turn |

### Facial presets
| Motion | Description |
|---|---|
| `raise_eyebrows` | Raised eyebrows with wide eyes |
| `frown` | Furrowed brows and turned-down mouth |
| `open_mouth` | Mouth wide open in awe |
| `cheek_puff` | Puffed cheeks, playful or holding breath |
| `close_eyes` | Gently closed eyes, relaxed |
| `squint` | Squinting, suspicious or scrutinizing |

### Direction & Body
| Motion | Description |
|---|---|
| `look_left` / `look_right` | Looking sideways with eyes and head turn |
| `head_circles` | Slow circular head movement with Neck overlay |
| `shiver` | Rapid tremors on Spine1/Spine2/Neck |
| `chew` | Rhythmic jaw movement (6 phases) |
| `deep_breath` | Visible chest inhale/exhale cycle |

### Compound
| Motion | Description |
|---|---|
| `vibrate` | Rapid micro-vibration on Hips |
| `curious` | Tilted head, raised brow, wide eyes |
| `disgust` | Nose scrunch, frown, and recoil |

---

## Custom motions format

```json
{
  "my_motion": {
    "_description": "Human-readable description for LLM discovery",
    "_tags": ["emotion", "category"],
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

---

## Demo

Run locally:

```bash
git clone https://github.com/lhupyn/motion-engine.git
cd motion-engine
npm install
npm run demo
```

Click **"Audit Avatar"** in the demo to see the autodiscovery engine in action.

---

## LLM Playground

The **[LLM Playground](https://lhupyn.github.io/motion-engine/playground.html)** is a browser-based authoring tool for creating avatar motions with AI. Describe a movement in natural language, and an LLM generates playable motion JSON in real time.

### How it works

1. **Avatar scanning** — MotionEngine discovers the loaded avatar's morph targets and skeleton bones at runtime via `getAvatarCapabilities()`
2. **Prompt injection** — The discovered capabilities, existing motion presets, and 6 real examples from the dictionary are injected into the LLM system prompt (few-shot)
3. **Generation** — The LLM (Gemini, OpenAI, or Claude) produces a valid motion JSON definition
4. **Preview** — Edit the JSON if needed, then play it directly on the avatar

### Two complementary layers

| Layer | Purpose | Speed |
|-------|---------|-------|
| **Semantic dictionary** | Runtime playback — LLM agent calls `play("thinking")` | Instant |
| **LLM motion creator** | Authoring — describe a movement, AI generates the JSON | 3-15 seconds |

The dictionary is for real-time conversations (fast, predictable). The playground is for expanding the dictionary without being a 3D animator (slow, creative, infinite variety).

### Supported providers

| Provider | Default model |
|----------|--------------|
| Gemini | `gemini-3.1-pro-preview` |
| OpenAI | `gpt-5.2` |
| Claude | `claude-opus-4-6` |

API keys are stored in `localStorage` and calls are made client-side — no backend required.

---

## Credits

- **[TalkingHead](https://github.com/met4citizen/TalkingHead)** by Mika Suominen — MIT License.
- **Demo avatar**: Created with [Ready Player Me](https://readyplayer.me/).

## License

MIT
