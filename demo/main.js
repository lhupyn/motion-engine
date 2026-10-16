import { TalkingHead } from 'talkinghead';
import { MotionEngine, systemOne } from '../src/index.js';
import FACS from '../src/facs.json' with { type: 'json' };

const $ = (id) => document.getElementById(id);
const label = (name) => name.replaceAll('_', ' ');
const status = (text) => {
  $('status').textContent = text;
};

const head = new TalkingHead($('avatar'), {
  cameraView: 'upper',
  showProgressBar: false,
  dracoEnabled: true,
});

try {
  await head.showAvatar({ url: './female_1.glb', body: 'F' });
} catch (err) {
  status(`Could not load the avatar: ${err.message}`);
  throw err;
}

// The load greeting's glances; demo only.
const beat = (aus, envelope) => ({ kind: 'beat', aus, envelope });
const GREETING_FACES = {
  glance_down: beat({ AU64: 0.6 }, { in: 150, hold: 350, out: 250 }),
  glance_side: beat({ AU62: 0.5 }, { in: 200, hold: 500, out: 300 }),
};
const greetingOnly = new Set(Object.keys(GREETING_FACES));

const engine = new MotionEngine(head, {
  face: { facs: { ...FACS, expressions: { ...FACS.expressions, ...GREETING_FACES } } },
});
window.engine = engine;

status('Ready');

// A shy hello: [ms, name] steps, then back to neutral. The director only relaxes
// faces it chose, so this one fades back here unless the visitor or a decision
// changes the face first.
const GREETING = [
  [0, 'glance_down'],
  [500, 'shy'],
  [600, 'glance_side'],
  [800, 'wave'],
];
const play = (name) => (engine.body.channelOf(name) ? engine.body.play(name) : engine.face.play(name));
const greetingTimers = [
  ...GREETING.map(([ms, name]) => setTimeout(() => play(name), ms)),
  setTimeout(() => engine.face.play('neutral'), 2500),
];
const endGreeting = () => greetingTimers.forEach(clearTimeout);

function button(text, onclick) {
  return Object.assign(document.createElement('button'), { textContent: text, onclick });
}

const select = (row, b) =>
  row.querySelectorAll('button').forEach((x) => {
    x.classList.toggle('on', x === b);
    x.setAttribute('aria-pressed', x === b);
  });

// `manual` names the director's question; options it doesn't offer the decision model are dashed.
const offered = engine.director.questions('avatar');

function chips(id, names, onPick, { exclusive = false, manual = null } = {}) {
  const row = $(id);
  for (const name of names) {
    if (greetingOnly.has(name)) continue;
    const b = button(label(name), () => {
      if (exclusive) select(row, b);
      status(onPick(name));
    });
    if (manual && !(name in offered[manual].criteria)) {
      b.classList.add('manual');
      b.title = 'Manual only: the decision model never picks it';
    }
    row.append(b);
  }
}

chips(
  'camera',
  ['head', 'upper', 'mid', 'full'],
  (view) => {
    head.setView(view);
    return `Camera: ${view}`;
  },
  { exclusive: true },
);
select($('camera'), $('camera').children[1]);

const kindOf = (name) => engine.face.resolve(name).kind;
const isGaze = (name) => Object.keys(engine.face.resolve(name).vs).every((mt) => /^eyeLook/.test(mt));
const beats = engine.face.names.filter((n) => kindOf(n) === 'beat');
const playFace = (prefix) => (name) => {
  endGreeting();
  engine.face.play(name);
  return `${prefix}: ${label(name)}`;
};

// Not exclusive: the face also changes through decisions and the relax.
chips(
  'moods',
  engine.face.names.filter((n) => kindOf(n) === 'mood'),
  playFace('Face'),
  { manual: 'expression' },
);
chips(
  'beats',
  beats.filter((n) => !isGaze(n)),
  playFace('Face beat'),
  { manual: 'expression' },
);
chips('gaze', beats.filter(isGaze), playFace('Gaze'), { manual: 'expression' });

for (const [channel, row, title] of [
  ['head', 'head-gestures', 'Head'],
  ['hands', 'hand-gestures', 'Hands'],
]) {
  chips(
    row,
    Object.keys(engine.body.gestures[channel]),
    (name) => {
      const mirror = channel === 'hands' && $('left-hand').checked;
      engine.body.play(name, { mirror }).then((done) => done && status('Ready'));
      return `${title}: ${label(name)}${mirror ? ' (left hand)' : ''}`;
    },
    { manual: channel },
  );
}

const PHRASES = {
  user: {
    en: [
      'I just adopted a puppy!',
      'My grandma passed away last week.',
      'Can you help me with something?',
      'eh mm the uh asdf',
    ],
    es: [
      'Estoy triste, alégrame el día',
      '¡Me han dado el trabajo!',
      'Hoy he tenido un día horrible.',
      '¿Me cuentas un chiste?',
    ],
  },
  avatar: {
    en: [
      "Hello! It's so nice to see you again.",
      "No, I don't think that's a good idea.",
      'Wait, really? I had no idea!',
      'Please, promise me you will rest tonight.',
    ],
    es: [
      '¡Qué buena noticia, me alegro muchísimo por ti!',
      'Vaya, lo siento mucho. Aquí estoy para lo que necesites.',
      'Mmm, déjame pensarlo un momento.',
      '¡Ja, ja, esa sí que es buena!',
    ],
  },
};

const store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      v ? localStorage.setItem(k, v) : localStorage.removeItem(k);
    } catch {
      /* private mode */
    }
  },
};

let speaker = 'user';

const KEYS_URL = 'openrouter.ai/keys';
const REJECTED = 'This key was rejected — check it at openrouter.ai/keys';

// A message's "openrouter.ai/keys" becomes a link.
function rich(text) {
  const [before, ...after] = text.split(KEYS_URL);
  if (!after.length) return [text];
  const a = Object.assign(document.createElement('a'), {
    href: `https://${KEYS_URL}`,
    target: '_blank',
    rel: 'noopener',
    textContent: KEYS_URL,
  });
  return [before, a, after.join(KEYS_URL)];
}

function show(el, text, error) {
  el.replaceChildren(...rich(text));
  el.classList.toggle('error', error);
}

// The latest outcome, next to where the visitor typed.
const feedback = (text, { error = false } = {}) => show($('feedback'), text, error);

// Key status replaces the key note for a moment, or until the key changes if it was rejected.
const KEY_NOTE = $('key-note').innerHTML;
let keyNoteTimer;
function keyNote(text, { error = false, ms = 0 } = {}) {
  clearTimeout(keyNoteTimer);
  if (!text) {
    $('key-note').innerHTML = KEY_NOTE;
    $('key-note').classList.remove('error');
    return;
  }
  show($('key-note'), text, error);
  if (ms) keyNoteTimer = setTimeout(() => keyNote(), ms);
}

const errorCode = (error) => /System One (\d+)/.exec(error)?.[1];

function explain(error) {
  const code = errorCode(error);
  if (code === '401') return 'OpenRouter rejected this key — check it at openrouter.ai/keys';
  if (code === '402') return 'Your OpenRouter account is out of credit';
  if (code === '429') return 'Too many requests — wait a moment';
  return `Couldn't reach the decision model${code ? ` (${code})` : ''}`;
}

const connect = (key) => engine.useClassifier(key ? systemOne({ apiKey: key }) : null);

$('key').value = store.get('openrouter-key') || '';
connect($('key').value.trim());
if (engine.classify && store.get('openrouter-key-rejected')) keyNote(REJECTED, { error: true });
$('key-save').onclick = () => {
  const key = $('key').value.trim();
  store.set('openrouter-key', key);
  store.set('openrouter-key-rejected', null);
  connect(key);
  feedback('');
  keyNote(key ? 'Key saved.' : 'Key removed.', { ms: 3000 });
};

function renderPhrases() {
  const { en, es } = PHRASES[speaker];
  const hint = Object.assign(document.createElement('p'), {
    className: 'note phrase-label',
    textContent: 'Works in any language:',
  });
  const phrase = (p) => button(p, () => say(p));
  $('phrases').replaceChildren(...en.map(phrase), hint, ...es.map(phrase));
}

$('speaker').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  speaker = b.dataset.speaker;
  select($('speaker'), b);
  $('text').placeholder = PHRASES[speaker].en[0];
  renderPhrases();
};
renderPhrases();

$('say').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (text) say(text);
  $('text').value = '';
};

let stream = null;
const WORD_MS = 260;

// The demo has no TTS, so the avatar mouths its line in silence, word for word
// with the stream: speech ducking and whileSpeaking work as with a real voice.
// TalkingHead has no Spanish lip-sync; Finnish spelling is as phonetic, so
// Spanish lines use it, without accents.
const SPANISH = /[áéíóúñ¿¡]|\b(que|el|la|de|y|es|muy|me|lo|por|para|un|una|esa|eso)\b/i;
function mouth(words) {
  const lipsyncLang = SPANISH.test(words.join('')) ? 'fi' : 'en';
  const plain = words.map((w) => (lipsyncLang === 'fi' ? w.normalize('NFD').replace(/\p{M}/gu, '') : w).trim());
  const ctx = head.audioCtx;
  const audio = ctx.createBuffer(
    1,
    Math.ceil((ctx.sampleRate * (plain.length * WORD_MS + 300)) / 1000),
    ctx.sampleRate,
  );
  const wtimes = plain.map((_, i) => i * WORD_MS);
  head.speakAudio({ audio, words: plain, wtimes, wdurations: wtimes.map(() => WORD_MS - 20) }, { lipsyncLang });
}

// The person's line arrives whole, like a chat message; the avatar's is
// streamed word by word, like a voice model's transcript.
async function say(text) {
  if (!engine.classify) {
    // Without a key the avatar still mouths its line, over the face picked by hand.
    if (speaker === 'avatar') {
      head.stopSpeaking();
      mouth(text.split(/(?<=\s)/));
    } else $('key').focus();
    feedback('Add an OpenRouter key above to let Jev decide.');
    return;
  }
  endGreeting();
  if (speaker === 'user') {
    engine.feed(text, { speaker: 'user', final: true });
    return;
  }
  // A new line ends the one still streaming, so the two don't merge into one sentence.
  if (stream) engine.feed('', { speaker: 'avatar', final: true });
  head.stopSpeaking();
  const id = (stream = {});
  const words = text.split(/(?<=\s)/);
  mouth(words);
  for (const w of words) {
    engine.feed(w, { speaker: 'avatar' });
    await new Promise((r) => setTimeout(r, WORD_MS));
    if (id !== stream) return;
  }
  stream = null;
  engine.feed(text, { speaker: 'avatar', final: true });
}

engine.onDecision = (d) => {
  const li = document.createElement('li');

  const line = document.createElement('div');
  line.className = 'line';
  line.innerHTML = `<span class="who">${d.speaker === 'user' ? 'You' : 'Avatar'}:</span> `;
  line.append(d.text);
  li.append(line);

  const acts = document.createElement('div');
  acts.className = 'acts';
  const message = d.error && explain(d.error);
  const note = (cls, text) => {
    const s = Object.assign(document.createElement('span'), { className: cls });
    s.replaceChildren(...rich(text));
    acts.append(s);
    return s;
  };
  if (d.error) note('error', message).title = d.error;
  else if (d.skipped) note('skipped', `Not asked: ${d.skipped}`);
  else if (!d.actions.length) note('skipped', 'No reaction (Jev chose none)');
  for (const a of d.actions) {
    const what = `${a.channel} → ${label(a.name)} ${Math.round(a.confidence * 100)}%`;
    note(a.applied ? 'applied' : 'skipped', a.applied ? `✓ ${what}` : `✗ ${what} · ${a.reason}`);
  }
  li.append(acts);
  feedback(message || '', { error: !!d.error });
  if (d.error && errorCode(d.error) === '401') {
    store.set('openrouter-key-rejected', '1');
    keyNote(REJECTED, { error: true });
  } else if (d.answers && store.get('openrouter-key-rejected')) {
    store.set('openrouter-key-rejected', null);
    keyNote();
  }

  if (d.ms != null) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    const cost = d.usage?.cost != null ? ` · $${d.usage.cost.toFixed(6)}` : '';
    const tokens = d.usage?.input_tokens != null ? ` · ${d.usage.input_tokens} tokens` : '';
    meta.textContent = `${d.ms} ms${tokens}${cost}${d.model ? ` · ${d.model}` : ''}`;
    li.append(meta);
  }

  $('decisions').hidden = false;
  $('log').prepend(li);
  while ($('log').children.length > 50) $('log').lastChild.remove();
  const applied = d.actions.filter((a) => a.applied);
  if (applied.some((a) => a.channel === 'face')) endGreeting();
  if (applied.length) status(applied.map((a) => label(a.name)).join(' + '));
};
