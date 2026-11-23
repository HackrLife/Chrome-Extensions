// Teleprompter. Scrolls while recording, stops when paused, and on a retake goes back to where
// the discarded part began. Hidden from the recording.
import { ic } from '../../shared/core/icons.js';

const api = window.retakeDesktop;
const $ = (id) => document.getElementById(id);
const scroller = $('scroll'), text = $('text');
const BASE = 34; // pixels per second at 1×
let speed = 1, size = 28, held = false, recording = false, marks = [], last = 0, pos = 0;

function apply() {
  text.style.fontSize = `${size}px`;
  $('speed').textContent = `${+speed.toFixed(2)}×`;
  $('play').innerHTML = ic(held ? 'play' : 'pause', 16);
  $('live').classList.toggle('on', recording && !held);
  const head = document.querySelector('.head').getBoundingClientRect().bottom;
  $('line').style.top = `${head + 30 + size * 0.75}px`;
}
$('top').innerHTML = ic('undo', 15);
$('play').onclick = () => ((held = !held), apply());
$('top').onclick = () => ((pos = 0), (scroller.scrollTop = 0));
$('slower').onclick = () => ((speed = Math.max(0.25, +(speed - 0.25).toFixed(2))), apply());
$('faster').onclick = () => ((speed = Math.min(4, +(speed + 0.25).toFixed(2))), apply());
$('smaller').onclick = () => ((size = Math.max(16, size - 3)), apply());
$('bigger').onclick = () => ((size = Math.min(64, size + 3)), apply());
scroller.addEventListener('wheel', () => setTimeout(() => (pos = scroller.scrollTop), 0), { passive: true });
addEventListener('resize', apply);
addEventListener('keydown', (e) => {
  if (e.key === ' ') (e.preventDefault(), (held = !held), apply());
  if (e.key === 'ArrowUp') (e.preventDefault(), (speed = Math.min(4, speed + 0.25)), apply());
  if (e.key === 'ArrowDown') (e.preventDefault(), (speed = Math.max(0.25, speed - 0.25)), apply());
});

function frame(t) {
  const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
  last = t;
  if (recording && !held) {
    pos += BASE * speed * dt * (size / 28);
    scroller.scrollTop = pos;
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

api.on('state', (s) => {
  const now = s.status === 'recording';
  if (now && !recording) marks.push(scroller.scrollTop); // a new part starts here
  recording = now;
  apply();
});
api.on('prompter', (m) => {
  if (m.rewind && marks.length) {
    pos = marks.pop();
    scroller.scrollTo({ top: pos, behavior: 'smooth' });
  }
});

const script = await api.call('prompter-script');
text.textContent = script.text || '';
speed = script.speed || 1;
size = script.size || 28;
apply();
