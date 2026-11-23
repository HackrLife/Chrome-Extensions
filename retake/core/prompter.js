// Teleprompter shared by the web app, the extension and the studio.
// It scrolls while recording, stops when paused, and on a retake goes back to where the
// discarded part began. The caller says when recording starts and stops, and when to rewind.

import { ic } from './icons.js';

const CSS = `
.rp{display:flex;flex-direction:column;height:100%;min-height:0;background:#111318;color:#fff;border-radius:16px;overflow:hidden;position:relative;font-family:Inter,system-ui,sans-serif}
.rp-head{height:38px;flex:none;display:flex;align-items:center;gap:2px;padding:0 6px 0 14px}
.rp-t{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.55);margin-right:auto;display:flex;align-items:center;gap:8px}
.rp-t i{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,.3);display:inline-block}
.rp-t i.on{background:#f0464b}
.rp-head button{height:28px;min-width:28px;border:0;background:transparent;color:#fff;border-radius:8px;display:grid;place-items:center;cursor:pointer;font:600 12px Inter,system-ui,sans-serif;padding:0 6px}
.rp-head button:hover{background:rgba(255,255,255,.12)}
.rp-v{font-size:12px;font-weight:600;color:rgba(255,255,255,.7);min-width:32px;text-align:center;font-variant-numeric:tabular-nums}
.rp-sep{width:1px;height:16px;background:rgba(255,255,255,.15);margin:0 4px}
.rp-scroll{flex:1;min-height:0;overflow-y:auto;padding:0 28px 0 30px;scrollbar-width:none;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 12%,#000 82%,transparent 100%);mask-image:linear-gradient(to bottom,transparent 0,#000 12%,#000 82%,transparent 100%)}
.rp-scroll::-webkit-scrollbar{display:none}
.rp-text{font-weight:500;line-height:1.55;letter-spacing:-.005em;color:#f3f4f6;white-space:pre-wrap;text-wrap:pretty;padding:18px 0 80vh;max-width:62ch}
.rp-mark{position:absolute;left:10px;width:0;height:0;border-top:7px solid transparent;border-bottom:7px solid transparent;border-left:9px solid #f0464b;transform:translateY(-50%);pointer-events:none}
.rp-empty{color:rgba(255,255,255,.5);font-weight:500}
.rp-cue{display:inline-block;font-size:.62em;font-weight:650;letter-spacing:.06em;text-transform:uppercase;color:#f0464b;background:rgba(240,70,75,.12);padding:2px 8px;border-radius:6px;margin:4px 0;vertical-align:middle}`;

const BASE = 34; // pixels a second at 1× and 28px text

export function mountPrompter(root, { text = '', speed = 1, size = 28 } = {}) {
  const doc = root.ownerDocument;
  if (!doc.getElementById('rp-style')) {
    const st = doc.createElement('style');
    st.id = 'rp-style';
    st.textContent = CSS;
    doc.head.append(st);
  }
  root.innerHTML = `<div class="rp">
    <div class="rp-head">
      <span class="rp-t"><i></i>Script</span>
      <button data-a="hold" title="Stop or start scrolling (Space)"></button>
      <button data-a="top" title="Back to the start">${ic('undo', 15)}</button>
      <span class="rp-sep"></span>
      <button data-a="slower" title="Slower">−</button><span class="rp-v"></span><button data-a="faster" title="Faster">+</button>
      <span class="rp-sep"></span>
      <button data-a="smaller" title="Smaller text">A−</button><button data-a="bigger" title="Bigger text">A+</button>
    </div>
    <div class="rp-scroll"><div class="rp-text"></div></div>
    <div class="rp-mark"></div></div>`;
  const box = root.querySelector('.rp');
  const scroller = root.querySelector('.rp-scroll');
  const body = root.querySelector('.rp-text');
  const live = root.querySelector('.rp-t i');
  let held = false, recording = false, pos = 0, last = 0, raf = 0, alive = true;
  const marks = [];

  // Stage directions and timings in square brackets, like [0:20 – 0:50] or [show the canvas],
  // are shown as small labels, not read out.
  const esc = (x) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const setText = (t) => {
    body.classList.toggle('rp-empty', !t.trim());
    body.innerHTML = t.trim() ? esc(t).replace(/\[([^\]\n]{1,80})\]/g, '<span class="rp-cue">$1</span>') : 'No script yet.';
  };
  const apply = () => {
    body.style.fontSize = `${size}px`;
    root.querySelector('.rp-v').textContent = `${+speed.toFixed(2)}×`;
    root.querySelector('[data-a=hold]').innerHTML = ic(held ? 'play' : 'pause', 15);
    live.classList.toggle('on', recording && !held);
    root.querySelector('.rp-mark').style.top = `${38 + 18 + size * 0.78}px`;
  };
  const actions = {
    hold: () => (held = !held),
    top: () => ((pos = 0), (scroller.scrollTop = 0)),
    slower: () => (speed = Math.max(0.25, +(speed - 0.25).toFixed(2))),
    faster: () => (speed = Math.min(4, +(speed + 0.25).toFixed(2))),
    smaller: () => (size = Math.max(16, size - 3)),
    bigger: () => (size = Math.min(64, size + 3)),
  };
  box.addEventListener('click', (e) => {
    const b = e.target.closest('[data-a]');
    if (!b) return;
    actions[b.dataset.a]();
    apply();
  });
  scroller.addEventListener('wheel', () => setTimeout(() => (pos = scroller.scrollTop), 0), { passive: true });
  const win = doc.defaultView;
  const frame = (t) => {
    if (!alive) return;
    const dt = last ? Math.min(0.1, (t - last) / 1000) : 0;
    last = t;
    if (recording && !held) {
      pos += BASE * speed * (size / 28) * dt;
      scroller.scrollTop = pos;
    }
    raf = win.requestAnimationFrame(frame);
  };
  raf = win.requestAnimationFrame(frame);
  setText(text);
  apply();

  return {
    // Call with true when a part starts recording and false when it stops.
    setRecording(on) {
      if (on && !recording) marks.push(scroller.scrollTop);
      recording = on;
      apply();
    },
    // Call when the last part is thrown away: go back to where it began.
    rewind() {
      if (!marks.length) return;
      pos = marks.pop();
      scroller.scrollTo({ top: pos, behavior: 'smooth' });
    },
    toggleHold() {
      held = !held;
      apply();
    },
    setText,
    destroy() {
      alive = false;
      win.cancelAnimationFrame(raf);
      root.innerHTML = '';
    },
  };
}

export const wordCount = (t) => (String(t || '').match(/\S+/g) || []).length;
export const readingMinutes = (t, speed = 1) => Math.max(1, Math.round(wordCount(t) / (140 * speed)));
