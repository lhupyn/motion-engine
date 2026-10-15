import { TalkingHead } from 'talkinghead';
import { MotionEngine } from '../src/index.js';

const $ = (id) => document.getElementById(id);
const label = (name) => name.replaceAll('_', ' ');

const head = new TalkingHead($('avatar'), {
  cameraView: 'upper',
  showProgressBar: false,
  dracoEnabled: true,
});

try {
  await head.showAvatar({ url: './female_1.glb', body: 'F' });
} catch (err) {
  $('status').textContent = `Could not load the avatar: ${err.message}`;
  throw err;
}

const engine = new MotionEngine(head);
window.engine = engine; // for the console

const status = (text) => { $('status').textContent = text; };
status('Ready');

/** Fill a chip row; `onPick` returns a status line. Marks the picked chip when `exclusive`. */
function chips(id, names, onPick, { exclusive = false } = {}) {
  const row = $(id);
  for (const name of names) {
    const b = document.createElement('button');
    b.textContent = label(name);
    b.onclick = () => {
      if (exclusive) row.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      status(onPick(name));
    };
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

chips('gestures', engine.body.names, (name) => {
  engine.body.play(name).then((done) => done && status('Ready'));
  return `Body: ${label(name)}`;
});
