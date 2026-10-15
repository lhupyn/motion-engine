import { TalkingHead } from 'talkinghead';
import { MotionEngine, systemOne } from '../src/index.js';

const $ = (id) => document.getElementById(id);
const label = (name) => name.replaceAll('_', ' ');
const status = (text) => { $('status').textContent = text; };

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

const engine = new MotionEngine(head);
window.engine = engine;

status('Ready');

function button(text, onclick) {
  return Object.assign(document.createElement('button'), { textContent: text, onclick });
}

const select = (row, b) => row.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));

function chips(id, names, onPick, { exclusive = false } = {}) {
  const row = $(id);
  for (const name of names) {
    const b = button(label(name), () => {
      if (exclusive) select(row, b);
      status(onPick(name));
    });
    row.append(b);
  }
}

chips('camera', ['head', 'upper', 'mid', 'full'], (view) => {
  head.setView(view);
  return `Camera: ${view}`;
}, { exclusive: true });
$('camera').children[1].classList.add('on');

const kindOf = (name) => engine.face.resolve(name).kind;
chips('moods', engine.face.names.filter((n) => kindOf(n) === 'mood'), (name) => {
  engine.face.play(name);
  return `Face: ${label(name)}`;
}, { exclusive: true });

chips('beats', engine.face.names.filter((n) => kindOf(n) === 'beat'), (name) => {
  engine.face.play(name);
  return `Face beat: ${label(name)}`;
});

for (const [channel, row, title] of [['head', 'head-gestures', 'Head'], ['hands', 'hand-gestures', 'Hands']]) {
  chips(row, Object.keys(engine.body.gestures[channel]), (name) => {
    engine.body.play(name).then((done) => done && status('Ready'));
    return `${title}: ${label(name)}`;
  });
}

const PHRASES = {
  user: [
    'I just adopted a puppy!',
    'My grandma passed away last week.',
    'Can you help me with something?',
    'eh mm the uh asdf',
    'Estoy triste, alégrame el día',
    '¡Me han dado el trabajo!',
    'Hoy he tenido un día horrible.',
    '¿Me cuentas un chiste?',
  ],
  avatar: [
    "Hello! It's so nice to see you again.",
    "No, I don't think that's a good idea.",
    'Wait, really? I had no idea!',
    'Please, promise me you will rest tonight.',
    '¡Qué buena noticia, me alegro muchísimo por ti!',
    'Vaya, lo siento mucho. Aquí estoy para lo que necesites.',
    'Mmm, déjame pensarlo un momento.',
    '¡Ja, ja, esa sí que es buena!',
  ],
};

const store = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch { /* private mode */ } },
};

let speaker = 'user';
let connected = false;

function connect(key) {
  connected = !!key;
  if (key) engine.useClassifier(systemOne({ apiKey: key }));
  $('key-note').textContent = key
    ? 'Connected. Your key stays in this browser and is sent only to openrouter.ai.'
    : 'Jev decides the reactions. Your key stays in this browser and is sent only to openrouter.ai.';
}

$('key').value = store.get('openrouter-key') || '';
connect($('key').value.trim());
$('key-save').onclick = () => {
  const key = $('key').value.trim();
  store.set('openrouter-key', key);
  connect(key);
};

function renderPhrases() {
  $('phrases').replaceChildren(...PHRASES[speaker].map((p) => button(p, () => say(p))));
}

$('speaker').onclick = (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  speaker = b.dataset.speaker;
  select($('speaker'), b);
  $('text').placeholder = PHRASES[speaker][0];
  renderPhrases();
};
renderPhrases();

$('say').onsubmit = (e) => {
  e.preventDefault();
  const text = $('text').value.trim();
  if (text) say(text);
  $('text').value = '';
};

// The person's line arrives whole, like a chat message; the avatar's is
// streamed word by word, like a voice model's transcript.
async function say(text) {
  if (!connected) {
    status('Add an OpenRouter key to let Jev decide');
    $('key').focus();
    return;
  }
  if (speaker === 'user') {
    engine.feed(text, { speaker: 'user', final: true });
    return;
  }
  const words = text.split(/(?<=\s)/);
  for (const w of words) {
    engine.feed(w, { speaker: 'avatar' });
    await new Promise((r) => setTimeout(r, 260));
  }
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
  const note = (cls, text) => { const s = document.createElement('span'); s.className = cls; s.textContent = text; acts.append(s); };
  if (d.error) note('error', d.error);
  else if (d.skipped) note('skipped', `Not asked: ${d.skipped}`);
  else if (!d.actions.length) note('skipped', 'No reaction (Jev chose none)');
  for (const a of d.actions) {
    const what = `${a.channel} → ${label(a.name)} ${Math.round(a.confidence * 100)}%`;
    note(a.applied ? 'applied' : 'skipped', a.applied ? `✓ ${what}` : `✗ ${what} · ${a.reason}`);
  }
  li.append(acts);

  if (d.ms != null) {
    const meta = document.createElement('div');
    meta.className = 'meta';
    const cost = d.usage?.cost != null ? ` · $${d.usage.cost.toFixed(6)}` : '';
    const tokens = d.usage?.input_tokens != null ? ` · ${d.usage.input_tokens} tokens` : '';
    meta.textContent = `${d.ms} ms${tokens}${cost}${d.model ? ` · ${d.model}` : ''}`;
    li.append(meta);
  }

  $('log').prepend(li);
  while ($('log').children.length > 50) $('log').lastChild.remove();
  const applied = d.actions.filter((a) => a.applied);
  if (applied.length) status(applied.map((a) => label(a.name)).join(' + '));
};
