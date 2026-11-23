// Transparent layer over the recorded screen: countdown, drawings and the cursor spotlight.
// Drawings and the spotlight are part of the video; the countdown disappears before recording starts.
const api = window.retakeDesktop;
const SIZES = { S: 3, M: 5, L: 9 };
const ink = document.getElementById('ink');
const spot = document.getElementById('spot');
const ctx = ink.getContext('2d');
const sctx = spot.getContext('2d');
const countEl = document.getElementById('count');
let settings = { tool: 'pen', color: '#F0464B', size: 'M', fade: 5000 };
let drawing = false, spotlight = false, cursor = null;
let shapes = [], current = null, stepN = 1, raf = 0, textInput = null;

function size() {
  const dpr = devicePixelRatio || 1;
  for (const c of [ink, spot]) {
    c.width = innerWidth * dpr;
    c.height = innerHeight * dpr;
    c.style.width = `${innerWidth}px`;
    c.style.height = `${innerHeight}px`;
    c.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  kick();
}
addEventListener('resize', size);
size();

const light = (c) => c.toUpperCase() === '#FFFFFF' || c.toUpperCase() === '#F5B83D';
function alphaOf(s, now) {
  if (!s.born || !s.fade) return 1;
  const age = now - s.born;
  if (age >= s.fade) return 0;
  return age > s.fade - 500 ? (s.fade - age) / 500 : 1;
}
function arrowHead(a, b, w) {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const h = Math.max(12, w * 3.6);
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - h * Math.cos(ang - 0.45), b.y - h * Math.sin(ang - 0.45));
  ctx.lineTo(b.x - h * Math.cos(ang + 0.45), b.y - h * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
}
function drawShape(s) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineWidth = s.w;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.18)';
  ctx.shadowBlur = 3;
  if (s.tool === 'pen' || s.tool === 'hl') {
    if (s.tool === 'hl') {
      ctx.globalAlpha *= 0.38;
      ctx.lineWidth = s.w * 4.5;
      ctx.lineCap = 'butt';
      ctx.shadowBlur = 0;
    }
    ctx.beginPath();
    s.pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    if (s.pts.length === 1) ctx.lineTo(s.pts[0].x + 0.1, s.pts[0].y);
    ctx.stroke();
  } else if (s.tool === 'arrow') {
    ctx.beginPath();
    ctx.moveTo(s.a.x, s.a.y);
    ctx.lineTo(s.b.x, s.b.y);
    ctx.stroke();
    arrowHead(s.a, s.b, s.w);
  } else if (s.tool === 'rect') {
    const x = Math.min(s.a.x, s.b.x), y = Math.min(s.a.y, s.b.y), w = Math.abs(s.b.x - s.a.x), h = Math.abs(s.b.y - s.a.y);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(12, w / 4, h / 4));
    ctx.stroke();
  } else if (s.tool === 'circle') {
    ctx.beginPath();
    ctx.ellipse((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, Math.abs(s.b.x - s.a.x) / 2 || 1, Math.abs(s.b.y - s.a.y) / 2 || 1, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool === 'step') {
    const r = 17;
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.a.x, s.a.y, r + 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.a.x, s.a.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = light(s.color) ? '#111318' : '#fff';
    ctx.font = '700 16px Inter, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.n), s.a.x, s.a.y + 1);
  } else if (s.tool === 'text') {
    ctx.font = '650 18px Inter, system-ui, sans-serif';
    const w = ctx.measureText(s.text).width + 24;
    ctx.shadowBlur = 10;
    ctx.beginPath();
    ctx.roundRect(s.a.x, s.a.y, w, 38, 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = light(s.color) ? '#111318' : '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.text, s.a.x + 12, s.a.y + 19.5);
  }
  ctx.restore();
}
function paint() {
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  const now = performance.now();
  shapes = shapes.filter((s) => alphaOf(s, now) > 0);
  for (const s of shapes) {
    ctx.globalAlpha = alphaOf(s, now);
    drawShape(s);
  }
  ctx.globalAlpha = 1;
  if (current) drawShape(current);
  sctx.clearRect(0, 0, innerWidth, innerHeight);
  if (spotlight && cursor) {
    const g = sctx.createRadialGradient(cursor.x, cursor.y, 70, cursor.x, cursor.y, 140);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,.45)');
    sctx.fillStyle = g;
    sctx.fillRect(0, 0, innerWidth, innerHeight);
  }
}
function loop() {
  paint();
  raf = shapes.some((s) => s.fade) || current || spotlight ? requestAnimationFrame(loop) : 0;
}
function kick() {
  if (!raf) raf = requestAnimationFrame(loop);
}

function commitText() {
  if (!textInput) return;
  const value = textInput.value.trim();
  if (value) shapes.push({ tool: 'text', color: settings.color, w: SIZES[settings.size], a: textInput._at, text: value, born: performance.now(), fade: settings.fade });
  textInput.remove();
  textInput = null;
  kick();
}

ink.addEventListener('pointerdown', (e) => {
  if (!drawing || e.button !== 0) return;
  e.preventDefault();
  const p = { x: e.clientX, y: e.clientY };
  const { tool, color } = settings;
  const w = SIZES[settings.size];
  if (tool === 'text') {
    commitText();
    textInput = document.createElement('input');
    textInput.className = 'textin';
    textInput.placeholder = 'Type, then press Enter';
    Object.assign(textInput.style, { left: `${p.x}px`, top: `${p.y}px`, background: color, color: light(color) ? '#111318' : '#fff' });
    textInput._at = p;
    textInput.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter') commitText();
      if (ev.key === 'Escape') {
        textInput.remove();
        textInput = null;
      }
    });
    document.body.append(textInput);
    setTimeout(() => textInput?.focus(), 0);
    return;
  }
  if (tool === 'step') {
    shapes.push({ tool, color, w, a: p, n: stepN++, born: performance.now(), fade: settings.fade });
    return kick();
  }
  ink.setPointerCapture(e.pointerId);
  current = tool === 'pen' || tool === 'hl' ? { tool, color, w, pts: [p] } : { tool, color, w, a: p, b: p };
  kick();
});
ink.addEventListener('pointermove', (e) => {
  if (!current) return;
  const p = { x: e.clientX, y: e.clientY };
  if (current.pts) current.pts.push(p);
  else current.b = p;
});
ink.addEventListener('pointerup', () => {
  if (!current) return;
  Object.assign(current, { born: performance.now(), fade: settings.fade });
  shapes.push(current);
  current = null;
  kick();
});
addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drawing) api.call('command', { cmd: 'draw-off' });
  if ((e.metaKey || e.ctrlKey) && e.key === 'z') (shapes.pop(), kick());
});

api.on('draw', (d) => {
  if (d.clear) {
    shapes = [];
    stepN = 1;
  }
  if (d.undo) shapes.pop();
  const { clear, undo, ...rest } = d;
  settings = { ...settings, ...rest };
  kick();
});
api.on('cursor', (p) => {
  cursor = p;
  kick();
});
api.on('state', (s) => {
  if (drawing && !s.drawing) commitText();
  drawing = s.drawing;
  document.body.classList.toggle('drawing', drawing);
  spotlight = s.spotlight;
  if (s.status === 'countdown' && s.countdown > 0) {
    countEl.innerHTML = `${s.countdown}<small>Recording starts…</small>`;
    countEl.hidden = false;
  } else countEl.hidden = true;
  kick();
});
