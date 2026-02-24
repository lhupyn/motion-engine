# MotionEngine

> **Multi-track motion engine for 3D avatars** — Data-driven animation control.

MotionEngine is a plugin for [TalkingHead](https://github.com/met4citizen/TalkingHead) that adds expressive, multi-layered animations (gestures + facial expressions + procedural bone oscillations). It is designed specifically for **AI Agents** that need a semantic vocabulary to control avatars.

**[Live Demo](https://lhupyn.github.io/motion-engine/)** · **[LLM Playground](https://lhupyn.github.io/motion-engine/playground.html)**

---

## Architecture: 2-Module Split

### `MotionEngine` — The Player (runtime)
Core playback engine. Every consumer imports this.

- **Multi-track state machine**: 3 parallel tracks (`pose`, `mood`, `action`)
- **Track routing**: reads `_track` from motion metadata, falls back to heuristics
- **Mood blending**: procedural morph interpolation with cosine ease-in, "extreme magnitude wins" safe override
- **Registration**: `registerMotions()` — parses metadata, registers animEmojis
- **Playback**: `play(name, dur)`, `playSequence(names)`, `stop()`
- **Render loop**: `update(dt)` — OverlayManager + manual mood morph blending per-frame

### `MotionStudio` — Authoring & Discovery (optional)
Wraps a MotionEngine instance. LLM integration, discovery, dynamic creation, aliases.

- **Discovery**: `getMotions()`, `getMotionsCompact()`, `getMotionsForPrompt()`, `getLLMContext()`
- **Avatar inspection**: `getAvatarCapabilities()` — morph targets + bones
- **Dynamic motions**: `parseDynamic()`, `playDynamic()`, `registerDynamic()`
- **Aliases**: morph name mapping, bone name mapping
- **Auto-wrap**: `wrapMorph()` — bare morph → full motion definition

### Track System

| Track | Behavior | Example |
|-------|----------|---------|
| **pose** | Persistent body position | `standing`, `sitting` |
| **mood** | Persistent, blended procedurally | `thinking`, `angry`, `shy` |
| **action** | Temporal, interrupts previous | `wave_right`, `nod_yes`, `laugh` |

Moods persist while actions play on top. Actions interrupt each other. Poses and moods apply immediately.

---

## Features

- **54 built-in motions** with `_track` metadata (14 moods + 40 actions)
- **Multi-track concurrency** — mood persists while action plays
- **Bone oscillation overlays** via `poseDelta`
- **Motion sequencing** — chain motions for multi-step animations
- **Motion interruption** — new actions cleanly interrupt running ones
- **LLM Autodiscovery** — `getAvatarCapabilities()` scans morph targets and bones
- **Raw JSON dynamic motions** — LLMs can send motion definitions as JSON
- **Morph & bone aliases** — map LLM-friendly names to real targets
- **Configurable timing** — all fade/settle durations are constructor options
- **Fallback** to native TalkingHead gestures, emojis, and poses
- **No DOM dependencies** — works as a pure plugin
- **Data-driven** — motions are pure JSON

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

// Hook into TalkingHead render loop (required for mood blending + overlays)
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
  boneAliases: { Head: 'Neck' },
});

engine.registerMotions(motions);
talkingHead.opt.update = (dt) => engine.update(dt);

// Discover avatar capabilities
const caps = studio.getAvatarCapabilities();
console.log(caps.morphTargets); // ['mouthSmile', 'eyeBlinkLeft', ...]
console.log(caps.bones);        // ['Neck', 'RightHand', ...]

// Get compact LLM context for system prompt
const context = studio.getLLMContext();

// Play a dynamic motion from LLM JSON
await studio.playDynamic('{"custom_wave": {"dt": [500, 2000, 500], "vs": {"mouthSmile": [0.8]}}}');

// Get motions for prompt injection
const prompt = studio.getMotionsForPrompt('compact');
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
| `getMotionNames()` | `string[]` | All registered motion names |
| `getRegisteredMotions()` | `object` | Internal motions dict (for Studio) |
| `update(dt)` | — | Frame hook: overlays + mood blending |

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
| `autoWrapMorphs` | `false` | Auto-wrap bare morph names |
| `morphWhitelist` | ARKit standard | For `getAvatarCapabilities()` |
| `boneWhitelist` | Common anchors | For `getAvatarCapabilities()` |

#### Methods

| Method | Returns | Description |
|---|---|---|
| `getAvatarCapabilities()` | `{morphTargets, bones}` | Scan avatar anatomy |
| `getMotionNames()` | `string[]` | All registered motion names |
| `getMotions()` | `Array<{name, description, tags, track}>` | Full metadata |
| `getMotionsCompact()` | `Object<tag, names[]>` | Grouped by primary tag |
| `getMotionsForPrompt(level?)` | `string` | `'full'` / `'compact'` / `'minimal'` |
| `getLLMContext()` | `string` | Compact context for system prompts |
| `parseDynamic(json)` | `{name, motion}` | Parse raw JSON from LLM |
| `playDynamic(json)` | `Promise<void>` | Parse + register + play |
| `registerDynamic(name, obj)` | — | Register with alias normalization |
| `setAliases(morphAliases)` | — | Configure morph aliases |
| `setBoneAliases(boneAliases)` | — | Configure bone aliases |
| `applyMorphAliases(vs)` | `object` | Transform vs through aliases |
| `applyBoneAliases(bones)` | `object` | Transform bones through aliases |
| `wrapMorph(name, opts?)` | `object` | Bare morph → full motion definition |

---

## Built-in Motions (54)

### Moods (14 — persistent, blended with actions)

| Motion | Description |
|---|---|
| `thinking` | Deep thought with asymmetric brow and tilted head |
| `angry` | Intense anger with furrowed brows and clenched fists |
| `sad` | Deep sadness with drooped brows and slumped posture |
| `nervous` | Nervous fidgeting with quick head shifts |
| `shy` | Bashful head turn with downcast gaze |
| `listen` | Attentive listening with tilted head |
| `smirk` | Sly one-sided smirk with side glance |
| `grimace` | Pained grimace with clenched teeth |
| `pleading` | Puppy-dog pleading with big eyes |
| `sleeping` | Peacefully sleeping with closed eyes |
| `frown` | Displeased frown with furrowed brows |
| `squint` | Squinting, suspicious or scrutinizing |
| `curious` | Curious tilted head with wide eyes |
| `disgust` | Disgusted nose scrunch and recoil |

### Actions (40 — temporal, interrupt each other)

| Motion | Description |
|---|---|
| `wave_right` | Friendly wave with right hand and warm smile |
| `wave_left` | Friendly wave with left hand and warm smile |
| `thumbup_right` | Enthusiastic thumbs up with big smile |
| `thumbdown_right` | Disapproving thumbs down with frown |
| `point` | Pointing gesture with focused expression |
| `ok_wink` | OK hand sign with playful wink |
| `shrug_confused` | Confused shrug with raised eyebrows |
| `namaste_bow` | Respectful namaste with prayer hands |
| `nod_yes` | Affirmative head nod with subtle smile |
| `shake_no` | Disapproving head shake with frown |
| `look_up` | Looking upward as if pondering |
| `look_down` | Looking downward, reflective or shy |
| `bow` | Respectful bow with closed eyes |
| `jump` | Excited jump with wide eyes |
| `celebrate` | Joyful celebration with raised hand |
| `turn_around` | Playful 360-degree spin |
| `surprised` | Shocked expression with wide eyes and open mouth |
| `wink` | Playful wink with body lean |
| `laugh` | Hearty laugh with body shakes and spine oscillation |
| `yawn` | Tired yawn with wide jaw and squinted eyes |
| `applause` | Clapping hands with joyful expression |
| `dance` | Rhythmic dance with hip bounce and spine sway |
| `facepalm` | Facepalm with hand to forehead |
| `excited` | Bursting with excitement — wide eyes, rapid hand wave |
| `dismiss` | Dismissive wave-off with head turn |
| `tongueout` | Playful tongue sticking out |
| `kiss` | Blowing a kiss with wink and pursed lips |
| `eyeroll` | Dramatic eye roll with head tilt |
| `sigh` | Deep sigh with chest inhale and slumped body |
| `raise_eyebrows` | Raised eyebrows expressing surprise |
| `open_mouth` | Mouth wide open in awe or shock |
| `cheek_puff` | Puffed cheeks, playful or holding breath |
| `close_eyes` | Gently closed eyes, relaxed or meditating |
| `look_left` | Looking left with eyes and slight head turn |
| `look_right` | Looking right with eyes and slight head turn |
| `head_circles` | Slow circular head movement |
| `shiver` | Shivering with rapid small tremors |
| `chew` | Chewing motion with rhythmic jaw |
| `deep_breath` | Deep inhale and exhale with chest expansion |
| `vibrate` | Rapid vibration effect, excitement or buzzing |

---

## Custom Motions Format

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
- `"mood"` — persistent, blended procedurally via `update()`
- `"action"` — temporal, uses TalkingHead gesture playback

---

## Demo

```bash
git clone https://github.com/lhupyn/motion-engine.git
cd motion-engine
npm install
npm run demo
```

## Tests

```bash
npm test
npm run test:watch
```

---

## Credits

- **[TalkingHead](https://github.com/met4citizen/TalkingHead)** by Mika Suominen — MIT License.
- **Demo avatar**: Created with [Ready Player Me](https://readyplayer.me/).

## License

MIT
