// Studio: records just the camera or just the voice, with the script right under the camera.
// Used by the web app and the extension. The page must load tokens.css.

import { newRecording, putRecording, deleteRecording, requestPersistence } from './db.js';
import { SegmentRecorder, voiceCard } from './recorder.js';
import { mountPrompter } from './prompter.js';
import { ic } from './icons.js';
import { fmtClock } from './format.js';
import { loadImage } from './media.js';

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
.st-script{height:250px}
.st-bar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.st-bar .btn{height:46px}
.st-bar .grow{margin-left:auto}
.st-big{height:52px!important;border-radius:26px;padding:0 28px;font-size:16px}
.st-confirm{background:var(--surface);border-radius:16px;box-shadow:0 0 0 1px var(--line);padding:16px;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
.st-confirm b{font-size:15px}.st-confirm p{margin:2px 0 0;font-size:13px;color:var(--muted)}
.st-confirm label{font-size:13px;display:flex;gap:6px;align-items:center;margin-left:auto}
.st-pulse{animation:stpulse 1.4s ease-in-out infinite}@keyframes stpulse{50%{opacity:.35}}
.st-link{font-size:13px;color:var(--muted);background:none;border:0;cursor:pointer;padding:8px}
.st-link:hover{color:var(--ink)}
.st-stage canvas{width:100%;height:100%;object-fit:contain;display:block;background:#0b0c0f}
.st-nav{display:flex;align-items:center;gap:8px}
.st-nav .num{font:600 13px Inter,system-ui,sans-serif;color:var(--muted);min-width:64px;text-align:center;font-variant-numeric:tabular-nums}
.st-strip{display:flex;gap:8px;overflow-x:auto;padding:2px 2px 6px;scrollbar-width:thin}
.st-strip button{flex:none;width:112px;aspect-ratio:16/9;border:0;border-radius:8px;background:#0b0c0f center/contain no-repeat;box-shadow:inset 0 0 0 1px var(--line);cursor:pointer;position:relative;padding:0}
.st-strip button.on{box-shadow:0 0 0 3px var(--rec)}
.st-strip button span{position:absolute;left:4px;bottom:4px;font:600 10px Inter,system-ui,sans-serif;color:#fff;background:rgba(0,0,0,.6);padding:1px 5px;border-radius:4px}`;

export async function openStudio(root, { kind, mic = true, micId = '', camId = '', cam = false, deck = [], countdown = true, script = null, tickerURL, onFinish, onClose }) {
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

  // Slides: the current slide fills the frame, with the camera as a bubble in the corner.
  let slide = 0, slideMarks = [], composer = null, ac = null, audioDest = null, bubbleStream = null;
  const videos = new Map(), images = new Map();
  try {
    if (kind === 'slides') {
      if (cam) bubbleStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: dev(camId), width: { ideal: 640 }, height: { ideal: 480 } } });
      if (mic) micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev(micId), echoCancellation: true, noiseSuppression: true } });
      composer = makeComposer();
      videoStream = composer.stream;
    }
    if (kind === 'camera') videoStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: dev(camId), width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
    if (kind !== 'slides' && (mic || kind === 'voice')) micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev(micId), echoCancellation: true, noiseSuppression: true } });
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

  function makeComposer() {
    const W = 1920, H = 1080;
    const canvas = doc.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const face = doc.createElement('video');
    face.muted = true;
    face.playsInline = true;
    if (bubbleStream) {
      face.srcObject = bubbleStream;
      face.play().catch(() => {});
    }
    ac = new AudioContext();
    audioDest = ac.createMediaStreamDestination();
    if (micStream) ac.createMediaStreamSource(micStream).connect(audioDest);
    deck.forEach((sl) => {
      if (sl.kind === 'video') {
        const v = doc.createElement('video');
        v.src = sl.url;
        v.playsInline = true;
        v.preload = 'auto';
        const src = ac.createMediaElementSource(v);
        src.connect(audioDest);
        src.connect(ac.destination);
        videos.set(sl.url, v);
      } else loadImage(sl.url).then((img) => images.set(sl.url, img));
    });
    const fit = (w, h) => {
      const k = Math.min(W / w, H / h);
      return [(W - w * k) / 2, (H - h * k) / 2, w * k, h * k];
    };
    const draw = () => {
      ctx.fillStyle = '#0b0c0f';
      ctx.fillRect(0, 0, W, H);
      const sl = deck[slide];
      if (sl?.kind === 'image' && images.get(sl.url)) {
        const img = images.get(sl.url);
        ctx.drawImage(img, ...fit(img.naturalWidth, img.naturalHeight));
      } else if (sl?.kind === 'video') {
        const v = videos.get(sl.url);
        if (v?.videoWidth) ctx.drawImage(v, ...fit(v.videoWidth, v.videoHeight));
      }
      if (bubbleStream && face.videoWidth) {
        const d = Math.round(H * 0.24), x = W - d - 40, y = H - d - 40;
        const sq = Math.min(face.videoWidth, face.videoHeight);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + d / 2, y + d / 2, d / 2 + 5, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(x + d, y);
        ctx.scale(-1, 1);
        ctx.drawImage(face, (face.videoWidth - sq) / 2, (face.videoHeight - sq) / 2, sq, sq, 0, 0, d, d);
        ctx.restore();
      }
    };
    const ticker = new Worker(tickerURL);
    ticker.onmessage = () => {
      try {
        draw();
      } finally {
        ticker.postMessage({ ack: true });
      }
    };
    ticker.postMessage({ start: true, interval: 33 });
    const stream = canvas.captureStream(30);
    return {
      canvas,
      stream,
      audioTracks: () => audioDest.stream.getAudioTracks(),
      stop() {
        ticker.postMessage({ stop: true });
        ticker.terminate();
        stream.getTracks().forEach((t) => t.stop());
        videos.forEach((v) => v.pause());
        bubbleStream?.getTracks().forEach((t) => t.stop());
        ac.close();
      },
    };
  }

  function goTo(i) {
    if (kind !== 'slides' || !deck.length) return;
    const next = Math.max(0, Math.min(deck.length - 1, i));
    const old = deck[slide];
    if (old?.kind === 'video') videos.get(old.url)?.pause();
    slide = next;
    const now = deck[slide];
    if (now?.kind === 'video') {
      const v = videos.get(now.url);
      ac?.resume();
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    const num = root.querySelector('#stNum');
    if (num) num.textContent = `${slide + 1} / ${deck.length}`;
    root.querySelectorAll('.st-strip button').forEach((b, k) => b.classList.toggle('on', k === slide));
    root.querySelector('.st-strip button.on')?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  const elapsed = () => recorder?.elapsed() || 0;
  const paused = () => view === 'paused' || view === 'retake';

  function render() {
    const title = { camera: 'Camera recording', voice: 'Voice recording', slides: 'Slides recording' }[kind];
    const nav =
      kind === 'slides' && deck.length && view !== 'error' && view !== 'saving'
        ? `<div class="st-nav"><button class="btn outline" data-s="prev" title="Previous slide (←)">‹ Prev</button><span class="num" id="stNum">${slide + 1} / ${deck.length}</span><button class="btn dark" data-s="next" title="Next slide (→ or a clicker)">Next ›</button></div>
           <div class="st-strip">${deck.map((d, k) => `<button class="${k === slide ? 'on' : ''}" data-slide="${k}" style="${d.kind === 'image' ? `background-image:url(${d.url})` : ''}"><span>${k + 1}${d.kind === 'video' ? ' ▶' : ''}</span></button>`).join('')}</div>`
        : '';
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
      ${nav}
      ${script ? '<div class="st-script" id="stScript"></div>' : ''}
      <div class="st-bar">${controls}</div>
      ${view === 'ready' ? `<div class="note" style="font-size:12.5px;color:var(--muted)">${script ? 'Your script scrolls under the camera while you record, so you keep looking near the lens. ' : ''}${kind === 'slides' ? 'Change slides with the arrow keys or a presentation clicker. ' : ''}Shortcuts: Alt+Shift+K pause, Alt+Shift+U retake, Alt+Shift+S finish.</div>` : ''}
    </div>`;
    const stage = root.querySelector('#stStage');
    if (composer) stage.prepend(composer.canvas);
    else {
      stage.prepend(preview);
      preview.play().catch(() => {});
    }
    const slot = root.querySelector('#stScript');
    if (slot) {
      if (!prompter) prompter = { el: doc.createElement('div') };
      if (!prompter.api) {
        prompter.el.style.height = '100%';
        prompter.api = mountPrompter(prompter.el, { ...script, size: 24 });
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
    slideMarks.push(slide);
    await fn();
    view = 'recording';
    prompter?.api?.setRecording(true);
    render();
  }

  async function start() {
    ac?.resume();
    const slideAudio = kind === 'slides' && (micStream || deck.some((d) => d.kind === 'video'));
    const tracks = [...videoStream.getVideoTracks(), ...(kind === 'slides' ? (slideAudio ? composer.audioTracks() : []) : micStream ? micStream.getAudioTracks() : [])];
    const set = videoStream.getVideoTracks()[0].getSettings();
    const size = kind === 'slides' ? { width: 1920, height: 1080 } : { width: set.width || 1280, height: set.height || 720 };
    const rec = newRecording({ source: kind === 'camera' ? 'camera' : kind === 'slides' ? 'slides' : 'audio', ...size, hasAudio: kind === 'slides' ? !!slideAudio : !!micStream });
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
      slideMarks.push(slide);
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
    composer?.stop();
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
      if (slideMarks.length) {
        const back = slideMarks.pop();
        render();
        goTo(back);
      }
      await countdownThen(retakeCountdown, () => recorder.begin({ retake: true }));
    },
    finish,
    discard,
    prev: () => goTo(slide - 1),
    next: () => goTo(slide + 1),
  };
  root.addEventListener('click', (e) => {
    const t = e.target.closest('[data-slide]');
    if (t) return goTo(Number(t.dataset.slide));
    const b = e.target.closest('[data-s]');
    if (b && !b.disabled) handlers[b.dataset.s]();
  });
  function onKey(e) {
    if (kind === 'slides' && !e.altKey && !e.target.closest?.('input,textarea,select')) {
      if (['ArrowRight', 'PageDown', 'ArrowDown'].includes(e.key)) return e.preventDefault(), goTo(slide + 1);
      if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) return e.preventDefault(), goTo(slide - 1);
    }
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
  if (kind === 'slides') goTo(0);
}
