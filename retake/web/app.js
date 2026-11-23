import { newRecording, putRecording, deleteRecording, requestPersistence } from './core/db.js';
import { SegmentRecorder, compositeWithCamera } from './core/recorder.js';
import { ic, LOGO } from './core/icons.js';
import { fmtClock, escapeHtml } from './core/format.js';
import { currentTheme, toggleTheme } from './core/theme.js';
import { mountPrompter, wordCount, readingMinutes } from './core/prompter.js';
import { openStudio } from './core/studio.js';
import { ACCEPT, listFiles, addFiles, removeFile, buildDeck, releaseDeck } from './core/media.js';

const $ = (s, root = document) => root.querySelector(s);
const TICKER = new URL('./core/ticker.js', import.meta.url).href;
const PREFS_KEY = 'retake.prefs';
const prefs = Object.assign({ source: 'browser', mic: true, micId: '', cam: false, camId: '', sound: true, countdown: true, prompter: false, script: '', speed: 1 }, readPrefs());

const SOURCES = {
  browser: { icon: 'tab', name: 'Tab', sub: 'One Chrome tab', label: 'a tab' },
  window: { icon: 'window', name: 'Window', sub: 'Any app window', label: 'a window' },
  monitor: { icon: 'screen', name: 'Screen', sub: 'Everything you see', label: 'your full screen' },
  slides: { icon: 'slides', name: 'Slides', sub: 'Your deck', label: 'your slides' },
  camera: { icon: 'cam', name: 'Camera', sub: 'Just you', label: 'your camera' },
  voice: { icon: 'mic', name: 'Voice', sub: 'Just your voice', label: 'your voice' },
};
const studioMode = () => prefs.source === 'camera' || prefs.source === 'voice' || prefs.source === 'slides';
let mediaFiles = [], mediaBusy = '';
const camOn = () => prefs.source === 'camera' || (prefs.cam && prefs.source !== 'voice');
const scriptFor = () => (prefs.script.trim() ? { text: prefs.script, speed: prefs.speed, size: 28 } : null);

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
document.querySelectorAll('[data-icon]').forEach((n) => (n.innerHTML = ic(n.dataset.icon, 18)));
const themeBtn = $('#themeBtn');
const paintTheme = () => (themeBtn.innerHTML = ic(currentTheme() === 'dark' ? 'sun' : 'moon', 16));
themeBtn.onclick = () => (toggleTheme(), paintTheme());
paintTheme();

const supported = !!navigator.mediaDevices?.getDisplayMedia && typeof MediaRecorder !== 'undefined';
const canFloat = 'documentPictureInPicture' in window;
const canBubble = !!document.pictureInPictureEnabled;
const floatBlocker = !window.isSecureContext
  ? 'This page isn’t on a secure (https) address, so the browser won’t show the floating camera and controls over other pages. Open Retake from its https link.'
  : !canFloat && !canBubble
    ? 'This browser can’t float a window over other pages, so your camera and controls stay on this tab. Use Chrome or Edge, or the Retake Chrome extension.'
    : '';
const REC_DOT = '<span class="recdot"></span>';

// ---------- state ----------
// setup → ready (share chosen, live preview) → countdown → recording ⇄ paused / retake → saving
let view = 'setup';
let display = null, surface = 'monitor', mic = null, cam = null, camPending = false;
let composite = null, mixed = null, audioCtx = null;
let recorder = null, recordingId = null, pip = null, timer = null, countdownLeft = 0, retakeCountdown = true;
let prompter = null, pagePrompter = null, pagePrEl = null;
const pr = () => prompter || pagePrompter; // script in the floating window, or on this page if it can't open
let devices = { audioinput: [], videoinput: [] };
let errorText = '', warnText = '';

// Videos are made once and moved between the page and the floating window, so they never flicker.
const screenVideo = mkVideo();
const selfVideo = mkVideo(true);
function mkVideo(mirror) {
  const v = document.createElement('video');
  v.muted = true;
  v.playsInline = true;
  v.autoplay = true;
  if (mirror) v.style.transform = 'scaleX(-1)';
  return v;
}
function mount(slot, video, stream) {
  if (!slot || !stream) return;
  if (video.srcObject !== stream) video.srcObject = stream;
  if (video.parentNode !== slot) slot.append(video);
  video.play().catch(() => {});
}

async function loadDevices() {
  try {
    const list = await navigator.mediaDevices.enumerateDevices();
    devices = { audioinput: list.filter((d) => d.kind === 'audioinput'), videoinput: list.filter((d) => d.kind === 'videoinput') };
  } catch {}
}

async function ensureCam() {
  if (!camOn() || cam || camPending) return;
  camPending = true;
  try {
    cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: prefs.camId ? { exact: prefs.camId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } } });
    warnText = '';
    await loadDevices();
  } catch {
    if (prefs.source !== 'camera') prefs.cam = false;
    savePrefs();
    warnText = 'Camera blocked. Allow it from the icon in the address bar, then turn the camera on again.';
  }
  camPending = false;
  refresh();
}
function stopCam() {
  cam?.getTracks().forEach((t) => t.stop());
  cam = null;
}

function deviceSelect(kind, id, selected, on) {
  const list = devices[kind];
  const named = list.some((d) => d.label);
  const opts = named
    ? list.map((d, i) => `<option value="${d.deviceId}" ${d.deviceId === selected ? 'selected' : ''}>${d.label || `Device ${i + 1}`}</option>`).join('')
    : `<option value="">${kind === 'audioinput' ? 'Default microphone' : 'Default camera'}</option>`;
  return `<div class="field"><select id="${id}" ${on ? '' : 'disabled'}>${opts}</select></div>`;
}

const notices = () => [errorText, warnText].filter(Boolean).map((t) => `<div class="notice">${t}</div>`).join('');

// ---------- page ----------
function render() {
  const el = $('#recorder');
  if (!supported) {
    el.innerHTML = `<div class="head"><span class="title">Record your screen</span></div><div class="notice">This browser can’t record the screen. Retake works in Chrome, Edge and other Chromium browsers on a computer.</div>`;
    return;
  }
  if (view === 'setup') return renderSetup(el);
  if (view === 'ready') return renderReady(el);
  if (view === 'saving') {
    el.innerHTML = `<div class="live"><div class="status">Saving your recording…</div></div>`;
    return;
  }
  renderLive(el);
}

function renderSetup(el) {
  const studio = studioMode();
  el.innerHTML = `
    <div class="head"><span class="title">New recording</span><span class="chip">${ic('lock', 14)} Saved on this device</span></div>
    <div class="tlabel">What to record</div>
    <div class="sources">${Object.entries(SOURCES)
      .map(([k, s]) => `<button class="src ${prefs.source === k ? 'on' : ''}" data-src="${k}">${ic(s.icon, 20)}<b>${s.name}</b><span>${s.sub}</span></button>`)
      .join('')}</div>
    <div class="devices"><div class="section"><div class="tlabel">Microphone</div>
      <div class="devrow">${deviceSelect('audioinput', 'micSel', prefs.micId, prefs.mic || prefs.source === 'voice')}${prefs.source === 'voice' ? '' : `<button class="toggle ${prefs.mic ? 'on' : ''}" id="micT" aria-label="Microphone on or off" aria-pressed="${prefs.mic}"></button>`}</div></div>
    ${prefs.source === 'voice' ? '' : `<div class="section"><div class="tlabel">${prefs.source === 'camera' ? 'Camera' : 'Camera bubble'}</div>
      <div class="devrow">${camOn() ? '<div class="selfie" id="selfSlot"></div>' : ''}${deviceSelect('videoinput', 'camSel', prefs.camId, camOn())}${prefs.source === 'camera' ? '' : `<button class="toggle ${prefs.cam ? 'on' : ''}" id="camT" aria-label="Camera on or off" aria-pressed="${prefs.cam}"></button>`}</div></div>`}</div>
    <div class="section prompt-box ${prefs.script.trim() ? 'on' : ''}">
      <div class="tlabel row" style="justify-content:space-between">${ic('text', 14)}&nbsp;Teleprompter<span class="words" id="words"></span></div>
      <textarea class="script" id="script" rows="${prefs.script.trim() ? 4 : 2}" placeholder="Optional: paste your script here. ${studio ? 'It scrolls under your camera' : 'It scrolls in the floating window'} while you record, and it is never in the video.">${escapeHtml(prefs.script)}</textarea>
      ${prefs.script.trim() ? `<div class="row prrow"><span class="lbl2">Speed</span><div class="seg">${[[0.75, 'Slow'], [1, 'Normal'], [1.5, 'Fast']].map(([v, l]) => `<button class="${prefs.speed === v ? 'on' : ''}" data-speed="${v}">${l}</button>`).join('')}</div><button class="mini" id="clearScript">Clear</button></div>` : ''}
      <div class="media">
        <div class="media-head"><span class="lbl2">${ic('slides', 14)} Slides and media</span>
          <span class="words">${mediaBusy || (mediaFiles.length ? `${mediaFiles.length} file${mediaFiles.length > 1 ? 's' : ''}` : 'PDF, images or video')}</span>
          <label class="btn outline add">${ic('upload', 14)} Add<input type="file" id="mediaIn" accept="${ACCEPT}" multiple hidden></label></div>
        ${mediaFiles.length ? `<div class="mfiles">${mediaFiles.map((f) => `<span class="mfile">${ic(f.kind === 'video' ? 'play' : f.kind === 'pdf' ? 'slides' : 'shot', 12)}<b>${escapeHtml(f.name)}</b><button data-rm="${f.id}" title="Remove">${ic('x', 12)}</button></span>`).join('')}</div>` : ''}
        <p class="hint">${prefs.source === 'slides' ? 'Your slides fill the video, with your camera in the corner. Change slides with the arrow keys or a clicker.' : 'Choose Slides above to present them, with your camera and this script.'}</p>
      </div>
    </div>
    <div class="section row" style="gap:8px;flex-wrap:wrap">
      ${studio ? '' : `<button class="chip ${prefs.sound ? 'on' : ''}" id="soundC">${ic('speaker', 14)} Include sound</button>`}
      <button class="chip ${prefs.countdown ? 'on' : ''}" id="cdC">${ic('fade', 14)} 3s countdown</button>
    </div>
    ${notices()}
    <button class="btn rec big" id="choose">${ic(SOURCES[prefs.source].icon, 18)} ${studio ? 'Continue' : `Choose ${SOURCES[prefs.source].label}`}</button>
    <div class="note">${ic('help', 14)}<span>${
      studio
        ? prefs.source === 'slides'
          ? 'Records your slides full frame, with your camera bubble and voice. No screen sharing needed.'
          : prefs.source === 'camera'
          ? 'Records just your camera and microphone. You’ll see yourself before anything is recorded.'
          : 'Records just your microphone. Export it as an audio file, or as a video with a sound wave.'
        : prefs.source === 'browser'
          ? 'Chrome then shows all your open tabs in a scrolling list with previews. Pick one and it fills the whole video. You see it here before anything is recorded.'
          : prefs.source === 'monitor'
            ? 'Chrome then shows your screens. To pick one of your open tabs instead, choose Tab above, or click Chrome Tab at the top of Chrome’s window.'
            : 'Chrome then shows your open app windows. You see your choice here before anything is recorded.'
    }</span></div>`;
  el.querySelectorAll('[data-src]').forEach(
    (b) =>
      (b.onclick = () => {
        prefs.source = b.dataset.src;
        savePrefs();
        if (!camOn()) stopCam();
        render();
        ensureCam();
      }),
  );
  const on = (sel, fn) => {
    const n = $(sel);
    if (n) n.onclick = fn;
  };
  on('#micT', () => ((prefs.mic = !prefs.mic), savePrefs(), render()));
  on('#camT', () => {
    prefs.cam = !prefs.cam;
    savePrefs();
    if (!camOn()) stopCam();
    render();
    ensureCam();
  });
  on('#clearScript', () => ((prefs.script = ''), savePrefs(), render()));
  const mi = $('#mediaIn');
  if (mi)
    mi.onchange = async () => {
      mediaBusy = 'Adding…';
      render();
      const { skipped } = await addFiles([...mi.files]);
      mediaFiles = await listFiles();
      mediaBusy = '';
      warnText = skipped.length ? `Skipped ${skipped.join(', ')}: use PDF, PNG, JPEG, WebP, GIF, MP4 or WebM.` : '';
      render();
    };
  el.querySelectorAll('[data-rm]').forEach(
    (b) =>
      (b.onclick = async () => {
        await removeFile(b.dataset.rm);
        mediaFiles = await listFiles();
        render();
      }),
  );
  el.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => ((prefs.speed = Number(b.dataset.speed)), savePrefs(), render())));
  const ta = $('#script');
  if (ta) {
    const words = () => {
      const n = wordCount(ta.value);
      $('#words').textContent = n ? `On · ${n} words · about ${readingMinutes(ta.value, prefs.speed)} min` : 'Off';
    };
    ta.oninput = () => {
      const had = !!prefs.script.trim();
      prefs.script = ta.value;
      savePrefs();
      words();
      if (had !== !!prefs.script.trim()) {
        // Show or hide the speed row without losing the cursor.
        const pos = ta.selectionStart;
        render();
        const t = $('#script');
        t.focus();
        t.setSelectionRange(pos, pos);
      }
    };
    words();
  }
  on('#soundC', () => ((prefs.sound = !prefs.sound), savePrefs(), render()));
  on('#cdC', () => ((prefs.countdown = !prefs.countdown), savePrefs(), render()));
  $('#micSel').onchange = (e) => ((prefs.micId = e.target.value), savePrefs());
  const camSel = $('#camSel');
  if (camSel)
    camSel.onchange = (e) => {
      prefs.camId = e.target.value;
      savePrefs();
      stopCam();
      ensureCam();
    };
  $('#choose').onclick = studio ? enterStudio : choose;
  mount($('#selfSlot'), selfVideo, cam);
}

// Camera-only and voice-only recordings happen in the studio, with the script under the camera.
async function enterStudio() {
  let deck = [];
  if (prefs.source === 'slides') {
    if (!mediaFiles.length) {
      errorText = 'Add your slides first: a PDF, images or videos, in the Teleprompter box.';
      return render();
    }
    errorText = '';
    const btn = $('#choose');
    btn.disabled = true;
    try {
      deck = await buildDeck(mediaFiles, (msg) => (btn.textContent = `Preparing ${msg}…`));
    } catch (e) {
      errorText = `Couldn’t open your slides: ${e.message || e}.`;
      return render();
    }
  }
  stopCam();
  const home = $('main.home');
  const host = document.createElement('main');
  host.className = 'studio-host';
  home.after(host);
  home.hidden = true;
  openStudio(host, {
    kind: prefs.source === 'camera' ? 'camera' : prefs.source === 'slides' ? 'slides' : 'voice',
    mic: prefs.mic || prefs.source === 'voice',
    cam: prefs.cam,
    deck,
    micId: prefs.micId,
    camId: prefs.camId,
    countdown: prefs.countdown,
    script: scriptFor(),
    tickerURL: TICKER,
    onFinish: (id) => (location.href = `pages/editor.html#${encodeURIComponent(id)}`),
    onClose: () => {
      releaseDeck(deck);
      host.remove();
      home.hidden = false;
      render();
      ensureCam();
    },
  });
}

function sourceLabel() {
  return SOURCES[surface]?.label || 'your screen';
}

function previewBox() {
  return `<div class="preview"><div class="pvslot" id="pvSlot"></div>${cam && !pip ? '<div class="pvcam" id="pvCam"></div>' : ''}
    <span class="srclabel">${ic(SOURCES[surface]?.icon || 'screen', 13)} ${view === 'ready' ? 'You’ll record' : 'Recording'} ${sourceLabel()}</span></div>`;
}

function renderReady(el) {
  const floatNote = canFloat
    ? `Press Start and a floating window stays on top of every app: the controls, a live preview of what you’re recording${cam ? ' with your camera' : ''}${scriptFor() ? ', and your script' : ''}.`
    : 'Keep this tab open to pause, retake or finish.';
  const camNote = surface === 'monitor' ? ' On a full-screen recording the floating window is filmed too, so record a tab or a window to keep it out of the video.' : '';
  el.innerHTML = `
    <div class="head"><span class="title">Ready to record</span><button class="chip" id="change">${ic('retake', 14)} Change</button></div>
    ${previewBox()}
    ${floatBlocker ? `<div class="notice">${floatBlocker}</div>` : ''}
    ${notices()}
    ${scriptFor() ? `<div class="note" style="margin:0 0 12px">${ic('text', 14)}<span>Teleprompter on: your script (${wordCount(prefs.script)} words) scrolls in the floating window while you record.</span></div>` : ''}
    <button class="btn rec big" id="go">${REC_DOT} Start recording</button>
    <div class="note">${ic('help', 14)}<span>${floatNote}${camNote} Shortcuts: Alt+Shift+K pause, Alt+Shift+U retake, Alt+Shift+S finish.</span></div>
    <button class="link" id="cancel">Cancel</button>`;
  $('#go').onclick = go;
  $('#change').onclick = async () => {
    releaseShare();
    await choose();
  };
  $('#cancel').onclick = () => {
    releaseShare();
    view = 'setup';
    render();
  };
  mount($('#pvSlot'), screenVideo, display);
  mount($('#pvCam'), selfVideo, cam);
}

function renderLive(el) {
  const paused = view === 'paused' || view === 'retake';
  const status =
    view === 'countdown'
      ? `<div class="status">Recording starts in <b class="cd">${countdownLeft}</b></div>`
      : `<div class="status"><span class="dot ${paused ? '' : 'pulse'}" style="background:${paused ? '#f79009' : 'var(--rec)'}"></span>${paused ? 'Paused' : 'Recording'} <span class="clock" id="clock">${fmtClock(recorder?.elapsed() || 0)}</span></div>`;
  el.innerHTML = `
    ${previewBox()}
    ${pagePrompter && !pip ? '<div id="prPage"></div>' : ''}
    <div class="live">${status}
      ${view === 'retake' ? retakeBox() : view === 'countdown' ? '<button class="link" id="cancel">Cancel</button>' : `
      <div class="controls">
        <button class="btn dark" id="pause">${paused ? `${ic('play', 16)} Resume` : `${ic('pause', 16)} Pause`}</button>
        <button class="btn outline" id="retake" ${recorder?.segments.length || recorder?.recording ? '' : 'disabled'}>${ic('retake', 16)} Retake</button>
        <button class="btn rec wide" id="finish">${ic('check', 16)} Finish and edit</button>
      </div>
      ${canFloat && !pip ? `<button class="link" id="float">${ic('vert', 13)} Show floating controls</button>` : ''}
      <button class="link" id="cancel">Discard this recording</button>`}
    </div>`;
  bindLive(el);
  mount($('#pvSlot'), screenVideo, display);
  mount($('#pvCam'), selfVideo, cam);
  if (pagePrompter && $('#prPage')) $('#prPage').append(pagePrEl);
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

// ---------- floating window (Document Picture-in-Picture) ----------
// Holds the camera bubble, so you can see yourself over any app, and the controls.
const PIP_CSS = `html,body{margin:0;height:100%;background:#0d0f13;color:#fff;font-family:Inter,system-ui,sans-serif;overflow:hidden}
.wrap{height:100%;display:flex;flex-direction:column;gap:10px;padding:10px;box-sizing:border-box}
.bar{height:52px;flex:none;display:flex;align-items:center;gap:8px;padding:0 8px 0 14px;background:#171a20;border-radius:14px}
.pclock{font-variant-numeric:tabular-nums;font-weight:650;font-size:17px;min-width:54px}
.psrc{font-size:12px;color:rgba(255,255,255,.55);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;flex:1;min-width:0;display:flex;gap:6px;align-items:center}
.pnum{font-size:24px;font-weight:700}.plabel{font-size:13px;font-weight:600;flex:1}
.ib{width:38px;height:38px;border-radius:11px;border:0;background:rgba(255,255,255,.08);color:#fff;display:grid;place-items:center;cursor:pointer;flex:none}
.ib:hover{background:rgba(255,255,255,.16)}
.btn.sm{height:38px;padding:0 14px;font-size:13px;flex:none}
.btn.outline.sm{background:transparent;color:#fff;box-shadow:inset 0 0 0 1px rgba(255,255,255,.3)}
.pv{position:relative;flex:none;aspect-ratio:16/9;background:#000;border-radius:14px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.08)}
.pv.off{aspect-ratio:auto;height:34px;background:#171a20}
.pv.off .pvs,.pv.off .pvface{display:none}
.pvs,.pvs video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain}
.pvface{position:absolute;left:10px;bottom:10px;width:24%;aspect-ratio:1;border-radius:50%;overflow:hidden;box-shadow:0 0 0 2px #fff,0 4px 16px rgba(0,0,0,.4)}
.pvface video{width:100%;height:100%;object-fit:cover}
.pvtag{position:absolute;top:8px;left:8px;font-size:11px;font-weight:600;background:rgba(13,15,19,.75);padding:4px 9px;border-radius:999px;color:rgba(255,255,255,.85)}
.pvbtn{position:absolute;top:6px;right:6px;height:24px;border:0;border-radius:8px;background:rgba(13,15,19,.75);color:#fff;font:600 11px Inter,system-ui,sans-serif;padding:0 9px;cursor:pointer}
.pv.off .pvtag{top:9px}.pv.off .pvbtn{top:5px}
.pscript{flex:1;min-height:0}.pscript .rp{border-radius:14px;background:#171a20}
.dot{width:10px;height:10px;border-radius:50%;flex:none}.pulse{animation:pulse 1.4s ease-in-out infinite}@keyframes pulse{50%{opacity:.35}}`;

const pipScreen = mkVideo();
let previewOn = true;

function pipBar() {
  const paused = view === 'paused' || view === 'retake';
  if (view === 'countdown') return `<span class="pnum">${countdownLeft}</span><span class="plabel">Recording starts…</span>`;
  if (view === 'retake')
    return `<span class="plabel">Retake last part?</span><button class="btn outline sm" id="rtNo">Keep</button><button class="btn rec sm" id="rtYes" style="margin-left:0">${ic('retake', 14)} Retake</button>`;
  return `<span class="dot ${paused ? '' : 'pulse'}" style="background:${paused ? '#f79009' : 'var(--rec)'}"></span>
    <span class="pclock" id="clock">${fmtClock(recorder?.elapsed() || 0)}</span>
    <span class="psrc">${paused ? 'Paused' : ''}</span>
    <button class="ib" id="pause" title="${paused ? 'Resume' : 'Pause'} (Alt+Shift+K)">${ic(paused ? 'play' : 'pause', 18)}</button>
    <button class="ib" id="retake" title="Retake the last part (Alt+Shift+U)">${ic('retake', 18)}</button>
    <button class="btn rec sm" id="finish">${ic('check', 14)} Finish</button>`;
}

function pipPreview(doc) {
  const box = doc.getElementById('pv');
  if (!box) return;
  box.classList.toggle('off', !previewOn);
  doc.getElementById('pvBtn').textContent = previewOn ? 'Hide' : 'Show preview';
  if (previewOn) {
    mount(doc.getElementById('pvScreen'), pipScreen, display);
    if (cam) mount(doc.getElementById('camSlot'), selfVideo, cam);
  }
}

function openFloat() {
  if (!canFloat || pip) return Promise.resolve(pip);
  const script = scriptFor();
  // Tall and wide: controls, a live preview of what is recorded, then the script.
  const size = script ? { width: 560, height: 820 } : { width: 520, height: 380 };
  let p;
  try {
    p = documentPictureInPicture.requestWindow(size);
  } catch (e) {
    p = Promise.reject(e);
  }
  return p
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
      w.document.body.innerHTML = `<div class="wrap">
        <div class="bar" id="bar"></div>
        <div class="pv" id="pv"><div class="pvs" id="pvScreen"></div>${cam ? '<div class="pvface" id="camSlot"></div>' : ''}
          <span class="pvtag">Recording ${sourceLabel()}</span><button class="pvbtn" id="pvBtn"></button></div>
        ${script ? '<div class="pscript" id="prSlot"></div>' : ''}</div>`;
      w.document.getElementById('pvBtn').onclick = () => {
        previewOn = !previewOn;
        pipPreview(w.document);
        if (!script) w.resizeTo(w.outerWidth, previewOn ? 380 : 150);
      };
      pipPreview(w.document);
      if (script) {
        pagePrompter?.destroy();
        pagePrompter = null;
        prompter = mountPrompter(w.document.getElementById('prSlot'), { ...script, size: 21 });
        prompter.setRecording(view === 'recording');
      }
      w.addEventListener('pagehide', () => {
        pip = null;
        prompter = null;
        refresh();
      });
      w.addEventListener('keydown', onKey);
      refresh();
      return w;
    })
    .catch(() => {
      warnText = 'The floating window couldn’t open, so use this page or the shortcuts to control the recording.';
      refresh();
      return null;
    });
}

function refresh() {
  render();
  if (pip) {
    const bar = pip.document.getElementById('bar');
    if (bar) {
      bar.innerHTML = pipBar();
      bindLive(pip.document);
    }
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
async function choose() {
  errorText = '';
  try {
    display = await navigator.mediaDevices.getDisplayMedia({
      video: { displaySurface: prefs.source, frameRate: { ideal: 30 }, width: { max: 2560 }, height: { max: 1600 } },
      audio: prefs.sound ? { suppressLocalAudioPlayback: false } : false,
      selfBrowserSurface: 'exclude',
      preferCurrentTab: false,
      surfaceSwitching: 'include',
      monitorTypeSurfaces: 'include',
      systemAudio: prefs.sound ? 'include' : 'exclude',
    });
  } catch (e) {
    display = null;
    if (e.name !== 'NotAllowedError') errorText = `Couldn’t start sharing: ${e.message || e.name}.`;
    view = 'setup';
    return render();
  }
  surface = display.getVideoTracks()[0].getSettings().displaySurface || prefs.source;
  display.getVideoTracks()[0].addEventListener('ended', onShareEnded);
  warnText = '';
  if (prefs.mic && !mic) {
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: prefs.micId ? { exact: prefs.micId } : undefined, echoCancellation: true, noiseSuppression: true } });
    } catch {
      warnText = 'Microphone blocked, so this recording will have no voice. Allow it from the icon in the address bar.';
    }
  }
  if (prefs.cam) await ensureCam();
  if (prefs.sound && !display.getAudioTracks().length && surface !== 'browser')
    warnText ||= 'Sound from the screen isn’t included. Chrome shares sound from a tab, or from the whole screen on Windows.';
  loadDevices();
  view = 'ready';
  render();
}

function onShareEnded() {
  if (view === 'ready') {
    releaseShare();
    view = 'setup';
    render();
  } else if (view !== 'setup' && view !== 'saving') finish();
}

function releaseShare() {
  display?.getTracks().forEach((t) => t.stop());
  mic?.getTracks().forEach((t) => t.stop());
  display = mic = null;
}

let bubbleOn = false;
function openBubble() {
  // Fallback when the floating window isn't available: float just the camera over every app.
  if (!cam || !canBubble || bubbleOn) return Promise.resolve(null);
  return selfVideo
    .requestPictureInPicture()
    .then((w) => {
      bubbleOn = true;
      try {
        navigator.mediaSession.setActionHandler('pause', () => view === 'recording' && togglePause());
        navigator.mediaSession.setActionHandler('play', () => view === 'paused' && togglePause());
        navigator.mediaSession.setActionHandler('hangup', () => finish());
      } catch {}
      selfVideo.addEventListener('leavepictureinpicture', () => (bubbleOn = false), { once: true });
      return w;
    })
    .catch(() => null);
}

async function go() {
  // Must come first, while the click still counts: the floating window needs it.
  const pipP = canFloat ? openFloat().then((w) => w || openBubble()) : openBubble();
  const tracks = [];
  // The camera is drawn into the video, so it is there whatever is shared.
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
  await pipP;
  if (!pip && scriptFor()) {
    pagePrEl = document.createElement('div');
    pagePrEl.className = 'pageprompt';
    pagePrompter = mountPrompter(pagePrEl, scriptFor());
  }
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
  pr()?.setRecording(true);
  refresh();
  clearInterval(timer);
  timer = setInterval(tick, 250);
}

async function togglePause() {
  if (!recorder) return;
  if (view === 'recording') {
    view = 'paused';
    pr()?.setRecording(false);
    refresh();
    await recorder.endSegment();
  } else if (view === 'paused') {
    await recorder.begin();
    view = 'recording';
    pr()?.setRecording(true);
    refresh();
  }
}

async function askRetake() {
  if (!recorder || (view !== 'recording' && view !== 'paused')) return;
  pr()?.setRecording(false);
  if (recorder.recording) await recorder.endSegment();
  if (!recorder.segments.length) return refresh();
  view = 'retake';
  refresh();
}

async function confirmRetake() {
  await recorder.discardLast();
  pr()?.rewind();
  await countdownThen(retakeCountdown, () => recorder.begin({ retake: true }));
}

function stopAll() {
  clearInterval(timer);
  prompter?.destroy();
  pagePrompter?.destroy();
  prompter = pagePrompter = null;
  composite?.stop();
  for (const s of [display, mic, cam, mixed]) s?.getTracks().forEach((t) => t.stop());
  audioCtx?.close();
  display = mic = cam = mixed = composite = audioCtx = null;
  pip?.close();
  pip = null;
  if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
}

async function finish() {
  if (!recorder || view === 'saving') return;
  view = 'saving';
  refresh();
  const count = await recorder.finish();
  stopAll();
  recorder = null;
  if (!count) {
    view = 'setup';
    errorText = 'Nothing was recorded.';
    render();
    return ensureCam();
  }
  location.href = `pages/editor.html#${encodeURIComponent(recordingId)}`;
}

async function cancel() {
  const nothingYet = !recorder?.segments.length && !recorder?.recording;
  if (!nothingYet && !confirm('Discard this recording? It can’t be recovered.')) return;
  view = 'setup';
  const r = recorder;
  recorder = null;
  stopAll();
  if (r) {
    await r.abort();
    await deleteRecording(recordingId);
  }
  render();
  ensureCam();
}

function onKey(e) {
  if (view === 'setup' || view === 'ready' || e.target.closest?.('input,select,textarea')) return;
  if (e.altKey && e.shiftKey && e.code === 'KeyK') (e.preventDefault(), togglePause());
  if (e.altKey && e.shiftKey && e.code === 'KeyU') (e.preventDefault(), askRetake());
  if (e.altKey && e.shiftKey && e.code === 'KeyS') (e.preventDefault(), finish());
}
document.addEventListener('keydown', onKey);
window.addEventListener('beforeunload', (e) => {
  if (recorder && view !== 'saving') e.preventDefault();
});

await loadDevices();
mediaFiles = await listFiles().catch(() => []);
render();
ensureCam();
