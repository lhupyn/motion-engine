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
| `update(dt)` | — | Frame hook: bone overlays + face mirror |
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
