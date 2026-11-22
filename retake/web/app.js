import { newRecording, putRecording, deleteRecording, requestPersistence } from './core/db.js';
import { SegmentRecorder, compositeWithCamera } from './core/recorder.js';
import { ic, LOGO } from './core/icons.js';
import { fmtClock } from './core/format.js';

const $ = (s, root = document) => root.querySelector(s);
const TICKER = new URL('./core/ticker.js', import.meta.url).href;
const PREFS_KEY = 'retake.prefs';
const prefs = Object.assign({ mic: true, micId: '', cam: false, camId: '', sound: true, countdown: true }, readPrefs());

function readPrefs() {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
  } catch {
    return {};
  }
}
function savePrefs() {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {}
}

$('#logo').innerHTML = LOGO(28);
$('#libLink').innerHTML = `${ic('folder', 16)} My recordings`;
$('#extLink').innerHTML = `${ic('plus', 16)} Chrome extension`;
$('#flow').innerHTML = [
  ['screen', 'var(--rec-soft, #fdecec)', 'var(--rec)', 'Record', 'Screen, window or tab'],
  ['retake', '#eef2ff', 'var(--accent)', 'Fix', 'Retake the last part'],
  ['download', '#ecfdf3', '#12b76a', 'Export', 'MP4, WebM, GIF, vertical'],
]
  .map(
    ([icon, bg, fg, b, s], i) =>
      `${i ? `<span class="to">${ic('chev', 18)}</span>` : ''}<div class="step"><div class="bubble" style="background:${bg};color:${fg}">${ic(icon, 18)}</div><div><b>${b}</b><span>${s}</span></div></div>`,
  )
  .join('');

const supported = !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';
const canFloat = 'documentPictureInPicture' in window;

// ---------- state ----------
let view = 'setup'; // setup | countdown | recording | paused | retake | saving
let display = null, mic = null, cam = null, composite = null, mixed = null, audioCtx = null;
let recorder = null, recordingId = null, pip = null, timer = null, countdownLeft = 0, retakeCountdown = true;
let devices = { audioinput: [], videoinput: [] };
let errorText = '';

async function loadDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    devices = { audioinput: list.filter((d) => d.kind === 'audioinput'), videoinput: list.filter((d) => d.kind === 'videoinput') };
  } catch {}
}

function deviceSelect(kind, id, selected, on) {
  const list = devices[kind];
  const named = list.some((d) => d.label);
  const opts = named
    ? list.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === selected ? 'selected' : ''}>${d.label || `Device ${i + 1}`}</option>`).join('')
    : `<option value="">${kind === 'audioinput' ? 'Default microphone' : 'Default camera'}</option>`;
  return `<div class="field"><select id="${id}" ${on ? '' : 'disabled'}>${opts}</select></div>`;
}

function render() {
  const el = $('#recorder');
  if (!supported) {
    el.innerHTML = `<div class="head"><span class="title">Record your screen</span></div><div class="notice">This browser can’t record the screen. Retake works in Chrome, Edge and other Chromium browsers on a computer.</div>`;
    return;
  }
  if (view === 'setup') {
    el.innerHTML = `
      <div class="head"><span class="title">New recording</span><span class="chip">${ic('lock', 14)} Saved on this device</span></div>
      <div class="section"><div class="tlabel">Microphone</div>
        <div class="devrow">${deviceSelect('audioinput', 'micSel', prefs.micId, prefs.mic)}<button class="toggle ${prefs.mic ? 'on' : ''}" id="micT" aria-label="Microphone on or off" aria-pressed="${prefs.mic}"></button></div></div>
      <div class="section"><div class="tlabel">Camera bubble</div>
        <div class="devrow">${deviceSelect('videoinput', 'camSel', prefs.camId, prefs.cam)}<button class="toggle ${prefs.cam ? 'on' : ''}" id="camT" aria-label="Camera on or off" aria-pressed="${prefs.cam}"></button></div></div>
      <div class="section row" style="gap:8px;flex-wrap:wrap">
        <button class="chip ${prefs.sound ? 'on' : ''}" id="soundC">${ic('speaker', 14)} Include sound</button>
        <button class="chip ${prefs.countdown ? 'on' : ''}" id="cdC">${ic('fade', 14)} 3s countdown</button>
      </div>
      ${errorText ? `<div class="notice">${errorText}</div>` : ''}
      <button class="btn rec big" id="start">${ic('screen', 18)} Start recording</button>
      <div class="note">${ic('help', 14)}<span>Chrome will ask what to share: a tab, a window or your whole screen. ${canFloat ? 'Small floating controls stay on top while you record.' : ''}</span></div>`;
    $('#micT').onclick = () => ((prefs.mic = !prefs.mic), savePrefs(), render());
    $('#camT').onclick = () => ((prefs.cam = !prefs.cam), savePrefs(), render());
    $('#soundC').onclick = () => ((prefs.sound = !prefs.sound), savePrefs(), render());
    $('#cdC').onclick = () => ((prefs.countdown = !prefs.countdown), savePrefs(), render());
    $('#micSel').onchange = (e) => ((prefs.micId = e.target.value), savePrefs());
    $('#camSel').onchange = (e) => ((prefs.camId = e.target.value), savePrefs());
    $('#start').onclick = start;
    return;
  }
  if (view === 'countdown') {
    el.innerHTML = `<div class="live"><div class="status">Recording starts in</div><div class="count">${countdownLeft}</div><button class="link" id="cancel">Cancel</button></div>`;
    $('#cancel').onclick = () => cancel();
    return;
  }
  if (view === 'saving') {
    el.innerHTML = `<div class="live"><div class="status">Saving your recording…</div></div>`;
    return;
  }
  const paused = view === 'paused' || view === 'retake';
  el.innerHTML = `
    <div class="live">
      <div class="status"><span class="dot ${paused ? '' : 'pulse'}" style="background:${paused ? '#f79009' : 'var(--rec)'}"></span>${paused ? 'Paused' : 'Recording'}</div>
      <div class="clock" id="clock">${fmtClock(recorder?.elapsed() || 0)}</div>
      ${view === 'retake' ? retakeBox() : `
      <div class="controls">
        <button class="btn dark" id="pause">${paused ? `${ic('play', 16)} Resume` : `${ic('pause', 16)} Pause`}</button>
        <button class="btn outline" id="retake" ${recorder?.segments.length || recorder?.recording ? '' : 'disabled'}>${ic('retake', 16)} Retake</button>
        <button class="btn rec wide" id="finish">${ic('check', 16)} Finish and edit</button>
      </div>
      ${canFloat && !pip ? `<button class="link" id="float">${ic('vert', 13)} Open floating controls</button>` : ''}
      <button class="link" id="cancel">Discard this recording</button>`}
    </div>`;
  bindLive(el);
}

function retakeBox() {
  return `<div class="confirm"><h3>Retake the last part?</h3>
    <p>The part since your last pause is removed and recording starts again from there. Everything before it is kept.</p>
    <label class="row" style="gap:8px;font-size:13px;margin-bottom:14px"><input type="checkbox" id="rtCd" ${retakeCountdown ? 'checked' : ''}/> 3-second countdown first</label>
    <div class="row"><button class="btn outline" id="rtNo">Keep it</button><button class="btn rec" id="rtYes">${ic('retake', 15)} Retake</button></div></div>`;
}

function bindLive(root) {
  const on = (id, fn) => {
    const b = $(`#${id}`, root);
    if (b) b.onclick = fn;
  };
  on('pause', togglePause);
  on('retake', askRetake);
  on('finish', finish);
  on('cancel', () => cancel());
  on('float', () => openFloat());
  on('rtNo', () => ((view = 'paused'), refresh()));
  on('rtYes', confirmRetake);
  const cb = $('#rtCd', root);
  if (cb) cb.onchange = (e) => (retakeCountdown = e.target.checked);
}

// ---------- floating controls (Document Picture-in-Picture) ----------
function pipHTML() {
  const paused = view === 'paused' || view === 'retake';
  if (view === 'countdown') return `<div class="pip"><span class="pnum">${countdownLeft}</span><span class="plabel">Get ready…</span></div>`;
  if (view === 'retake')
    return `<div class="pip"><span class="plabel">Retake the last part?</span><button class="btn outline sm" id="rtNo">Keep</button><button class="btn rec sm" id="rtYes">${ic('retake', 14)} Retake</button></div>`;
  return `<div class="pip">
    <span class="dot ${paused ? '' : 'pulse'}" style="background:${paused ? '#f79009' : 'var(--rec)'}"></span>
    <span class="pclock" id="clock">${fmtClock(recorder?.elapsed() || 0)}</span>
    <button class="ib" id="pause" title="${paused ? 'Resume' : 'Pause'}">${ic(paused ? 'play' : 'pause', 18)}</button>
    <button class="ib" id="retake" title="Retake the last part">${ic('retake', 18)}</button>
    <button class="btn rec sm" id="finish">${ic('check', 14)} Finish</button></div>`;
}

const PIP_CSS = `body{margin:0;background:#111318;color:#fff;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.pip{height:100vh;display:flex;align-items:center;gap:10px;padding:0 14px}
.pclock{font-variant-numeric:tabular-nums;font-weight:600;font-size:18px;min-width:64px}
.pnum{font-size:30px;font-weight:700}.plabel{font-size:14px;font-weight:600;flex:1}
.ib{width:38px;height:38px;border-radius:12px;border:0;background:rgba(255,255,255,.1);color:#fff;display:grid;place-items:center;cursor:pointer}
.ib:hover{background:rgba(255,255,255,.18)}.btn.sm{height:38px;padding:0 14px;font-size:13px;margin-left:auto}
.btn.outline.sm{margin-left:0;background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
.dot{width:10px;height:10px;border-radius:50%;flex:none}.pulse{animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}`;

function openFloat() {
  if (!canFloat || pip) return Promise.resolve(pip);
  return documentPictureInPicture
    .requestWindow({ width: 340, height: 64 })
    .then((w) => {
      pip = w;
      for (const sheet of document.styleSheets) {
        try {
          const s = w.document.createElement('style');
          s.textContent = [...sheet.cssRules].map((r) => r.cssText).join('\n');
          w.document.head.append(s);
        } catch {}
      }
      const s = w.document.createElement('style');
      s.textContent = PIP_CSS;
      w.document.head.append(s);
      w.document.title = 'Retake';
      w.addEventListener('pagehide', () => {
        pip = null;
        refresh();
      });
      w.addEventListener('keydown', onKey);
      refresh();
      return w;
    })
    .catch(() => null);
}

function refresh() {
  render();
  if (pip) {
    pip.document.body.innerHTML = pipHTML();
    bindLive(pip.document);
  }
}

function tick() {
  const t = fmtClock(recorder?.elapsed() || 0);
  for (const d of [document, pip?.document]) {
    const c = d && $('#clock', d);
    if (c && c.textContent !== t) c.textContent = t;
  }
}

// ---------- flow ----------
async function start() {
  errorText = '';
  // Ask for the screen and the floating window in the same click: both need it.
  const shareP = navigator.mediaDevices.getDisplayMedia({
    video: { frameRate: { ideal: 30 }, width: { max: 2560 }, height: { max: 1600 } },
    audio: prefs.sound ? { suppressLocalAudioPlayback: false } : false,
    selfBrowserSurface: 'exclude',
    surfaceSwitching: 'include',
    systemAudio: prefs.sound ? 'include' : 'exclude',
  });
  const pipP = openFloat();
  try {
    display = await shareP;
  } catch (e) {
    pip?.close();
    if (e.name !== 'NotAllowedError') errorText = `Couldn’t start sharing: ${e.message || e.name}.`;
    return render();
  }
  await pipP;
  display.getVideoTracks()[0].addEventListener('ended', () => {
    if (view !== 'setup' && view !== 'saving') finish();
  });
  try {
    if (prefs.mic) mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.micId ? { exact: prefs.micId } : undefined, echoCancellation: true, noiseSuppression: true } });
  } catch {
    errorText = 'Microphone blocked, so this recording has no voice. Allow it in the address bar to use it next time.';
  }
  try {
    if (prefs.cam) cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: prefs.camId ? { exact: prefs.camId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } } });
  } catch {
    errorText = 'Camera blocked, so this recording has no camera bubble.';
  }
  loadDevices();

  const tracks = [];
  if (cam) {
    composite = compositeWithCamera(display, cam, TICKER);
    tracks.push(...composite.stream.getVideoTracks());
  } else tracks.push(...display.getVideoTracks());
  const audio = [display, mic].filter((s) => s?.getAudioTracks().length);
  if (audio.length === 1) tracks.push(...audio[0].getAudioTracks());
  else if (audio.length > 1) {
    audioCtx = new AudioContext();
    const dest = audioCtx.createMediaStreamDestination();
    for (const s of audio) audioCtx.createMediaStreamSource(s).connect(dest);
    tracks.push(...dest.stream.getAudioTracks());
  }
  mixed = new MediaStream(tracks);

  const set = display.getVideoTracks()[0].getSettings();
  const surface = set.displaySurface || 'monitor';
  const rec = newRecording({
    source: surface === 'browser' ? 'tab' : surface === 'window' ? 'window' : 'screen',
    width: set.width || 1920,
    height: set.height || 1080,
    hasAudio: audio.length > 0,
  });
  recordingId = rec.id;
  recorder = new SegmentRecorder({ stream: mixed, recordingId });
  rec.mimeType = recorder.mimeType;
  await putRecording(rec);
  requestPersistence();
  await countdownThen(prefs.countdown, () => recorder.begin());
}

async function countdownThen(withCountdown, fn) {
  if (withCountdown) {
    view = 'countdown';
    for (countdownLeft = 3; countdownLeft > 0; countdownLeft--) {
      refresh();
      await new Promise((r) => setTimeout(r, 1000));
      if (view !== 'countdown') return;
    }
  }
  await fn();
  view = 'recording';
  refresh();
  clearInterval(timer);
  timer = setInterval(tick, 250);
}

async function togglePause() {
  if (!recorder) return;
  if (view === 'recording') {
    view = 'paused';
    refresh();
    await recorder.endSegment();
  } else if (view === 'paused') {
    await recorder.begin();
    view = 'recording';
    refresh();
  }
}

async function askRetake() {
  if (!recorder) return;
  if (recorder.recording) await recorder.endSegment();
  if (!recorder.segments.length) return refresh();
  view = 'retake';
  refresh();
}

async function confirmRetake() {
  await recorder.discardLast();
  await countdownThen(retakeCountdown, () => recorder.begin({ retake: true }));
}

function stopAll() {
  clearInterval(timer);
  composite?.stop();
  for (const s of [display, mic, cam, mixed]) s?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  display = mic = cam = mixed = composite = audioCtx = null;
  pip?.close();
  pip = null;
}

async function finish() {
  if (!recorder || view === 'saving') return;
  view = 'saving';
  refresh();
  const r = recorder;
  const count = await r.finish();
  stopAll();
  recorder = null;
  if (!count) {
    view = 'setup';
    errorText = 'Nothing was recorded.';
    return render();
  }
  location.href = `pages/editor.html#${encodeURIComponent(recordingId)}`;
}

async function cancel() {
  const wasCountdown = view === 'countdown' && !recorder?.segments.length && !recorder?.recording;
  if (!wasCountdown && !confirm('Discard this recording? It can’t be recovered.')) return;
  view = 'setup';
  const r = recorder;
  recorder = null;
  stopAll();
  if (r) {
    await r.abort();
    await deleteRecording(recordingId);
  }
  render();
}

function onKey(e) {
  if (view === 'setup' || e.target.closest?.('input,select,textarea')) return;
  if (e.altKey && e.shiftKey && e.code === 'KeyK') (e.preventDefault(), togglePause());
  if (e.altKey && e.shiftKey && e.code === 'KeyU') (e.preventDefault(), askRetake());
  if (e.altKey && e.shiftKey && e.code === 'KeyS') (e.preventDefault(), finish());
}
document.addEventListener('keydown', onKey);
window.addEventListener('beforeunload', (e) => {
  if (recorder && view !== 'saving') e.preventDefault();
});

await loadDevices();
render();
if (location.hash === '#record') $('#start')?.focus();
