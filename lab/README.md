# Lab

A frozen avatar for fitting and reviewing the catalogs: contact sheets of expressions and film strips of gestures, with the measurements that pictures can't settle. The bundled `facs.json` and `gestures.json` were tuned with it.

```bash
npm run lab    # http://localhost:5174/ (faces) and /body.html (gestures)
```

Sheets and data are saved under `lab/out/` (git-ignored) and previewed on the page. Keep the tab visible: Chrome stops rendering a hidden one. After editing `src/` or a catalog, reload the page by hand.

| URL parameter | Meaning |
| --- | --- |
| `avatar` | Another `.glb` (default: the demo's). A local file is served from `demo/public/`: `?avatar=./mine.glb`. |
| `body` | `F` (default) or `M`, as in TalkingHead's `showAvatar`. |
| `lids=0` | Without the live-like lids (see [Limits](#limits)). |

## Faces

The toolbar runs `review()` and `ladder()`; the rest is in the console as `lab`.

| Call | Result |
| --- | --- |
| `lab.review({ dir })` | Every expression the classifier can pick: moods level, head down and talking; beats at their peak. Plus `faces.json`. |
| `lab.ladder('AU12', { levels })` | One AU at rising levels, still and talking. `AU12_L` for one side. |
| `lab.compare({ happy: { AU6: 0.3, AU12: 0.5 } })` | The catalog's recipe next to a new one, two names per sheet. |
| `lab.sheet({ title, cols, rows, file })` | Any sheet. `cols`: `{ label, aus }` or `{ label, name }`; `rows`: `{ label, head: [pitch, yaw, roll], talk: 'aa' }`. |
| `lab.show(aus)` | Puts a recipe on the face and leaves it there. |
| `lab.measure.lids()`, `.teeth()` | The facts below, for the face as it is now. |

A recipe can set a blendshape directly with `=name`: `{ AU12: 0.4, '=mouthRollLower': 0.3 }`.

Each sheet returns facts per cell:

- `lowerLidMm`, `upperLidMm`: how far each lid moved from that row's neutral face. A smile reads warm when the lower lid rises; an upper lid that drops reads sleepy or smug.
- `teeth`: `{ upper, lower }`, how many sample points of each row of teeth the camera sees. A thin band of teeth reads tense: show them properly or not at all.

**How to fit an expression**

1. Run a ladder for each AU it uses. The highest level that still looks natural, still and talking, goes in `au_limits`.
2. Compare the recipe in all three rows. It has to hold up with the head down, where a smile under unchanged eyes turns into a stare.
3. Look at the neutral face first. If the mouth's corners turn up at rest, lowered brows over it read as a smirk.
4. Then watch it in the demo, in motion and through a whole reply.

## Gestures

| Call | Result |
| --- | --- |
| `lab.review({ dir })` | Every gesture as a strip of stills, a table of its motion, and `motion.json`. |
| `lab.film(names, { file, frames })` | The same for some gestures; without `file` it only measures. |
| `lab.series(name, { track, axis, from, to })` | The last recording as `ms:value` pairs: a hand's distance from its start (m), or the head's pitch, yaw or roll (rad) with `track: 'head'` and `axis` 0, 1 or 2. |
| `lab.rest()` | Back to the stance. |

Per gesture: `reachM` (how far the hand travels), `handPeakMps` and `handPeakAtMs` (its fastest 100 ms), `headPeakRadps`.

For reference, conversational hand gestures peak around 1–2.5 m/s at the wrist. At 4 m/s the hand jumps 13 cm between two frames and the move reads as a pop: give the frame a longer `transitionMs`. TalkingHead finishes a pose change in about 0.6 of the time it is given.

## Limits

- The avatar is frozen: no blinks, breathing, gaze or idle sway. The lab shows a recipe, not how it feels in motion; the demo does.
- Live, TalkingHead's gaze lowers the upper lids a little. The lab holds them there (`eyesLookDown` 0.28, the eye about 88% open) so eyes aren't judged more open than they will ever be. Lid narrowing that looks right with `lids=0` is too much live.
- Sheets show beats held at their peak, not their envelope.
- The arm poses in `gestures.json` are fitted to the demo avatar. The lab shows how they play on another one; it doesn't re-solve them.
