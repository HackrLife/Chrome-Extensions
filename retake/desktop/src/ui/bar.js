// Recording controls. This window is hidden from screen capture, so it never appears in the video.
import { ic } from '../../shared/core/icons.js';
import { COLORS } from '../../shared/core/callouts.js';
import { fmtClock } from '../../shared/core/format.js';

const api = window.retakeDesktop;
const pill = document.getElementById('pill');
const mac = api.platform === 'darwin';
const key = (k) => (mac ? `⌥⇧${k}` : `Alt+Shift+${k}`);
const TOOLS = [['pen', 'Pen'], ['hl', 'Highlighter'], ['arrow', 'Arrow'], ['rect', 'Box'], ['circle', 'Circle'], ['step', 'Numbered step'], ['text', 'Text']];
let state = null, retakeCountdown = true;
const draw = { tool: 'pen', color: COLORS[0], size: 'M', fade: 5000 };

const cmd = (c, extra = {}) => api.call('command', { cmd: c, ...extra });
const elapsed = () => (state ? state.base + (state.status === 'recording' && state.since ? (Date.now() - state.since) / 1000 : 0) : 0);

function render() {
  if (!state) return;
  const s = state.status;
  const warn = state.warning ? `<div class="warn">${state.warning}</div>` : '';
  if (s === 'preparing' || s === 'saving' || s === 'idle') {
    pill.innerHTML = `${warn}<div class="row1"><span class="grip">${ic('more', 14)}</span><span class="msg">${s === 'saving' ? 'Saving your recording…' : 'Getting ready…'}</span></div>`;
    return;
  }
  if (s === 'countdown') {
    pill.innerHTML = `${warn}<div class="row1"><span class="grip">${ic('more', 14)}</span><span class="msg">Recording starts in ${state.countdown}…</span>
      <button class="ib" data-c="discard" title="Cancel">${ic('x', 18)}</button></div>`;
    bind();
    return;
  }
  const paused = s === 'paused' || s === 'retake';
  const top =
    s === 'retake'
      ? `<div class="confirm"><b>Retake the last part?</b><div class="trow">
           <label><input type="checkbox" id="rtCd" ${retakeCountdown ? 'checked' : ''}/> 3-second countdown</label>
           <button class="btn2 ghost" data-c="close-dialog">Keep it</button><button class="btn2 red" id="rtYes">Retake</button></div></div>`
      : state.drawing
        ? tray()
        : '';
  pill.innerHTML = `${top}${warn}<div class="row1">
    <span class="grip" title="Drag to move">${ic('more', 14)}</span>
    <span class="dot ${paused ? '' : 'pulse'}" style="background:${paused ? '#f79009' : 'var(--rec)'}"></span>
    <span class="clock" id="clock">${fmtClock(elapsed())}</span>
    <button class="ib" data-c="toggle-pause" title="${paused ? 'Resume' : 'Pause'} (${key('K')})">${ic(paused ? 'play' : 'pause', 19)}</button>
    <button class="ib" data-c="retake" title="Retake the last part (${key('U')})" ${state.parts || s === 'recording' ? '' : 'disabled'}>${ic('retake', 19)}</button>
    ${state.drawAllowed ? `<span class="sep"></span>
    <button class="ib ${state.drawing ? 'on' : ''}" data-c="draw-toggle" title="Draw on screen (${key('D')})">${ic('pen', 19)}</button>
    <button class="ib ${state.spotlight ? 'on' : ''}" data-c="spotlight-toggle" title="Spotlight the cursor">${ic('spot', 19)}</button>` : ''}
    <span class="sep"></span>
    <button class="ib" data-c="discard" title="Discard">${ic('trash', 18)}</button>
    <button class="fin" data-c="finish" title="Finish (${key('S')})">${ic('check', 15)} Finish</button>
  </div>`;
  bind();
}

function tray() {
  return `<div class="tray">
    <div class="trow"><div class="tools">${TOOLS.map(([t, n]) => `<button class="ib ${draw.tool === t ? 'on' : ''}" data-tool="${t}" title="${n}">${ic(t, 18)}</button>`).join('')}</div>
      <span class="sep"></span>${COLORS.map((c) => `<button class="sw ${draw.color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" title="Colour"></button>`).join('')}</div>
    <div class="trow"><span class="lbl">Fade</span><div class="seg2">${[[0, 'Off'], [3000, '3s'], [5000, '5s'], [10000, '10s']].map(([v, l]) => `<button class="${draw.fade === v ? 'on' : ''}" data-fade="${v}">${l}</button>`).join('')}</div>
      <span class="lbl">Size</span><div class="seg2">${['S', 'M', 'L'].map((k) => `<button class="${draw.size === k ? 'on' : ''}" data-size="${k}">${k}</button>`).join('')}</div>
      <button class="mini" data-d="undo">${ic('undo', 15)} Undo</button><button class="mini" data-d="clear">${ic('trash', 15)} Clear</button></div>
  </div>`;
}

function sendDraw(extra = {}) {
  cmd('draw-settings', { settings: { ...draw, ...extra } });
}

function bind() {
  pill.querySelectorAll('[data-c]').forEach((b) => (b.onclick = () => cmd(b.dataset.c)));
  pill.querySelectorAll('[data-tool]').forEach((b) => (b.onclick = () => ((draw.tool = b.dataset.tool), sendDraw(), render())));
  pill.querySelectorAll('[data-color]').forEach((b) => (b.onclick = () => ((draw.color = b.dataset.color), sendDraw(), render())));
  pill.querySelectorAll('[data-fade]').forEach((b) => (b.onclick = () => ((draw.fade = Number(b.dataset.fade)), sendDraw(), render())));
  pill.querySelectorAll('[data-size]').forEach((b) => (b.onclick = () => ((draw.size = b.dataset.size), sendDraw(), render())));
  pill.querySelectorAll('[data-d]').forEach((b) => (b.onclick = () => sendDraw({ [b.dataset.d]: true })));
  const cb = document.getElementById('rtCd');
  if (cb) cb.onchange = (e) => (retakeCountdown = e.target.checked);
  const yes = document.getElementById('rtYes');
  if (yes) yes.onclick = () => cmd('confirm-retake', { countdown: retakeCountdown });
}

let lastKey = '';
api.on('state', (s) => {
  const wasDrawing = state?.drawing;
  state = s;
  if (s.drawing && !wasDrawing) sendDraw();
  const k = JSON.stringify({ ...s, since: 0, base: 0 });
  if (k !== lastKey) {
    lastKey = k;
    render();
  }
});
setInterval(() => {
  const c = document.getElementById('clock');
  if (c) c.textContent = fmtClock(elapsed());
}, 250);
api.call('state').then((s) => ((state = s), render()));
