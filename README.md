# MotionEngine

> **Proof of concept** — Data-driven motion control for 3D avatars.

MotionEngine is a plugin for [TalkingHead](https://github.com/met4citizen/TalkingHead) that adds expressive, multi-layered animations (gestures + facial expressions + procedural bone oscillations). It is designed specifically for **AI Agents** that need a semantic vocabulary to control avatars.

**[Live Demo](https://lhupyn.github.io/motion-engine/)**

---

## 🚀 Key Features

- **39 Built-in Motions**: Synchronized facial expressions, gestures, and body movements.
- **Procedural Overlays**: Real-time bone oscillations (e.g., hand waves, hip bounces, laugh tremors).
- **🤖 LLM Autodiscovery**: Discover avatar capabilities (morph targets and bones) dynamically to generate a precise "anatomical manual" for LLMs.
- **Motion Sequencing**: Chain animations (e.g., `thinking` → `nod_yes` → `celebrate`) with a single call.
- **Pure JavaScript**: No DOM dependencies, lightweight, and designed for modular integration.

---

## 🧠 LLM Integration

TalkingHead provides the muscles; MotionEngine provides the **brain**. 

Instead of orchestrating low-level blendshapes, an LLM calls semantic names. With the new **Autodiscovery** feature, the engine scans the avatar's 3D model and tells the LLM exactly what it can do.

### Discovery Prompt
`engine.getDiscoveryPrompt()` generates a comprehensive manual for the LLM:
- **Anatomy**: Lists all 100% available Morph Targets and Bones.
- **Skills**: Lists all registered high-level motions.
- **Schema**: Provides the JSON format for generative animations.

---

## 🛠 Usage

### 1. Simple Setup
```js
import { MotionEngine } from 'motion-engine';
import motions from 'motion-engine/motions';

const engine = new MotionEngine(talkingHead);
engine.registerMotions(motions);

// Hook into TalkingHead render loop
talkingHead.opt.update = (dt) => engine.update(dt);
```

### 2. Capabilities Discovery
```js
// Get dynamic anatomical info for your LLM context
const capabilities = engine.getAvatarCapabilities();
console.log(capabilities.morphTargets); // ['mouthSmile', 'eyeBlinkLeft', ...]
console.log(capabilities.bones);        // ['Neck', 'RightHand', ...]

// Get a ready-to-use prompt for Gemini/GPT
const systemPrompt = engine.getDiscoveryPrompt();
```

### 3. Playing Animations
```js
// Play by name
await engine.play('wave_right');

// Play sequence
await engine.playSequence(['thinking', 'nod_yes', 'celebrate']);

// Stop everything
engine.stop();
```

---

## 📖 API Reference

### `engine.getAvatarCapabilities()`
Scans the TalkingHead instance and returns `{ morphTargets: string[], bones: string[] }`.

### `engine.getDiscoveryPrompt()`
Returns a pre-formatted string for LLM system instructions, including anatomy and registered motions.

### `engine.play(name, dur?)`
Plays a motion. Resolves: `custom` → `native gesture` → `native emoji` → `native pose`.

### `engine.registerMotions(motions)`
Registers a dictionary of custom JSON motions. Strips metadata for TalkingHead compatibility.

---

## 📂 Project Structure

- `src/MotionEngine.js`: Main controller and discovery logic.
- `src/OverlayManager.js`: Procedural bone oscillation engine.
- `src/motions.json`: The standard library of 39 motions.

---

## 💻 Development & Demo

Run the interactive test bench locally:

```bash
git clone https://github.com/lhupyn/motion-engine.git
cd motion-engine
npm install
npm run demo
```

Click **"🔍 Audit Avatar"** in the demo to see the autodiscovery engine in action.

---

## 🤝 Credits & License

- **[TalkingHead](https://github.com/met4citizen/TalkingHead)**: The core 3D avatar engine.
- **Avatar**: Created with [Ready Player Me](https://readyplayer.me/).
- **License**: MIT.
