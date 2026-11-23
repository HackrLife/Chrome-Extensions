// Studio: records just the camera or just the voice, with the script right under the camera.
// Used by the web app and the extension. The page must load tokens.css.

import { newRecording, putRecording, deleteRecording, requestPersistence } from './db.js';
import { SegmentRecorder, voiceCard } from './recorder.js';
import { mountPrompter } from './prompter.js';
import { ic } from './icons.js';
import { fmtClock } from './format.js';

const CSS = `
.st{width:100%;max-width:900px;margin:0 auto;display:flex;flex-direction:column;gap:14px}
.st-top{display:flex;align-items:center;gap:10px}
.st-title{font-size:17px;font-weight:650;margin-right:auto}
.st-stage{position:relative;aspect-ratio:16/9;max-height:56vh;background:#0b0c0f;border-radius:18px;overflow:hidden;align-self:center;width:100%}
.st-stage video{width:100%;height:100%;object-fit:cover;display:block}
.st-stage.mirror video{transform:scaleX(-1)}
.st-count{position:absolute;inset:0;display:grid;place-items:center;font:700 120px Inter,system-ui,sans-serif;color:#fff;background:rgba(17,19,24,.35)}
.st-tag{position:absolute;top:12px;left:12px;display:inline-flex;align-items:center;gap:8px;background:rgba(17,19,24,.8);color:#fff;font:600 13px Inter,system-ui,sans-serif;padding:7px 12px;border-radius:999px;font-variant-numeric:tabular-nums}
.st-tag .dot{width:9px;height:9px;border-radius:50%}
.st-script{height:190px}
.st-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.st-bar .btn{height:46px}
.st-bar .grow{margin-left:auto}
.st-big{height:52px!important;border-radius:26px;padding:0 28px;font-size:16px}
.st-confirm{background:#fff;border-radius:16px;box-shadow:0 0 0 1px var(--line);padding:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.st-confirm b{font-size:15px}.st-confirm p{margin:2px 0 0;font-size:13px;color:var(--muted)}
.st-confirm label{font-size:13px;display:flex;gap:6px;align-items:center;margin-left:auto}
.st-pulse{animation:stpulse 1.4s ease-in-out infinite}@keyframes stpulse{50%{opacity:.35}}
.st-link{font-size:13px;color:var(--muted);background:none;border:0;cursor:pointer;padding:8px}
.st-link:hover{color:var(--ink)}`;

export async function openStudio(root, { kind, mic = true, micId = '', camId = '', countdown = true, script = null, tickerURL, onFinish, onClose }) {
  const doc = root.ownerDocument;
  if (!doc.getElementById('st-style')) {
    const s = doc.createElement('style');
    s.id = 'st-style';
    s.textContent = CSS;
    doc.head.append(s);
  }
  const dev = (id) => (id && id !== 'default' ? { exact: id } : undefined);
  let view = 'loading', error = '', countdownLeft = 0, retakeCountdown = true;
  let videoStream = null, micStream = null, card = null, recorder = null, recordingId = null, prompter = null, timer = 0;
  const preview = doc.createElement('video');
  preview.muted = true;
  preview.playsInline = true;
  preview.autoplay = true;

  try {
    if (kind === 'camera') videoStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: dev(camId), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
    if (mic || kind === 'voice') micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev(micId), echoCancellation: true, noiseSuppression: true } });
    if (kind === 'voice') {
      card = voiceCard(micStream, tickerURL);
      videoStream = new MediaStream(card.stream.getVideoTracks());
    }
    view = 'ready';
  } catch (e) {
    error = kind === 'camera' ? 'The camera or microphone is blocked. Allow them from the icon in the address bar, then try again.' : 'The microphone is blocked. Allow it from the icon in the address bar, then try again.';
    view = 'error';
  }
  preview.srcObject = videoStream;

  const elapsed = () => recorder?.elapsed() || 0;
  const paused = () => view === 'paused' || view === 'retake';

  function render() {
    const title = kind === 'camera' ? 'Camera recording' : 'Voice recording';
    const tag =
      view === 'recording' || paused()
        ? `<span class="st-tag"><span class="dot ${paused() ? '' : 'st-pulse'}" style="background:${paused() ? '#f79009' : 'var(--rec)'}"></span><span id="stClock">${fmtClock(elapsed())}</span>${paused() ? ' · Paused' : ''}</span>`
        : '';
    let controls = '';
    if (view === 'error') controls = `<div class="notice">${error}</div><button class="btn outline" data-s="close">Back</button>`;
    else if (view === 'ready') controls = `<button class="btn rec st-big" data-s="start"><span class="dot" style="width:12px;height:12px;background:#fff;border-radius:50%;display:inline-block"></span> Start recording</button><button class="st-link" data-s="close">Cancel</button>`;
    else if (view === 'countdown') controls = `<button class="st-link" data-s="discard">Cancel</button>`;
    else if (view === 'saving') controls = `<span class="tlabel">Saving your recording…</span>`;
    else if (view === 'retake')
      controls = `<div class="st-confirm" style="width:100%"><div><b>Retake the last part?</b><p>The part since your last pause is removed. Everything before it is kept.</p></div>
        <label><input type="checkbox" id="stCd" ${retakeCountdown ? 'checked' : ''}/> 3-second countdown</label>
        <button class="btn outline" data-s="keep">Keep it</button><button class="btn rec" data-s="retake-yes">${ic('retake', 15)} Retake</button></div>`;
    else
      controls = `<button class="btn dark" data-s="pause">${paused() ? `${ic('play', 16)} Resume` : `${ic('pause', 16)} Pause`}</button>
        <button class="btn outline" data-s="retake" ${recorder?.segments.length || recorder?.recording ? '' : 'disabled'}>${ic('retake', 16)} Retake</button>
        <button class="st-link" data-s="discard">Discard</button>
        <button class="btn rec grow" data-s="finish">${ic('check', 16)} Finish and edit</button>`;
    root.innerHTML = `<div class="st">
      <div class="st-top"><span class="st-title">${title}</span><span class="chip">${ic('lock', 14)} Saved on this device</span></div>
      <div class="st-stage ${kind === 'camera' ? 'mirror' : ''}" id="stStage">${tag}${view === 'countdown' ? `<div class="st-count">${countdownLeft}</div>` : ''}</div>
      ${script ? '<div class="st-script" id="stScript"></div>' : ''}
      <div class="st-bar">${controls}</div>
      ${view === 'ready' ? `<div class="note" style="font-size:12.5px;color:var(--muted)">${script ? 'Your script scrolls under the camera while you record, so you keep looking near the lens. ' : ''}Shortcuts: Alt+Shift+K pause, Alt+Shift+U retake, Alt+Shift+S finish.</div>` : ''}
    </div>`;
    const stage = root.querySelector('#stStage');
    stage.prepend(preview);
    preview.play().catch(() => {});
    const slot = root.querySelector('#stScript');
    if (slot) {
      if (!prompter) prompter = { el: doc.createElement('div') };
      if (!prompter.api) {
        prompter.el.style.height = '100%';
        prompter.api = mountPrompter(prompter.el, script);
      }
      slot.append(prompter.el);
    }
    const cb = root.querySelector('#stCd');
    if (cb) cb.onchange = (e) => (retakeCountdown = e.target.checked);
  }

  async function countdownThen(on, fn) {
    if (on) {
      view = 'countdown';
      for (countdownLeft = 3; countdownLeft > 0; countdownLeft--) {
        render();
        await new Promise((r) => setTimeout(r, 1000));
        if (view !== 'countdown') return;
      }
    }
    await fn();
    view = 'recording';
    prompter?.api?.setRecording(true);
    render();
  }

  async function start() {
    const tracks = [...videoStream.getVideoTracks(), ...(micStream ? micStream.getAudioTracks() : [])];
    const set = videoStream.getVideoTracks()[0].getSettings();
    const rec = newRecording({ source: kind === 'camera' ? 'camera' : 'audio', width: set.width || 1280, height: set.height || 720, hasAudio: !!micStream });
    recordingId = rec.id;
    recorder = new SegmentRecorder({ stream: new MediaStream(tracks), recordingId });
    rec.mimeType = recorder.mimeType;
    await putRecording(rec);
    requestPersistence();
    timer = setInterval(() => {
      const c = root.querySelector('#stClock');
      if (c) c.textContent = fmtClock(elapsed());
    }, 250);
    await countdownThen(countdown, () => recorder.begin());
  }

  async function pauseToggle() {
    if (view === 'recording') {
      view = 'paused';
      prompter?.api?.setRecording(false);
      render();
      await recorder.endSegment();
    } else if (view === 'paused') {
      await recorder.begin();
      view = 'recording';
      prompter?.api?.setRecording(true);
      render();
    }
  }

  async function askRetake() {
    if (view !== 'recording' && view !== 'paused') return;
    if (view === 'recording') await pauseToggle();
    if (!recorder.segments.length) return render();
    view = 'retake';
    render();
  }

  function stopStreams() {
    clearInterval(timer);
    card?.stop();
    for (const s of [videoStream, micStream]) s?.getTracks().forEach((t) => t.stop());
    prompter?.api?.destroy();
    doc.removeEventListener('keydown', onKey);
    doc.defaultView.removeEventListener('beforeunload', guard);
  }

  async function finish() {
    if (!recorder || view === 'saving') return;
    prompter?.api?.setRecording(false);
    view = 'saving';
    render();
    const count = await recorder.finish();
    stopStreams();
    if (count) onFinish?.(recordingId);
    else {
      await deleteRecording(recordingId);
      onClose?.();
    }
  }

  async function discard() {
    const started = recorder && (recorder.segments.length || recorder.recording);
    if (started && !doc.defaultView.confirm('Discard this recording? It can’t be recovered.')) return;
    view = 'closing';
    if (recorder) {
      await recorder.abort();
      await deleteRecording(recordingId);
    }
    stopStreams();
    onClose?.();
  }

  const handlers = {
    start,
    close: () => (stopStreams(), onClose?.()),
    pause: pauseToggle,
    retake: askRetake,
    keep: () => ((view = 'paused'), render()),
    'retake-yes': async () => {
      await recorder.discardLast();
      prompter?.api?.rewind();
      await countdownThen(retakeCountdown, () => recorder.begin({ retake: true }));
    },
    finish,
    discard,
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('[data-s]');
    if (b && !b.disabled) handlers[b.dataset.s]();
  });
  function onKey(e) {
    if (!e.altKey || !e.shiftKey) return;
    if (e.code === 'KeyK') (e.preventDefault(), pauseToggle());
    if (e.code === 'KeyU') (e.preventDefault(), askRetake());
    if (e.code === 'KeyS') (e.preventDefault(), finish());
  }
  function guard(e) {
    if (recorder && view !== 'saving') e.preventDefault();
  }
  doc.addEventListener('keydown', onKey);
  doc.defaultView.addEventListener('beforeunload', guard);
  render();
}
