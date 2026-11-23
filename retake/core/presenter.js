// Presenter: present your slides full screen with your camera bubble, draw on them, and record.
// Everything drawn into the 1920×1080 frame (slide, drawings, camera) is what gets recorded;
// the controls and the teleprompter sit on top and are never in the video.

import { newRecording, putRecording, deleteRecording, requestPersistence } from './db.js';
import { SegmentRecorder } from './recorder.js';
import { mountPrompter } from './prompter.js';
import { ic } from './icons.js';
import { fmtClock } from './format.js';
import { loadImage } from './media.js';
import { COLORS } from './callouts.js';
import { drawInk, inkAlpha, inkTextColor, INK_TOOLS, INK_SIZES, INK_FADES } from './ink.js';

const W = 1920, H = 1080, K = 1.6; // drawings are scaled up for the 1920-pixel frame
const CORNERS = ['br', 'bl', 'tr', 'tl'];

const CSS = `
.pz{position:fixed;inset:0;z-index:100;background:#07080b;color:#fff;font-family:Inter,system-ui,sans-serif;overflow:hidden;user-select:none}
.pz-stage{position:absolute;inset:0}
.pz-stage canvas{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
.pz.drawing .pz-stage canvas{cursor:crosshair}
.pz-dockwrap{position:absolute;left:50%;bottom:18px;transform:translateX(-50%);display:flex;flex-direction:column;align-items:center;gap:8px;max-width:calc(100vw - 24px)}
.pz-dock,.pz-tools,.pz-ask{background:rgba(17,19,24,.94);backdrop-filter:blur(8px);border-radius:18px;box-shadow:0 10px 36px rgba(0,0,0,.45),inset 0 0 0 1px rgba(255,255,255,.08)}
.pz-dock{display:flex;align-items:center;gap:6px;padding:8px}
.pz-tools{display:flex;align-items:center;gap:10px;padding:8px 10px;flex-wrap:wrap;justify-content:center}
.pz-ask{display:flex;align-items:center;gap:10px;padding:10px 12px;font-size:13.5px}
.pz-ask label{font-size:12.5px;color:rgba(255,255,255,.75);display:flex;gap:6px;align-items:center}
.pz .ib{width:40px;height:40px;border-radius:12px;border:0;background:transparent;color:#fff;display:grid;place-items:center;cursor:pointer;flex:none}
.pz .ib:hover{background:rgba(255,255,255,.12)}
.pz .ib.on{background:#fff;color:#111318}
.pz .ib:disabled{opacity:.35;cursor:default}
.pz .sep{width:1px;height:26px;background:rgba(255,255,255,.14);margin:0 3px}
.pz .num{font:600 13px Inter,system-ui,sans-serif;color:rgba(255,255,255,.75);min-width:58px;text-align:center;font-variant-numeric:tabular-nums}
.pz .clock{font:650 16px Inter,system-ui,sans-serif;font-variant-numeric:tabular-nums;min-width:50px;padding-left:4px}
.pz .dot{width:10px;height:10px;border-radius:50%;flex:none;margin-left:8px}
.pz .pulse{animation:pzp 1.4s ease-in-out infinite}@keyframes pzp{50%{opacity:.35}}
.pz .go{height:40px;border-radius:12px;border:0;background:#f0464b;color:#fff;font:650 14px Inter,system-ui,sans-serif;padding:0 16px;display:flex;align-items:center;gap:8px;cursor:pointer;flex:none}
.pz .go:hover{filter:brightness(1.08)}
.pz .ghost{height:36px;border-radius:10px;border:0;background:rgba(255,255,255,.1);color:#fff;font:600 13px Inter,system-ui,sans-serif;padding:0 14px;cursor:pointer;display:inline-flex;align-items:center;gap:6px}
.pz .sw{width:22px;height:22px;border-radius:50%;border:0;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(255,255,255,.25);flex:none}
.pz .sw.on{box-shadow:0 0 0 2px #111318,0 0 0 4px #fff}
.pz .seg2{display:flex;background:rgba(255,255,255,.08);border-radius:9px;padding:2px}
.pz .seg2 button{border:0;background:transparent;color:rgba(255,255,255,.75);font:600 12px Inter,system-ui,sans-serif;padding:5px 9px;border-radius:7px;cursor:pointer}
.pz .seg2 button.on{background:#fff;color:#111318}
.pz .lbl{font-size:11px;color:rgba(255,255,255,.5);text-transform:uppercase;letter-spacing:.06em}
.pz-count{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:200px;height:200px;border-radius:50%;background:rgba(17,19,24,.85);display:grid;place-items:center;font:700 96px Inter,system-ui,sans-serif}
.pz-pr{position:absolute;top:14px;left:50%;transform:translateX(-50%);width:min(780px,60vw);height:230px;display:flex;flex-direction:column;border-radius:16px;overflow:hidden;box-shadow:0 10px 36px rgba(0,0,0,.45);background:#111318}
.pz-pr.min{height:34px}
.pz-pr-bar{height:22px;flex:none;display:flex;align-items:center;justify-content:center;gap:8px;cursor:grab;background:#1b1e24;font-size:10.5px;color:rgba(255,255,255,.45);text-transform:uppercase;letter-spacing:.08em}
.pz-pr-bar button{border:0;background:transparent;color:rgba(255,255,255,.6);font:600 10.5px Inter,system-ui,sans-serif;cursor:pointer;text-transform:uppercase;letter-spacing:.06em}
.pz-pr-body{flex:1;min-height:0}
.pz-pr.min .pz-pr-body{display:none}
.pz-text{position:absolute;border:0;outline:0;font:650 18px Inter,system-ui,sans-serif;padding:8px 11px;border-radius:9px;min-width:220px;box-shadow:0 4px 18px rgba(0,0,0,.35)}
.pz-hint{position:absolute;top:14px;right:14px;font-size:12px;color:rgba(255,255,255,.55);background:rgba(17,19,24,.7);padding:6px 10px;border-radius:999px}
.pz-err{position:absolute;inset:0;display:grid;place-items:center;text-align:center;padding:40px}
.pz-err div{max-width:460px;background:#171a20;border-radius:18px;padding:24px}`;

export async function openPresenter(root, { mic = true, micId = '', cam = true, camId = '', deck = [], countdown = true, script = null, tickerURL, onFinish, onClose }) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  if (!doc.getElementById('pz-style')) {
    const s = doc.createElement('style');
    s.id = 'pz-style';
    s.textContent = CSS;
    doc.head.append(s);
  }
  const dev = (id) => (id && id !== 'default' ? { exact: id } : undefined);

  let view = 'ready', error = '', countdownLeft = 0, retakeCountdown = true;
  let slide = 0, drawing = false, corner = 0, shapes = [], current = null, textInput = null;
  const steps = new Map(); // next step number per slide
  const marks = []; // where each recorded part began: { slide, t }
  const ink = { tool: 'pen', color: COLORS[0], size: 'M', fade: 0 };
  let micStream = null, faceStream = null, recorder = null, recordingId = null, timer = 0, prompter = null;

  try {
    if (cam) faceStream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: dev(camId), width: { ideal: 640 }, height: { ideal: 480 } } });
    if (mic) micStream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: dev(micId), echoCancellation: true, noiseSuppression: true } });
  } catch {
    error = 'The camera or microphone is blocked. Allow them from the icon in the address bar, then try again.';
    view = 'error';
  }

  // ---------- the frame ----------
  const canvas = doc.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  const face = doc.createElement('video');
  face.muted = true;
  face.playsInline = true;
  if (faceStream) {
    face.srcObject = faceStream;
    face.play().catch(() => {});
  }
  const ac = new AudioContext();
  const audioDest = ac.createMediaStreamDestination();
  if (micStream) ac.createMediaStreamSource(micStream).connect(audioDest);
  const videos = new Map(), images = new Map();
  for (const sl of deck) {
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
  }
  const fit = (w, h) => {
    const k = Math.min(W / w, H / h);
    return [(W - w * k) / 2, (H - h * k) / 2, w * k, h * k];
  };
  function draw() {
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
    const now = performance.now();
    shapes = shapes.filter((s) => inkAlpha(s, now) > 0);
    for (const s of shapes) {
      if (s.slide !== slide) continue;
      ctx.globalAlpha = inkAlpha(s, now);
      drawInk(ctx, s, K);
    }
    ctx.globalAlpha = 1;
    if (current) drawInk(ctx, current, K);
    if (faceStream && face.videoWidth) {
      const d = Math.round(H * 0.26), m = 44;
      const c = CORNERS[corner];
      const x = c.endsWith('r') ? W - d - m : m, y = c.startsWith('b') ? H - d - m : m;
      const sq = Math.min(face.videoWidth, face.videoHeight);
      ctx.save();
      ctx.beginPath();
      ctx.arc(x + d / 2, y + d / 2, d / 2 + 6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.shadowColor = 'rgba(0,0,0,.35)';
      ctx.shadowBlur = 24;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.beginPath();
      ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
      ctx.clip();
      ctx.translate(x + d, y);
      ctx.scale(-1, 1);
      ctx.drawImage(face, (face.videoWidth - sq) / 2, (face.videoHeight - sq) / 2, sq, sq, 0, 0, d, d);
      ctx.restore();
    }
  }
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

  // ---------- layout ----------
  const oldOverflow = doc.documentElement.style.overflow;
  doc.documentElement.style.overflow = 'hidden';
  root.innerHTML = '';
  const shell = doc.createElement('div');
  shell.className = 'pz';
  shell.innerHTML = `<div class="pz-stage" id="pzStage"></div>
    ${script ? '<div class="pz-pr" id="pzPr"><div class="pz-pr-bar" id="pzPrBar">Script · drag to move <button id="pzPrMin">Hide</button></div><div class="pz-pr-body" id="pzPrBody"></div></div>' : ''}
    <div class="pz-count" id="pzCount" hidden></div>
    <div class="pz-hint" id="pzHint"></div>
    <div class="pz-dockwrap" id="pzWrap"></div>`;
  root.append(shell);
  shell.querySelector('#pzStage').append(canvas);
  const $ = (id) => shell.querySelector(`#${id}`);
  if (script) {
    prompter = mountPrompter($('pzPrBody'), { ...script, size: 22 });
    const pr = $('pzPr');
    $('pzPrMin').onclick = (e) => {
      e.stopPropagation();
      pr.classList.toggle('min');
      $('pzPrMin').textContent = pr.classList.contains('min') ? 'Show' : 'Hide';
    };
    let drag = null;
    $('pzPrBar').addEventListener('pointerdown', (e) => {
      const r = pr.getBoundingClientRect();
      drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
      $('pzPrBar').setPointerCapture(e.pointerId);
    });
    $('pzPrBar').addEventListener('pointermove', (e) => {
      if (!drag) return;
      Object.assign(pr.style, { left: `${e.clientX - drag.dx}px`, top: `${e.clientY - drag.dy}px`, transform: 'none' });
    });
    $('pzPrBar').addEventListener('pointerup', () => (drag = null));
  }
  if (error) {
    $('pzWrap').innerHTML = '';
    shell.insertAdjacentHTML('beforeend', `<div class="pz-err"><div><p style="margin:0 0 16px;line-height:1.5">${error}</p><button class="ghost" data-a="close">Back</button></div></div>`);
  }

  const elapsed = () => recorder?.elapsed() || 0;
  const paused = () => view === 'paused' || view === 'retake';
  const key = (k) => (/Mac/.test(navigator.platform) ? `⌥⇧${k}` : `Alt+Shift+${k}`);

  function dock() {
    const nav = `<button class="ib" data-a="prev" title="Previous slide (←)">${ic('chev', 18).replace('<svg', '<svg style="transform:rotate(90deg)"')}</button>
      <span class="num">${slide + 1} / ${deck.length}</span>
      <button class="ib" data-a="next" title="Next slide (→ or a clicker)">${ic('chev', 18).replace('<svg', '<svg style="transform:rotate(-90deg)"')}</button>`;
    const tools = `<span class="sep"></span>
      <button class="ib ${drawing ? 'on' : ''}" data-a="draw" title="Draw on the slide (D)">${ic('pen', 18)}</button>
      ${faceStream ? `<button class="ib" data-a="corner" title="Move your camera to another corner">${ic('cam', 18)}</button>` : ''}
      <button class="ib" data-a="full" title="Full screen">${ic('expand', 17)}</button>`;
    if (view === 'error') return '';
    if (view === 'ready')
      return `<div class="pz-dock">${nav}${tools}<span class="sep"></span><button class="ghost" data-a="close">Exit</button><button class="go" data-a="start"><span style="width:11px;height:11px;border-radius:50%;background:#fff"></span>Start recording</button></div>`;
    if (view === 'countdown') return `<div class="pz-dock">${nav}<span class="sep"></span><button class="ghost" data-a="discard">Cancel</button></div>`;
    if (view === 'saving') return `<div class="pz-dock"><span class="num" style="min-width:auto;padding:0 12px">Saving your recording…</span></div>`;
    const ask =
      view === 'retake'
        ? `<div class="pz-ask"><b>Retake the last part?</b><label><input type="checkbox" id="pzCd" ${retakeCountdown ? 'checked' : ''}/> 3-second countdown</label><button class="ghost" data-a="keep">Keep it</button><button class="go" data-a="retake-yes">${ic('retake', 15)} Retake</button></div>`
        : '';
    return `${ask}<div class="pz-dock">
      <span class="dot ${paused() ? '' : 'pulse'}" style="background:${paused() ? '#f79009' : '#f0464b'}"></span><span class="clock" id="pzClock">${fmtClock(elapsed())}</span>
      <button class="ib" data-a="pause" title="${paused() ? 'Resume' : 'Pause'} (${key('K')})">${ic(paused() ? 'play' : 'pause', 18)}</button>
      <button class="ib" data-a="retake" title="Retake the last part (${key('U')})" ${recorder?.segments.length || recorder?.recording ? '' : 'disabled'}>${ic('retake', 18)}</button>
      <span class="sep"></span>${nav}${tools}<span class="sep"></span>
      <button class="ib" data-a="discard" title="Discard">${ic('trash', 17)}</button>
      <button class="go" data-a="finish" title="Finish (${key('S')})">${ic('check', 15)} Finish</button></div>`;
  }
  function toolsRow() {
    if (!drawing) return '';
    return `<div class="pz-tools">
      ${INK_TOOLS.map(([t, n]) => `<button class="ib ${ink.tool === t ? 'on' : ''}" data-tool="${t}" title="${n}">${ic(t, 18)}</button>`).join('')}
      <span class="sep"></span>${COLORS.map((c) => `<button class="sw ${ink.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" title="Colour"></button>`).join('')}
      <span class="sep"></span><span class="lbl">Size</span><div class="seg2">${Object.keys(INK_SIZES).map((s) => `<button class="${ink.size === s ? 'on' : ''}" data-size="${s}">${s}</button>`).join('')}</div>
      <span class="lbl">Fade</span><div class="seg2">${INK_FADES.map(([v, l]) => `<button class="${ink.fade === v ? 'on' : ''}" data-fade="${v}">${l}</button>`).join('')}</div>
      <button class="ghost" data-a="undo">${ic('undo', 14)} Undo</button><button class="ghost" data-a="clear">Clear</button></div>`;
  }
  function render() {
    shell.classList.toggle('drawing', drawing);
    $('pzWrap').innerHTML = toolsRow() + dock();
    $('pzCount').hidden = view !== 'countdown';
    $('pzCount').textContent = countdownLeft;
    $('pzHint').textContent = drawing ? 'Drawing: click and drag on the slide · Esc to stop' : view === 'ready' ? 'Arrow keys or a clicker change slides · D to draw' : '';
    $('pzHint').hidden = !$('pzHint').textContent;
    const cb = $('pzCd');
    if (cb) cb.onchange = (e) => (retakeCountdown = e.target.checked);
  }

  // ---------- slides ----------
  function goTo(i) {
    if (!deck.length) return;
    commitText();
    const next = Math.max(0, Math.min(deck.length - 1, i));
    const old = deck[slide];
    if (old?.kind === 'video') videos.get(old.url)?.pause();
    slide = next;
    const now = deck[slide];
    if (now?.kind === 'video') {
      const v = videos.get(now.url);
      ac.resume();
      v.currentTime = 0;
      v.play().catch(() => {});
    }
    const n = shell.querySelector('.num');
    if (n) n.textContent = `${slide + 1} / ${deck.length}`;
  }

  // ---------- drawing ----------
  function toFrame(e) {
    const r = canvas.getBoundingClientRect();
    const k = Math.min(r.width / W, r.height / H);
    const ox = r.left + (r.width - W * k) / 2, oy = r.top + (r.height - H * k) / 2;
    return { x: (e.clientX - ox) / k, y: (e.clientY - oy) / k, k, ox, oy };
  }
  function commitText() {
    if (!textInput) return;
    const value = textInput.value.trim();
    if (value) shapes.push({ tool: 'text', color: ink.color, w: INK_SIZES[ink.size], a: textInput._at, text: value, slide, born: performance.now(), fade: ink.fade });
    textInput.remove();
    textInput = null;
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    const p = toFrame(e);
    const w = INK_SIZES[ink.size];
    if (ink.tool === 'text') {
      commitText();
      textInput = doc.createElement('input');
      textInput.className = 'pz-text';
      textInput.placeholder = 'Type, then press Enter';
      Object.assign(textInput.style, { left: `${e.clientX}px`, top: `${e.clientY}px`, background: ink.color, color: inkTextColor(ink.color), fontSize: `${18 * K * p.k}px` });
      textInput._at = { x: p.x, y: p.y };
      textInput.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') commitText();
        if (ev.key === 'Escape') (textInput.remove(), (textInput = null));
      });
      shell.append(textInput);
      setTimeout(() => textInput?.focus(), 0);
      return;
    }
    if (ink.tool === 'step') {
      const n = steps.get(slide) || 1;
      steps.set(slide, n + 1);
      shapes.push({ tool: 'step', color: ink.color, w, a: p, n, slide, born: performance.now(), fade: ink.fade });
      return;
    }
    canvas.setPointerCapture(e.pointerId);
    current = ink.tool === 'pen' || ink.tool === 'hl' ? { tool: ink.tool, color: ink.color, w, pts: [p], slide } : { tool: ink.tool, color: ink.color, w, a: p, b: p, slide };
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!current) return;
    const p = toFrame(e);
    if (current.pts) current.pts.push({ x: p.x, y: p.y });
    else current.b = { x: p.x, y: p.y };
  });
  canvas.addEventListener('pointerup', () => {
    if (!current) return;
    shapes.push({ ...current, born: performance.now(), fade: ink.fade });
    current = null;
  });

  // ---------- recording ----------
  async function countdownThen(on, fn) {
    if (on) {
      view = 'countdown';
      for (countdownLeft = 3; countdownLeft > 0; countdownLeft--) {
        render();
        await new Promise((r) => setTimeout(r, 1000));
        if (view !== 'countdown') return;
      }
    }
    marks.push({ slide, t: performance.now() });
    await fn();
    view = 'recording';
    prompter?.setRecording(true);
    render();
  }
  async function start() {
    ac.resume();
    const hasAudio = !!micStream || deck.some((d) => d.kind === 'video');
    const tracks = [...stream.getVideoTracks(), ...(hasAudio ? audioDest.stream.getAudioTracks() : [])];
    const rec = newRecording({ source: 'slides', width: W, height: H, hasAudio });
    recordingId = rec.id;
    recorder = new SegmentRecorder({ stream: new MediaStream(tracks), recordingId });
    rec.mimeType = recorder.mimeType;
    await putRecording(rec);
    requestPersistence();
    timer = setInterval(() => {
      const c = $('pzClock');
      if (c) c.textContent = fmtClock(elapsed());
    }, 250);
    await countdownThen(countdown, () => recorder.begin());
  }
  async function pauseToggle() {
    if (view === 'recording') {
      view = 'paused';
      prompter?.setRecording(false);
      render();
      await recorder.endSegment();
    } else if (view === 'paused') {
      marks.push({ slide, t: performance.now() });
      await recorder.begin();
      view = 'recording';
      prompter?.setRecording(true);
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
  async function retakeYes() {
    await recorder.discardLast();
    prompter?.rewind();
    const m = marks.pop();
    if (m) {
      shapes = shapes.filter((s) => s.born < m.t); // drawings from the discarded part go too
      goTo(m.slide);
    }
    await countdownThen(retakeCountdown, () => recorder.begin({ retake: true }));
  }
  function teardown() {
    clearInterval(timer);
    ticker.postMessage({ stop: true });
    ticker.terminate();
    stream.getTracks().forEach((t) => t.stop());
    videos.forEach((v) => v.pause());
    for (const s of [faceStream, micStream]) s?.getTracks().forEach((t) => t.stop());
    ac.close();
    prompter?.destroy();
    doc.removeEventListener('keydown', onKey, true);
    win.removeEventListener('beforeunload', guard);
    if (doc.fullscreenElement) doc.exitFullscreen().catch(() => {});
    doc.documentElement.style.overflow = oldOverflow;
    root.innerHTML = '';
  }
  async function finish() {
    if (!recorder || view === 'saving') return;
    prompter?.setRecording(false);
    view = 'saving';
    render();
    const count = await recorder.finish();
    teardown();
    if (count) onFinish?.(recordingId);
    else {
      await deleteRecording(recordingId);
      onClose?.();
    }
  }
  async function discard() {
    const started = recorder && (recorder.segments.length || recorder.recording);
    if (started && !win.confirm('Discard this recording? It can’t be recovered.')) return;
    if (recorder) {
      await recorder.abort();
      await deleteRecording(recordingId);
    }
    teardown();
    onClose?.();
  }
  function setDrawing(on) {
    if (!on) commitText();
    drawing = on;
    render();
  }

  const actions = {
    start,
    close: () => (teardown(), onClose?.()),
    prev: () => goTo(slide - 1),
    next: () => goTo(slide + 1),
    draw: () => setDrawing(!drawing),
    corner: () => (corner = (corner + 1) % CORNERS.length),
    full: () => (doc.fullscreenElement ? doc.exitFullscreen() : doc.documentElement.requestFullscreen()).catch(() => {}),
    pause: pauseToggle,
    retake: askRetake,
    keep: () => ((view = 'paused'), render()),
    'retake-yes': retakeYes,
    finish,
    discard,
    undo: () => {
      for (let i = shapes.length - 1; i >= 0; i--) if (shapes[i].slide === slide) return void shapes.splice(i, 1);
    },
    clear: () => ((shapes = shapes.filter((s) => s.slide !== slide)), steps.delete(slide)),
  };
  shell.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tool],[data-color],[data-size],[data-fade]');
    if (t) {
      if (t.dataset.tool) ink.tool = t.dataset.tool;
      if (t.dataset.color) ink.color = t.dataset.color;
      if (t.dataset.size) ink.size = t.dataset.size;
      if (t.dataset.fade) ink.fade = Number(t.dataset.fade);
      return render();
    }
    const b = e.target.closest('[data-a]');
    if (b && !b.disabled) actions[b.dataset.a]?.();
  });
  function onKey(e) {
    if (e.target.closest?.('input,textarea,select')) return;
    if (e.altKey && e.shiftKey) {
      if (e.code === 'KeyK') (e.preventDefault(), pauseToggle());
      if (e.code === 'KeyU') (e.preventDefault(), askRetake());
      if (e.code === 'KeyS') (e.preventDefault(), finish());
      return;
    }
    if (['ArrowRight', 'PageDown', 'ArrowDown'].includes(e.key)) return e.preventDefault(), goTo(slide + 1);
    if (['ArrowLeft', 'PageUp', 'ArrowUp'].includes(e.key)) return e.preventDefault(), goTo(slide - 1);
    if (e.key === 'd' || e.key === 'D') return setDrawing(!drawing);
    if (e.key === 'Escape' && drawing) return setDrawing(false);
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') return actions.undo();
  }
  function guard(e) {
    if (recorder && view !== 'saving') e.preventDefault();
  }
  doc.addEventListener('keydown', onKey, true);
  win.addEventListener('beforeunload', guard);
  render();
  goTo(0);
}
