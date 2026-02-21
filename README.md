# MotionEngine

Motion engine plugin for [TalkingHead](https://github.com/nicolefdear/talkinghead) 3D avatars. Adds expressive, multi-layered motions (gestures + facial expressions + bone oscillation overlays) that go beyond TalkingHead's built-in animations.

## Features

- **Custom motions** with synchronized facial expressions, gestures, and body movement
- **Bone oscillation overlays** (e.g., hand waving, hip bounce) via `poseDelta`
- **Fallback** to native TalkingHead gestures, emojis, and poses
- **No DOM dependencies** — works as a pure plugin
- **20 built-in motions** included in `motions.json`

## Install

```bash
npm install motion-engine
```

Or copy `src/MotionEngine.js` and `src/motions.json` directly into your project.

## Usage

```js
import { TalkingHead } from 'talkinghead';
import { MotionEngine } from 'motion-engine';
import motions from 'motion-engine/motions';

// Create TalkingHead instance
const head = new TalkingHead(container, { /* options */ });
await head.showAvatar({ url: '/model.glb', body: 'F', avatarMode: 'full-body' });
head.start();

// Create engine and register motions
const engine = new MotionEngine(head);
engine.registerMotions(motions);

// Hook into render loop for overlay oscillations
head.opt.update = (dt) => engine.update(dt);

// Play a motion
await engine.play('wave_right');
await engine.play('thumbup_right');
await engine.play('celebrate');
```

## API

### `new MotionEngine(talkingHead)`

Create a new engine bound to a TalkingHead instance.

### `engine.registerMotions(motions) → number`

Register a dictionary of custom motions. Returns the number of motions registered. Automatically converts `null` to `Infinity` in gesture duration fields (JSON compatibility).

### `engine.play(name, dur?) → Promise<void>`

Play a motion by name. Resolves custom motions first, then falls back to native TalkingHead gestures/emojis, then poses.

### `engine.stop()`

Force-stop the current motion.

### `engine.update(dt)`

Frame update hook for oscillation overlays. Connect via:

```js
head.opt.update = (dt) => engine.update(dt);
```

### Callbacks

```js
engine.onStart = (name) => { /* motion started */ };
engine.onEnd = (name) => { /* motion finished */ };
engine.onError = (name, error) => { /* motion failed */ };
```

## Built-in motions

| Motion | Description |
|--------|-------------|
| `wave_right` / `wave_left` | Waving with hand oscillation |
| `thumbup_right` | Thumbs up with smile |
| `thumbdown_right` | Thumbs down with frown |
| `point` | Pointing gesture |
| `ok_wink` | OK sign with wink |
| `shrug_confused` | Confused shrug |
| `namaste_bow` | Namaste with bow |
| `nod_yes` / `shake_no` | Head nod / shake |
| `look_up` / `look_down` | Look up / down |
| `bow` | Respectful bow |
| `jump` | Excited jump |
| `celebrate` | Celebration with hand wave |
| `turn_around` | 360-degree turn |
| `thinking` | Thinking pose |
| `surprised` | Surprised expression |
| `wink` | Playful wink |
| `angry` / `sad` | Emotional expressions |

## Custom motions format

```json
{
  "my_motion": {
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

- **`dt`**: Keyframe durations in milliseconds
- **`rescale`**: Interpolation weights per keyframe
- **`vs`**: Viseme/morph target values + gesture commands
- **`_overlay`**: Optional bone oscillation overlay (frequency, amplitude, phase)

## Demo

```bash
git clone https://github.com/lhupyn/motion-engine.git
cd motion-engine
npm install
npm run demo
```

> Note: The demo requires a `.glb` avatar model at `/models/avatars/female_1.glb`. You can configure the path in `demo/demo.js`.

## License

MIT
