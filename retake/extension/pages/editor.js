import { getRecording, updateRecording, getSegmentBlob } from '../core/db.js';
import { ic, LOGO } from '../core/icons.js';
import { fmtTime, fmtTimePrecise, fmtBytes, fmtWhen, slugify, escapeHtml } from '../core/format.js';
import { totalDuration, segmentStarts, trimRange, locate, clamp, measureDuration } from '../core/timeline.js';
import { drawFrame, viewAt, createCallout, calloutBounds, fromCanvas, toCanvas, COLORS, TYPE_LABEL, isActive } from '../core/callouts.js';
import { exportRecording, composeFrame, estimateBytes, pickMime, GIF_MAX_SECONDS } from '../core/exporter.js';
import { saveFile } from '../core/save.js';

const $ = (s) => document.querySelector(s);
const IS_EXTENSION = !!globalThis.chrome?.runtime?.id;
const id = decodeURIComponent(location.hash.slice(1));
const video = $('#video');
const canvas = $('#preview');
const ctx = canvas.getContext('2d');
const FULL = { x: 0, y: 0, w: 1, h: 1 };
const LABEL_W = 114;

let rec = null;
const urls = new Map();
let t = 0;
let playing = false;
let loadedSeg = null;
let selectedId = null;
let history = [];
let future = [];
let saveTimer = 0;
let cssW = 0, cssH = 0;
let seekToken = 0;
let switching = false;
let peaks = null; // per 1/50 s
const PEAK_RATE = 50;

// ---------- static chrome ----------
$('#logo').innerHTML = LOGO(30);
$('#undo').innerHTML = ic('undo', 20);
$('#redo').innerHTML = ic('redo', 20);
$('#lib').innerHTML = `${ic('folder', 17)}My recordings`;
$('#export').innerHTML = `${ic('download', 17, 2.2)}Export`;
$('#toStart').innerHTML = ic('retake', 18);
$('#addrow').innerHTML =
  `<span class="tlabel" style="margin-right:6px">Add</span>` +
  [['arrow', 'Arrow'], ['box', 'Box'], ['step', 'Step'], ['text', 'Text'], ['zoom', 'Zoom'], ['blur', 'Blur']]
    .map(([k, l]) => `<button class="chip" data-add="${k}">${ic(k === 'box' ? 'rect' : k, 16)}${l}</button>`)
    .join('') +
  `<div class="right"><button class="chip" id="resetTrim" hidden>${ic('trim', 16)}Reset trim</button><span class="muted" style="font-size:12px">Drag the yellow handles to trim</span></div>`;

const total = () => totalDuration(rec.segments);
const selected = () => rec?.callouts.find((c) => c.id === selectedId) || null;
const segIndexById = (sid) => rec.segments.findIndex((s) => s.id === sid);

async function segURL(seg) {
  if (urls.has(seg.id)) return urls.get(seg.id);
  const blob = await getSegmentBlob(seg.id, rec.mimeType || 'video/webm');
  const u = URL.createObjectURL(blob);
  urls.set(seg.id, u);
  return u;
}

const waitFor = (el, ev, ms = 4000) =>
  new Promise((res) => {
    const done = () => {
      clearTimeout(timer);
      el.removeEventListener(ev, done);
      res();
    };
    const timer = setTimeout(done, ms);
    el.addEventListener(ev, done, { once: true });
  });

// ---------- load ----------
async function load() {
  rec = await getRecording(id);
  if (!rec) return fatal('This recording could not be found. It may have been deleted.');
  if (rec.status === 'recording' && IS_EXTENSION) {
    const res = await chrome.runtime.sendMessage({ type: 'get-state' }).catch(() => null);
    if (res?.state?.recordingId === id && res.state.status !== 'idle') return fatal('This recording is still in progress. Finish it first, then open it here.');
  }
  for (const s of rec.segments) {
    if (!s.duration || s.open) {
      s.duration = await measureDuration(await segURL(s));
      s.open = false;
    }
  }
  rec.segments = rec.segments.filter((s) => s.duration > 0.05);
  rec.callouts ||= [];
  rec.trim ||= { start: 0, end: null };
  if (!rec.segments.length) return fatal('This recording has no footage. It may have been stopped before it started.');
  await updateRecording(id, { segments: rec.segments, status: 'ready' });
  $('#title').value = rec.title;
  document.title = `${rec.title} · Retake`;
  history = [];
  future = [];
  layout();
  await seek(trimRange(rec).start);
  $('#loading').remove();
  renderInspector();
  renderTimeline();
  setSaved(true);
  buildFilmstrip();
  buildWaveform();
}

function fatal(msg) {
  $('#loading').textContent = msg;
  $('#export').disabled = true;
}

// ---------- persistence and history ----------
const snapshot = () => JSON.stringify({ callouts: rec.callouts, trim: rec.trim, title: rec.title });

function checkpoint() {
  history.push(snapshot());
  if (history.length > 200) history.shift();
  future = [];
  updateHistoryButtons();
}

function restore(snap) {
  const s = JSON.parse(snap);
  rec.callouts = s.callouts;
  rec.trim = s.trim;
  rec.title = s.title;
  $('#title').value = rec.title;
  if (!selected()) selectedId = null;
  changed();
}

function undo() {
  if (!history.length) return;
  future.push(snapshot());
  restore(history.pop());
}

function redo() {
  if (!future.length) return;
  history.push(snapshot());
  restore(future.pop());
}

function updateHistoryButtons() {
  $('#undo').disabled = !history.length;
  $('#redo').disabled = !future.length;
}

function setSaved(ok) {
  const el = $('#saved');
  el.classList.toggle('busy', !ok);
  el.innerHTML = ok ? `${ic('lock', 13)}Saved on this device` : 'Saving…';
}

function changed() {
  setSaved(false);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await updateRecording(id, { callouts: rec.callouts, trim: rec.trim, title: rec.title });
    setSaved(true);
  }, 400);
  updateHistoryButtons();
  renderInspector();
  renderTimeline();
  draw();
}

// ---------- preview ----------
function layout() {
  const wrap = $('#canvasWrap');
  const W = wrap.clientWidth, H = wrap.clientHeight;
  const ar = (rec?.width || 16) / (rec?.height || 9);
  cssW = Math.floor(Math.min(W, H * ar));
  cssH = Math.floor(cssW / ar);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

const dest = () => ({ x: 0, y: 0, w: cssW, h: cssH });
const currentView = () => (selected()?.type === 'zoom' ? FULL : viewAt(rec.callouts, t));

function draw() {
  if (!rec || video.readyState < 2) return;
  ctx.clearRect(0, 0, cssW, cssH);
  const view = currentView();
  drawFrame(ctx, video, video.videoWidth, video.videoHeight, dest(), rec.callouts, t, { view });
  const c = selected();
  if (c && !playing) drawSelection(c, view);
}

function drawSelection(c, view) {
  const b = calloutBounds(c, view, dest());
  ctx.save();
  ctx.strokeStyle = c.type === 'zoom' ? '#1E9E6A' : '#2F54EB';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 4]);
  if (c.type === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(b.a.x, b.a.y);
    ctx.lineTo(b.b.x, b.b.y);
    ctx.stroke();
  } else {
    ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);
  }
  ctx.setLineDash([]);
  if (c.type === 'zoom') {
    ctx.fillStyle = 'rgba(30,158,106,.08)';
    ctx.fillRect(b.x, b.y, b.w, b.h);
    ctx.fillStyle = '#1E9E6A';
    ctx.font = '600 12px Inter, system-ui';
    ctx.fillText('Zoom area', b.x + 6, b.y + 16);
  }
  if (!isActive(c, t) && c.type !== 'zoom') {
    ctx.fillStyle = '#2F54EB';
    ctx.font = '600 11px Inter, system-ui';
    ctx.fillText('Not showing at this moment', b.x - 4, b.y - 10);
  }
  for (const h of handles(c, view)) {
    ctx.fillStyle = '#fff';
    ctx.strokeStyle = ctx.strokeStyle;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(h.x - 5, h.y - 5, 10, 10);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function handles(c, view) {
  const b = calloutBounds(c, view, dest());
  if (c.type === 'arrow') return [{ ...b.a, kind: 'p1' }, { ...b.b, kind: 'p2' }];
  if (['box', 'blur', 'zoom'].includes(c.type)) return [{ x: b.x, y: b.y, kind: 'tl' }, { x: b.x + b.w, y: b.y + b.h, kind: 'br' }];
  return [];
}

function distToSegment(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy || 1;
  const u = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len, 0, 1);
  return Math.hypot(p.x - (a.x + u * dx), p.y - (a.y + u * dy));
}

function hit(c, p, view) {
  const b = calloutBounds(c, view, dest());
  if (c.type === 'arrow') return distToSegment(p, b.a, b.b) < 12;
  return p.x >= b.x - 6 && p.x <= b.x + b.w + 6 && p.y >= b.y - 6 && p.y <= b.y + b.h + 6;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!rec) return;
  if (playing) pause();
  const r = canvas.getBoundingClientRect();
  const p = { x: e.clientX - r.left, y: e.clientY - r.top };
  const view = currentView();
  let c = selected();
  let mode = null;
  if (c) {
    const h = handles(c, view).find((h) => Math.hypot(h.x - p.x, h.y - p.y) < 10);
    if (h) mode = h.kind;
    else if (hit(c, p, view)) mode = 'move';
  }
  if (!mode) {
    const visible = rec.callouts.filter((x) => isActive(x, t) && x.type !== 'zoom');
    const found = [...visible].reverse().find((x) => hit(x, p, view));
    if (found) {
      selectedId = found.id;
      c = found;
      mode = 'move';
    } else {
      selectedId = null;
      renderInspector();
      renderTimeline();
      return draw();
    }
  }
  canvas.setPointerCapture(e.pointerId);
  checkpoint();
  drag = { mode, start: fromCanvas(p.x, p.y, view, dest()), orig: JSON.parse(JSON.stringify(c)), view };
  renderInspector();
  renderTimeline();
  draw();
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const c = selected();
  if (!c) return;
  const r = canvas.getBoundingClientRect();
  const n = fromCanvas(e.clientX - r.left, e.clientY - r.top, drag.view, dest());
  const dx = n.x - drag.start.x, dy = n.y - drag.start.y;
  const o = drag.orig;
  const cl = (v) => clamp(v, 0, 1);
  if (drag.mode === 'move') {
    if (c.type === 'arrow') Object.assign(c, { x1: cl(o.x1 + dx), y1: cl(o.y1 + dy), x2: cl(o.x2 + dx), y2: cl(o.y2 + dy) });
    else {
      c.x = clamp(o.x + dx, 0, 1 - (o.w || 0));
      c.y = clamp(o.y + dy, 0, 1 - (o.h || 0));
    }
  } else if (drag.mode === 'p1') Object.assign(c, { x1: cl(n.x), y1: cl(n.y) });
  else if (drag.mode === 'p2') Object.assign(c, { x2: cl(n.x), y2: cl(n.y) });
  else if (drag.mode === 'br') {
    c.w = clamp(n.x - o.x, 0.02, 1 - o.x);
    c.h = clamp(n.y - o.y, 0.02, 1 - o.y);
  } else if (drag.mode === 'tl') {
    const x2 = o.x + o.w, y2 = o.y + o.h;
    c.x = clamp(n.x, 0, x2 - 0.02);
    c.y = clamp(n.y, 0, y2 - 0.02);
    c.w = x2 - c.x;
    c.h = y2 - c.y;
  }
  draw();
});

canvas.addEventListener('pointerup', () => {
  if (!drag) return;
  drag = null;
  changed();
});

// ---------- playback ----------
async function loadSegment(seg) {
  if (loadedSeg === seg.id) return;
  loadedSeg = seg.id;
  video.src = await segURL(seg);
  await waitFor(video, 'loadeddata');
}

async function seek(gt) {
  const token = ++seekToken;
  t = clamp(gt, 0, total());
  const { index, local } = locate(rec.segments, t);
  await loadSegment(rec.segments[index]);
  if (token !== seekToken) return;
  if (Math.abs(video.currentTime - local) > 0.02) {
    video.currentTime = local;
    await waitFor(video, 'seeked', 3000);
  }
  if (token !== seekToken) return;
  draw();
  updateClock();
}

async function play() {
  if (!rec) return;
  const { start, end } = trimRange(rec);
  if (t < start || t >= end - 0.05) await seek(start);
  playing = true;
  renderPlay();
  draw();
  try {
    await video.play();
  } catch {
    playing = false;
    renderPlay();
    return;
  }
  requestAnimationFrame(tick);
}

function pause() {
  playing = false;
  video.pause();
  renderPlay();
  draw();
}

function tick() {
  if (!playing) return;
  const i = segIndexById(loadedSeg);
  const starts = segmentStarts(rec.segments);
  if (!switching && i >= 0) t = starts[i] + video.currentTime;
  const { end } = trimRange(rec);
  if (t >= end - 0.01) {
    pause();
    t = end;
    updateClock();
    return;
  }
  const seg = rec.segments[i];
  if (!switching && seg && (video.ended || video.currentTime >= seg.duration - 0.04) && i < rec.segments.length - 1) {
    switching = true;
    const next = rec.segments[i + 1];
    loadSegment(next).then(async () => {
      video.currentTime = 0;
      t = starts[i + 1];
      switching = false;
      if (playing) await video.play().catch(() => {});
    });
  } else if (!switching && video.ended && i === rec.segments.length - 1) {
    pause();
    return;
  }
  draw();
  updateClock();
  requestAnimationFrame(tick);
}

function renderPlay() {
  $('#play').innerHTML = ic(playing ? 'pause' : 'play', 20);
  $('#play').setAttribute('aria-label', playing ? 'Pause' : 'Play');
}

function updateClock() {
  $('#now').textContent = fmtTimePrecise(t);
  $('#dur').textContent = ` / ${fmtTime(total())}`;
  placePlayhead();
}

$('#play').onclick = () => (playing ? pause() : play());
$('#toStart').onclick = () => {
  pause();
  seek(trimRange(rec).start);
};

// ---------- timeline ----------
const tracksEl = $('#tracks');
const trackW = () => tracksEl.clientWidth - LABEL_W;
const pps = () => trackW() / Math.max(0.1, total());
const xAt = (time) => LABEL_W + time * pps();
const timeAt = (clientX) => clamp((clientX - tracksEl.getBoundingClientRect().left - LABEL_W) / pps(), 0, total());

function lanes() {
  const sorted = [...rec.callouts].sort((a, b) => a.start - b.start);
  const ends = [];
  const lane = new Map();
  for (const c of sorted) {
    let l = ends.findIndex((e) => e <= c.start + 0.01);
    if (l === -1) {
      l = ends.length;
      ends.push(0);
    }
    ends[l] = c.end;
    lane.set(c.id, l);
  }
  return { lane, count: Math.max(1, ends.length) };
}

function renderTimeline() {
  if (!rec) return;
  const T = total();
  const p = pps();
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  const step = steps.find((s) => s * p >= 70) || 600;
  let ticks = '';
  for (let s = 0; s <= T + 0.001; s += step) ticks += `<span class="tick" style="left:${s * p}px">${fmtTime(s)}</span>`;
  $('#ruler').innerHTML = ticks;

  const starts = segmentStarts(rec.segments);
  $('#videoTrack').innerHTML = rec.segments
    .map((s, i) => {
      const thumb = s._thumb ? `background-image:url(${s._thumb})` : '';
      return `<div class="vseg" style="left:${starts[i] * p}px;width:${Math.max(2, s.duration * p - 3)}px;${thumb}">
        ${s.retake ? '<span class="tag">RETAKE</span>' : ''}${rec.segments.length > 1 && s.duration * p > 50 ? `<span class="part">Part ${i + 1}</span>` : ''}</div>`;
    })
    .join('');

  const { lane, count } = lanes();
  const callTop = 96;
  const laneH = 36;
  const ct = $('#calloutTrack');
  ct.style.top = `${callTop}px`;
  ct.style.height = `${count * laneH}px`;
  $('#calloutLabel').style.top = `${callTop + 8}px`;
  ct.innerHTML = rec.callouts
    .map((c) => {
      const sel = c.id === selectedId;
      const color = c.type === 'blur' ? '#6B7079' : c.color;
      const bg = sel ? color : `${color}1A`;
      const fg = sel ? (color.toUpperCase() === '#FFFFFF' || color === '#F5B83D' ? '#111318' : '#fff') : color === '#FFFFFF' ? '#3C4048' : color;
      const label = c.type === 'step' ? String(c.n) : c.label || TYPE_LABEL[c.type];
      return `<div class="cchip ${sel ? 'sel' : ''}" data-cid="${c.id}" style="left:${c.start * p}px;width:${Math.max(30, (c.end - c.start) * p - 3)}px;top:${lane.get(c.id) * laneH}px;background:${bg};color:${fg};${sel ? '' : `border:1px solid ${color}55;`}">
        <span class="edge l" data-edge="l"></span>${ic(c.type === 'box' ? 'rect' : c.type, 14, 2)}${escapeHtml(label)}<span class="edge r" data-edge="r"></span></div>`;
    })
    .join('') || `<div class="muted" style="font-size:12px;padding:8px 0">Add arrows, boxes, steps, text, zoom or blur from the buttons above.</div>`;

  const voiceTop = callTop + count * laneH + 12;
  const vt = $('#voiceTrack');
  vt.style.top = `${voiceTop}px`;
  $('#voiceLabel').style.top = `${voiceTop + 12}px`;
  const bottom = voiceTop + 40;
  tracksEl.style.height = `${bottom + 16}px`;
  drawWaveform();

  const { start, end } = trimRange(rec);
  const h = bottom - 36;
  Object.assign($('#shadeL').style, { left: `${LABEL_W}px`, width: `${start * p}px`, height: `${h}px` });
  Object.assign($('#shadeR').style, { left: `${xAt(end)}px`, width: `${(T - end) * p}px`, height: `${h}px` });
  Object.assign($('#trimL').style, { left: `${xAt(start)}px`, height: `${h + 8}px` });
  Object.assign($('#trimR').style, { left: `${xAt(end)}px`, height: `${h + 8}px` });
  $('#playhead').style.height = `${bottom - 28}px`;
  $('#resetTrim').hidden = !(start > 0.01 || end < T - 0.01);
  placePlayhead();
}

function placePlayhead() {
  if (!rec) return;
  $('#playhead').style.left = `${xAt(t)}px`;
}

function drawWaveform() {
  const vt = $('#voiceTrack');
  const w = trackW(), h = 40;
  const dpr = window.devicePixelRatio || 1;
  vt.width = Math.round(w * dpr);
  vt.height = h * dpr;
  vt.style.width = `${w}px`;
  vt.style.height = `${h}px`;
  const g = vt.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!peaks) {
    g.fillStyle = '#9AA3B2';
    g.font = '500 11.5px Inter, system-ui';
    g.fillText(rec.hasAudio === false ? 'No sound in this recording' : 'Reading sound…', 4, 24);
    return;
  }
  g.fillStyle = '#9AA3B2';
  const bars = Math.floor(w / 3);
  for (let i = 0; i < bars; i++) {
    const a = Math.floor((i / bars) * peaks.length), b = Math.floor(((i + 1) / bars) * peaks.length);
    let m = 0;
    for (let k = a; k < b; k++) m = Math.max(m, peaks[k]);
    const bh = Math.max(2, Math.min(1, m * 2.2) * h);
    g.fillRect(i * 3, (h - bh) / 2, 2, bh);
  }
}

async function buildWaveform() {
  if (rec.hasAudio === false) return drawWaveform();
  try {
    const ac = new OfflineAudioContext(1, 1, 44100);
    const out = new Float32Array(Math.ceil(total() * PEAK_RATE) + 1);
    const starts = segmentStarts(rec.segments);
    for (const [i, s] of rec.segments.entries()) {
      const buf = await (await getSegmentBlob(s.id, rec.mimeType)).arrayBuffer();
      const audio = await ac.decodeAudioData(buf);
      const data = audio.getChannelData(0);
      const per = audio.sampleRate / PEAK_RATE;
      for (let k = 0; k * per < data.length; k++) {
        let m = 0;
        const from = Math.floor(k * per), to = Math.min(data.length, Math.floor((k + 1) * per));
        for (let j = from; j < to; j += 4) m = Math.max(m, Math.abs(data[j]));
        const idx = Math.floor(starts[i] * PEAK_RATE) + k;
        if (idx < out.length) out[idx] = m;
      }
    }
    peaks = out;
  } catch {
    rec.hasAudio = false;
  }
  drawWaveform();
}

async function buildFilmstrip() {
  const v = document.createElement('video');
  v.muted = true;
  const c = document.createElement('canvas');
  c.height = 96;
  c.width = Math.round((96 * (rec.width || 16)) / (rec.height || 9));
  for (const s of rec.segments) {
    try {
      v.src = await segURL(s);
      await waitFor(v, 'loadeddata');
      v.currentTime = Math.min(0.4, s.duration / 2);
      await waitFor(v, 'seeked');
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      s._thumb = c.toDataURL('image/jpeg', 0.6);
    } catch {
      /* no thumbnail */
    }
  }
  v.removeAttribute('src');
  renderTimeline();
}

// timeline pointer interactions
let tdrag = null;
tracksEl.addEventListener('pointerdown', (e) => {
  if (!rec) return;
  const handle = e.target.closest('.trimhandle');
  const chip = e.target.closest('.cchip');
  tracksEl.setPointerCapture(e.pointerId);
  if (handle) {
    checkpoint();
    tdrag = { kind: handle.id === 'trimL' ? 'trimL' : 'trimR' };
    if (playing) pause();
    return;
  }
  if (chip) {
    const c = rec.callouts.find((x) => x.id === chip.dataset.cid);
    selectedId = c.id;
    checkpoint();
    tdrag = { kind: e.target.dataset.edge ? `edge-${e.target.dataset.edge}` : 'chip', id: c.id, x0: e.clientX, s0: c.start, e0: c.end, moved: false };
    if (playing) pause();
    renderInspector();
    renderTimeline();
    return;
  }
  tdrag = { kind: 'scrub' };
  if (playing) pause();
  seek(timeAt(e.clientX));
});

tracksEl.addEventListener('pointermove', (e) => {
  if (!tdrag) return;
  const T = total();
  if (tdrag.kind === 'scrub') return seek(timeAt(e.clientX));
  if (tdrag.kind === 'trimL' || tdrag.kind === 'trimR') {
    const tt = timeAt(e.clientX);
    const { start, end } = trimRange(rec);
    if (tdrag.kind === 'trimL') rec.trim.start = clamp(tt, 0, end - 0.5);
    else rec.trim.end = clamp(tt, start + 0.5, T);
    if (rec.trim.end != null && rec.trim.end >= T - 0.01) rec.trim.end = null;
    renderTimeline();
    seek(tdrag.kind === 'trimL' ? rec.trim.start : (rec.trim.end ?? T));
    return;
  }
  const c = rec.callouts.find((x) => x.id === tdrag.id);
  if (!c) return;
  const dt = (e.clientX - tdrag.x0) / pps();
  if (Math.abs(e.clientX - tdrag.x0) > 2) tdrag.moved = true;
  const len = tdrag.e0 - tdrag.s0;
  if (tdrag.kind === 'chip') {
    c.start = clamp(tdrag.s0 + dt, 0, T - len);
    c.end = c.start + len;
  } else if (tdrag.kind === 'edge-l') c.start = clamp(tdrag.s0 + dt, 0, c.end - 0.3);
  else c.end = clamp(tdrag.e0 + dt, c.start + 0.3, T);
  renderTimeline();
  renderInspector();
  draw();
});

tracksEl.addEventListener('pointerup', () => {
  if (!tdrag) return;
  const d = tdrag;
  tdrag = null;
  if (d.kind === 'scrub') return;
  if ((d.kind === 'chip' || d.kind.startsWith('edge')) && !d.moved) {
    history.pop(); // a click, not a change
    const c = selected();
    if (c && !isActive(c, t)) seek(c.start + Math.min(0.5, (c.end - c.start) / 2));
    updateHistoryButtons();
    return draw();
  }
  changed();
});

$('#addrow').addEventListener('click', (e) => {
  const b = e.target.closest('[data-add]');
  if (b) return addCallout(b.dataset.add);
  if (e.target.closest('#resetTrim')) {
    checkpoint();
    rec.trim = { start: 0, end: null };
    changed();
  }
});

function addCallout(type) {
  if (!rec) return;
  if (playing) pause();
  checkpoint();
  const c = createCallout(type, t, rec.callouts);
  const T = total();
  const len = c.end - c.start;
  if (c.end > T) {
    c.start = Math.max(0, T - len);
    c.end = Math.min(T, c.start + len);
  }
  rec.callouts.push(c);
  selectedId = c.id;
  if (!isActive(c, t)) t = c.start + 0.1;
  changed();
  seek(t);
}

// ---------- inspector ----------
function swatches(c) {
  return `<div class="swatches">${COLORS.map((col) => `<button class="swatch ${col === '#FFFFFF' ? 'white' : ''} ${c.color === col ? 'on' : ''}" data-color="${col}" style="background:${col};color:${col === '#FFFFFF' ? '#9AA0A9' : col}" aria-label="Colour"></button>`).join('')}</div>`;
}

function renderInspector() {
  const el = $('#inspector');
  if (!rec) return;
  const c = selected();
  if (!c) {
    const { start, end, total: T, length } = trimRange(rec);
    const retakes = rec.segments.filter((s) => s.retake).length;
    el.innerHTML = `
      <div class="ins-head"><div class="ins-title">This recording</div></div>
      <div class="stat"><span>Length</span><span>${fmtTime(length)}${length < T - 0.05 ? ` <span class="muted">of ${fmtTime(T)}</span>` : ''}</span></div>
      <div class="stat"><span>Parts</span><span>${rec.segments.length}${retakes ? ` · ${retakes} retake${retakes > 1 ? 's' : ''}` : ''}</span></div>
      <div class="stat"><span>Size</span><span>${rec.width}×${rec.height} · ${fmtBytes(rec.bytes)}</span></div>
      <div class="stat"><span>Recorded</span><span>${fmtWhen(rec.createdAt)}</span></div>
      <div class="stat"><span>Callouts</span><span>${rec.callouts.length}</span></div>
      ${start > 0.01 || end < T - 0.01 ? `<div class="stat"><span>Trimmed to</span><span>${fmtTimePrecise(start)} – ${fmtTimePrecise(end)}</span></div>` : ''}
      <div class="tips">
        <p><b>Add a callout</b> with the buttons under the video. It appears at the playhead for 4 seconds.</p>
        <p style="margin-top:8px"><b>Change when it shows</b> by dragging it, or its edges, in the Callouts row.</p>
        <p style="margin-top:8px"><kbd>Space</kbd> play or pause · <kbd>←</kbd> <kbd>→</kbd> move 1 second · <kbd>Delete</kbd> remove selected</p>
      </div>`;
    return;
  }
  const iconName = c.type === 'box' ? 'rect' : c.type;
  const tint = c.type === 'blur' ? '#6B7079' : c.color === '#FFFFFF' ? '#3C4048' : c.color;
  const hasLabel = ['arrow', 'box', 'step', 'text'].includes(c.type);
  const hasColor = !['blur', 'zoom'].includes(c.type);
  const zoomLevel = c.type === 'zoom' ? (1 / Math.max(c.w, c.h)).toFixed(1) : null;
  el.innerHTML = `
    <div class="ins-head">
      <div class="ins-title"><div class="ins-badge" style="background:${tint}1A;color:${tint}">${ic(iconName, 17, 2.2)}</div>${TYPE_LABEL[c.type]} callout</div>
      <button class="iconbtn" data-act="delete" title="Delete (Delete key)" aria-label="Delete callout">${ic('trash', 18)}</button>
    </div>
    ${hasLabel ? `<div class="ins-sec"><div class="tlabel">${c.type === 'text' ? 'Text' : 'Label'}</div><label class="field"><input data-field="label" value="${escapeHtml(c.label)}" placeholder="${c.type === 'step' ? 'Optional' : 'Optional'}" maxlength="80"></label></div>` : ''}
    ${c.type === 'step' ? `<div class="ins-sec"><div class="tlabel">Number</div><label class="field"><input data-field="n" type="number" min="1" max="99" value="${c.n}"></label></div>` : ''}
    ${c.type === 'zoom' ? `<div class="ins-sec"><div class="tlabel">Zoom level · ${zoomLevel}×</div><input type="range" data-field="zoom" min="1.25" max="4" step="0.05" value="${zoomLevel}"><p class="muted" style="font-size:12px;margin-top:6px">Drag the green box on the video to choose what to zoom into.</p></div>` : ''}
    <div class="ins-sec"><div class="tlabel">Shows</div>
      <div class="row" style="gap:8px"><label class="field">From<input data-field="start" value="${fmtTimePrecise(c.start)}"></label><label class="field">To<input data-field="end" value="${fmtTimePrecise(c.end)}"></label></div>
    </div>
    ${hasColor ? `<div class="ins-sec"><div class="tlabel">Colour</div>${swatches(c)}</div>` : ''}
    <div class="optrow">${c.type === 'zoom' ? 'Smooth zoom in and out' : 'Fade in and out'}<button class="toggle ${c.animate ? 'on' : ''}" data-act="animate" aria-pressed="${c.animate}"></button></div>`;
}

function parseTime(s) {
  const m = String(s).trim().match(/^(?:(\d+):)?(\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return Number(m[1] || 0) * 60 + Number(m[2]);
}

$('#inspector').addEventListener('click', (e) => {
  const c = selected();
  const b = e.target.closest('button');
  if (!c || !b) return;
  if (b.dataset.act === 'delete') return deleteSelected();
  checkpoint();
  if (b.dataset.color) c.color = b.dataset.color;
  if (b.dataset.act === 'animate') c.animate = !c.animate;
  changed();
});

$('#inspector').addEventListener('input', (e) => {
  const c = selected();
  const f = e.target.dataset.field;
  if (!c || !f) return;
  if (f === 'label') {
    c.label = e.target.value;
    draw();
    renderTimeline();
    scheduleCommit();
  } else if (f === 'zoom') {
    const k = Number(e.target.value);
    const cx = c.x + c.w / 2, cy = c.y + c.h / 2;
    const size = 1 / k;
    c.w = c.h = size;
    c.x = clamp(cx - size / 2, 0, 1 - size);
    c.y = clamp(cy - size / 2, 0, 1 - size);
    e.target.previousElementSibling.textContent = `Zoom level · ${k.toFixed(1)}×`;
    draw();
    scheduleCommit();
  }
});

let commitTimer = 0;
let pendingCheckpoint = false;
function scheduleCommit() {
  if (!pendingCheckpoint) {
    history.push(snapshot());
    pendingCheckpoint = true;
  }
  clearTimeout(commitTimer);
  commitTimer = setTimeout(() => {
    pendingCheckpoint = false;
    future = [];
    changed();
  }, 500);
}

$('#inspector').addEventListener('change', (e) => {
  const c = selected();
  const f = e.target.dataset.field;
  if (!c || !f) return;
  if (f === 'start' || f === 'end') {
    const v = parseTime(e.target.value);
    if (v == null) return renderInspector();
    checkpoint();
    const T = total();
    if (f === 'start') c.start = clamp(v, 0, c.end - 0.3);
    else c.end = clamp(v, c.start + 0.3, T);
    changed();
  } else if (f === 'n') {
    checkpoint();
    c.n = clamp(Math.round(Number(e.target.value) || 1), 1, 99);
    changed();
  }
});

function deleteSelected() {
  if (!selected()) return;
  checkpoint();
  rec.callouts = rec.callouts.filter((x) => x.id !== selectedId);
  selectedId = null;
  changed();
}

// ---------- title ----------
$('#title').addEventListener('change', (e) => {
  checkpoint();
  rec.title = e.target.value.trim() || 'Untitled recording';
  document.title = `${rec.title} · Retake`;
  changed();
});
$('#title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') e.target.blur();
});

// ---------- keyboard ----------
document.addEventListener('keydown', (e) => {
  if (!rec) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName);
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !typing) {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && e.key.toLowerCase() === 'y' && !typing) {
    e.preventDefault();
    return redo();
  }
  if (typing || $('#modal').firstChild) return;
  if (e.key === ' ') {
    e.preventDefault();
    return playing ? pause() : play();
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault();
    if (playing) pause();
    return seek(t + (e.key === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1));
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && selected()) {
    e.preventDefault();
    return deleteSelected();
  }
  if (e.key === 'Escape') {
    selectedId = null;
    renderInspector();
    renderTimeline();
    draw();
  }
});

$('#undo').onclick = undo;
$('#redo').onclick = redo;

// ---------- export ----------
const exportState = { layout: 'landscape', format: 'mp4', quality: 1080 };

function exportModal() {
  if (!rec) return;
  if (playing) pause();
  const { length } = trimRange(rec);
  const gifTooLong = length > GIF_MAX_SECONDS;
  if (exportState.format === 'gif' && gifTooLong) exportState.format = 'mp4';
  const est = estimateBytes(rec, exportState.layout, exportState.quality, exportState.format);
  const mp4ok = !pickMime('mp4').fellBack;
  const m = $('#modal');
  m.innerHTML = `<div class="scrim"><div class="panel modal" role="dialog" aria-label="Export video">
    <div class="mh"><div class="h" style="font-size:19px">Export video</div><button class="iconbtn" data-x aria-label="Close">${ic('x', 20)}</button></div>
    <div class="tlabel" style="margin-bottom:10px">Layout</div>
    <div class="layouts">
      <button class="layout ${exportState.layout === 'landscape' ? 'on' : ''}" data-layout="landscape"><div class="thumbbox"><canvas id="thL"></canvas></div><div><b>Landscape 16:9</b><small>YouTube, docs, email</small></div></button>
      <button class="layout ${exportState.layout === 'vertical' ? 'on' : ''}" data-layout="vertical"><div class="thumbbox"><canvas id="thV"></canvas></div><div><b>Vertical 9:16</b><small>Shorts, Reels, TikTok</small></div></button>
    </div>
    <div class="mrow">
      <div><div class="tlabel">Format</div><div class="seg" style="padding:3px">
        ${['mp4', 'webm', 'gif'].map((f) => `<button class="${exportState.format === f ? 'on' : ''}" data-format="${f}" ${f === 'gif' && gifTooLong ? 'disabled title="GIFs are limited to 60 seconds"' : ''}>${f.toUpperCase()}</button>`).join('')}
      </div></div>
      <div><div class="tlabel">Quality</div><label class="field" style="height:44px"><select id="quality" ${exportState.format === 'gif' ? 'disabled' : ''}><option value="1080" ${exportState.quality === 1080 ? 'selected' : ''}>1080p · High</option><option value="720" ${exportState.quality === 720 ? 'selected' : ''}>720p · Smaller file</option></select>${ic('chev', 16)}</label></div>
    </div>
    ${exportState.format === 'mp4' && !mp4ok ? '<div class="notice warn" style="margin-bottom:14px">This version of Chrome can’t make MP4 files, so Retake will save WebM. Update Chrome to get MP4.</div>' : ''}
    ${exportState.format === 'gif' ? '<div class="notice" style="margin-bottom:14px">GIFs have no sound and are limited to 60 seconds. They are made at 10 frames a second.</div>' : ''}
    ${gifTooLong && exportState.format !== 'gif' ? '' : ''}
    <div class="mfoot"><div class="info">${fmtTime(length)} after trimming · about ${fmtBytes(est)}<br><span style="display:inline-flex;align-items:center;gap:5px">${ic('lock', 12)}Made on your computer. No upload.</span></div>
    <button class="btn dark" id="go" style="height:48px;padding:0 22px">${ic('download', 18, 2.2)}Save to Downloads</button></div>
  </div></div>`;
  drawExportThumbs();
}

function drawExportThumbs() {
  const draws = [['#thL', 'landscape', 1], ['#thV', 'vertical', 1]];
  for (const [sel, lay] of draws) {
    const c = $(sel);
    if (!c) continue;
    const dpr = window.devicePixelRatio || 1;
    const w = lay === 'vertical' ? 120 : 210;
    const h = lay === 'vertical' ? 214 : Math.round((210 * (rec.height || 9)) / (rec.width || 16));
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    c.width = w * dpr;
    c.height = h * dpr;
    const g = c.getContext('2d');
    g.scale(dpr, dpr);
    if (video.readyState >= 2) composeFrame(g, video, video.videoWidth, video.videoHeight, w, h, lay, rec.callouts, t);
  }
}

let exportAbort = null;
async function runExport() {
  const { layout, format, quality } = exportState;
  const m = $('#modal');
  exportAbort = new AbortController();
  m.innerHTML = `<div class="scrim"><div class="panel modal" role="dialog" aria-label="Exporting">
    <div class="h" style="font-size:19px">Exporting your video</div>
    <div class="progress"><i id="bar"></i></div>
    <div class="row" style="justify-content:space-between"><span class="muted" style="font-size:13px" id="pct">Starting…</span><button class="btn ghost" id="cancelExport" style="height:40px">Cancel</button></div>
    <div class="notice" style="margin-top:16px">Keep this tab open until it finishes. Export plays your video once on this computer, so it takes about as long as the video.</div>
  </div></div>`;
  $('#cancelExport').onclick = () => exportAbort.abort();
  if (playing) pause();
  try {
    const res = await exportRecording({
      rec: { ...rec, segments: rec.segments.map(({ _thumb, ...s }) => s) },
      getSegmentURL: (i) => segURL(rec.segments[i]),
      format,
      layout,
      quality,
      signal: exportAbort.signal,
      tickerURL: '../core/ticker.js',
      onProgress: (p) => {
        const bar = $('#bar');
        if (bar) bar.style.width = `${Math.round(p * 100)}%`;
        const pct = $('#pct');
        if (pct) pct.textContent = `${Math.round(p * 100)}%`;
      },
    });
    const name = `${slugify(rec.title)}${layout === 'vertical' ? '-vertical' : ''}.${res.ext}`;
    await saveFile(res.blob, name);
    m.innerHTML = `<div class="scrim"><div class="panel modal" role="dialog" aria-label="Export finished">
      <div class="row" style="gap:12px;margin-bottom:10px"><div style="width:40px;height:40px;border-radius:12px;background:var(--green-soft);color:var(--green);display:grid;place-items:center">${ic('check', 22, 2.4)}</div><div class="h" style="font-size:19px">Saved to Downloads</div></div>
      <p class="muted" style="font-size:13.5px;line-height:1.5">Retake/${escapeHtml(name)} · ${fmtBytes(res.blob.size)}${res.fellBack ? '<br>This Chrome version can’t make MP4, so it was saved as WebM.' : ''}</p>
      <div class="row" style="justify-content:flex-end;margin-top:18px;gap:10px"><button class="btn ghost" id="again">Export another version</button><button class="btn dark" data-x>Done</button></div>
    </div></div>`;
    $('#again').onclick = exportModal;
  } catch (e) {
    if (e.name === 'AbortError') {
      m.innerHTML = '';
      return;
    }
    m.innerHTML = `<div class="scrim"><div class="panel modal" role="dialog" aria-label="Export failed">
      <div class="h" style="font-size:19px;margin-bottom:12px">Export didn’t finish</div>
      <div class="notice err">${escapeHtml(e.message || String(e))}</div>
      <p class="muted" style="font-size:13px;margin-top:12px;line-height:1.5">Try WebM, or a lower quality. If it keeps failing, please report it from Help.</p>
      <div class="row" style="justify-content:flex-end;margin-top:18px;gap:10px"><button class="btn ghost" data-x>Close</button><button class="btn dark" id="retry">Try again</button></div>
    </div></div>`;
    $('#retry').onclick = exportModal;
  } finally {
    exportAbort = null;
    await seek(t);
  }
}

$('#export').onclick = exportModal;
$('#modal').addEventListener('click', (e) => {
  if (e.target.closest('[data-x]') || e.target.classList.contains('scrim')) {
    if (exportAbort) return;
    $('#modal').innerHTML = '';
    return;
  }
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.layout) {
    exportState.layout = b.dataset.layout;
    return exportModal();
  }
  if (b.dataset.format && !b.disabled) {
    exportState.format = b.dataset.format;
    return exportModal();
  }
  if (b.id === 'go') runExport();
});
$('#modal').addEventListener('change', (e) => {
  if (e.target.id === 'quality') {
    exportState.quality = Number(e.target.value);
    exportModal();
  }
});

// ---------- boot ----------
renderPlay();
updateHistoryButtons();
new ResizeObserver(() => {
  if (!rec) return;
  layout();
}).observe($('#canvasWrap'));
new ResizeObserver(() => {
  if (!rec) return;
  renderTimeline();
}).observe($('#tracks'));
window.addEventListener('beforeunload', (e) => {
  if (exportAbort) {
    e.preventDefault();
    e.returnValue = '';
  }
});
load().catch((e) => fatal(`Could not open this recording: ${e.message}`));
