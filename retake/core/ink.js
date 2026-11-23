// Drawing on screen: pen, highlighter, arrow, box, circle, numbered step and text.
// `k` scales line widths and type, so the same shapes work on a 1920-pixel video frame.

export const INK_TOOLS = [
  ['pen', 'Pen'],
  ['hl', 'Highlighter'],
  ['arrow', 'Arrow'],
  ['rect', 'Box'],
  ['circle', 'Circle'],
  ['step', 'Numbered step'],
  ['text', 'Text'],
];
export const INK_SIZES = { S: 3, M: 5, L: 9 };
export const INK_FADES = [
  [0, 'Off'],
  [3000, '3s'],
  [5000, '5s'],
  [10000, '10s'],
];

const light = (c) => ['#FFFFFF', '#F5B83D'].includes(String(c).toUpperCase());

export function inkAlpha(s, now) {
  if (!s.born || !s.fade) return 1;
  const age = now - s.born;
  if (age >= s.fade) return 0;
  return age > s.fade - 500 ? (s.fade - age) / 500 : 1;
}

export function drawInk(ctx, s, k = 1) {
  ctx.save();
  ctx.strokeStyle = ctx.fillStyle = s.color;
  ctx.lineWidth = s.w * k;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.shadowColor = 'rgba(0,0,0,.2)';
  ctx.shadowBlur = 3 * k;
  if (s.tool === 'pen' || s.tool === 'hl') {
    if (s.tool === 'hl') {
      ctx.globalAlpha *= 0.38;
      ctx.lineWidth = s.w * 4.5 * k;
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
    const ang = Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x);
    const h = Math.max(12, s.w * 3.6) * k;
    ctx.beginPath();
    ctx.moveTo(s.b.x, s.b.y);
    ctx.lineTo(s.b.x - h * Math.cos(ang - 0.45), s.b.y - h * Math.sin(ang - 0.45));
    ctx.lineTo(s.b.x - h * Math.cos(ang + 0.45), s.b.y - h * Math.sin(ang + 0.45));
    ctx.closePath();
    ctx.fill();
  } else if (s.tool === 'rect') {
    const x = Math.min(s.a.x, s.b.x), y = Math.min(s.a.y, s.b.y), w = Math.abs(s.b.x - s.a.x), h = Math.abs(s.b.y - s.a.y);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, Math.min(12 * k, w / 4, h / 4));
    ctx.stroke();
  } else if (s.tool === 'circle') {
    ctx.beginPath();
    ctx.ellipse((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, Math.abs(s.b.x - s.a.x) / 2 || 1, Math.abs(s.b.y - s.a.y) / 2 || 1, 0, 0, Math.PI * 2);
    ctx.stroke();
  } else if (s.tool === 'step') {
    const r = 17 * k;
    ctx.shadowBlur = 8 * k;
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(s.a.x, s.a.y, r + 3 * k, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = s.color;
    ctx.beginPath();
    ctx.arc(s.a.x, s.a.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = light(s.color) ? '#111318' : '#fff';
    ctx.font = `700 ${16 * k}px Inter, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(s.n), s.a.x, s.a.y + k);
  } else if (s.tool === 'text') {
    ctx.font = `650 ${18 * k}px Inter, system-ui, sans-serif`;
    const w = ctx.measureText(s.text).width + 24 * k;
    ctx.shadowBlur = 10 * k;
    ctx.beginPath();
    ctx.roundRect(s.a.x, s.a.y, w, 38 * k, 10 * k);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = light(s.color) ? '#111318' : '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(s.text, s.a.x + 12 * k, s.a.y + 19.5 * k);
  }
  ctx.restore();
}

export const inkTextColor = (c) => (light(c) ? '#111318' : '#fff');
