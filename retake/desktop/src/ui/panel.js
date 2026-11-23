// Set up a recording: what to record, microphone, camera bubble, options.
import { ic, LOGO } from '../../shared/core/icons.js';

const api = window.retakeDesktop;
const mac = api.platform === 'darwin';
const win = api.platform === 'win32';
const $ = (s) => document.querySelector(s);
if (mac) document.body.classList.add('mac');
$('#logo').innerHTML = LOGO(26);
$('#lib').innerHTML = `${ic('folder', 15)} My recordings`;
$('#lib').onclick = () => api.call('open-library');

const PREFS = 'retake.desktop.prefs';
const prefs = Object.assign({ kind: 'screen', sourceId: '', mic: true, micId: '', cam: false, camId: '', sound: true, countdown: true }, (() => {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}');
  } catch {
    return {};
  }
})());
const save = () => {
  try {
    localStorage.setItem(PREFS, JSON.stringify(prefs));
  } catch {}
};

let sources = [], devices = { audioinput: [], videoinput: [] }, perms = { screen: 'granted' }, error = '', starting = false;

async function loadDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    devices = { audioinput: list.filter((d) => d.kind === 'audioinput'), videoinput: list.filter((d) => d.kind === 'videoinput') };
  } catch {}
}

async function loadSources() {
  try {
    sources = await api.call('sources');
  } catch {
    sources = [];
  }
  const ofKind = sources.filter((s) => s.kind === prefs.kind);
  if (!ofKind.some((s) => s.id === prefs.sourceId)) prefs.sourceId = ofKind[0]?.id || '';
  render();
}

function select(kind, id, value, on, fallback) {
  const list = devices[kind];
  const named = list.some((d) => d.label);
  const opts = named ? list.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === value ? 'selected' : ''}>${d.label || `Device ${i + 1}`}</option>`).join('') : `<option value="">${fallback}</option>`;
  return `<div class="field"><select id="${id}" ${on ? '' : 'disabled'}>${opts}</select></div>`;
}

function render() {
  const ofKind = sources.filter((s) => s.kind === prefs.kind);
  const screenBlocked = mac && perms.screen !== 'granted';
  $('#main').innerHTML = `
    ${screenBlocked ? `<div class="notice"><b>Allow Retake to record your screen.</b><br>Turn on Retake in System Settings › Privacy &amp; Security › Screen Recording, then quit and reopen Retake.<br><button class="btn dark" id="openScreen">Open System Settings</button></div>` : ''}
    <section class="card">
      <div class="tlabel">What to record <button id="refresh" title="Refresh the list">${ic('retake', 12)} Refresh</button></div>
      <div class="kinds">
        <button class="${prefs.kind === 'screen' ? 'on' : ''}" data-kind="screen">${ic('screen', 16)} Full screen</button>
        <button class="${prefs.kind === 'window' ? 'on' : ''}" data-kind="window">${ic('window', 16)} A window</button>
      </div>
      <div class="grid">${
        ofKind.length
          ? ofKind
              .map((s) => `<button class="srcard ${s.id === prefs.sourceId ? 'on' : ''}" data-id="${s.id}"><div class="thumb" style="${s.thumb ? `background-image:url(${s.thumb})` : ''}"></div><div class="nm">${s.icon ? `<img src="${s.icon}" alt="">` : ''}<span>${escape(s.name)}</span></div></button>`)
              .join('')
          : `<div class="empty">${prefs.kind === 'window' ? 'No windows found. Open the app you want to record, then press Refresh.' : 'Looking for screens…'}</div>`
      }</div>
    </section>
    <section class="card">
      <div class="tlabel">Voice and camera</div>
      <div class="devrow"><span class="ic">${ic('mic', 18)}</span>${select('audioinput', 'micSel', prefs.micId, prefs.mic, 'Default microphone')}<button class="toggle ${prefs.mic ? 'on' : ''}" id="micT" aria-label="Microphone on or off"></button></div>
      <div class="devrow"><span class="ic">${ic('cam', 18)}</span>${select('videoinput', 'camSel', prefs.camId, prefs.cam, 'Default camera')}<button class="toggle ${prefs.cam ? 'on' : ''}" id="camT" aria-label="Camera on or off"></button></div>
      <div class="chips">
        ${win ? `<button class="chip ${prefs.sound ? 'on' : ''}" id="soundC">${ic('speaker', 14)} Computer sound</button>` : ''}
        <button class="chip ${prefs.countdown ? 'on' : ''}" id="cdC">${ic('fade', 14)} 3s countdown</button>
      </div>
    </section>
    ${error ? `<div class="notice">${error}</div>` : ''}
    <button class="btn rec big" id="start" ${prefs.sourceId && !starting ? '' : 'disabled'}><span class="recdot"></span> ${starting ? 'Starting…' : 'Start recording'}</button>
    <div class="foot">${prefs.cam ? 'Your camera bubble is on screen now. Drag it where you want it. ' : ''}While recording: <kbd>${mac ? '⌥⇧K' : 'Alt+Shift+K'}</kbd> pause · <kbd>${mac ? '⌥⇧U' : 'Alt+Shift+U'}</kbd> retake · <kbd>${mac ? '⌥⇧D' : 'Alt+Shift+D'}</kbd> draw · <kbd>${mac ? '⌥⇧S' : 'Alt+Shift+S'}</kbd> finish</div>`;
  bind();
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function bind() {
  $('#openScreen')?.addEventListener('click', () => api.call('open-settings', { kind: 'screen' }));
  $('#refresh').onclick = loadSources;
  document.querySelectorAll('[data-kind]').forEach((b) => (b.onclick = () => ((prefs.kind = b.dataset.kind), (prefs.sourceId = ''), save(), loadSources())));
  document.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => ((prefs.sourceId = b.dataset.id), save(), render())));
  $('#micT').onclick = () => ((prefs.mic = !prefs.mic), save(), render());
  $('#camT').onclick = async () => {
    prefs.cam = !prefs.cam;
    save();
    if (prefs.cam && mac) await api.call('ask-media', { kind: 'camera' });
    api.call('bubble', { on: prefs.cam, camId: prefs.camId });
    await loadDevices();
    render();
  };
  $('#micSel').onchange = (e) => ((prefs.micId = e.target.value), save());
  $('#camSel').onchange = (e) => {
    prefs.camId = e.target.value;
    save();
    if (prefs.cam) api.call('bubble', { on: true, camId: prefs.camId });
  };
  const sc = $('#soundC');
  if (sc) sc.onclick = () => ((prefs.sound = !prefs.sound), save(), render());
  $('#cdC').onclick = () => ((prefs.countdown = !prefs.countdown), save(), render());
  $('#start').onclick = start;
}

async function start() {
  const src = sources.find((s) => s.id === prefs.sourceId);
  if (!src) return;
  error = '';
  starting = true;
  render();
  api.call('clear-error');
  const res = await api.call('start', { sourceId: src.id, kind: src.kind, name: src.name, mic: prefs.mic, micId: prefs.micId, cam: prefs.cam, camId: prefs.camId, sound: win && prefs.sound, countdown: prefs.countdown });
  starting = false;
  if (!res?.ok) error = res?.error || 'Couldn’t start recording.';
  render();
}

api.on('state', (s) => {
  if (s.error && s.error !== error) {
    error = s.error;
    starting = false;
    render();
  }
});

// Ask for the microphone once so devices have names, then show the camera bubble if it was on.
(async () => {
  perms = await api.call('permissions');
  render();
  if (mac && prefs.mic) await api.call('ask-media', { kind: 'microphone' });
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
  } catch {}
  await loadDevices();
  if (prefs.cam) api.call('bubble', { on: true, camId: prefs.camId });
  await loadSources();
  perms = await api.call('permissions');
  render();
})();
window.addEventListener('focus', async () => {
  if (mac && perms.screen !== 'granted') {
    perms = await api.call('permissions');
    loadSources();
  }
});
