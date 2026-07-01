# FACS migration map

Generated from `src/motions.json` (98 motions). Split by **rig**: face → FACS/AU, body → skeleton.

**Rule:** face? → FACS. body? → motions.json. in both? → FACS wins, delete the other.

## 🟥 A — Emotion → FACS owns it (DELETE dup / alias)  (43)

| motion | current | → destination | note |
|---|---|---|---|
| `adoring` | action | FACS love | alias |
| `angry` | mood | FACS angry | dup |
| `beam` | action | FACS happy (strong) | intensity variant |
| `crying_laugh` | action | FACS laugh | stylized (tears) — flag |
| `curious` | mood | FACS curious | dup |
| `disappointed` | action | FACS disappointed | dup |
| `disgust` | mood | FACS disgust | dup |
| `excited` | action | FACS excited | dup |
| `fear` | mood | FACS fear | dup |
| `flushed` | action | FACS shy | alias (blush is a texture, not AU — flag) |
| `frown` | mood | FACS sad | alias |
| `grimace` | mood | FACS disgust/pain | flag: pain not in EMFACS-7 |
| `grimace_teeth` | action | FACS anger/fear (bared teeth) | flag |
| `grin` | action | FACS happy | alias |
| `happy` | mood | FACS happy | dup |
| `heart_eyes` | action | FACS love | stylized sticker (no AU) — KEEP special? flag |
| `laugh` | action | FACS laugh | dup |
| `laugh_closed` | action | FACS laugh | closed-mouth variant → intensity |
| `love` | mood | FACS love | dup |
| `nervous` | mood | FACS nervous | dup |
| `neutral` | mood | FACS neutral | base/rest state |
| `neutral_face` | action | FACS neutral | dup of neutral |
| `open_grin` | action | FACS laugh | alias |
| `pensive` | action | FACS pensive | dup |
| `pleading` | mood | FACS tender/pleading | flag: needs pleading recipe? |
| `puppy_eyes` | action | FACS tender/pleading | flag: needs pleading recipe? |
| `rage` | action | FACS angry (intense) | intensity variant |
| `sad` | mood | FACS sad | dup |
| `sad_frown` | action | FACS sad | alias |
| `scream` | action | FACS fear (intense) | intensity variant |
| `shy` | mood | FACS shy | dup |
| `slight_smile` | action | FACS happy (slight) | intensity variant |
| `smirk` | action | FACS contempt | alias |
| `smug` | action | FACS proud | alias |
| `sobbing` | action | FACS sad (intense) | stylized — flag |
| `squint_smile` | action | FACS amused | alias |
| `surprise` | mood | FACS surprise | dup |
| `surprised` | action | FACS surprise | dup of surprise |
| `thinking` | mood | FACS pensive | alias |
| `thinking_face` | action | FACS pensive | alias |
| `unamused` | action | FACS contempt | alias |
| `warm_smile` | action | FACS tender | alias |
| `wink_smile` | action | FACS happy + [wink] | composite (emotion+action) |

## 🟩 B — Facial action → move to FACS as AU (kind:beat)  (16)

| motion | current | → destination | note |
|---|---|---|---|
| `blow_kiss` | action | AU18 + hand (hybrid) | face→FACS, hand stays in C |
| `cheek_puff` | action | AU33 (blow) / cheekPuff | new FACS action |
| `chew` | action | jaw cycle | facial action |
| `close_eyes` | action | AU43 | new FACS action |
| `eyeroll` | action | gaze up + roll | new FACS action (eyes) |
| `kiss` | action | AU18 (pucker) | new FACS action |
| `kiss_eyes_closed` | action | AU18 + AU43 | new FACS action |
| `open_mouth` | action | AU26 (jaw) | new FACS action |
| `raise_eyebrows` | action | AU1 + AU2 | new FACS action |
| `side_glance` | action | gaze (eyesRotateY) | already used by old smirk _react |
| `sigh` | action | exhale (subtle) | facial + audio cue |
| `squint` | mood | AU7 | new FACS action |
| `tongue_out` | action | AU19 | dup of tongueout |
| `tongueout` | action | AU19 (tongue show) | new FACS action |
| `wink` | action | AU46 (unilateral AU43) | new FACS action |
| `yawn` | action | AU26 + AU43 | facial action |

## 🟦 C — Body/skeletal gesture → KEEP in motions.json (Mixamo later)  (32)

| motion | current | → destination | note |
|---|---|---|---|
| `applause` | action | motions.json |  |
| `bow` | action | motions.json | Mixamo candidate |
| `celebrate` | action | motions.json | Mixamo candidate |
| `dance` | action | motions.json | Mixamo candidate |
| `dismiss` | action | motions.json |  |
| `facepalm` | action | motions.json | hand-to-face (body) |
| `hand_raise` | action | motions.json |  |
| `hand_raise_left` | action | motions.json |  |
| `head_circles` | action | motions.json |  |
| `head_shake` | action | motions.json | dup of shake_no? |
| `jump` | action | motions.json | Mixamo candidate |
| `look_down` | action | motions.json (head) | DUBIOSO |
| `look_left` | action | motions.json (head) | DUBIOSO: usado en pack_adventure |
| `look_right` | action | motions.json (head) | DUBIOSO: usado en pack_adventure |
| `look_up` | action | motions.json (head) | DUBIOSO: cara o cuerpo? |
| `namaste_bow` | action | motions.json |  |
| `nod` | action | motions.json |  |
| `nod_yes` | action | motions.json | dup of nod? |
| `ok_sign` | action | motions.json |  |
| `ok_wink` | action | motions.json + [wink] | hybrid: hand ok + wink |
| `point` | action | motions.json |  |
| `pray` | action | motions.json |  |
| `shake_no` | action | motions.json |  |
| `shrug_both` | action | motions.json | dup of shrug_confused? |
| `shrug_confused` | action | motions.json |  |
| `thumbdown_right` | action | motions.json |  |
| `thumbs_down` | action | motions.json | dup of thumbdown_right? |
| `thumbs_up` | action | motions.json | dup of thumbup_right? |
| `thumbup_right` | action | motions.json |  |
| `turn_around` | action | motions.json |  |
| `wave_left` | action | motions.json | Mixamo candidate |
| `wave_right` | action | motions.json | Mixamo candidate |

## ⚙️ D — Idle / physiological → KEEP (special)  (7)

| motion | current | → destination | note |
|---|---|---|---|
| `deep_breath` | action | keep (idle) |  |
| `listen` | mood | keep (idle) |  |
| `shiver` | action | keep (idle) |  |
| `sleep` | mood | keep (state) |  |
| `sleeping` | mood | keep (state) | dup of sleep? |
| `vibrate` | action | keep (idle) |  |
| `zzz` | action | keep (state) |  |

## Summary

| bucket | count | outcome |
|---|---|---|
| A emotion | 43 | folded into FACS (delete/alias) |
| B facial action | 16 | added to FACS as AU beats |
| C body gesture | 32 | stay in motions.json (~final size) |
| D idle | 7 | stay (special) |

**motions.json after:** ~39 (body + idle only). **FACS after:** ~24 emotions + ~16 facial actions.

### Flags to review
- `ok_wink`: hybrid: hand ok + wink
- `nod_yes`: dup of nod?
- `look_up`: DUBIOSO: cara o cuerpo?
- `look_down`: DUBIOSO
- `surprised`: dup of surprise
- `grimace`: flag: pain not in EMFACS-7
- `pleading`: flag: needs pleading recipe?
- `sleeping`: dup of sleep?
- `look_left`: DUBIOSO: usado en pack_adventure
- `look_right`: DUBIOSO: usado en pack_adventure
- `neutral_face`: dup of neutral
- `tongue_out`: dup of tongueout
- `crying_laugh`: stylized (tears) — flag
- `wink_smile`: composite (emotion+action)
- `sobbing`: stylized — flag
- `puppy_eyes`: flag: needs pleading recipe?
- `flushed`: alias (blush is a texture, not AU — flag)
- `heart_eyes`: stylized sticker (no AU) — KEEP special? flag
- `grimace_teeth`: flag
- `thumbs_up`: dup of thumbup_right?
- `thumbs_down`: dup of thumbdown_right?
- `shrug_both`: dup of shrug_confused?
- `head_shake`: dup of shake_no?
