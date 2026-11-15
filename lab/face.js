// Face lab: contact sheets of recipes on the frozen avatar, still, head down and talking, with the lid and teeth facts
// that pictures can't settle. Use it from the toolbar or from the console through window.lab.

import { capture, createStage, createStatus, faceRect, setHeadPose, wait, withPixelRatio } from './stage.js';
import { createMeasure } from './measure.js';
import { createSheet, publish, saveJson } from './sheet.js';

// TalkingHead eases a baseline change over about 1.2 s.
const SETTLE = 1300;
// A viseme as it peaks in speech, and how long TalkingHead takes to reach it or let it go.
const VISEME = 0.6;
const VISEME_SETTLE = 650;
// TalkingHead's standing poses and idle leave the head pitched down about this much (rad) for much of a session; a
// face has to hold up there too.
const HEAD_DOWN = [0.15, 0, 0.05];
const ROWS = [{ label: 'level' }, { label: 'head down', head: HEAD_DOWN }, { label: 'talking', talk: 'aa' }];

const PER_SHEET = 4;

const { head, engine, facs } = await createStage({ view: 'head' });
const measure = createMeasure(head);
const { status, tracked } = createStatus();

const chunks = (list, size) =>
  Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));
const round1 = (x) => Math.round(x * 10) / 10;

/**
 * Shows a recipe through the engine and waits for it to settle.
 * @param {Record<string, number>} aus - AU → level; none for the neutral face
 */
async function show(aus) {
  engine.face.reset();
  await wait(60);
  if (Object.keys(aus).length) {
    // A mood, so a beat's recipe is held at its peak.
    facs.expressions.__lab = { aus };
    engine.face.play('__lab');
  }
  await wait(SETTLE);
}

// A column's recipe: its own AUs, or those of a catalog expression.
function recipeOf({ aus, name }) {
  if (aus) return aus;
  const expression = facs.expressions[name];
  if (!expression) throw new Error(`unknown expression ${name}`);
  return expression.aus ?? {};
}

/**
 * One contact sheet: a row per head pose or mouth state, a column per recipe.
 * @param {object} options
 * @param {string} options.title
 * @param {{label: string, aus?: Record<string, number>, name?: string}[]} options.cols - Recipes, or catalog names
 * @param {{label: string, head?: number[], talk?: string}[]} [options.rows] - `head` is [pitch, yaw, roll] in rad,
 *   `talk` a viseme held while the cell is captured
 * @param {string} options.file - Relative to lab/out/
 * @param {number} [options.cell=440]
 * @param {'face'|'eyes'|'mouth'} [options.crop='face']
 * @returns {Promise<{file: string, facts: Record<string, object>}>} Per cell: how far the lids moved against that
 *   row's neutral (mm) and how many teeth samples show
 */
async function sheet({ title, cols, rows = ROWS, file, cell = 440, crop = 'face' }) {
  const subtitle = `settle ${SETTLE} ms · talking viseme ${VISEME}`;
  const out = createSheet({ title, subtitle, columns: cols.length, rows: rows.length, cell });
  const facts = {};
  try {
    await withPixelRatio(head, 3, async () => {
      for (const [r, row] of rows.entries()) {
        setHeadPose(head, ...(row.head ?? []));
        await show({});
        const neutral = measure.lids();
        for (const [c, col] of cols.entries()) {
          status(`${title}: ${row.label} · ${col.label}`);
          await show(recipeOf(col));
          // Through TalkingHead on purpose, so the engine's speech ducking applies as it does live.
          if (row.talk) {
            head.setFixedValue('viseme_' + row.talk, VISEME);
            await wait(VISEME_SETTLE);
          }
          out.put(r, c, capture(head, faceRect(head, crop), cell, cell), `${row.label} · ${col.label}`);
          const lids = measure.lids();
          facts[`${row.label} | ${col.label}`] = {
            lowerLidMm: round1((lids.lower - neutral.lower) * 1000),
            upperLidMm: round1((lids.upper - neutral.upper) * 1000),
            teeth: measure.teeth(),
          };
          if (row.talk) {
            head.setFixedValue('viseme_' + row.talk, null);
            await wait(VISEME_SETTLE);
          }
        }
      }
    });
  } finally {
    setHeadPose(head);
    engine.face.reset();
  }
  return { file: await publish(out.canvas, file), facts };
}

/**
 * The catalog's recipe against a new one, two names per sheet (`<file>-1.jpeg`, …).
 * @param {Record<string, Record<string, number>>} recipes - Name → AUs; a new name gets only its "new" column
 * @param {object} [options]
 * @param {string} [options.file='compare']
 * @returns {Promise<{file: string, facts: Record<string, object>}[]>}
 */
async function compare(recipes, { file = 'compare' } = {}) {
  const sheets = [];
  for (const [i, names] of chunks(Object.keys(recipes), 2).entries()) {
    const cols = names.flatMap((name) => [
      ...(facs.expressions[name] ? [{ label: `${name} now`, name }] : []),
      { label: `${name} new`, aus: recipes[name] },
    ]);
    sheets.push(await sheet({ title: names.join(' · '), cols, file: `${file}-${i + 1}.jpeg` }));
  }
  return sheets;
}

// "AU12 → mouthSmileLeft 1, …", for the subtitle of a ladder.
function blendshapesOf(au) {
  const side = au.endsWith('_L') ? 'Left' : au.endsWith('_R') ? 'Right' : null;
  const weights = facs.au_map[side ? au.slice(0, -2) : au];
  if (!weights) throw new Error(`unknown AU ${au}`);
  return Object.entries(weights)
    .filter(([morph]) => !side || morph.includes(side))
    .map(([morph, weight]) => `${morph} ${weight}`)
    .join(', ');
}

/**
 * One AU at rising levels, level and talking. A trailing _L or _R makes it one-sided, as in the engine.
 * @param {string} au
 * @param {object} [options]
 * @param {number[]} [options.levels]
 * @param {string} [options.file='ladder-<au>.jpeg']
 * @returns {Promise<{file: string, facts: Record<string, object>}>}
 */
async function ladder(au, { levels = [0.2, 0.4, 0.6, 0.8, 1], file = `ladder-${au}.jpeg` } = {}) {
  const cols = [
    { label: 'neutral', aus: {} },
    ...levels.map((level) => ({ label: `${au} ${level}`, aus: { [au]: level } })),
  ];
  return sheet({ title: `${au} → ${blendshapesOf(au)}`, cols, rows: [ROWS[0], ROWS[2]], file });
}

/**
 * Every expression that has a description (the ones the classifier can pick): moods in head poses and talking, beats
 * at their peak, four per sheet, and all the facts in one file.
 * @param {object} [options]
 * @param {string} [options.dir='review'] - Under lab/out/
 * @returns {Promise<string[]>} The files written
 */
async function review({ dir = 'review' } = {}) {
  const described = Object.entries(facs.expressions).filter(([, expression]) => expression.description);
  const column = ([name]) => ({ label: name, name });
  const moods = described.filter(([name, expression]) => expression.kind !== 'beat' && name !== 'neutral').map(column);
  const beats = described.filter(([, expression]) => expression.kind === 'beat').map(column);

  const files = [];
  const facts = {};
  const run = async (list, prefix, rows) => {
    for (const [i, cols] of chunks(list, PER_SHEET).entries()) {
      const result = await sheet({ title: `${prefix} ${i + 1}`, cols, rows, file: `${dir}/${prefix}-${i + 1}.jpeg` });
      files.push(result.file);
      Object.assign(facts, result.facts);
    }
  };
  await run(moods, 'moods', ROWS);
  await run(beats, 'beats', ROWS.slice(0, 2));
  files.push(await saveJson(facts, `${dir}/faces.json`));
  return files;
}

const select = document.getElementById('au');
for (const au of Object.keys(facs.au_map).filter((key) => !key.startsWith('='))) select.append(new Option(au, au));

const tools = {
  sheet: tracked(sheet),
  compare: tracked(compare),
  ladder: tracked(ladder),
  review: tracked(review),
};
const buttons = [document.getElementById('review'), document.getElementById('ladder')];
const onClick = (button, job) =>
  button.addEventListener('click', async () => {
    buttons.forEach((b) => (b.disabled = true));
    try {
      await job();
    } catch (error) {
      console.error(error);
    } finally {
      buttons.forEach((b) => (b.disabled = false));
    }
  });
onClick(buttons[0], () => tools.review());
onClick(buttons[1], () => tools.ladder(select.value));

window.lab = { head, engine, facs, measure, show, ...tools };
