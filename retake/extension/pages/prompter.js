// The script window. Edit the script before recording; while recording it scrolls with the
// recording, stops on pause and goes back on a retake.
import { mountPrompter, wordCount, readingMinutes } from '../core/prompter.js';
import { ic } from '../core/icons.js';

const $ = (s) => document.querySelector(s);
const stored = (await chrome.storage.local.get('script')).script || {};
let script = { text: stored.text || '', speed: stored.speed || 1 };
const save = () => chrome.storage.local.set({ script });
let reader = null, parts = 0, wasRecording = false;

function showEdit() {
  document.body.className = '';
  $('#read').hidden = true;
  $('#edit').hidden = false;
  $('#title').innerHTML = `${ic('text', 18)} Teleprompter script`;
  const ta = $('#text');
  ta.value = script.text;
  const words = () => {
    const n = wordCount(ta.value);
    $('#words').textContent = n ? `${n} words · about ${readingMinutes(ta.value, script.speed)} min` : '';
  };
  const speeds = () =>
    ($('#speed').innerHTML = [[0.75, 'Slow'], [1, 'Normal'], [1.5, 'Fast']].map(([v, l]) => `<button class="${script.speed === v ? 'on' : ''}" data-v="${v}">${l}</button>`).join(''));
  speeds();
  $('#speed').onclick = (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    script.speed = Number(b.dataset.v);
    save();
    speeds();
    words();
  };
  ta.oninput = () => ((script.text = ta.value), save(), words());
  words();
  ta.focus();
  $('#done').onclick = () => (save(), window.close());
}

function showRead() {
  document.body.className = 'read';
  $('#edit').hidden = true;
  $('#read').hidden = false;
  reader = mountPrompter($('#read'), { text: script.text, speed: script.speed, size: 28 });
}

function onState(s) {
  if (!s) return;
  if (!reader && s.status !== 'idle' && s.mode !== 'present') {
    if (!$('#edit').hidden) save();
    showRead();
  }
  if (!reader) return;
  const n = (s.segments || []).length;
  if (n < parts) reader.rewind(); // the last part was thrown away
  parts = n;
  const recording = s.status === 'recording';
  if (recording !== wasRecording) reader.setRecording(recording);
  wasRecording = recording;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'state') onState(msg.state);
});
addEventListener('keydown', (e) => {
  if (e.key === ' ' && reader) (e.preventDefault(), reader.toggleHold());
});

if (location.hash === '#edit') showEdit();
else showRead();
const res = await chrome.runtime.sendMessage({ type: 'get-state' }).catch(() => null);
onState(res?.state);
