import { ic, LOGO } from '../core/icons.js';
import { fmtClock, escapeHtml } from '../core/format.js';
import { watchErrors } from '../core/diagnostics.js';

watchErrors('popup');

const app = document.getElementById('app');
const DEFAULTS = {
  mode: 'record',
  source: 'tab',
  mic: true,
  micId: 'default',
  camera: false,
  camId: 'default',
  tabAudio: true,
  clickPulse: true,
  spotlight: false,
  countdown: true,
  keys: false,
  prompter: false,
};

let prefs = { ...DEFAULTS };
let state = { status: 'idle' };
let tab = null;
let devices = { mics: [], cams: [] };
let permission = 'prompt';
let meterStream = null;
let meterRaf = 0;
let clockTimer = 0;
let busy = false;
let error = '';
let script = { text: '', speed: 1 };

const send = (msg) => chrome.runtime.sendMessage(msg);

async function init() {
  const stored = await chrome.storage.local.get(['prefs', 'script']);
  prefs = { ...DEFAULTS, ...(stored.prefs || {}) };
  script = { text: '', speed: 1, ...(stored.script || {}) };
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await send({ type: 'get-state' }).catch(() => null);
  state = res?.state || { status: 'idle' };
  permission = await micPermission();
  if (permission === 'granted') await loadDevices();
  render();
}

async function micPermission() {
  try {
    return (await navigator.permissions.query({ name: 'microphone' })).state;
  } catch {
    return 'prompt';
  }
}

async function loadDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    devices.mics = list.filter((d) => d.kind === 'audioinput');
    devices.cams = list.filter((d) => d.kind === 'videoinput');
  } catch {
    devices = { mics: [], cams: [] };
  }
}

function save() {
  chrome.storage.local.set({ prefs });
}

const pageAllowed = () => /^https?:|^file:/.test(tab?.url || '') && !/chromewebstore\.google\.com|chrome\.google\.com\/webstore/.test(tab?.url || '');

function header() {
  return `<div class="head">
    <div class="brand">${LOGO(30)}<div><div class="name">Retake</div><div class="sub">Free screen recorder</div></div></div>
    <div class="head-actions">
      <button class="icon-btn" data-act="library" title="My recordings" aria-label="My recordings">${ic('folder', 20)}</button>
      <button class="icon-btn" data-act="help" title="Help" aria-label="Help">${ic('help', 20)}</button>
    </div></div>`;
}

function chip(key, icon, label) {
  const on = prefs[key];
  const glyph = icon === 'keys' ? '<span class="keyicon">K</span>' : ic(icon, 16);
  return `<button class="chip ${on ? 'on' : ''}" data-toggle="${key}" aria-pressed="${on}">${glyph}${label}</button>`;
}

function deviceSelect(kind) {
  const list = kind === 'mic' ? devices.mics : devices.cams;
  const key = kind === 'mic' ? 'micId' : 'camId';
  const icon = kind === 'mic' ? 'mic' : 'cam';
  if (permission !== 'granted' || !list.length) {
    const label = kind === 'mic' ? 'Microphone' : 'Camera';
    return `<div class="field">${ic(icon, 18)}<span>${label}</span></div>`;
  }
  const options = list
    .map((d, i) => `<option value="${escapeHtml(d.deviceId)}" ${d.deviceId === prefs[key] ? 'selected' : ''}>${escapeHtml(d.label || `${kind === 'mic' ? 'Microphone' : 'Camera'} ${i + 1}`)}</option>`)
    .join('');
  return `<label class="field">${ic(icon, 18)}<select class="devsel" data-select="${key}">${options}</select>${ic('chev', 16)}</label>`;
}

function setupView() {
  const present = prefs.mode === 'present';
  const restricted = !pageAllowed();
  let notice = '';
  if (error) notice = `<div class="notice err">${escapeHtml(error)}</div>`;
  else if (restricted && (present || prefs.source === 'tab'))
    notice = `<div class="notice warn">Chrome doesn’t let extensions record or draw on this page. Open a website${present ? '' : ', or choose Window or Full screen'}.</div>`;
  else if (!present && permission !== 'granted' && (prefs.mic || prefs.camera || prefs.source === 'camera' || prefs.source === 'voice' || prefs.source === 'slides'))
    notice = `<div class="notice">Retake needs your permission to use the microphone and camera. <button data-act="permissions">Allow access</button></div>`;

  const studio = prefs.source === 'camera' || prefs.source === 'voice' || prefs.source === 'slides';
  const words = (script.text.match(/\S+/g) || []).length;
  const sourceSeg = `<div class="seg tall five six">
      ${[['tab', 'tab', 'This tab'], ['window', 'window', 'Window'], ['screen', 'screen', 'Screen'], ['slides', 'slides', 'Slides'], ['camera', 'cam', 'Camera'], ['voice', 'mic', 'Voice']]
        .map(([v, icon, label]) => `<button class="${prefs.source === v ? 'on' : ''}" data-source="${v}">${ic(icon, 22)}${label}</button>`)
        .join('')}
    </div>`;

  const level = [6, 12, 18, 14, 8].map((h) => `<i style="height:${h}px"></i>`).join('');

  const recordSections = `
    <div class="section"><div class="tlabel">Record</div>${sourceSeg}</div>
    <div class="section"><div class="tlabel">Sound and camera</div>
      <div class="stack">
        <div class="row">${deviceSelect('mic')}<div class="meter" id="meter">${level}</div>${prefs.source === 'voice' ? '' : `<button class="toggle ${prefs.mic ? 'on' : ''}" data-toggle="mic" aria-label="Microphone" aria-pressed="${prefs.mic}"></button>`}</div>
        ${prefs.source === 'voice' ? '' : `<div class="row">${deviceSelect('cam')}${prefs.source === 'camera' ? '' : `<button class="toggle ${prefs.camera ? 'on' : ''}" data-toggle="camera" aria-label="Camera bubble" aria-pressed="${prefs.camera}"></button>`}</div>`}
        <div class="line">${ic('text', 18)}Teleprompter<span class="muted-s">${words ? `${words} words` : 'No script yet'}</span><button class="mini-link" data-act="script">${words ? 'Edit' : 'Write'}</button><button class="toggle ${prefs.prompter ? 'on' : ''}" data-toggle="prompter" aria-label="Teleprompter" aria-pressed="${prefs.prompter}"></button></div>
        ${prefs.source === 'tab' ? `<div class="line">${ic('speaker', 18)}Include sound from this tab<button class="toggle ${prefs.tabAudio ? 'on' : ''}" data-toggle="tabAudio" aria-pressed="${prefs.tabAudio}" aria-label="Tab sound"></button></div>` : ''}
      </div>
    </div>`;

  const startDisabled = (restricted && (present || prefs.source === 'tab')) || busy;
  const studioNote =
    prefs.source === 'slides'
      ? 'Add your slides in the next tab, then present them full screen with your camera.'
      : prefs.source === 'camera'
        ? 'Records just your camera and voice, in a new tab.'
        : 'Records just your voice, in a new tab.';
  return `${header()}
    ${notice}
    <div class="seg" style="margin-bottom:14px;padding:3px">
      <button class="${!present ? 'on' : ''}" data-mode="record"><span class="dot" style="width:9px;height:9px;color:var(--rec)"></span>Record</button>
      <button class="${present ? 'on' : ''}" data-mode="present">${ic('pen', 15)}Present only</button>
    </div>
    ${present ? '' : recordSections}
    <div class="section"><div class="tlabel">${present ? 'On screen' : 'While recording'}</div>
      <div class="chips">
        ${studio ? '' : chip('clickPulse', 'click', 'Click pulse')}
        ${studio ? '' : chip('spotlight', 'spot', 'Spotlight')}
        ${present ? '' : chip('countdown', 'fade', '3s countdown')}
        ${studio ? '' : chip('keys', 'keys', 'Show keys')}
      </div>
    </div>
    <button class="btn ${present ? 'dark' : 'rec'} start" data-act="${present ? 'present' : 'start'}" ${startDisabled ? 'disabled' : ''}>
      ${present ? ic('pen', 18) : '<span class="dot" style="width:12px;height:12px;color:#fff"></span>'}${busy ? 'Starting…' : present ? 'Start presenting' : 'Start recording'}
    </button>
    <div class="foot">${ic('lock', 13)}${present ? 'Nothing is recorded in this mode.' : studio ? studioNote : 'Saved on this device. No account, no upload, no time limit.'}</div>`;
}

function elapsed() {
  const done = (state.segments || []).reduce((s, x) => s + (x.duration || 0), 0);
  const live = state.status === 'recording' && state.segmentStartedAt ? (Date.now() - state.segmentStartedAt) / 1000 : 0;
  return done + live;
}

function liveView() {
  const st = state.status;
  if (st === 'presenting') {
    return `${header()}
      <div class="live"><span class="status"><span class="dot" style="color:#7C8BFF"></span>Presenting · not recording</span></div>
      <div class="controls">
        <button class="btn rec wide" data-act="start-from-present"><span class="dot" style="width:10px;height:10px;color:#fff"></span>Start recording this tab</button>
        <button class="btn ghost wide" data-act="cancel">Stop presenting</button>
      </div>`;
  }
  if (st === 'saving' || st === 'preparing') {
    return `${header()}<div class="live"><div class="clock">${fmtClock(elapsed())}</div><span class="status">${st === 'saving' ? 'Saving your recording…' : 'Getting ready…'}</span></div>`;
  }
  const recording = st === 'recording';
  const label = recording ? 'Recording' : st === 'countdown' ? 'Starting…' : 'Paused';
  const color = recording ? 'var(--rec)' : 'var(--amber)';
  const canRetake = (state.segments || []).length > 0 || recording;
  return `${header()}
    ${state.error ? `<div class="notice err">${escapeHtml(state.error)}</div>` : ''}
    ${state.micFailed ? `<div class="notice warn">The microphone could not be used, so this recording has no voice. <button data-act="permissions">Check access</button></div>` : ''}
    <div class="live">
      <div class="clock" id="clock">${fmtClock(elapsed())}</div>
      <span class="status"><span class="dot" style="color:${color}"></span>${label}</span>
    </div>
    <div class="controls">
      <button class="btn ghost" data-act="${recording ? 'pause' : 'resume'}" ${st === 'countdown' ? 'disabled' : ''}>${ic(recording ? 'pause' : 'play', 18)}${recording ? 'Pause' : 'Resume'}</button>
      <button class="btn ghost" data-act="retake" ${canRetake ? '' : 'disabled'}>${ic('retake', 18)}Retake</button>
      <button class="btn rec wide" data-act="finish">${ic('stop', 16)}Finish and edit</button>
    </div>
    <button class="link" data-act="cancel">Discard this recording</button>`;
}

function render() {
  cancelAnimationFrame(meterRaf);
  clearInterval(clockTimer);
  const active = state.status && state.status !== 'idle';
  app.innerHTML = active ? liveView() : setupView();
  if (active && ['recording', 'paused', 'countdown'].includes(state.status)) {
    clockTimer = setInterval(() => {
      const el = document.getElementById('clock');
      if (el) el.textContent = fmtClock(elapsed());
    }, 250);
  }
  if (!active && prefs.mode === 'record' && prefs.mic && permission === 'granted') startMeter();
  else stopMeter();
}

async function startMeter() {
  try {
    if (!meterStream) {
      meterStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.micId === 'default' ? undefined : { exact: prefs.micId } } });
    }
    const ctx = new AudioContext();
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 256;
    ctx.createMediaStreamSource(meterStream).connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let peak = 0;
      for (const v of data) peak = Math.max(peak, Math.abs(v - 128));
      const level = Math.min(5, Math.round((peak / 64) * 5));
      document.querySelectorAll('#meter i').forEach((el, i) => el.classList.toggle('on', i < level));
      meterRaf = requestAnimationFrame(tick);
    };
    tick();
  } catch {
    /* meter is decoration only */
  }
}

function stopMeter() {
  meterStream?.getTracks().forEach((t) => t.stop());
  meterStream = null;
}

async function act(name) {
  error = '';
  if (name === 'library') return chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
  if (name === 'help') return chrome.tabs.create({ url: chrome.runtime.getURL('pages/help.html') });
  if (name === 'permissions') return chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html#permissions') });
  if (name === 'script') {
    await send({ type: 'open-prompter', edit: true, windowId: tab?.windowId });
    return window.close();
  }
  if (name === 'start' && prefs.source === 'slides') {
    if (permission !== 'granted' && (prefs.mic || prefs.camera)) return chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html#permissions') });
    await chrome.tabs.create({ url: chrome.runtime.getURL('pages/slides.html') });
    return window.close();
  }
  if (name === 'start' && (prefs.source === 'camera' || prefs.source === 'voice')) {
    if (permission !== 'granted') return chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html#permissions') });
    await chrome.tabs.create({ url: chrome.runtime.getURL(`pages/studio.html#${prefs.source}`) });
    return window.close();
  }

  if (name === 'start' || name === 'present') {
    if (name === 'start' && permission !== 'granted' && (prefs.mic || prefs.camera)) {
      return chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html#permissions') });
    }
    busy = true;
    render();
    stopMeter();
    const options = { ...prefs };
    const size = { width: tab?.width, height: tab?.height, dpr: window.devicePixelRatio || 1 };
    const res = await send({ type: name, options, tabId: tab?.id, windowId: tab?.windowId, size }).catch((e) => ({ ok: false, error: e.message }));
    busy = false;
    if (!res?.ok) {
      error = res?.error || 'Something went wrong. Please try again.';
      return render();
    }
    if (res.cancelled) return render();
    return window.close();
  }
  const map = { pause: 'pause', resume: 'resume', retake: 'request-retake', finish: 'finish', cancel: 'cancel', 'start-from-present': 'start-from-present' };
  if (name === 'cancel' && state.status !== 'presenting' && !confirm('Discard this recording? It cannot be recovered.')) return;
  const extra = name === 'start-from-present' ? { size: { width: tab?.width, height: tab?.height, dpr: window.devicePixelRatio || 1 } } : {};
  const res = await send({ type: map[name], ...extra }).catch((e) => ({ ok: false, error: e.message }));
  if (!res?.ok) {
    state.error = res?.error;
    render();
  }
  if (name === 'retake' || name === 'finish' || name === 'start-from-present') window.close();
}

app.addEventListener('click', (e) => {
  const t = e.target.closest('button');
  if (!t || t.disabled) return;
  if (t.dataset.act) return act(t.dataset.act);
  if (t.dataset.mode) {
    prefs.mode = t.dataset.mode;
    save();
    return render();
  }
  if (t.dataset.source) {
    prefs.source = t.dataset.source;
    save();
    return render();
  }
  if (t.dataset.toggle) {
    prefs[t.dataset.toggle] = !prefs[t.dataset.toggle];
    save();
    if (t.dataset.toggle === 'mic') stopMeter();
    return render();
  }
});

app.addEventListener('change', (e) => {
  const key = e.target.dataset.select;
  if (!key) return;
  prefs[key] = e.target.value;
  save();
  if (key === 'micId') {
    stopMeter();
    render();
  }
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'state') {
    state = msg.state;
    render();
  }
});

window.addEventListener('unload', stopMeter);
init();
