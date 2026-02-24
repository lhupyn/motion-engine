#!/usr/bin/env node
/**
 * Batch motion generator — calls Gemini to create ~128 unified motions.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx node scripts/generate-motions.js
 *
 * Options:
 *   --dry-run       Print prompts without calling API
 *   --output PATH   Output file (default: src/motions_generated.json)
 *   --delay MS      Delay between requests (default: 2500)
 *   --model NAME    Gemini model (default: gemini-3.1-pro-preview)
 *   --resume        Resume from existing partial output file
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// CLI args
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const DRY_RUN = flag('dry-run');
const OUTPUT = resolve(ROOT, opt('output', 'src/motions.json'));
const DELAY = Number(opt('delay', '2500'));
const MODEL = opt('model', 'gemini-3.1-pro-preview');
const RESUME = flag('resume');
const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY && !DRY_RUN) {
  console.error('ERROR: Set GEMINI_API_KEY environment variable');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Static LLM context (equivalent to studio.getLLMContext())
// ---------------------------------------------------------------------------
const MORPHS = [
  'browDownLeft', 'browDownRight', 'browInnerUp', 'browOuterUpLeft', 'browOuterUpRight',
  'cheekPuff', 'cheekSquintLeft', 'cheekSquintRight',
  'eyeBlinkLeft', 'eyeBlinkRight', 'eyeSquintLeft', 'eyeSquintRight',
  'eyeWideLeft', 'eyeWideRight', 'eyeLookInLeft', 'eyeLookInRight',
  'eyeLookOutLeft', 'eyeLookOutRight', 'eyesClosed',
  'jawForward', 'jawOpen',
  'mouthClose', 'mouthDimpleLeft', 'mouthDimpleRight',
  'mouthFrownLeft', 'mouthFrownRight', 'mouthFunnel',
  'mouthLeft', 'mouthLowerDownLeft', 'mouthLowerDownRight',
  'mouthOpen', 'mouthPressLeft', 'mouthPressRight', 'mouthPucker',
  'mouthRight', 'mouthRollLower', 'mouthRollUpper',
  'mouthShrugLower', 'mouthShrugUpper',
  'mouthSmile', 'mouthSmileLeft', 'mouthSmileRight',
  'mouthStretchLeft', 'mouthStretchRight',
  'mouthUpperUpLeft', 'mouthUpperUpRight',
  'noseSneerLeft', 'noseSneerRight', 'tongueOut',
].join(',');

const BONES = 'Hips,Spine,Spine1,Spine2,Neck,Head,RightHand,LeftHand,RightForeArm,LeftForeArm,RightArm,LeftArm,RightShoulder,LeftShoulder';

// ---------------------------------------------------------------------------
// System prompt — improved with quality guidelines and 8 examples
// ---------------------------------------------------------------------------
const SYSTEM_PROMPT = `You are an expert motion designer for a 3D avatar powered by MotionEngine. Given a description, you produce a JSON motion definition.

AVAILABLE TARGETS:
- Morphs (face): ${MORPHS}
- Bones (body): ${BONES}
- Special vs keys: headRotateX/Y/Z (±0.3 rad), bodyRotateX/Y/Z (±0.2 rad), headMove ([0] to disable), chestInhale (0–1)
- Gestures: handup, thumbup, thumbdown, ok, shrug, namaste, index, side, fist

RULES — respond with ONLY a valid JSON object, no markdown, no explanation.

JSON STRUCTURE:
{
  "dt": [fadeIn_ms, main_ms, fadeOut_ms],
  "rescale": [0, 1, 0],
  "vs": { "morphName": [value], "gesture": [["poseName", null, isRight], null] },
  "_overlay": {
    "bones": { "BoneName": { "freq": hz, "amp": [x, y, z], "phase": radians } },
    "delay": ms,
    "duration": ms
  }
}

FIELD DETAILS:
- "dt": array of durations in ms. 3+ phases for complex sequences. Total 1000–5000 ms.
- "rescale": envelope per phase (0–1). [0,1,0] = fade in, hold, fade out. MUST match dt length.
- "vs": morph targets → value arrays (0–1). One value = all phases (scaled by rescale). N values = per-phase.
- "gesture": hand poses. Format: [["poseName", null, isRight], null]. The null frame = release. isRight: true = right hand, false = left hand.
- "_overlay": MUST be TOP-LEVEL (sibling of "dt","vs"), NEVER inside "vs".
  - "bones": each bone maps to { "freq": Hz, "amp": [x,y,z], "phase": radians }
  - "delay" and "duration": MUST be direct children of "_overlay", NEVER inside "bones"
  - freq: 2–12 Hz typical, 18–30 Hz for tremors. amp: 0.003–0.15 range. phase: π/2 increments for wave propagation.
- "_overlay.bones.[Bone].kf": Per-phase bone keyframes [[x,y,z], ...].
  Length MUST match "dt". Linearly interpolated. Composes with freq/amp oscillation.
  Always start and end at [0,0,0]. Pair with freq/amp on the same bone for organic feel.

BONE POSE ATLAS — Empirically verified poseDelta values (only visually effective axes listed):
  Arms (BOTH sides use same X axis — NO left/right inversion):
    RightArm  X+: arm forward/up.  X-: arm back.      Range ±0.4–1.3
    LeftArm   X+: arm forward/up.  X-: arm back.      Range ±0.4–1.3
    RightForeArm X+: BEND elbow.   X-: straighten.    Range ±0.3–1.4
    LeftForeArm  X+: BEND elbow.   X-: straighten.    Range ±0.3–1.4
    NOTE: Y and Z axes on arms have negligible visual effect via poseDelta. Use X only!
  Spine (use Spine + Spine1 together for stronger effect):
    X+: lean forward (bow).     X-: lean back.       Range ±0.1–0.2 each
    Y+: turn left.              Y-: turn right.      Range ±0.1–0.15 each
  Head:
    X+: look down (nod).        X-: look up.         Range ±0.05–0.12
    Y+: turn left.              Y-: turn right.      Range ±0.05–0.15

  COMPOSING POSES — verified combinations:
    Wave: RightArm X+1.2 (raise) + RightForeArm X+1.0 (bend elbow)
    Arms up: Both Arms X+1.3 + Both ForeArms X+0.8
    Shrug: Both Arms X+0.4 + Both ForeArms X+0.6 + Spine1 X-0.05
    Point/Present: RightArm X+0.9 + RightForeArm X+0.3
    Bow: Spine X+0.15 + Spine1 X+0.15 + Head X+0.1
  These are building blocks — combine and interpolate freely via kf arrays.

CRITICAL QUALITY RULES:
1. EXPRESSIVENESS: Every action MUST have 4+ facial morphs. Combine brows + eyes + mouth + cheeks for believable expressions. A "nod" still needs facial expression (smile, squint, brow movement).
2. OVERLAYS ARE ESSENTIAL: Any motion with a hand gesture MUST include _overlay for natural arm oscillation. Body motions (laugh, nod, shiver) benefit from Spine/Neck overlays for organic movement. Use overlays generously — they add life.
3. MULTI-LAYER: Good motions combine face (morphs) + head (rotation) + body (rotation) + hands (gesture) + oscillation (overlay). The more layers, the more alive.
4. ASYMMETRY: Real expressions are asymmetric. Use different values for left/right morphs (e.g., mouthSmileLeft: 0.6, mouthSmileRight: 0.8). Asymmetric brows convey nuance.
5. MOODS vs ACTIONS:
   - MOOD = persistent background state. Simple 3-phase dt [500,2000,500] with rescale [0,1,0]. Define morph baselines + posture. NO gestures. Keep subtle (values 0.2–0.6). Must include 5+ morphs covering brows + eyes + mouth minimum.
   - ACTION = temporal gesture, plays once. Can be complex multi-phase. CAN use gestures + overlays. Be bold with values.
6. STRUCTURE: "delay" and "duration" go directly inside "_overlay", never inside "bones". Each bone entry has only "freq", "amp", "phase".
7. BONE KEYFRAMES: Use the BONE POSE ATLAS above to position arms/body. Arms move via X axis ONLY
   (Y/Z have no visible effect). ALWAYS pair kf with freq/amp oscillation on the same bone
   (kf alone looks stiff). Don't use kf for tremors/shivers — oscillation handles those.

EXAMPLES:

1. Hearty laugh (6-phase action, body overlay):
{"dt":[300,300,300,300,300,500],"vs":{"mouthSmile":[0.9],"mouthOpen":[0.3,0.5,0.3,0.5,0.3,0],"jawOpen":[0.2,0.4,0.2,0.4,0.2,0],"eyeSquintLeft":[0.8],"eyeSquintRight":[0.8],"cheekSquintLeft":[0.6],"cheekSquintRight":[0.6],"noseSneerLeft":[0.3],"noseSneerRight":[0.3],"bodyRotateX":[0.05,-0.02,0.05,-0.02,0.05,0]},"_overlay":{"bones":{"Spine":{"freq":10,"amp":[0.02,0,0.01]},"Head":{"freq":10,"amp":[0.01,0,0.01],"phase":1.5708}},"delay":200,"duration":1800}}

2. Sad mood (persistent, face + posture, no overlay):
{"dt":[800,2000,800],"rescale":[0,1,0],"vs":{"browInnerUp":[0.8],"eyeSquintLeft":[0.5],"eyeSquintRight":[0.6],"eyesClosed":[0.2],"mouthFrownLeft":[0.7],"mouthFrownRight":[0.6],"mouthPucker":[0.3],"mouthRollLower":[0.2],"bodyRotateX":[0.1,0.1,0],"headRotateX":[0.1,0.1,0]}}

3. Deep sigh (5-phase action, breathing):
{"dt":[800,1200,500,1500,500],"rescale":[0,0,0,1,0],"vs":{"chestInhale":[0,0.8,0.8,0,0],"bodyRotateX":[0,-0.05,-0.05,0.15,0],"headRotateX":[0,-0.1,-0.1,0.15,0],"eyesClosed":[0,0.3,0.3,0.5,0],"mouthOpen":[0,0.2,0.2,0,0],"mouthFrownLeft":[0,0,0,0.6,0],"mouthFrownRight":[0,0,0,0.5,0],"browInnerUp":[0,0.3,0.3,0.7,0]}}

4. Wave with hand gesture + arm overlay:
{"dt":[300,2500,500],"rescale":[0,1,0],"vs":{"mouthSmile":[0.6],"eyeSquintLeft":[0.3],"eyeSquintRight":[0.3],"browInnerUp":[0.3],"cheekSquintLeft":[0.2],"cheekSquintRight":[0.2],"gesture":[["handup",null,true],null]},"_overlay":{"bones":{"RightHand":{"freq":8,"amp":[0,0.12,0.12],"phase":0},"RightForeArm":{"freq":8,"amp":[0.04,0,0.08],"phase":1.5708},"RightArm":{"freq":8,"amp":[0.02,0,0.03],"phase":3.1416}},"delay":400,"duration":2500}}

5. Shiver (high-freq tremors, multi-bone overlay):
{"dt":[300,2000,300],"rescale":[0,1,0],"vs":{"eyeSquintLeft":[0.4],"eyeSquintRight":[0.4],"mouthPressLeft":[0.3],"mouthPressRight":[0.3],"jawOpen":[0.1],"browInnerUp":[0.3],"mouthFrownLeft":[0.2],"mouthFrownRight":[0.2]},"_overlay":{"bones":{"Spine1":{"freq":18,"amp":[0.008,0,0.005],"phase":0},"Spine2":{"freq":18,"amp":[0.005,0,0.008],"phase":0.8},"Neck":{"freq":20,"amp":[0.004,0,0.004],"phase":1.2},"Head":{"freq":20,"amp":[0.003,0,0.003],"phase":1.8}},"delay":200,"duration":2200}}

6. Thinking (asymmetric face + head tilt, no overlay):
{"dt":[500,2000,500],"rescale":[0,1,0],"vs":{"browDownLeft":[1],"browOuterUpRight":[1],"eyeSquintLeft":[0.6],"eyeSquintRight":[0.3],"mouthFrownLeft":[0.7],"mouthFrownRight":[0.5],"mouthRight":[0.5],"mouthRollLower":[0.5],"mouthPressRight":[0.4],"headRotateY":[0.15,0.15,0],"headRotateZ":[0.05,0.05,0],"bodyRotateY":[0.1,0.1,0]}}

7. Point with index finger (gesture + overlay + expressive face):
{"dt":[300,1500,400],"rescale":[0,1,0],"vs":{"browInnerUp":[0.6],"browOuterUpLeft":[0.3],"eyeWideLeft":[0.4],"eyeWideRight":[0.5],"eyeSquintLeft":[0.2],"mouthSmile":[0.3],"mouthDimpleRight":[0.2],"bodyRotateY":[-0.1,-0.1,0],"headRotateY":[-0.08,-0.08,0],"gesture":[["index",null,true],null]},"_overlay":{"bones":{"RightArm":{"freq":4,"amp":[0,0.02,0.01],"phase":0},"RightForeArm":{"freq":4,"amp":[0,0.01,0.02],"phase":1.5708}},"delay":300,"duration":1500}}

8. Confident mood (persistent baseline — subtle, 5+ morphs):
{"dt":[500,2000,500],"rescale":[0,1,0],"vs":{"mouthSmileLeft":[0.3],"mouthSmileRight":[0.4],"eyeSquintLeft":[0.2],"eyeSquintRight":[0.25],"browOuterUpLeft":[0.1],"jawForward":[0.05],"chestInhale":[0.1],"bodyRotateX":[-0.02,-0.02,0],"headRotateX":[-0.03,-0.03,0]}}

9. Arms-up celebration (atlas: both arms raised via X axis + oscillation):
{"dt":[400,600,1000,600,400],"rescale":[0,1,1,1,0],"vs":{"mouthSmile":[0.9],"eyeSquintLeft":[0.7],"eyeSquintRight":[0.8],"cheekSquintLeft":[0.5],"cheekSquintRight":[0.6],"browInnerUp":[0.6],"noseSneerLeft":[0.2],"chestInhale":[0,0.3,0.5,0.3,0],"gesture":[["fist",null,true],null]},"_overlay":{"bones":{"RightArm":{"freq":4,"amp":[0.03,0.02,0.02],"kf":[[0,0,0],[1.0,0,0],[1.3,0,0],[1.0,0,0],[0,0,0]]},"LeftArm":{"freq":4,"amp":[0.03,0.02,0.02],"kf":[[0,0,0],[1.0,0,0],[1.3,0,0],[1.0,0,0],[0,0,0]]},"RightForeArm":{"kf":[[0,0,0],[0.6,0,0],[0.8,0,0],[0.6,0,0],[0,0,0]]},"LeftForeArm":{"kf":[[0,0,0],[0.6,0,0],[0.8,0,0],[0.6,0,0],[0,0,0]]},"Spine":{"freq":3,"amp":[0.02,0,0.01]}},"delay":100,"duration":2900}}

10. Guitar strum (atlas: LeftArm X+ raised for fretting, RightArm X+ strum arc):
{"dt":[400,350,350,400,350,350,400,500,400,400],"rescale":[0.3,0.6,0.8,1,1,1,0.9,1,0.6,0],"vs":{"eyesClosed":[0.2,0.3,0.4,0.6,0.5,0.7,0.8,0.6,0.3,0],"mouthSmileLeft":[0.2,0.3,0.4,0.6,0.5,0.7,0.8,0.6,0.4,0],"mouthSmileRight":[0.3,0.4,0.5,0.7,0.6,0.5,0.6,0.5,0.3,0],"browInnerUp":[0.2,0.3,0.5,0.7,0.6,0.8,0.7,0.9,0.4,0],"eyeSquintLeft":[0.3,0.4,0.5,0.7,0.6,0.8,0.7,0.5,0.3,0],"gesture":[["fist",null,true],["fist",null,false],null]},"_overlay":{"bones":{"RightArm":{"freq":6,"amp":[0.03,0.02,0.02],"kf":[[0,0,0],[0.8,0,0],[0.5,0,0],[0.8,0,0],[0.5,0,0],[0.8,0,0],[0.5,0,0],[0.6,0,0],[0.3,0,0],[0,0,0]]},"RightForeArm":{"freq":6,"amp":[0.03,0.04,0.02],"kf":[[0,0,0],[0.5,0,0],[0.3,0,0],[0.5,0,0],[0.3,0,0],[0.5,0,0],[0.3,0,0],[0.4,0,0],[0.2,0,0],[0,0,0]]},"LeftArm":{"freq":2,"amp":[0.02,0.01,0.01],"kf":[[0,0,0],[0.9,0,0],[0.9,0,0],[0.9,0,0],[1.0,0,0],[1.0,0,0],[1.0,0,0],[0.8,0,0],[0.4,0,0],[0,0,0]]},"LeftForeArm":{"freq":3,"amp":[0.03,0.01,0.02],"kf":[[0,0,0],[0.7,0,0],[0.7,0,0],[0.7,0,0],[0.8,0,0],[0.8,0,0],[0.8,0,0],[0.6,0,0],[0.3,0,0],[0,0,0]]},"Spine":{"freq":2,"amp":[0.04,0,0.03]},"Head":{"freq":4,"amp":[0.05,0,0.02],"phase":1.5708}},"delay":100,"duration":3800}}`;

// ---------------------------------------------------------------------------
// Motion catalog — ~128 unified motions (regenerate ALL with consistent quality)
// ---------------------------------------------------------------------------
const CATALOG = [
  // ══════════════════════════════════════════════════════════════════════════
  // EXISTING ACTIONS (40) — regenerate for consistent Gemini 3.1 Pro quality
  // ══════════════════════════════════════════════════════════════════════════

  // ── Greetings & Social Gestures ──
  { name: 'wave_right', track: 'action', tags: ['greeting', 'friendly', 'hand'],
    desc: 'Friendly wave with right hand oscillation and warm smile. Use handup gesture right hand. Expressive face: warm smile with cheek squint, raised brows, squinted happy eyes. Use kf: RightArm X+1.2 to raise arm + RightForeArm X+1.0 to bend elbow (wave position from atlas). Add freq ~8 oscillation on RightHand/RightForeArm for waving motion. Duration ~2500ms.' },
  { name: 'wave_left', track: 'action', tags: ['greeting', 'friendly', 'hand'],
    desc: 'Friendly wave with left hand. Use handup gesture LEFT hand (isRight=false). Mirror of wave_right but with different asymmetric smile. Warm face with cheek squint, one brow slightly higher. Use kf: LeftArm X+1.2 to raise arm + LeftForeArm X+1.0 to bend elbow. Add freq ~8 oscillation on LeftHand/LeftForeArm for wave. Duration ~2500ms.' },
  { name: 'thumbup_right', track: 'action', tags: ['positive', 'approval', 'hand'],
    desc: 'Thumbs up with right hand and approving expression. Use thumbup gesture right hand. Confident smile, slight wink feel (eyeSquint asymmetric), raised brow, cheek squint. Add RightArm/RightForeArm overlay for natural arm bob. Duration ~1500ms.' },
  { name: 'thumbdown_right', track: 'action', tags: ['negative', 'disapproval', 'hand'],
    desc: 'Thumbs down with right hand and disapproving face. Use thumbdown gesture right hand. Disappointed face: slight frown, lowered brows, pressed mouth, slight head shake (headRotateY). Add RightArm overlay for subtle arm movement. Duration ~1500ms.' },
  { name: 'point', track: 'action', tags: ['directing', 'presenting', 'hand'],
    desc: 'Index finger point forward-right. Use index gesture right hand. Expressive face: browInnerUp, slight smile, wide engaged eyes, slight lean toward pointing direction. Add RightArm/RightForeArm overlay for natural arm sway. Duration ~1500ms.' },
  { name: 'ok_wink', track: 'action', tags: ['positive', 'playful', 'hand'],
    desc: 'OK sign with right hand and a cheeky wink. Use ok gesture right hand. Wink (eyeBlinkRight high), playful smile (asymmetric), raised brow on open eye side, cheek squint. Add RightHand/RightForeArm overlay for gentle hold oscillation. Duration ~1500ms.' },
  { name: 'shrug_confused', track: 'action', tags: ['uncertain', 'reaction', 'hand'],
    desc: 'Confused shrug — "I dunno". Use shrug gesture (both arms). Confused face: asymmetric brows (one up, one down), slight frown, mouth pulled to side, wide eyes. Body lifts (bodyRotateX slightly negative). Add Spine1/Spine2 overlay for shoulder-shrug oscillation. Duration ~1500ms.' },
  { name: 'namaste_bow', track: 'action', tags: ['greeting', 'respectful', 'hand'],
    desc: 'Respectful namaste bow. Use namaste gesture. Multi-phase: hands come together, then graceful bow (headRotateX + bodyRotateX positive). Serene face: gentle smile, eyes close during bow, peaceful brow. Add Spine overlay for organic bow movement. Duration ~2500ms.' },
  { name: 'nod_yes', track: 'action', tags: ['agreement', 'positive'],
    desc: 'Affirmative nod — "yes". Multi-phase (4 phases): head goes down (headRotateX positive) and back up twice. Warm agreeable face: smile, squinted eyes, raised cheeks. Add Neck overlay for natural nod weight. Duration ~1200ms.' },
  { name: 'shake_no', track: 'action', tags: ['disagreement', 'negative'],
    desc: 'Head shake no. Multi-phase (4 phases): headRotateY oscillates left-right-left. Serious/firm expression: pressed lips, slight brow down, focused squint. Add Head bone overlay with Y-axis oscillation. Duration ~1200ms.' },
  { name: 'applause', track: 'action', tags: ['celebration', 'positive', 'hand'],
    desc: 'Enthusiastic clapping. Use namaste gesture (hands together repeatedly). Multi-phase (6 phases): hands clap rhythm. Bright excited face: big smile, squinted joyful eyes, raised cheeks, brows up. Use kf: RightArm X+0.7 and LeftArm X+0.7 (raise both forward, atlas compose) + freq 4 oscillation for clap rhythm. Add Spine overlay for body bounce. Duration ~2500ms.' },

  // ── Head & Look ──
  { name: 'look_up', track: 'action', tags: ['direction', 'thinking'],
    desc: 'Look upward. Head tilts up (headRotateX negative ~-0.2). Thoughtful face: brows slightly raised, eyes widen slightly, mouth neutral-curious. Add subtle Neck overlay for organic movement. Duration ~1200ms.' },
  { name: 'look_down', track: 'action', tags: ['direction', 'shy'],
    desc: 'Look downward. Head tilts down (headRotateX positive ~0.2). Contemplative face: brows slightly furrowed, eyes partially close, slight frown. Add subtle Neck overlay. Duration ~1200ms.' },
  { name: 'look_left', track: 'action', tags: ['direction', 'glance'],
    desc: 'Look to the left. Head turns left (headRotateY negative ~-0.2). Curious face: one brow raised, slight squint, lips slightly parted. Add subtle Head overlay. Duration ~1200ms.' },
  { name: 'look_right', track: 'action', tags: ['direction', 'glance'],
    desc: 'Look to the right. Head turns right (headRotateY positive ~0.2). Curious face with different asymmetry from look_left: other brow raised, slight smile. Add subtle Head overlay. Duration ~1200ms.' },
  { name: 'head_circles', track: 'action', tags: ['body', 'playful'],
    desc: 'Head rolling in circles. Multi-phase (6 phases): headRotateX and headRotateZ trace a circle pattern. Playful face: slight smile, relaxed eyes, loose jaw. Add Head overlay with circular motion (phase offsets on X and Z). Duration ~3000ms.' },

  // ── Full Body ──
  { name: 'bow', track: 'action', tags: ['greeting', 'respectful'],
    desc: 'Formal bow. Multi-phase: body and head tilt forward (bodyRotateX + headRotateX positive ~0.2), hold, then return. Respectful face: eyes close during bow, gentle smile, composed brows. Add Spine overlay for organic bow weight. Duration ~2000ms.' },
  { name: 'jump', track: 'action', tags: ['body', 'celebration'],
    desc: 'Excited jump. Multi-phase (4 phases): crouch (bodyRotateX positive), spring up (negative), land, settle. Excited face: wide eyes, big smile, raised brows, open mouth on jump. Add Spine overlay with jump arc feel. Duration ~1200ms.' },
  { name: 'celebrate', track: 'action', tags: ['celebration', 'positive', 'hand'],
    desc: 'Victory celebration — fist pump. Use fist gesture right hand. Multi-phase: arm raises (gesture), body leans back then forward triumphantly. Ecstatic face: huge smile, squinted eyes, raised cheeks, brows up. Use kf: RightArm X+1.2 to raise arm up + RightForeArm X+0.8 + freq 4 oscillation for bounce. Add Spine overlay for celebratory bounce. Duration ~2000ms.' },
  { name: 'turn_around', track: 'action', tags: ['body', 'playful'],
    desc: 'Full body turn. Multi-phase (4 phases): bodyRotateY rotates through 360-degree feel (positive phases). Playful face: smile, slight wink, engaged expression. Add Spine overlay for natural body sway. Duration ~2500ms.' },
  { name: 'dance', track: 'action', tags: ['body', 'celebration', 'fun'],
    desc: 'Simple happy dance. Multi-phase (6 phases): body sways left-right (bodyRotateY + bodyRotateZ oscillation), head bobs. Joyful face: big smile, squinted eyes, raised cheeks. Add Spine/Head overlay for rhythmic bounce (freq ~6). Duration ~3000ms.' },
  { name: 'deep_breath', track: 'action', tags: ['body', 'calm'],
    desc: 'Deep calming breath. Multi-phase (4 phases): inhale (chestInhale ramps up, body slightly back), hold, exhale (chestInhale drops, body settles). Peaceful face: eyes close on inhale, brows relax, soft smile on exhale. Add Spine overlay for breathing body movement. Duration ~3000ms.' },
  { name: 'shiver', track: 'action', tags: ['body', 'cold'],
    desc: 'Cold shivering. Tense face: squinted eyes, pressed lips, slight frown, jaw tension. Add multi-bone overlay with HIGH frequency (18-20 Hz) on Spine1/Spine2/Neck/Head for rapid tremors. Small amplitude. Duration ~2000ms.' },
  { name: 'chew', track: 'action', tags: ['body', 'idle'],
    desc: 'Chewing motion. Multi-phase (6 phases): jawOpen oscillates up and down rhythmically. Casual face: relaxed eyes, slight frown, cheek puff alternating. No hand gesture. Duration ~2500ms.' },
  { name: 'yawn', track: 'action', tags: ['body', 'tired'],
    desc: 'Sleepy yawn. Multi-phase (4 phases): mouth opens wide (jawOpen + mouthOpen ramp up), eyes squeeze shut (eyesClosed), brows up, then gradually closes with sleepy expression. Add Spine overlay for body stretch on inhale. Duration ~2500ms.' },
  { name: 'vibrate', track: 'action', tags: ['body', 'intense'],
    desc: 'Intense vibration/trembling. Tense face: wide eyes, clenched jaw, raised brows. Add multi-bone overlay with VERY high frequency (25-30 Hz) on multiple bones (Head, Neck, Spine1, Spine2) for intense vibration effect. Duration ~1500ms.' },

  // ── Expressions (actions) ──
  { name: 'surprised', track: 'action', tags: ['reaction', 'emotion'],
    desc: 'Surprised expression. Quick multi-phase: eyes fly wide (eyeWide max), brows shoot up (browInnerUp + browOuterUp), mouth drops open (jawOpen + mouthOpen), slight body lean back (bodyRotateX positive). Rich face: 6+ morphs. Add Spine overlay for reactive jolt. Duration ~1200ms.' },
  { name: 'wink', track: 'action', tags: ['playful', 'social'],
    desc: 'Playful wink. Right eye closes (eyeBlinkRight high), left eye stays open with slight squint. Asymmetric smile (mouthSmileRight higher), one brow up. Head slight tilt (headRotateZ). Charming expression. Duration ~800ms.' },
  { name: 'laugh', track: 'action', tags: ['joy', 'positive'],
    desc: 'Hearty laugh. Multi-phase (6 phases): mouth opens and closes rhythmically for laugh pulses. Big smile, squinted eyes, cheek squint, nose sneer. Body bounces. Add Spine/Head overlay (freq ~10) for laugh body shake. Duration ~2000ms.' },
  { name: 'kiss', track: 'action', tags: ['social', 'romantic'],
    desc: 'Blowing a kiss. Multi-phase: lips pucker (mouthPucker max), eyes partially close, slight lean forward, then release with a smile. Warm affectionate expression throughout. Duration ~1500ms.' },
  { name: 'eyeroll', track: 'action', tags: ['attitude', 'sarcastic'],
    desc: 'Dramatic eye roll. Head tilts slightly, eyes look up then sweep (headRotateX goes negative then back). Unamused face: slight frown, one brow raised, pressed mouth, mouthRight. Duration ~1200ms.' },
  { name: 'sigh', track: 'action', tags: ['emotion', 'negative'],
    desc: 'Deep exasperated sigh. Multi-phase (5 phases): inhale (chestInhale up), hold with tense face, slow exhale (chestInhale drops), shoulders drop (bodyRotateX). Tired face: frown, droopy brows, squinted eyes, mouthFrown. Duration ~2500ms.' },
  { name: 'facepalm', track: 'action', tags: ['reaction', 'exasperation', 'hand'],
    desc: 'Facepalm — "oh no". Use handup gesture right hand (hand to face). Multi-phase: hand rises, face contacts (eyes close), hold in shame. Exasperated face: frown, eyesClosed, browInnerUp, mouthFrown. Use kf: RightArm X+0.7 (forward) + RightForeArm X+1.4 (bend sharply) = hand toward face. Add freq 3 oscillation. Duration ~2000ms.' },
  { name: 'excited', track: 'action', tags: ['joy', 'positive'],
    desc: 'Bursting with excitement. Multi-phase: eyes go wide, brows up, huge smile, slight bounce (bodyRotateX oscillation). Ecstatic face: eyeWide, browInnerUp, mouthSmile max, cheekSquint, noseSneer slight. Add Spine overlay for excited bouncing. Duration ~1500ms.' },
  { name: 'dismiss', track: 'action', tags: ['attitude', 'negative', 'hand'],
    desc: 'Dismissive wave-away. Use side gesture right hand (brushing away). Head turns slightly away (headRotateY), unamused face: slight frown, one brow raised, squint, pressed mouth. Add RightArm overlay for dismissive sweep. Duration ~1200ms.' },

  // ── Facial (isolated morphs) ──
  { name: 'raise_eyebrows', track: 'action', tags: ['facial', 'surprise'],
    desc: 'Raise both eyebrows high. browInnerUp and browOuterUpLeft/Right go high. Eyes widen slightly (eyeWide), mouth stays neutral or slightly open. Head tilts back slightly (headRotateX negative). Duration ~1000ms.' },
  { name: 'open_mouth', track: 'action', tags: ['facial', 'surprise'],
    desc: 'Open mouth wide. jawOpen and mouthOpen go high. Eyes widen (eyeWide), brows raise. Surprised face accompaniment. Duration ~1000ms.' },
  { name: 'cheek_puff', track: 'action', tags: ['facial', 'playful'],
    desc: 'Puff out cheeks. cheekPuff goes high, mouth closes (mouthClose), eyes squint slightly, brows neutral. Playful/holding-breath feel. Duration ~1200ms.' },
  { name: 'close_eyes', track: 'action', tags: ['facial', 'calm'],
    desc: 'Close eyes peacefully. eyesClosed ramps up, brows relax (browInnerUp slight), gentle smile, head tilts down slightly. Serene expression. Duration ~1500ms.' },
  { name: 'tongueout', track: 'action', tags: ['facial', 'playful'],
    desc: 'Stick tongue out playfully. tongueOut goes high, mouthOpen, playful squint, one brow raised, asymmetric smile. Silly expression. Duration ~1000ms.' },

  // ══════════════════════════════════════════════════════════════════════════
  // EXISTING MOODS (14) — regenerate sparse ones for consistent quality
  // ══════════════════════════════════════════════════════════════════════════
  { name: 'thinking', track: 'mood', tags: ['cognitive', 'processing'],
    desc: 'Deep thinking persistent mood. Asymmetric brows (browDownLeft + browOuterUpRight), squinted focused eyes (asymmetric), mouth pulled to one side (mouthRight + mouthFrownLeft), head tilted (headRotateY + headRotateZ). 6+ morphs for rich contemplation.' },
  { name: 'angry', track: 'mood', tags: ['emotion', 'negative', 'intense'],
    desc: 'Angry persistent mood. Lowered brows (browDownLeft + browDownRight), intense squint (eyeSquint high), flared nostrils (noseSneerLeft + noseSneerRight), tight pressed mouth (mouthPressLeft + mouthPressRight), jaw forward (jawForward), slight forward lean. 7+ morphs for convincing anger.' },
  { name: 'sad', track: 'mood', tags: ['emotion', 'negative'],
    desc: 'Sad persistent mood. Inner brows raised (browInnerUp high), asymmetric eye squint, mouth frown (mouthFrownLeft + mouthFrownRight), mouth pucker, rolled lower lip (mouthRollLower), head and body drooped (headRotateX + bodyRotateX positive). 7+ morphs.' },
  { name: 'nervous', track: 'mood', tags: ['emotion', 'anxious'],
    desc: 'Nervous/anxious persistent mood. Wide darting eyes (eyeWideLeft/Right slight), raised inner brows, tight pressed smile (mouthPressLeft+Right with mouthSmile slight), lip bite feel (mouthRollLower), slight head tilt away (headRotateY). 6+ morphs for believable anxiety.' },
  { name: 'shy', track: 'mood', tags: ['emotion', 'social'],
    desc: 'Shy persistent mood. Head dipped down (headRotateX positive), eyes partially averted (headRotateY), eyesClosed partial, small pressed smile, brows slightly raised (browInnerUp), cheek squint from suppressed smile. 6+ morphs.' },
  { name: 'listen', track: 'mood', tags: ['listening', 'attentive'],
    desc: 'Active listening persistent mood. Wide attentive eyes (eyeWideLeft/Right subtle), raised inner brows, slight forward lean (bodyRotateX slight negative), head tilted (headRotateZ), lips slightly parted (jawOpen slight), engaged face. 6+ morphs.' },
  { name: 'smirk', track: 'mood', tags: ['attitude', 'playful'],
    desc: 'Knowing smirk persistent mood. Highly asymmetric smile (mouthSmileRight much higher than Left), one brow raised (browOuterUpRight), slight squint (eyeSquintRight more), slight head tilt, mouthDimpleRight. 6+ morphs for cocky look.' },
  { name: 'grimace', track: 'mood', tags: ['emotion', 'discomfort'],
    desc: 'Uncomfortable grimace persistent mood. Teeth showing feel (mouthStretchLeft + mouthStretchRight), squinted eyes, raised inner brows, nose sneer, slight head pull-back (headRotateX negative). 6+ morphs for "yikes" expression.' },
  { name: 'pleading', track: 'mood', tags: ['emotion', 'social'],
    desc: 'Pleading/begging persistent mood. Wide puppy eyes (eyeWideLeft/Right), highly raised inner brows (browInnerUp max), slight frown, mouth slightly open, head tilted (headRotateZ). 6+ morphs for "please" look.' },
  { name: 'sleeping', track: 'mood', tags: ['state', 'idle'],
    desc: 'Sleeping persistent mood. Eyes fully closed (eyesClosed high), relaxed brows, mouth slightly open (jawOpen slight), head drooped to side (headRotateX positive + headRotateZ), body slumped (bodyRotateX positive). 6+ morphs for deep sleep.' },
  { name: 'frown', track: 'mood', tags: ['emotion', 'negative'],
    desc: 'Deep frown persistent mood. Strong mouth frown (mouthFrownLeft + mouthFrownRight), lowered brows (browDownLeft + browDownRight), squinted disapproving eyes, pressed lips, jaw tension (mouthClose). 6+ morphs.' },
  { name: 'squint', track: 'mood', tags: ['attitude', 'suspicious'],
    desc: 'Squinting persistent mood. Heavy squint (eyeSquintLeft + eyeSquintRight high), lowered brows, slight nose sneer, mouth pressed tight, head slightly forward (headRotateX negative), suspicion face. 6+ morphs.' },
  { name: 'curious', track: 'mood', tags: ['emotion', 'interested'],
    desc: 'Curious persistent mood. Wide interested eyes (eyeWideLeft/Right slight), one brow raised higher (browOuterUpLeft), head tilted (headRotateZ + headRotateY), slight smile, lips slightly parted. Forward lean slight. 6+ morphs.' },
  { name: 'disgust', track: 'mood', tags: ['emotion', 'negative'],
    desc: 'Disgusted persistent mood. Nose sneer (noseSneerLeft + noseSneerRight high), upper lip raised (mouthUpperUpLeft/Right), squinted eyes, lowered asymmetric brows, head pulled back (headRotateX negative), mouthFrown. 7+ morphs.' },

  // ══════════════════════════════════════════════════════════════════════════
  // NEW MOTIONS (61) — Narrating, Listening, Emotions, Reactions, etc.
  // ══════════════════════════════════════════════════════════════════════════

  // ── Narrating/Explaining (11) ──
  { name: 'emphasize', track: 'action', tags: ['narrating', 'presenting'],
    desc: 'Right hand forward push with raised brows — "this is the key point". Use index finger gesture right hand. Expressive face: wide eyes, raised brows, slight open mouth. Add arm overlay for natural forward push motion. Duration ~2000ms.' },
  { name: 'open_palms', track: 'action', tags: ['narrating', 'welcoming'],
    desc: 'Both palms open outward, warm face with smile — "let me explain". Use shrug gesture (spreads both arms). Warm smile with cheek squint, raised inner brows, slight forward lean. Add shoulder/arm overlay for gentle sway. Duration ~2500ms.' },
  { name: 'count_one', track: 'action', tags: ['narrating', 'counting'],
    desc: 'Index finger raised on right hand — "first...". Use index gesture right hand. Confident face: slight smile, one brow raised, eyes engaged. Add overlay on RightHand/RightForeArm for subtle emphasis bob. Duration ~1500ms.' },
  { name: 'count_two', track: 'action', tags: ['narrating', 'counting'],
    desc: 'Two fingers up — "second...". Use side gesture right hand. Engaged face: smile, squinted eyes, slight head tilt to other side from count_one. Add arm overlay. Duration ~1500ms.' },
  { name: 'count_three', track: 'action', tags: ['narrating', 'counting'],
    desc: 'Open hand raised — "third...". Use handup gesture right hand. Expressive face: wider smile, brows up, nod. Add arm overlay. Duration ~1500ms.' },
  { name: 'on_one_hand', track: 'action', tags: ['narrating', 'comparing'],
    desc: 'Left hand raised presenting, body turns left — "on one hand...". Use handup gesture LEFT hand (isRight=false). Thoughtful face: one brow raised, slight frown, considering expression. Body and head rotate left (negative Y). Add LeftArm/LeftForeArm overlay for gentle sway. Duration ~2000ms.' },
  { name: 'on_other_hand', track: 'action', tags: ['narrating', 'comparing'],
    desc: 'Right hand raised presenting, body turns right — "on the other hand...". Use handup gesture RIGHT hand. Different expression from on_one_hand: other brow raised, slight smile. Body and head rotate right (positive Y). Add RightArm/RightForeArm overlay. Duration ~2000ms.' },
  { name: 'imagine_this', track: 'action', tags: ['narrating', 'storytelling'],
    desc: 'Hands spread outward/upward, wonder face — "picture this". Use shrug gesture. Wide eyes (eyeWide), raised brows (all four), open mouth excitement, slight backward lean then forward. Add Spine overlay for dramatic body sway. Duration ~2500ms.' },
  { name: 'in_conclusion', track: 'action', tags: ['narrating', 'presenting'],
    desc: 'Hands come together, decisive nod — "to sum up". Use namaste gesture then release. Multi-phase: hands come together, pause, decisive nod (headRotateX down then up). Serious-confident face: slight squint, pressed lips, then resolute nod. Duration ~2000ms.' },
  { name: 'transition_pause', track: 'action', tags: ['narrating', 'pacing'],
    desc: 'Brief head tilt, eyes look up then back — "so moving on..." Subtle transition. Head tilts (headRotateZ), eyes shift up briefly (headRotateX negative then back). Thoughtful face: slight squint, one brow up, pressed lips. No hands. Add subtle Neck overlay for organic feel. Duration ~1500ms.' },
  { name: 'list_item', track: 'action', tags: ['narrating', 'listing'],
    desc: 'Quick downward point — ticking off an item. Use index gesture right hand briefly. Quick nod down (headRotateX). Focused face: slight squint, pressed lips, brow down. Add RightHand overlay for crisp pointing motion. Duration ~1200ms.' },

  // ── Active Listening (6) ──
  { name: 'head_tilt', track: 'action', tags: ['listening', 'backchannel'],
    desc: 'Gentle head tilt to the right with raised brow — "I\'m following". Head tilts (positive headRotateZ ~0.12). Warm face: one brow raised (browOuterUpRight), soft smile, gentle eye squint. Add subtle Neck overlay for organic micro-movement. Duration ~1200ms.' },
  { name: 'slow_nod', track: 'action', tags: ['listening', 'acknowledgment'],
    desc: 'Single slow deliberate nod with soft smile — "mmhmm". Multi-phase: head goes down (headRotateX positive) then slowly back up. Warm face: soft smile with cheek squint, relaxed brows slightly up, pressed lips. Add Neck overlay for natural nod weight. Duration ~1500ms.' },
  { name: 'interested', track: 'mood', tags: ['listening', 'engaged'],
    desc: 'Deep engagement mood — wide attentive eyes, forward lean. Wide eyes (eyeWideLeft/Right ~0.3), raised inner brows, slight smile, forward lean (bodyRotateX slightly negative), slight head tilt. 5+ face morphs for believable engagement.' },
  { name: 'hmm_reaction', track: 'action', tags: ['listening', 'reaction'],
    desc: 'Pursed lips, one brow raised, tiny tilt — "hmm, interesting". Asymmetric: mouthPucker + mouthRight, one brow up (browOuterUpLeft), other slightly down, slight eye squint, tiny head tilt (headRotateZ + headRotateY). Rich facial expression. Duration ~1200ms.' },
  { name: 'micro_nod', track: 'action', tags: ['listening', 'backchannel'],
    desc: 'Very quick small nod — backchannel "uh-huh". Despite being quick, include facial expression: brief smile flash, slight eye squint, brow micro-movement. Fast headRotateX down and back. Add subtle Neck overlay. Duration ~600ms (short but expressive).' },
  { name: 'lean_in', track: 'action', tags: ['listening', 'engaged'],
    desc: 'Forward body lean with attentive eyes — "tell me more". Body leans forward (bodyRotateX negative ~-0.1). Wide attentive eyes, raised brows, slight smile, slight open mouth interest. Add Spine overlay for natural lean oscillation. Duration ~1500ms.' },

  // ── Emotional Nuance (14) ──
  { name: 'confused', track: 'mood', tags: ['emotion', 'uncertain'],
    desc: 'Puzzled persistent mood. Asymmetric brows (browDownLeft + browOuterUpRight), squinted eyes asymmetric, slightly open mouth (jawOpen + mouthOpen), head tilted (headRotateZ). Include 6+ morphs: brows + eyes + mouth + nose for rich confusion.' },
  { name: 'proud', track: 'mood', tags: ['emotion', 'positive'],
    desc: 'Proud persistent mood. Chin up (headRotateX negative), chest forward (bodyRotateX slightly negative), confident asymmetric smile (mouthSmileLeft != mouthSmileRight), narrowed eyes (eyeSquint), raised outer brow, slight nostril flare (noseSneer). 6+ morphs.' },
  { name: 'confident', track: 'mood', tags: ['emotion', 'professional'],
    desc: 'Calm self-assured persistent mood. Straight posture (bodyRotateX ~0), relaxed asymmetric smile, slight squint, one brow slightly higher, jaw slightly forward, chest expanded (chestInhale slight). Subtle but 6+ morphs for depth.' },
  { name: 'relieved', track: 'action', tags: ['emotion', 'positive'],
    desc: 'Relief action — multi-phase exhale. Phase 1: eyes close, chest inflated. Phase 2: deep exhale (chestInhale drops to 0), shoulders drop (bodyRotateX eases), mouth opens with exhale sound. Phase 3: eyes open, soft warm smile, relaxed brows. Add Spine overlay for organic exhale body movement. Duration ~2500ms.' },
  { name: 'hopeful', track: 'mood', tags: ['emotion', 'positive'],
    desc: 'Optimistic persistent mood. Wide eyes (eyeWide subtle), gentle warm smile, slight upward gaze (headRotateX slightly negative), raised inner brows, open face expression. Slight forward lean. 6+ morphs including cheeks.' },
  { name: 'embarrassed', track: 'mood', tags: ['emotion', 'social'],
    desc: 'Self-conscious persistent mood. Eyes averted to side (headRotateY), head dipped slightly (headRotateX positive). Pressed-lip smile (mouthPressLeft+Right + mouthSmile), slight brow furrow, eye squint, cheek flush feel (cheekSquint). 6+ morphs.' },
  { name: 'impressed', track: 'action', tags: ['emotion', 'reaction'],
    desc: 'Impressed reaction — "that\'s really good". Multi-phase: brows shoot up (browInnerUp + browOuterUp), eyes widen, slight backward lean (bodyRotateX positive). Then slow appreciative nod with squinted smile. Add Spine overlay for natural lean-back weight. Duration ~2000ms.' },
  { name: 'grateful', track: 'mood', tags: ['emotion', 'positive'],
    desc: 'Grateful persistent mood. Soft warm eyes (eyeSquint gentle), warm asymmetric smile, head slightly tilted (headRotateZ), brows gently raised, slight bow feeling (bodyRotateX + headRotateX slightly positive). Mouth pressed softly. 6+ morphs.' },
  { name: 'apologetic', track: 'mood', tags: ['emotion', 'social'],
    desc: 'Sorry persistent mood. Inner brows raised high (browInnerUp), slight frown (mouthFrownLeft+Right), eyes averted (headRotateY), head dipped, eye squint, pressed worried mouth. Include 6+ morphs for genuine remorse.' },
  { name: 'determined', track: 'mood', tags: ['emotion', 'intense'],
    desc: 'Resolute persistent mood. Jaw set (mouthClose + jawForward), brows down (browDownLeft+Right), focused squint (eyeSquint), slight forward lean (bodyRotateX positive), nostrils slightly flared (noseSneer), pressed lips. 6+ morphs.' },
  { name: 'bored', track: 'mood', tags: ['emotion', 'negative'],
    desc: 'Disengaged persistent mood. Half-lidded eyes (eyesClosed partial), slight frown, head propped to one side (headRotateZ), mouth pulled to one side (mouthRight), droopy brows, relaxed/slack jaw. 6+ morphs for convincing boredom.' },
  { name: 'nostalgic', track: 'mood', tags: ['emotion', 'reflective'],
    desc: 'Reflective persistent mood. Soft distant gaze (eyesClosed partial, eyeSquint), gentle asymmetric smile, head slightly tilted, eyes partially closed, brows softly raised, slight headRotateY as if looking into distance. 6+ morphs.' },
  { name: 'jealous', track: 'mood', tags: ['emotion', 'negative'],
    desc: 'Jealous persistent mood. Narrowed eyes (eyeSquint high), tight mouth (mouthPressLeft+Right), subtle side-eye (headRotateY), one brow lower than other, slight nose sneer, jaw tension (mouthClose). 6+ asymmetric morphs.' },
  { name: 'vulnerable', track: 'mood', tags: ['emotion', 'intimate'],
    desc: 'Exposed/vulnerable persistent mood. Wide eyes (eyeWide), inner brows raised high, mouth slightly parted (jawOpen + mouthOpen), chin slightly down, slight trembling lip feel (mouthLowerDown), quivering brow (browInnerUp high). 6+ morphs.' },

  // ── Conversational Reactions (7) ──
  { name: 'agree', track: 'action', tags: ['reaction', 'positive'],
    desc: 'Quick emphatic agreement nod. Multi-phase: quick nod down (headRotateX positive) then back up firmly. Bright smile with squinted eyes, raised cheeks, slight brow up. Despite being short, include 5+ face morphs. Add Neck overlay for natural nod weight. Duration ~800ms.' },
  { name: 'disagree_gentle', track: 'action', tags: ['reaction', 'polite'],
    desc: 'Polite small head shake. Multi-phase head oscillation: headRotateY goes positive, then negative, then back to center (3-4 phases). Empathetic face: pressed-lip smile, raised inner brows (sympathy), soft eye squint. Add Head bone overlay with Y-axis oscillation (freq 5, amp 0.03) for smooth shake. Duration ~1200ms.' },
  { name: 'surprise_positive', track: 'action', tags: ['reaction', 'positive'],
    desc: '"Oh! Great!" — surprise into delight. Multi-phase: Phase 1: brows shoot up, eyes widen, mouth opens (surprise). Phase 2: transitions to big smile, squinted happy eyes, cheek raise. Body leans back slightly then forward. Add Spine overlay for reactive body movement. Duration ~1500ms.' },
  { name: 'realization', track: 'action', tags: ['reaction', 'thinking'],
    desc: '"Aha!" moment. Quick multi-phase: eyes suddenly widen (eyeWide), brows shoot up, mouth forms "oh" (mouthPucker + jawOpen), slight head back then forward nod. Expressive: 6+ face morphs transitioning from surprise to understanding smile. Duration ~1200ms.' },
  { name: 'doubt', track: 'action', tags: ['reaction', 'uncertain'],
    desc: '"Are you sure?" skeptical look. Asymmetric: one brow up (browOuterUpLeft), other down (browDownRight), mouth pulled to side (mouthRight), slight squint, head tilt (headRotateZ), slight headRotateY. Rich asymmetric face with 6+ morphs. Duration ~1200ms.' },
  { name: 'sympathy_nod', track: 'action', tags: ['reaction', 'empathy'],
    desc: '"That\'s tough" — concerned slow nod. Multi-phase slow nod (headRotateX). Sad-concerned face: browInnerUp (sympathy brow), slight frown, soft squinted eyes, pressed mouth. Throughout the nod, maintain the concerned expression. Add Neck overlay. Duration ~1800ms.' },
  { name: 'whoops', track: 'action', tags: ['reaction', 'social'],
    desc: '"Oops!" awkward grimace-smile. Quick: grimace (mouthStretchLeft+Right), transitioning to embarrassed smile. Eyes shut briefly (eyesClosed flash), shoulders rise feeling (bodyRotateX negative briefly), brows up, cheeks squinted. Add Spine1/Spine2 overlay for shoulder-shrug oscillation. Duration ~1200ms.' },

  // ── Presenting/Teaching (6) ──
  { name: 'present', track: 'action', tags: ['presenting', 'professional'],
    desc: '"As you can see" — presenting gesture. Use handup gesture right hand. Body turns slightly toward presenting hand (bodyRotateY negative, headRotateY negative). Warm professional face: confident smile, engaged eyes, raised brow. Use kf: RightArm X+0.9 + RightForeArm X+0.3 to extend arm presenting (atlas verified). Add freq 3 oscillation. Duration ~2500ms.' },
  { name: 'welcome', track: 'action', tags: ['presenting', 'greeting'],
    desc: 'Welcoming arms open. Use shrug gesture (both arms spread). Wide warm smile with cheek squint, raised brows, slight bow (headRotateX positive briefly then back). Use kf: RightArm X+1.0 and LeftArm X+1.0 (both arms raised from atlas) + Both ForeArm X+0.5 + freq 3 oscillation. Add Spine overlay for bow. Duration ~2500ms.' },
  { name: 'consider', track: 'action', tags: ['presenting', 'thinking'],
    desc: '"Let me think about this" — hand to chin. Use fist gesture right hand (near chin). Thoughtful squint, brows furrowed slightly, eyes look up (headRotateX slightly negative), mouth pressed/pursed. Add subtle RightArm overlay for thinking fidget. Duration ~2500ms.' },
  { name: 'weigh_options', track: 'action', tags: ['presenting', 'comparing'],
    desc: 'Weighing pros and cons — body sways left then right. Multi-phase (5 phases): lean left (bodyRotateY negative) with left-side expression, center pause, lean right (bodyRotateY positive) with right-side asymmetric expression. Use different brow/mouth morphs for each side. Duration ~2500ms.' },
  { name: 'reveal', track: 'action', tags: ['presenting', 'dramatic'],
    desc: '"Ta-da!" reveal. Use handup gesture right hand. Multi-phase: anticipation (slight lean back, squint) then burst open: wide eyes (eyeWide), raised brows, big smile, open mouth joy, arm extends out. Add RightArm overlay for dramatic flourish. Duration ~1500ms.' },
  { name: 'attention_here', track: 'action', tags: ['presenting', 'directing'],
    desc: '"Pay attention!" — index finger up. Use index gesture right hand. Wide authoritative eyes (eyeWide), raised brows, slight forward lean (bodyRotateX negative). Serious-engaged expression, slight open mouth. Add RightHand/RightForeArm overlay for emphasis bob. Duration ~1800ms.' },

  // ── Social/Romantic (6) ──
  { name: 'flirty', track: 'mood', tags: ['social', 'playful'],
    desc: 'Flirtatious persistent mood. Asymmetric smile (mouthSmileLeft: 0.4, mouthSmileRight: 0.7), side glance (headRotateY ~0.08), head tilted (headRotateZ negative), one brow raised, slight squint, lips slightly parted. 6+ asymmetric morphs for charm.' },
  { name: 'coy', track: 'action', tags: ['social', 'playful'],
    desc: 'Coy glance — look away then back. Multi-phase: Phase 1: look away (headRotateY increases), shy smile. Phase 2: slowly look back, lids lower (eyesClosed partial), small alluring smile, one brow raised. Asymmetric face throughout. Duration ~2000ms.' },
  { name: 'playful_tease', track: 'action', tags: ['social', 'playful'],
    desc: 'Teasing smirk with eyebrow waggle. Multi-phase: asymmetric smirk (one side higher), then brows go up dramatically, then settle with squinted mischievous eyes. Slight lean forward. Add subtle Head overlay for playful head bob. Duration ~1500ms.' },
  { name: 'bashful', track: 'action', tags: ['social', 'romantic'],
    desc: '"You\'re making me blush" — look down then peek up. Multi-phase: head dips down (headRotateX positive), eyes close, shy smile, shoulders rise. Then slowly peek back up: eyes open, smile brightens, head comes back. Add Spine overlay for natural shy body movement. Duration ~1800ms.' },
  { name: 'whisper_lean', track: 'action', tags: ['social', 'intimate'],
    desc: '"Let me tell you a secret" — conspiratorial lean. Forward lean to side (bodyRotateX negative + bodyRotateY). Use fist gesture right (hand near mouth). Squinted conspiratorial eyes, pressed lips, lowered brows. Add Spine overlay for secretive sway. Duration ~2500ms.' },
  { name: 'tender_gaze', track: 'action', tags: ['social', 'intimate'],
    desc: 'Warm tender look with slow blink. Multi-phase: eyes softly close (eyesClosed ramps), soft warm smile, gentle head tilt (headRotateZ). Then eyes reopen with warm squinted gaze. Add subtle Neck overlay for gentle organic movement. Duration ~2500ms.' },

  // ── Role-Play (7) ──
  { name: 'heroic_pose', track: 'action', tags: ['roleplay', 'dramatic'],
    desc: 'Superhero power pose. Chest out (bodyRotateX negative ~-0.15), chin up (headRotateX negative ~-0.15). Use fist gesture right hand. Determined face: brows down, squinted focused eyes, jaw set (mouthClose), nostril flare (noseSneer). Use kf on RightArm/LeftArm to position arms in power pose (~0.7) + freq 2 oscillation for breathing. Add Spine overlay for powerful chest-breathing oscillation. Duration ~2500ms.' },
  { name: 'villain_laugh', track: 'action', tags: ['roleplay', 'dramatic'],
    desc: 'Evil menacing laugh. Multi-phase (5-6 phases): head tilts back, narrowed eyes (eyeSquint high), menacing asymmetric smile, mouth opens and closes rhythmically for laugh cycles. Lowered brows, nose sneer. Add Spine+Head overlay for sinister body shake (freq ~10). Duration ~3000ms.' },
  { name: 'dramatic_reveal', track: 'action', tags: ['roleplay', 'dramatic'],
    desc: '"Behold!" — dramatic sweep. Use shrug gesture (arms sweep out). Multi-phase: buildup (squint, lean), then burst: eyes wide, jaw drops, arms out. Transition to triumphant smile. Use kf on RightArm/LeftArm to sweep arms outward (~0.7) + freq 3 oscillation for flourish. Add Spine overlay for dramatic body flourish. Duration ~1800ms.' },
  { name: 'royal_wave', track: 'action', tags: ['roleplay', 'formal'],
    desc: 'Dignified royal wave. Use handup gesture right hand. Composed expression: controlled symmetric smile, slight chin raise (headRotateX slightly negative), dignified squint. Add RightHand overlay with SLOW oscillation (freq ~4, low amp) for elegant controlled wave. Duration ~2500ms.' },
  { name: 'sneaky', track: 'mood', tags: ['roleplay', 'suspicious'],
    desc: 'Sneaky/suspicious persistent mood. Squinted eyes (eyeSquint), hunched forward (bodyRotateX positive ~0.1), lowered brows (browDown), tight pressed mouth, slight side-look (headRotateY). 6+ morphs for shifty look.' },
  { name: 'scared_hide', track: 'action', tags: ['roleplay', 'fear'],
    desc: '"Don\'t hurt me!" — defensive recoil. Use handup gesture right hand (defensive). Wide terrified eyes (eyeWide max), raised brows max, open mouth fear, body recoils back (bodyRotateX positive). Use kf on RightArm for defensive arm position (~0.5) + freq 12 oscillation for trembling. Add Spine overlay for trembling (high freq ~15, low amp). Duration ~1500ms.' },
  { name: 'dramatic_gasp', track: 'action', tags: ['roleplay', 'dramatic'],
    desc: 'Dramatic shock gasp. Quick multi-phase: sharp inhale (chestInhale spikes), eyes fly open (eyeWide), brows shoot up, mouth opens wide (jawOpen + mouthOpen), body leans back (bodyRotateX negative). Add Spine overlay for gasp-body-jolt. Duration ~1200ms.' },

  // ── Professional (4) ──
  { name: 'formal_nod', track: 'action', tags: ['professional', 'formal'],
    desc: 'Professional deliberate nod. Single firm nod (headRotateX positive then back). Serious expression: NO smile, slight brow down, pressed lips (mouthPressLeft+Right), focused eyes (slight squint), jaw slightly set. Add Neck overlay for natural nod weight. Duration ~800ms.' },
  { name: 'thoughtful_pause', track: 'action', tags: ['professional', 'thinking'],
    desc: '"Let me consider" — finger to chin. Use fist gesture right hand. Eyes look upward (headRotateX negative), thoughtful squint, one brow raised, mouth closed and pressed, slight head tilt. Add subtle RightArm overlay for thinking fidget. Duration ~2000ms.' },
  { name: 'making_decision', track: 'action', tags: ['professional', 'decisive'],
    desc: '"Let\'s do that" — decisive moment. Multi-phase: eyes narrow with concentration (squint, brows down), then decisive firm nod (headRotateX down then up), jaw sets (mouthClose + jawForward), resolute expression. Add Neck overlay for weighted decisive nod. Duration ~1200ms.' },
  { name: 'respectful_disagree', track: 'action', tags: ['professional', 'polite'],
    desc: '"I see your point but..." — respectful disagreement. Use handup gesture right hand (palms-out feel). Empathetic face: browInnerUp (concern), slight frown, soft eyes, pressed sympathetic smile. Multi-phase gentle head shake. Add Head overlay with Y-axis oscillation for smooth disagree shake. Duration ~2000ms.' },

  // ══════════════════════════════════════════════════════════════════════════
  // CREATIVE MOTIONS (+12) — fun, expressive, memorable
  // ══════════════════════════════════════════════════════════════════════════
  { name: 'robot_malfunction', track: 'action', tags: ['fun', 'roleplay'],
    desc: 'Glitchy robot twitches. Multi-phase (6 phases): head jerks erratically (headRotateX/Y/Z rapid small changes), eyes blink erratically (eyeBlinkLeft/Right alternating), body micro-spasms (bodyRotateX/Z small jolts). Blank face with occasional jaw drop. Add HIGH frequency overlays (freq 15-25) on Head/Neck/Spine1/Spine2 for glitch tremors with varying phases. Duration ~2500ms.' },
  { name: 'robot_boot', track: 'action', tags: ['fun', 'roleplay'],
    desc: 'Robot powering on. Multi-phase (5 phases): Phase 1: dead still, eyes closed. Phase 2: eyes slowly open (eyesClosed decreasing), mechanical head movement (headRotateX stepwise). Phase 3: body straightens stiffly (bodyRotateX). Phase 4: eye blink calibration. Phase 5: operational — small smile, eyes focused. Mechanical feel throughout. Duration ~3000ms.' },
  { name: 'mind_blown', track: 'action', tags: ['fun', 'reaction'],
    desc: '"WHOA my mind is blown!" Head tilts back (headRotateX negative), eyes go WIDE (eyeWide max), jaw drops (jawOpen max), hands to temples feel — use handup gesture right hand. Multi-phase: shock, then hands spread out. Add Spine overlay for dramatic recoil. Duration ~2000ms.' },
  { name: 'mic_drop', track: 'action', tags: ['fun', 'dramatic'],
    desc: '"I rest my case" — confident mic drop moment. Use fist gesture right hand (holding mic), then release. Multi-phase: confident smirk (asymmetric mouthSmile, one brow raised), hand drops (gesture release), slight lean back (bodyRotateX positive). Satisfied squint. Add RightArm overlay for drop motion. Duration ~1500ms.' },
  { name: 'chef_kiss', track: 'action', tags: ['fun', 'positive'],
    desc: '"Perfecto!" — kiss fingertips then hand spreads. Use fist gesture right hand near face. Multi-phase: Phase 1: lips pucker (mouthPucker high) + fist near face. Phase 2: fingers release (gesture to handup), hand moves away, satisfied smile. Squinted happy eyes, raised cheeks. Add RightArm/RightHand overlay for flourish movement. Duration ~1500ms.' },
  { name: 'slow_clap', track: 'action', tags: ['fun', 'sarcastic'],
    desc: 'Sarcastic slow clap building speed. Use namaste gesture (hands together). Multi-phase (5-6 phases): slow rhythm building faster. Unamused face throughout: one brow raised (browOuterUpLeft), slight frown, mouthRight, squinted judging eyes. NOT a happy clap. Add Spine overlay for rhythmic body lean. Duration ~3000ms.' },
  { name: 'suspicious_squint', track: 'action', tags: ['fun', 'reaction'],
    desc: '"I\'m watching you." Increasingly narrowing eyes — multi-phase: squint intensifies (eyeSquintLeft/Right ramp up), head tilts forward (headRotateX negative), mouth tightens (mouthPressLeft+Right increase), brows lower. Very asymmetric face. Add subtle Head overlay for menacing forward movement. Duration ~2000ms.' },
  { name: 'victory_dance', track: 'action', tags: ['fun', 'celebration'],
    desc: '"I WIN!" — fist pump + head bob + body sway. Use fist gesture right hand. Multi-phase (6 phases): fist pumps up, head bobs, body sways side to side (bodyRotateY + bodyRotateZ oscillation). HUGE smile, squinted joyful eyes, raised cheeks. Use kf on RightArm for fist pump arc (~0.7 up then down) + freq 6 oscillation for bounce. Add Spine/Head overlay for rhythmic bouncing (freq ~6). Duration ~3000ms.' },
  { name: 'sleeping_wake', track: 'action', tags: ['fun', 'surprise'],
    desc: 'Startled awake from sleep. Multi-phase (4 phases): Phase 1: asleep (eyesClosed, head drooped, slack jaw). Phase 2: sudden jolt — eyes SNAP open (eyeWide max), head jerks up, body straightens. Phase 3: confused blinking. Phase 4: dawning awareness — small smile, brows settle. Add Spine overlay for wake-up jolt. Duration ~2000ms.' },
  { name: 'zoned_out', track: 'mood', tags: ['fun', 'negative'],
    desc: 'Totally checked out persistent mood. Blank stare: eyes slightly wide but unfocused (eyeWideLeft/Right slight), mouth slightly open (jawOpen + mouthOpen slight), head drifts to one side (headRotateZ + headRotateY). Flat brows, no engagement. 6+ morphs for vacancy.' },
  { name: 'sassy', track: 'action', tags: ['fun', 'social'],
    desc: 'Sassy neck roll with attitude face. Multi-phase (4 phases): head rotates in a Z-axis circle (headRotateZ oscillation positive then negative), asymmetric smirk (mouthSmileRight high, mouthSmileLeft low), one brow raised high, squinted judging eyes, slight nose sneer. Add Head/Neck overlay for smooth rolling motion. Duration ~2000ms.' },
  { name: 'evil_plan', track: 'mood', tags: ['fun', 'roleplay'],
    desc: 'Scheming villain persistent mood. Narrowed eyes (eyeSquintLeft + eyeSquintRight high), asymmetric grin (mouthSmileRight much higher), lowered brows (browDownLeft + browDownRight), steepled fingers feel — use fist gesture... wait, moods have NO gestures. Instead: slight forward lean (bodyRotateX negative), head slightly down (headRotateX positive), nose sneer. 6+ morphs for menace.' },
  { name: 'triumph', track: 'action', tags: ['fun', 'celebration'],
    desc: '"I DID IT!" — epic victory. Use handup gesture right hand (both arms up feel). Head tilts back (headRotateX negative), huge smile (mouthSmile max), body leans back proudly (bodyRotateX negative), chest out (chestInhale high). Wide eyes, raised brows, cheek squint max. Use kf on RightArm/LeftArm to raise arms up (~0.7) + freq 4 oscillation for triumphant swell then back down. Add Spine overlay for triumphant body swell. Duration ~2500ms.' },
];

// ---------------------------------------------------------------------------
// Gemini API caller
// ---------------------------------------------------------------------------
async function callGemini(apiKey, model, system, prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: system }] },
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, responseMimeType: 'application/json' },
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini ${res.status}: ${text}`);
  }
  const data = await res.json();
  return data.candidates[0].content.parts[0].text;
}

// ---------------------------------------------------------------------------
// Parse LLM response into clean motion JSON
// ---------------------------------------------------------------------------
function parseMotionResponse(raw) {
  let text = raw.trim();
  if (text.startsWith('```')) {
    text = text.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  }
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// Build user prompt for each motion
// ---------------------------------------------------------------------------
function buildUserPrompt(entry) {
  const trackHint = entry.track === 'mood'
    ? `This is a MOOD (persistent state).
Requirements:
- Use dt [500, 2000, 500] with rescale [0, 1, 0]
- Define morph baselines that stay active — NO gestures
- Include 6+ face morphs minimum (brows + eyes + mouth + at least one of: cheeks/nose/jaw)
- Use asymmetric left/right values for natural look
- Keep morph values subtle (0.15–0.6 range)
- Can include posture (headRotate, bodyRotate) but keep subtle
- NO _overlay needed for moods`
    : `This is an ACTION (temporal gesture).
Requirements:
- Use appropriate phase count (3 for simple, 4-6 for complex sequences)
- Include 5+ face morphs minimum — EVERY action needs an expressive face
- If the motion involves hands: MUST include gesture AND _overlay for arm bones
- If it involves body movement: add Spine/Neck _overlay for organic feel
- Use asymmetric morph values for natural expressions
- Combine face + head rotation + body rotation + gesture + overlay for rich multi-layer motion`;

  return `Create a motion called "${entry.name}".

Description: ${entry.desc}

${trackHint}

Return ONLY the motion body JSON object with dt, vs, rescale, and optionally _overlay.`;
}

// ---------------------------------------------------------------------------
// Post-generation validator
// ---------------------------------------------------------------------------
function validateMotion(name, motion, entry) {
  const warnings = [];
  const dt = motion.dt || [];
  const vs = motion.vs || {};
  const rescale = motion.rescale || [];
  const overlay = motion._overlay;

  // Check dt/rescale length match
  if (rescale.length && rescale.length !== dt.length) {
    warnings.push(`rescale length ${rescale.length} != dt length ${dt.length}`);
  }

  // Count face morphs (exclude special keys)
  const specialKeys = new Set(['gesture', 'headRotateX', 'headRotateY', 'headRotateZ',
    'bodyRotateX', 'bodyRotateY', 'bodyRotateZ', 'headMove', 'chestInhale']);
  const faceMorphs = Object.keys(vs).filter(k => !specialKeys.has(k));
  if (entry.track === 'action' && faceMorphs.length < 4) {
    warnings.push(`only ${faceMorphs.length} face morphs (want 4+)`);
  }
  if (entry.track === 'mood' && faceMorphs.length < 5) {
    warnings.push(`mood with only ${faceMorphs.length} face morphs (want 5+)`);
  }

  // Check overlay structure
  if (overlay) {
    if (overlay.bones) {
      for (const [bone, params] of Object.entries(overlay.bones)) {
        if (typeof params !== 'object' || Array.isArray(params) || typeof params === 'number') {
          warnings.push(`overlay bone "${bone}" malformed: ${JSON.stringify(params)}`);
        }
      }
    }
    if (overlay.delay === undefined && overlay.duration === undefined) {
      warnings.push('overlay missing delay/duration');
    }
  }

  // Check that gesture actions have overlay
  if (vs.gesture && !overlay && entry.track === 'action') {
    warnings.push('has gesture but no arm overlay');
  }

  return warnings;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\n🎬 Motion Generator — ${CATALOG.length} motions`);
  console.log(`   Model: ${MODEL}`);
  console.log(`   Output: ${OUTPUT}`);
  console.log(`   Delay: ${DELAY}ms between requests`);
  if (DRY_RUN) console.log('   ** DRY RUN — no API calls **');
  console.log('');

  // Load existing results if resuming
  let results = {};
  if (RESUME && existsSync(OUTPUT)) {
    results = JSON.parse(readFileSync(OUTPUT, 'utf8'));
    console.log(`   Resuming: ${Object.keys(results).length} motions already generated\n`);
  }

  let success = 0;
  let errors = 0;
  const allWarnings = [];

  for (let i = 0; i < CATALOG.length; i++) {
    const entry = CATALOG[i];
    const num = `[${i + 1}/${CATALOG.length}]`;

    // Skip if already generated (resume mode)
    if (results[entry.name]) {
      console.log(`${num} ⏭  ${entry.name} (already exists)`);
      success++;
      continue;
    }

    const userPrompt = buildUserPrompt(entry);

    if (DRY_RUN) {
      console.log(`${num} 📝 ${entry.name} (${entry.track})`);
      console.log(`   Prompt: ${userPrompt.split('\n')[0]}`);
      continue;
    }

    try {
      process.stdout.write(`${num} 🔄 ${entry.name} (${entry.track})...`);
      const raw = await callGemini(API_KEY, MODEL, SYSTEM_PROMPT, userPrompt);
      const motion = parseMotionResponse(raw);

      // Validate
      const warnings = validateMotion(entry.name, motion, entry);
      if (warnings.length) {
        allWarnings.push({ name: entry.name, warnings });
      }

      // Add metadata
      motion._description = entry.desc.split('.')[0];
      motion._tags = entry.tags;
      motion._track = entry.track;

      results[entry.name] = motion;
      success++;
      console.log(warnings.length ? ` ⚠️  (${warnings.join('; ')})` : ' ✅');

      // Save after each successful generation (crash-safe)
      writeFileSync(OUTPUT, JSON.stringify(results, null, 2));

      // Rate limit
      if (i < CATALOG.length - 1) {
        await new Promise(r => setTimeout(r, DELAY));
      }
    } catch (err) {
      errors++;
      console.log(` ❌ ${err.message}`);
    }
  }

  // Final save
  if (!DRY_RUN && Object.keys(results).length > 0) {
    writeFileSync(OUTPUT, JSON.stringify(results, null, 2));
  }

  console.log(`\n✨ Done: ${success} success, ${errors} errors`);
  if (allWarnings.length) {
    console.log(`\n⚠️  Quality warnings (${allWarnings.length} motions):`);
    allWarnings.forEach(({ name, warnings }) => {
      console.log(`   ${name}: ${warnings.join('; ')}`);
    });
  }
  console.log(`   Output: ${OUTPUT}\n`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
