# MotionEngine — API Reference

Full API documentation for MotionEngine, MotionStudio, and FaceMirror.

---

## `new MotionEngine(talkingHead, options?)`

| Option | Default | Description |
|---|---|---|
| `gestureFadeIn` | `800` | Fade-in for gesture playback (ms) |
| `gestureFadeOut` | `800` | Fade-out when stopping a gesture (ms) |
| `stopFade` | `100` | Quick fade for interrupt stops (ms) |
| `stopSettleTime` | `1000` | Wait after stopGesture before cleanup (ms) |
| `poseFadeIn` | `1500` | Transition time for pose changes (ms) |
| `poseSettleTime` | `1700` | Wait after setPoseFromTemplate (ms) |
| `nativeDuration` | `3` | Default duration for native gestures (s) |
| `exprMoodFade` | `400` | Fade in/out time for FACS mood expressions (ms) |
| `facs` | built-in `facs.json` | FACS data override (AU map + expression recipes + aliases) |

### Methods

| Method | Returns | Description |
|---|---|---|
| `registerMotions(motions)` | `number` | Register motion dictionary, returns count |
| `play(name, dur?)` | `Promise<void>` | Play motion with multi-track routing |
| `playSequence(names)` | `Promise<void>` | Play motions sequentially |
| `stop()` | — | Force-stop current action |
| `freeze(enabled?)` | — | Stop all idle animations (breathing, blinking, etc.) |
| `getMotionNames()` | `string[]` | All registered motion names |
| `getRegisteredMotions()` | `object` | Internal motions dict (for Studio) |
| `handleTranscript(text)` | — | Parse a transcript chunk (emoji, `::markers::`, `[emotion]`) and route each — face → FACS, body → motion |
| `expr(name)` | `object\|null` | Play a FACS expression (emotion or facial action) via the compositor |
| `setMoodExpression(name)` | `object\|null` | Set/clear the sustained mood layer (`null` or `"neutral"` fades it out) |
| `resetExpression()` | — | Clear all FACS layers (mood + beats), release morphs to neutral |
| `resolveExpression(name)` | `object\|null` | Resolve an emotion word → `{name, vs, kind, envelope}` without playing |
| `setFacs(facs)` | — | Replace the FACS data (AU map + expression recipes + aliases) |
| `setEmojiMap(map)` | — | Replace the emoji → name map used by `handleTranscript` |
| `resetTurn()` | — | Re-arm per-turn state at a turn boundary |
| `update(dt)` | — | Frame hook: FACS compositor + bone overlays + face mirror |
| `startMirror(videoEl, opts?)` | `Promise<void>` | Start face mirroring (empathic or mirror mode) |
| `stopMirror()` | — | Stop and dispose face mirror, clean up empathic state |
| `pauseMirror()` | — | Pause face detection |
| `resumeMirror()` | — | Resume face detection |
| `playMoodAttenuated(name, intensity)` | — | Play a mood at reduced intensity (0-1) |
| `setHeadPose(pitch, yaw, roll)` | — | Set avatar head rotation (radians) |

### Properties

| Property | Type | Description |
|---|---|---|
| `playing` | `boolean` (getter) | Whether an action is currently playing |
| `tracks` | `object` | Multi-track state: `{ pose, mood, action }` |
| `onStart` | `function\|null` | Callback when motion starts |
| `onEnd` | `function\|null` | Callback when motion finishes |
| `onError` | `function\|null` | Callback when motion fails |
| `mirror` | `FaceMirror\|null` (getter) | Access FaceMirror for advanced config |

---

## `new FaceMirror(options?)`

| Option | Default | Description |
|---|---|---|
| `threshold` | `0.3` | Min score to trigger mood change |
| `cooldown` | `2000` | Ms between mood changes |
| `detectInterval` | `200` | Ms between detections (5 FPS) |
| `mode` | `'mirror'` | `'mirror'` (1:1 clone) or `'empathic'` (react with attenuation) |
| `blendSpeed` | `0.08` | Lerp factor per frame for smooth blending |
| `headPose` | `false` | Enable head pose tracking |
| `headPoseScale` | `0.25` | Attenuation for head rotation |

### Methods

| Method | Returns | Description |
|---|---|---|
| `loadMotions(motions)` | `number` | Extract classifiers from `_detect` in any motion entry |
| `init(opts?)` | `Promise<void>` | Load MediaPipe FaceLandmarker |
| `start(videoEl)` | — | Start detection from video element |
| `stop()` | — | Stop detection, keep MediaPipe loaded |
| `pause()` / `resume()` | — | Pause/resume detection |
| `_classify(blendshapes)` | `{mood, score}` | Score blendshapes (public for testing) |
| `dispose()` | — | Release all resources |

### Callbacks

| Callback | Signature | Description |
|---|---|---|
| `onMood` | `(mood, score, blendshapes)` | Fired on mood change (both modes) |
| `onDetect` | `(blendshapes)` | Fired on every detection frame |
| `onReaction` | `(reactionMood, intensity, gesture, detectedMood)` | Fired on mood transition (empathic mode) |
| `onValues` | `(morphValues, headPose)` | Fired every frame with smoothed values (empathic mode) |

### `_detect` schema

Any motion entry in `motions.json` (mood or action) can include a `_detect` object for face mirroring:

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

### `_react` schema

Mood entries can also include a `_react` object for empathic mode. This defines how the avatar *reacts* when that emotion is detected on the user:

```json
{
  "happy": {
    "_track": "mood",
    "_detect": { "mouthSmileLeft": 0.5, "mouthSmileRight": 0.5 },
    "_react": { "mood": "happy", "intensity": 0.3, "gesture": "nod_yes" }
  }
}
```

| Field | Type | Description |
|---|---|---|
| `mood` | `string` | Avatar mood to play (can differ from detected mood) |
| `intensity` | `number` | Attenuation factor (0-1), applied to mood baselines |
| `gesture` | `string\|undefined` | Optional action to play alongside (e.g. `"nod_yes"`) |

---

## FACS expression system (`facs.json`)

The FACS layer is one data file with these parts:

| Key | What |
|---|---|
| `au_map` | FACS Action Unit → ARKit base blendshapes. Unilateral via `AU12_L` / `AU12_R`. |
| `expressions` | emotion / facial-action name → recipe (see below) |
| `aliases` | free-text word → canonical expression (`joy`→`happy`, `frustrated`→`angry`, …) |
| `_sources`, `_doc` | provenance (EMFACS-7, ARKit↔FACS convention, AU-Blendshape) |

### Expression recipe

```json
"happy":    { "facs": "EMFACS-7 happiness: AU6+AU12", "aus": { "AU6": 0.42, "AU12": 0.7 } },
"laugh":    { "kind": "beat", "aus": { "AU6": 0.56, "AU12": 0.7 }, "envelope": { "in": 250, "hold": 1400, "out": 500 } }
```

| Field | Type | Description |
|---|---|---|
| `aus` | `Object<AU, weight>` | Action Units with their **final** weight (0–1). `morph = weight × au_map weight`, clamped. No runtime intensity — one fixed calibrated level per expression. |
| `kind` | `"mood"` \| `"beat"` | `mood` (default) sustains until replaced/reset; `beat` is a transient bloom → hold → fade. |
| `envelope` | `{in,hold,out}` ms | Beat timing (default `300/1500/600`). |
| `facs` | `string` | Provenance note — ignored by the engine. |

### Compositor & routing

`update(dt)` sums the active **mood layer** (faded in/out) plus **beats** (enveloped) on top of the mood baseline. Eye-animation morphs (`eyeLook*`/`eyeBlink*`) are written via `setValue()` (the system slot, to outrank TalkingHead's idle-eye animation); everything else writes the baseline and yields to visemes/blinks. Sustained moods carry no mouth-opening AUs (they fight lipsync) — jaw lives only in beats.

**Markers** (`handleTranscript` reads all three from the speech stream): `[emotion]` → FACS expression (small prompt menu; off-menu words resolve via aliases); `::name::` → explicit motion/gesture; emoji → mapped via the emoji map.

---

## `new MotionStudio(engine, options?)`

| Option | Default | Description |
|---|---|---|
| `aliases` | `{}` | Morph name aliases |
| `boneAliases` | `{}` | Bone name aliases |
| `morphWhitelist` | ARKit standard | For `getAvatarCapabilities()` |
| `boneWhitelist` | Common anchors | For `getAvatarCapabilities()` |

### Methods

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
