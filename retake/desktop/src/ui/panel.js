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
const prefs = Object.assign({ kind: 'screen', sourceId: '', mic: true, micId: '', cam: false, camId: '', sound: true, countdown: true, prompter: false, script: '', speed: 1 }, (() => {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || '{}');
  } catch {
    return {};
  }
})());
const KINDS = [
  ['screen', 'screen', 'Screen'],
  ['window', 'window', 'Window'],
  ['camera', 'cam', 'Camera'],
  ['audio', 'mic', 'Voice'],
];
const needsSource = () => prefs.kind === 'screen' || prefs.kind === 'window';
const camOn = () => prefs.kind === 'camera' || (prefs.cam && prefs.kind !== 'audio');
const micOn = () => prefs.kind === 'audio' || prefs.mic;
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
      <div class="tlabel">What to record ${needsSource() ? `<button id="refresh" title="Refresh the list">${ic('retake', 12)} Refresh</button>` : ''}</div>
      <div class="kinds">${KINDS.map(([k, icon, label]) => `<button class="${prefs.kind === k ? 'on' : ''}" data-kind="${k}">${ic(icon, 16)} ${label}</button>`).join('')}</div>
      ${
        prefs.kind === 'camera'
          ? '<p class="hint">Records just your camera and microphone, full frame. Your camera shows on screen so you can check yourself.</p>'
          : prefs.kind === 'audio'
            ? '<p class="hint">Records just your microphone. Trim it in the editor and export it as an audio file, or as a video with a sound wave.</p>'
            : ''
      }
      ${needsSource() ? `<div class="grid">${
        ofKind.length
          ? ofKind
              .map((s) => `<button class="srcard ${s.id === prefs.sourceId ? 'on' : ''}" data-id="${s.id}"><div class="thumb" style="${s.thumb ? `background-image:url(${s.thumb})` : ''}"></div><div class="nm">${s.icon ? `<img src="${s.icon}" alt="">` : ''}<span>${escape(s.name)}</span></div></button>`)
              .join('')
          : `<div class="empty">${prefs.kind === 'window' ? 'No windows found. Open the app you want to record, then press Refresh.' : 'Looking for screens…'}</div>`
      }</div>` : ''}
    </section>
    <section class="card">
      <div class="tlabel">Voice and camera</div>
      <div class="devrow"><span class="ic">${ic('mic', 18)}</span>${select('audioinput', 'micSel', prefs.micId, micOn(), 'Default microphone')}${prefs.kind === 'audio' ? '' : `<button class="toggle ${prefs.mic ? 'on' : ''}" id="micT" aria-label="Microphone on or off"></button>`}</div>
      ${prefs.kind === 'audio' ? '' : `<div class="devrow"><span class="ic">${ic('cam', 18)}</span>${select('videoinput', 'camSel', prefs.camId, camOn(), 'Default camera')}${prefs.kind === 'camera' ? '' : `<button class="toggle ${prefs.cam ? 'on' : ''}" id="camT" aria-label="Camera on or off"></button>`}</div>`}
      <div class="chips">
        ${win && needsSource() ? `<button class="chip ${prefs.sound ? 'on' : ''}" id="soundC">${ic('speaker', 14)} Computer sound</button>` : ''}
        <button class="chip ${prefs.countdown ? 'on' : ''}" id="cdC">${ic('fade', 14)} 3s countdown</button>
      </div>
    </section>
    <section class="card">
      <div class="tlabel">Teleprompter <button class="toggle ${prefs.prompter ? 'on' : ''}" id="prT" aria-label="Teleprompter on or off" style="margin-left:auto"></button></div>
      ${
        prefs.prompter
          ? `<textarea id="script" rows="6" placeholder="Paste or write your script. While you record it scrolls at the top of your screen, next to your camera, and it is never in the video.">${escape(prefs.script)}</textarea>
        <div class="prrow"><span class="lbl2">Speed</span><div class="seg">${[[0.75, 'Slow'], [1, 'Normal'], [1.5, 'Fast']].map(([v, l]) => `<button class="${prefs.speed === v ? 'on' : ''}" data-speed="${v}">${l}</button>`).join('')}</div><span class="words" id="words"></span></div>`
          : '<p class="hint" style="margin:0">Read your script while you record. Only you see it.</p>'
      }
    </section>
    ${error ? `<div class="notice">${error}</div>` : ''}
    <button class="btn rec big" id="start" ${(!needsSource() || prefs.sourceId) && !starting ? '' : 'disabled'}><span class="recdot"></span> ${starting ? 'Starting…' : 'Start recording'}</button>
    <div class="foot">${camOn() ? 'Your camera bubble is on screen now. Drag it where you want it. ' : ''}While recording: <kbd>${mac ? '⌥⇧K' : 'Alt+Shift+K'}</kbd> pause · <kbd>${mac ? '⌥⇧U' : 'Alt+Shift+U'}</kbd> retake · <kbd>${mac ? '⌥⇧D' : 'Alt+Shift+D'}</kbd> draw · <kbd>${mac ? '⌥⇧S' : 'Alt+Shift+S'}</kbd> finish</div>`;
  bind();
}

const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

function bind() {
  $('#openScreen')?.addEventListener('click', () => api.call('open-settings', { kind: 'screen' }));
  const refresh = $('#refresh');
  if (refresh) refresh.onclick = loadSources;
  document.querySelectorAll('[data-kind]').forEach(
    (b) =>
      (b.onclick = async () => {
        prefs.kind = b.dataset.kind;
        prefs.sourceId = '';
        save();
        if (camOn() && mac) await api.call('ask-media', { kind: 'camera' });
        api.call('bubble', { on: camOn(), camId: prefs.camId });
        if (needsSource()) loadSources();
        else render();
      }),
  );
  document.querySelectorAll('[data-id]').forEach((b) => (b.onclick = () => ((prefs.sourceId = b.dataset.id), save(), render())));
  const micT = $('#micT');
  if (micT) micT.onclick = () => ((prefs.mic = !prefs.mic), save(), render());
  const camT = $('#camT');
  if (camT)
    camT.onclick = async () => {
      prefs.cam = !prefs.cam;
      save();
      if (prefs.cam && mac) await api.call('ask-media', { kind: 'camera' });
      api.call('bubble', { on: camOn(), camId: prefs.camId });
      await loadDevices();
      render();
    };
  $('#micSel').onchange = (e) => ((prefs.micId = e.target.value), save());
  const camSel = $('#camSel');
  if (camSel)
    camSel.onchange = (e) => {
      prefs.camId = e.target.value;
      save();
      if (camOn()) api.call('bubble', { on: true, camId: prefs.camId });
    };
  $('#prT').onclick = () => ((prefs.prompter = !prefs.prompter), save(), render());
  const script = $('#script');
  if (script) {
    const words = () => {
      const n = (script.value.match(/\S+/g) || []).length;
      $('#words').textContent = n ? `${n} words · about ${Math.max(1, Math.round(n / (140 * prefs.speed)))} min` : '';
    };
    script.oninput = () => ((prefs.script = script.value), save(), words());
    words();
  }
  document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => ((prefs.speed = Number(b.dataset.speed)), save(), render())));
  const sc = $('#soundC');
  if (sc) sc.onclick = () => ((prefs.sound = !prefs.sound), save(), render());
  $('#cdC').onclick = () => ((prefs.countdown = !prefs.countdown), save(), render());
  $('#start').onclick = start;
}

async function start() {
  const src = needsSource() ? sources.find((s) => s.id === prefs.sourceId) : { id: '', kind: prefs.kind, name: prefs.kind === 'camera' ? 'Camera' : 'Voice' };
  if (!src) return;
  error = '';
  starting = true;
  render();
  api.call('clear-error');
  const res = await api.call('start', {
    sourceId: src.id,
    kind: src.kind,
    name: src.name,
    mic: micOn(),
    micId: prefs.micId,
    cam: camOn(),
    camId: prefs.camId,
    sound: win && prefs.sound && needsSource(),
    countdown: prefs.countdown,
    script: prefs.prompter && prefs.script.trim() ? { text: prefs.script, speed: prefs.speed, size: 28 } : null,
  });
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
  if (camOn()) api.call('bubble', { on: true, camId: prefs.camId });
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
