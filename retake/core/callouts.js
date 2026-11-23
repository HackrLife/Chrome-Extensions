// Callouts added in the editor: arrows, boxes, steps, text, blur and zoom.
// Positions are stored as fractions of the video (0 to 1) so they survive any export size.
// The same drawing code runs in the editor preview and in the export, so they always match.

export const COLORS = ['#F0464B', '#2F54EB', '#F5B83D', '#1E9E6A', '#111318', '#FFFFFF'];
export const CALLOUT_TYPES = ['arrow', 'box', 'step', 'text', 'zoom', 'blur'];
export const TYPE_LABEL = { arrow: 'Arrow', box: 'Box', step: 'Step', text: 'Text', zoom: 'Zoom', blur: 'Blur' };

const FADE = 0.22; // seconds for animate in and out
const ZOOM_EASE = 0.45;

export function createCallout(type, at, existing = []) {
  const base = {
    id: crypto.randomUUID(),
    type,
    start: Math.max(0, at),
    end: Math.max(0, at) + (type === 'blur' ? 6 : 4),
    color: type === 'blur' ? '#6B7079' : type === 'zoom' ? '#1E9E6A' : type === 'text' ? '#111318' : type === 'step' ? '#2F54EB' : '#F0464B',
    animate: true,
    label: '',
  };
  switch (type) {
    case 'arrow':
      return { ...base, x1: 0.38, y1: 0.62, x2: 0.55, y2: 0.42, label: 'Look here' };
    case 'box':
      return { ...base, x: 0.38, y: 0.36, w: 0.24, h: 0.2 };
    case 'step': {
      const n = existing.filter((c) => c.type === 'step').length + 1;
      return { ...base, x: 0.5, y: 0.5, n, label: '' };
    }
    case 'text':
      return { ...base, x: 0.4, y: 0.45, label: 'Your note' };
    case 'zoom':
      return { ...base, x: 0.3, y: 0.25, w: 0.4, h: 0.4 };
    case 'blur':
      return { ...base, x: 0.4, y: 0.4, w: 0.2, h: 0.08 };
    default:
      return base;
  }
}

export function isActive(c, t) {
  return t >= c.start && t <= c.end;
}

function alphaAt(c, t, solid = false) {
  if (!c.animate || solid) return isActive(c, t) ? 1 : 0;
  if (!isActive(c, t)) return 0;
  const a = Math.min(1, (t - c.start) / FADE, (c.end - t) / FADE);
  return Math.max(0, a);
}

const ease = (x) => (x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2);

// The part of the video shown at time t, as fractions. Full frame unless a zoom is active.
export function viewAt(callouts, t) {
  const full = { x: 0, y: 0, w: 1, h: 1 };
  const z = callouts.find((c) => c.type === 'zoom' && t >= c.start - 0 && t <= c.end);
  if (!z) return full;
  const into = Math.min(1, (t - z.start) / ZOOM_EASE, (z.end - t) / ZOOM_EASE);
  const k = ease(Math.max(0, into));
  // keep the zoom box at the video's aspect ratio by fitting around its centre
  const size = Math.max(z.w, z.h);
  const target = {
    w: size,
    h: size,
    x: Math.min(1 - size, Math.max(0, z.x + z.w / 2 - size / 2)),
    y: Math.min(1 - size, Math.max(0, z.y + z.h / 2 - size / 2)),
  };
  return {
    x: full.x + (target.x - full.x) * k,
    y: full.y + (target.y - full.y) * k,
    w: full.w + (target.w - full.w) * k,
    h: full.h + (target.h - full.h) * k,
  };
}

// Map a point in video fractions to canvas pixels, given the visible view and destination rect.
export function toCanvas(px, py, view, dest) {
  return {
    x: dest.x + ((px - view.x) / view.w) * dest.w,
    y: dest.y + ((py - view.y) / view.h) * dest.h,
  };
}

export function fromCanvas(cx, cy, view, dest) {
  return {
    x: view.x + ((cx - dest.x) / dest.w) * view.w,
    y: view.y + ((cy - dest.y) / dest.h) * view.h,
  };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function textColorFor(bg) {
  const hex = bg.replace('#', '');
  const r = parseInt(hex.slice(0, 2), 16), g = parseInt(hex.slice(2, 4), 16), b = parseInt(hex.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 186 ? '#111318' : '#FFFFFF';
}

function drawLabel(ctx, text, x, y, color, unit, anchor = 'left') {
  if (!text) return;
  const fs = Math.max(11, unit * 1.6);
  ctx.font = `650 ${fs}px Inter, "DM Sans", system-ui, sans-serif`;
  const padX = fs * 0.7, padY = fs * 0.45;
  const w = ctx.measureText(text).width + padX * 2;
  const h = fs + padY * 2;
  let lx = anchor === 'center' ? x - w / 2 : x;
  const ly = y;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,0.22)';
  ctx.shadowBlur = fs * 0.8;
  ctx.shadowOffsetY = fs * 0.25;
  ctx.fillStyle = color;
  roundRect(ctx, lx, ly, w, h, fs * 0.55);
  ctx.fill();
  ctx.restore();
  if (color.toUpperCase() === '#FFFFFF') {
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    roundRect(ctx, lx, ly, w, h, fs * 0.55);
    ctx.stroke();
  }
  ctx.fillStyle = textColorFor(color);
  ctx.textBaseline = 'middle';
  ctx.fillText(text, lx + padX, ly + h / 2 + fs * 0.04);
  return { x: lx, y: ly, w, h };
}

function drawArrow(ctx, a, b, color, unit) {
  const lw = Math.max(2.5, unit * 0.45);
  const head = lw * 4.2;
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = lw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = lw * 2;
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x - Math.cos(ang) * head * 0.6, b.y - Math.sin(ang) * head * 0.6);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(b.x, b.y);
  ctx.lineTo(b.x - head * Math.cos(ang - 0.45), b.y - head * Math.sin(ang - 0.45));
  ctx.lineTo(b.x - head * Math.cos(ang + 0.45), b.y - head * Math.sin(ang + 0.45));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// Draw one frame: the visible part of the source into dest, then blur regions, then callouts.
// source: a video, canvas or image. sw/sh: its natural size.
// opts.solid draws callouts at full strength, ignoring the fade, so a paused preview shows
// a callout the moment it is added (its fade starts from nothing at its first frame).
export function drawFrame(ctx, source, sw, sh, dest, callouts, t, opts = {}) {
  const view = opts.view || viewAt(callouts, t);
  ctx.drawImage(source, view.x * sw, view.y * sh, view.w * sw, view.h * sh, dest.x, dest.y, dest.w, dest.h);
  const unit = dest.w / 100; // 1% of the picture width

  for (const c of callouts) {
    if (c.type !== 'blur') continue;
    const a = alphaAt(c, t, opts.solid);
    if (a <= 0) continue;
    const p = toCanvas(c.x, c.y, view, dest);
    const q = toCanvas(c.x + c.w, c.y + c.h, view, dest);
    ctx.save();
    ctx.beginPath();
    ctx.rect(p.x, p.y, q.x - p.x, q.y - p.y);
    ctx.clip();
    ctx.globalAlpha = a;
    ctx.filter = `blur(${Math.max(6, unit * 1.4)}px)`;
    ctx.drawImage(source, view.x * sw, view.y * sh, view.w * sw, view.h * sh, dest.x, dest.y, dest.w, dest.h);
    ctx.filter = 'none';
    ctx.fillStyle = 'rgba(240,242,245,0.25)';
    ctx.fillRect(p.x, p.y, q.x - p.x, q.y - p.y);
    ctx.restore();
  }

  for (const c of callouts) {
    if (c.type === 'blur' || c.type === 'zoom') continue;
    const a = alphaAt(c, t, opts.solid);
    if (a <= 0) continue;
    ctx.save();
    ctx.globalAlpha = a;
    if (c.type === 'arrow') {
      const p1 = toCanvas(c.x1, c.y1, view, dest);
      const p2 = toCanvas(c.x2, c.y2, view, dest);
      drawArrow(ctx, p1, p2, c.color, unit);
      if (c.label) {
        const fs = Math.max(11, unit * 1.6);
        const below = p1.y >= p2.y;
        drawLabel(ctx, c.label, p1.x, below ? p1.y + fs * 0.4 : p1.y - fs * 2.4, c.color, unit, 'center');
      }
    } else if (c.type === 'box') {
      const p = toCanvas(c.x, c.y, view, dest);
      const q = toCanvas(c.x + c.w, c.y + c.h, view, dest);
      ctx.strokeStyle = c.color;
      ctx.lineWidth = Math.max(2.5, unit * 0.4);
      ctx.shadowColor = 'rgba(0,0,0,0.15)';
      ctx.shadowBlur = unit;
      roundRect(ctx, p.x, p.y, q.x - p.x, q.y - p.y, unit * 1.1);
      ctx.stroke();
      ctx.shadowBlur = 0;
      if (c.label) drawLabel(ctx, c.label, p.x, p.y - Math.max(11, unit * 1.6) * 2.3, c.color, unit);
    } else if (c.type === 'step') {
      const p = toCanvas(c.x, c.y, view, dest);
      const r = Math.max(12, unit * 1.9) * (c.animate ? 0.85 + 0.15 * a : 1);
      ctx.shadowColor = 'rgba(0,0,0,0.28)';
      ctx.shadowBlur = r * 0.7;
      ctx.shadowOffsetY = r * 0.18;
      ctx.fillStyle = '#FFFFFF';
      ctx.beginPath();
      ctx.arc(p.x, p.y, r + Math.max(2, r * 0.16), 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = c.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = textColorFor(c.color);
      ctx.font = `700 ${r * 1.05}px Inter, system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(c.n ?? 1), p.x, p.y + r * 0.05);
      ctx.textAlign = 'left';
      if (c.label) drawLabel(ctx, c.label, p.x + r * 1.5, p.y - Math.max(11, unit * 1.6) * 1.15, c.color, unit);
    } else if (c.type === 'text') {
      const p = toCanvas(c.x, c.y, view, dest);
      drawLabel(ctx, c.label || 'Text', p.x, p.y, c.color, unit);
    }
    ctx.restore();
  }
}

// Bounding box in canvas pixels, for selection and hit testing in the editor.
export function calloutBounds(c, view, dest) {
  const unit = dest.w / 100;
  if (c.type === 'arrow') {
    const a = toCanvas(c.x1, c.y1, view, dest), b = toCanvas(c.x2, c.y2, view, dest);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y), a, b };
  }
  if (c.type === 'step') {
    const p = toCanvas(c.x, c.y, view, dest);
    const r = Math.max(12, unit * 1.9) + 4;
    return { x: p.x - r, y: p.y - r, w: r * 2, h: r * 2 };
  }
  if (c.type === 'text') {
    const p = toCanvas(c.x, c.y, view, dest);
    const fs = Math.max(11, unit * 1.6);
    const w = Math.max(40, (c.label || 'Text').length * fs * 0.56 + fs * 1.4);
    return { x: p.x, y: p.y, w, h: fs * 1.9 };
  }
  const p = toCanvas(c.x, c.y, view, dest), q = toCanvas(c.x + c.w, c.y + c.h, view, dest);
  return { x: p.x, y: p.y, w: q.x - p.x, h: q.y - p.y };
}
