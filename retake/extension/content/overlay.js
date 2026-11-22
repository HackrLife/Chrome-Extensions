// Retake on-page overlay. Injected into the tab being recorded or presented.
// Everything sits in a closed shadow root so the page's styles can't reach it, and
// the page can't read it. Drawings are drawn on the page, so they appear in the recording.

(() => {
  if (window.__retakeOverlay) {
    chrome.runtime.sendMessage({ type: 'get-state' }).then((r) => r?.state && window.__retakeOverlay.update(r.state)).catch(() => {});
    return;
  }

  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);
  const COLORS = ['#F0464B', '#2F54EB', '#F5D33D', '#1E9E6A', '#FFFFFF'];
  const SIZES = { S: 3, M: 5, L: 9 };
  const P = {
    pen: '<path d="M4 20l4.2-1.1L19 8.1 15.9 5 5.1 15.8z"/><path d="M13.5 7.4l3.1 3.1"/>',
    hl: '<path d="M8 14l7.5-7.5 3 3L11 17"/><path d="M8 14l3 3-2 2H5.5l1-2.5z"/><path d="M14 20h6"/>',
    line: '<path d="M5 19L19 5"/>',
    arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
    rect: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
    circle: '<circle cx="12" cy="12" r="8"/>',
    text: '<path d="M6 6h12"/><path d="M12 6v13"/>',
    step: '<circle cx="12" cy="12" r="8.5"/><path d="M11 9.2l1.6-1v7.6"/>',
    pause: '<rect x="7" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.8" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none"/>',
    play: '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>',
    stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
    retake: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
    cam: '<rect x="3" y="7" width="12.5" height="10" rx="2.2"/><path d="M15.5 10.5l5-3v9l-5-3"/>',
    spot: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
    click: '<path d="M9 9l10 4-4 1.6L13.4 19z"/><path d="M5 5l2 2M9 3v2.5M3 9h2.5"/>',
    shot: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
    grip: '<circle cx="9" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="7" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none"/><circle cx="9" cy="17" r="1.1" fill="currentColor" stroke="none"/><circle cx="15" cy="17" r="1.1" fill="currentColor" stroke="none"/>',
    x: '<path d="M6 6l12 12M18 6L6 18"/>',
    undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
    trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  };
  const ic = (n, s = 20, w = 1.8) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n]}</svg>`;
  const clock = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
  };
  const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;
  const send = (msg) => chrome.runtime.sendMessage(msg).catch(() => ({ ok: false }));

  const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: Inter, "DM Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; -webkit-font-smoothing: antialiased; }
  button { font: inherit; background: none; border: 0; color: inherit; cursor: pointer; padding: 0; margin: 0; }
  svg { display: block; flex: none; }
  .layer { position: fixed; inset: 0; pointer-events: none; }
  canvas.ink { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
  canvas.ink.drawing { pointer-events: auto; cursor: crosshair; }
  .spot { position: fixed; inset: 0; pointer-events: none; display: none; }
  .ring { position: fixed; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 3px solid rgba(240,70,75,.85); background: rgba(240,70,75,.28); pointer-events: none; animation: ring .6s ease-out forwards; }
  @keyframes ring { from { transform: scale(.6); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }
  .keys { position: fixed; left: 50%; bottom: 112px; transform: translateX(-50%); display: none; gap: 6px; align-items: center; background: rgba(17,19,24,.88); padding: 8px 12px; border-radius: 12px; color: #fff; font-weight: 650; font-size: 15px; box-shadow: 0 8px 20px rgba(0,0,0,.25); pointer-events: none; }
  .keys .k { background: #2E3138; border: 1px solid #474B54; border-bottom-width: 3px; border-radius: 7px; padding: 3px 9px; }
  .keys .plus { color: #8D929B; }
  .bar { position: fixed; height: 60px; border-radius: 30px; background: #17191E; color: #fff; display: flex; align-items: center; padding: 0 8px 0 6px; gap: 4px; box-shadow: 0 18px 44px rgba(10,12,20,.35), 0 2px 6px rgba(10,12,20,.25); font-size: 13px; pointer-events: auto; transition: opacity .35s; user-select: none; }
  .bar.hidden { opacity: 0; }
  .bb { width: 44px; height: 44px; border-radius: 22px; display: grid; place-items: center; color: #D7DAE0; position: relative; }
  .bb:hover { background: #24272D; color: #fff; }
  .bb.on { background: #2E3138; color: #fff; }
  .bb[disabled] { opacity: .35; cursor: default; }
  .bb .tip { position: absolute; bottom: 54px; left: 50%; transform: translateX(-50%); background: #fff; color: #111318; font-size: 11.5px; font-weight: 600; padding: 5px 9px; border-radius: 7px; white-space: nowrap; box-shadow: 0 6px 18px rgba(0,0,0,.18); opacity: 0; pointer-events: none; transition: opacity .12s; }
  .bb:hover .tip { opacity: 1; }
  .sep { width: 1px; height: 26px; background: #363941; margin: 0 6px; }
  .grip { color: #5A5E67; width: 24px; height: 44px; display: grid; place-items: center; cursor: grab; }
  .timer { display: flex; align-items: center; gap: 9px; padding: 0 12px 0 6px; font-variant-numeric: tabular-nums; font-weight: 600; font-size: 14.5px; letter-spacing: .2px; white-space: nowrap; }
  .timer .sub { color: #9AA0A9; font-weight: 500; }
  .rd { width: 11px; height: 11px; border-radius: 50%; background: #F0464B; box-shadow: 0 0 0 4px rgba(240,70,75,.25); animation: blink 1.6s infinite; }
  .rd.paused { background: #F5B83D; box-shadow: 0 0 0 4px rgba(245,184,61,.25); animation: none; }
  .rd.present { background: #7C8BFF; box-shadow: 0 0 0 4px rgba(124,139,255,.25); animation: none; }
  @keyframes blink { 50% { opacity: .45; } }
  .done { height: 44px; border-radius: 22px; background: #F0464B; color: #fff; display: flex; align-items: center; gap: 8px; padding: 0 18px 0 14px; font-weight: 600; font-size: 13.5px; margin-left: 4px; white-space: nowrap; }
  .done.light { background: #fff; color: #111318; }
  .done:hover { filter: brightness(1.07); }
  .tray { position: fixed; background: #17191E; border-radius: 20px; color: #fff; box-shadow: 0 18px 44px rgba(10,12,20,.35); padding: 12px 14px; pointer-events: auto; display: none; user-select: none; }
  .tray .row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
  .tool { width: 42px; height: 42px; border-radius: 12px; display: grid; place-items: center; color: #D7DAE0; }
  .tool:hover { background: #24272D; }
  .tool.on { background: #fff; color: #111318; }
  .sw { width: 22px; height: 22px; border-radius: 50%; margin: 0 4px; }
  .sw.on { box-shadow: 0 0 0 2px #17191E, 0 0 0 4px #fff; }
  .divider { height: 1px; background: #2C2F36; margin: 12px -14px; }
  .lbl { font-size: 11px; color: #8D929B; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; }
  .seg { display: flex; background: #2A2D33; border-radius: 10px; padding: 3px; gap: 2px; }
  .seg button { padding: 6px 11px; border-radius: 8px; font-size: 12px; font-weight: 600; color: #B9BDC5; }
  .seg button.on { background: #fff; color: #111318; }
  .mini { display: flex; align-items: center; gap: 6px; color: #B9BDC5; font-size: 12px; font-weight: 600; padding: 6px 8px; border-radius: 8px; }
  .mini:hover { background: #24272D; color: #fff; }
  .count { position: fixed; inset: 0; display: none; place-items: center; pointer-events: none; background: rgba(15,17,22,.25); }
  .count .n { width: 150px; height: 150px; border-radius: 50%; background: rgba(17,19,24,.9); color: #fff; display: grid; place-items: center; font-size: 72px; font-weight: 700; box-shadow: 0 24px 60px rgba(0,0,0,.35); animation: pop .9s ease-out; }
  .count .hint { position: absolute; top: calc(50% + 100px); color: #fff; font-size: 14px; font-weight: 600; text-shadow: 0 1px 6px rgba(0,0,0,.6); text-align: center; line-height: 1.6; }
  @keyframes pop { from { transform: scale(1.25); opacity: .2; } to { transform: scale(1); opacity: 1; } }
  .cam { position: fixed; border-radius: 50%; overflow: hidden; box-shadow: 0 14px 34px rgba(0,0,0,.3), 0 0 0 4px #fff; pointer-events: auto; cursor: grab; background: #2D3446; display: none; }
  .cam iframe { width: 100%; height: 100%; border: 0; pointer-events: none; display: block; }
  .dialog { position: fixed; width: 440px; background: #fff; color: #111318; border-radius: 18px; padding: 22px; pointer-events: auto; box-shadow: 0 24px 60px rgba(10,12,20,.32), 0 0 0 1px rgba(10,12,20,.06); }
  .dialog h3 { margin: 0; font-size: 17px; font-weight: 650; letter-spacing: -.2px; }
  .dialog p { margin: 12px 0 18px; font-size: 13.5px; line-height: 1.5; color: #6B7079; }
  .dialog p b { color: #111318; }
  .dhead { display: flex; align-items: center; justify-content: space-between; }
  .dicon { width: 36px; height: 36px; border-radius: 12px; background: #FDECEC; color: #F0464B; display: grid; place-items: center; }
  .strip { position: relative; height: 26px; }
  .strip .s { position: absolute; top: 0; bottom: 0; border-radius: 6px; background: #DDE1E7; }
  .strip .s.last { background: repeating-linear-gradient(135deg,#F0464B 0 6px,#F47478 6px 12px); }
  .marks { position: relative; height: 30px; margin: 6px 0 12px; font-size: 11px; color: #6B7079; font-variant-numeric: tabular-nums; }
  .marks span { position: absolute; top: 0; }
  .marks .rep { right: 0; top: 15px; color: #F0464B; font-weight: 600; }
  .check { display: flex; align-items: center; gap: 10px; font-size: 13px; font-weight: 500; margin-bottom: 20px; cursor: pointer; }
  .box { width: 20px; height: 20px; border-radius: 6px; border: 1.5px solid #C7CBD1; display: grid; place-items: center; color: #fff; }
  .box.on { background: #111318; border-color: #111318; }
  .btns { display: flex; gap: 10px; }
  .btn { height: 48px; border-radius: 24px; display: flex; align-items: center; justify-content: center; gap: 10px; font-weight: 650; font-size: 14px; flex: 1; }
  .btn.ghost { background: #F3F4F6; }
  .btn.rec { background: #F0464B; color: #fff; flex: 1.4; }
  .hintline { text-align: center; font-size: 11.5px; margin-top: 12px; color: #6B7079; }
  .toast { position: fixed; left: 50%; top: 24px; transform: translateX(-50%); background: #111318; color: #fff; padding: 11px 16px; border-radius: 12px; font-size: 13px; font-weight: 600; box-shadow: 0 12px 30px rgba(0,0,0,.25); pointer-events: auto; display: none; max-width: 520px; line-height: 1.4; }
  .flash { position: fixed; inset: 0; background: #fff; opacity: 0; pointer-events: none; }
  .flash.go { animation: flash .35s ease-out; }
  @keyframes flash { from { opacity: .7; } to { opacity: 0; } }
  .textin { position: fixed; pointer-events: auto; min-width: 120px; font-weight: 650; font-size: 16px; padding: 6px 10px; border-radius: 9px; border: 2px dashed rgba(255,255,255,.8); outline: none; color: #fff; }
  `;

  // ---------- DOM ----------
  const host = document.createElement('retake-overlay');
  host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;pointer-events:none;';
  const root = host.attachShadow({ mode: 'closed' });
  root.innerHTML = `<style>${CSS}</style>
    <canvas class="ink"></canvas>
    <div class="spot"></div>
    <div class="layer fx"></div>
    <div class="keys"></div>
    <div class="cam"></div>
    <div class="count"></div>
    <div class="tray"></div>
    <div class="bar"></div>
    <div class="dlg"></div>
    <div class="toast"></div>
    <div class="flash"></div>`;
  document.documentElement.appendChild(host);
  const $ = (s) => root.querySelector(s);
  const ink = $('canvas.ink'), spot = $('.spot'), fx = $('.fx'), keysEl = $('.keys'), camEl = $('.cam');
  const countEl = $('.count'), tray = $('.tray'), bar = $('.bar'), dlg = $('.dlg'), toast = $('.toast'), flash = $('.flash');
  const ctx = ink.getContext('2d');

  let state = { status: 'idle' };
  let opts = {};
  let barPos = null; // {x, y} once dragged
  let drawing = false;
  let tool = 'pen', color = COLORS[0], fadeMs = 3000, sizeKey = 'M';
  let shapes = [];
  let current = null;
  let stepN = 1;
  let raf = 0;
  let timerInt = 0;
  let lastBarKey = '';
  let lastPointer = { x: innerWidth / 2, y: innerHeight / 2 };
  let idleTimer = 0;
  let keysTimer = 0;
  let toastTimer = 0;
  let retakeCountdown = true;

  // ---------- sizing ----------
  function sizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    ink.width = Math.round(innerWidth * dpr);
    ink.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paint();
    placeBar();
  }

  // ---------- control bar ----------
  const elapsed = () => {
    const done = (state.segments || []).reduce((s, x) => s + (x.duration || 0), 0);
    const live = state.status === 'recording' && state.segmentStartedAt ? (Date.now() - state.segmentStartedAt) / 1000 : 0;
    return done + live;
  };

  function bb(act, icon, tip, on = false, disabled = false) {
    return `<button class="bb ${on ? 'on' : ''}" data-act="${act}" ${disabled ? 'disabled' : ''} aria-label="${tip}">${ic(icon, 20)}<span class="tip">${tip}</span></button>`;
  }

  function renderBar() {
    const st = state.status;
    const key = [st, drawing, opts.spotlight, opts.camera, opts.clickPulse, (state.segments || []).length].join('|');
    if (key === lastBarKey) return updateTimer();
    lastBarKey = key;
    const grip = `<div class="grip" data-grip title="Drag to move">${ic('grip', 18)}</div>`;
    if (st === 'presenting') {
      bar.innerHTML = `${grip}
        <div class="timer"><span class="rd present"></span>Presenting<span class="sub">· not recording</span></div>
        <div class="sep"></div>
        ${bb('draw', 'pen', 'Draw (Alt+Shift+D)', drawing)}
        ${bb('spotlight', 'spot', 'Spotlight', opts.spotlight)}
        ${bb('clickPulse', 'click', 'Click pulse', opts.clickPulse)}
        <div class="sep"></div>
        <button class="done light" data-act="record"><span class="rd" style="animation:none;width:10px;height:10px;box-shadow:none"></span>Start recording</button>
        ${bb('close', 'x', 'Stop presenting')}`;
    } else {
      const recording = st === 'recording';
      const paused = st === 'paused';
      const label = st === 'countdown' ? '<span class="sub">Starting…</span>' : paused ? '<span class="sub">Paused</span>' : st === 'saving' ? '<span class="sub">Saving…</span>' : '';
      const canRetake = recording || (state.segments || []).length > 0;
      bar.innerHTML = `${grip}
        <div class="timer"><span class="rd ${recording ? '' : 'paused'}"></span><span class="t">${clock(elapsed())}</span>${label}</div>
        ${bb('pause', recording ? 'pause' : 'play', recording ? 'Pause (Alt+Shift+K)' : 'Resume (Alt+Shift+K)', false, !(recording || paused))}
        ${bb('retake', 'retake', 'Retake last part (Alt+Shift+U)', state.dialog === 'retake', !canRetake)}
        <div class="sep"></div>
        ${bb('draw', 'pen', 'Draw (Alt+Shift+D)', drawing)}
        ${bb('spotlight', 'spot', 'Spotlight', opts.spotlight)}
        ${bb('camera', 'cam', opts.camera ? 'Hide camera' : 'Show camera', opts.camera)}
        ${bb('shot', 'shot', 'Screenshot')}
        <div class="sep"></div>
        <button class="done" data-act="finish">${ic('stop', 16)}Finish</button>`;
    }
    placeBar();
  }

  function updateTimer() {
    const t = bar.querySelector('.t');
    if (t) t.textContent = clock(elapsed());
  }

  function placeBar() {
    if (!bar.firstChild) return;
    const w = bar.offsetWidth || 560;
    const x = barPos ? barPos.x : (innerWidth - w) / 2;
    const y = barPos ? barPos.y : innerHeight - 60 - 28;
    const cx = Math.min(Math.max(8, x), innerWidth - w - 8);
    const cy = Math.min(Math.max(8, y), innerHeight - 68);
    bar.style.left = `${cx}px`;
    bar.style.top = `${cy}px`;
    if (drawing) {
      const tw = tray.offsetWidth || 680;
      tray.style.left = `${Math.min(Math.max(8, cx + w / 2 - tw / 2), innerWidth - tw - 8)}px`;
      tray.style.top = `${Math.max(8, cy - (tray.offsetHeight || 120) - 14)}px`;
    }
    keysEl.style.bottom = `${innerHeight - cy + 18}px`;
  }

  // The bar fades away while you work, so it rarely shows in the recording.
  function pointerNearBar() {
    const r = bar.getBoundingClientRect();
    return lastPointer.x > r.left - 140 && lastPointer.x < r.right + 140 && lastPointer.y > r.top - 140 && lastPointer.y < r.bottom + 140;
  }
  function bumpVisibility({ immediate = false } = {}) {
    clearTimeout(idleTimer);
    const canHide = state.status === 'recording' && !drawing && !state.dialog;
    if (canHide && immediate && !pointerNearBar()) {
      bar.style.transition = 'none';
      bar.classList.add('hidden');
      void bar.offsetWidth;
      bar.style.transition = '';
      return;
    }
    bar.classList.remove('hidden');
    if (!canHide) return;
    idleTimer = setTimeout(() => {
      if (!pointerNearBar() && state.status === 'recording' && !drawing && !state.dialog) bar.classList.add('hidden');
    }, 2500);
  }

  // ---------- tray (drawing tools) ----------
  function renderTray() {
    if (!drawing) {
      tray.style.display = 'none';
      return;
    }
    const tools = ['pen', 'hl', 'line', 'arrow', 'rect', 'circle', 'text', 'step'];
    const names = { pen: 'Pen', hl: 'Highlighter', line: 'Line', arrow: 'Arrow', rect: 'Box', circle: 'Circle', text: 'Text', step: 'Numbered step' };
    tray.innerHTML = `
      <div class="row">
        <div class="row" style="gap:4px">${tools.map((t) => `<button class="tool ${tool === t ? 'on' : ''}" data-tool="${t}" title="${names[t]}" aria-label="${names[t]}">${ic(t, 21)}</button>`).join('')}</div>
        <div class="row" style="gap:2px">${COLORS.map((c) => `<button class="sw ${color === c ? 'on' : ''}" data-color="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div>
      </div>
      <div class="divider"></div>
      <div class="row">
        <div class="row" style="gap:10px"><span class="lbl">Fade</span><div class="seg">${[[0, 'Off'], [3000, '3s'], [5000, '5s'], [10000, '10s']].map(([v, l]) => `<button class="${fadeMs === v ? 'on' : ''}" data-fade="${v}">${l}</button>`).join('')}</div></div>
        <div class="row" style="gap:10px"><span class="lbl">Size</span><div class="seg">${Object.keys(SIZES).map((k) => `<button class="${sizeKey === k ? 'on' : ''}" data-size="${k}">${k}</button>`).join('')}</div></div>
        <div class="row" style="gap:2px"><button class="mini" data-act="undo">${ic('undo', 17)}Undo</button><button class="mini" data-act="clear">${ic('trash', 17)}Clear</button></div>
      </div>`;
    tray.style.display = 'block';
    placeBar();
  }

  function setDrawing(on) {
    drawing = on;
    ink.classList.toggle('drawing', on);
    if (!on) commitText();
    renderTray();
    lastBarKey = '';
    renderBar();
    bumpVisibility();
  }

  // ---------- drawing ----------
  const width = () => SIZES[sizeKey];

  function shapeAlpha(s, now) {
    if (!s.born || !s.fade) return 1;
    const age = now - s.born;
    if (age >= s.fade) return 0;
    return age > s.fade - 500 ? (s.fade - age) / 500 : 1;
  }

  function drawArrowHead(a, b, w) {
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
    ctx.strokeStyle = s.color;
    ctx.fillStyle = s.color;
    ctx.lineWidth = s.w;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
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
    } else if (s.tool === 'line' || s.tool === 'arrow') {
      ctx.beginPath();
      ctx.moveTo(s.a.x, s.a.y);
      ctx.lineTo(s.b.x, s.b.y);
      ctx.stroke();
      if (s.tool === 'arrow') drawArrowHead(s.a, s.b, s.w);
    } else if (s.tool === 'rect') {
      const x = Math.min(s.a.x, s.b.x), y = Math.min(s.a.y, s.b.y);
      const w = Math.abs(s.b.x - s.a.x), h = Math.abs(s.b.y - s.a.y);
      ctx.beginPath();
      ctx.roundRect(x, y, w, h, Math.min(12, w / 4, h / 4));
      ctx.stroke();
    } else if (s.tool === 'circle') {
      ctx.beginPath();
      ctx.ellipse((s.a.x + s.b.x) / 2, (s.a.y + s.b.y) / 2, Math.abs(s.b.x - s.a.x) / 2 || 1, Math.abs(s.b.y - s.a.y) / 2 || 1, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (s.tool === 'step') {
      const r = 15;
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
      ctx.fillStyle = s.color.toUpperCase() === '#FFFFFF' || s.color === '#F5D33D' ? '#111318' : '#fff';
      ctx.font = '700 15px Inter, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(String(s.n), s.a.x, s.a.y + 1);
    } else if (s.tool === 'text') {
      ctx.font = '650 16px Inter, system-ui, sans-serif';
      const w = ctx.measureText(s.text).width + 22;
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.roundRect(s.a.x, s.a.y, w, 34, 9);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = s.color.toUpperCase() === '#FFFFFF' || s.color === '#F5D33D' ? '#111318' : '#fff';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, s.a.x + 11, s.a.y + 17.5);
    }
    ctx.restore();
  }

  function paint() {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const now = performance.now();
    shapes = shapes.filter((s) => shapeAlpha(s, now) > 0);
    for (const s of shapes) {
      ctx.globalAlpha = shapeAlpha(s, now);
      drawShape(s);
    }
    ctx.globalAlpha = 1;
    if (current) drawShape(current);
  }

  function loop() {
    paint();
    if (shapes.some((s) => s.fade) || current) raf = requestAnimationFrame(loop);
    else raf = 0;
  }
  const kick = () => {
    if (!raf) raf = requestAnimationFrame(loop);
  };

  let textInput = null;
  function commitText() {
    if (!textInput) return;
    const value = textInput.value.trim();
    if (value) shapes.push({ tool: 'text', color, w: width(), a: textInput._at, text: value, born: performance.now(), fade: fadeMs });
    textInput.remove();
    textInput = null;
    kick();
  }

  ink.addEventListener('pointerdown', (e) => {
    if (!drawing || e.button !== 0) return;
    e.preventDefault();
    const p = { x: e.clientX, y: e.clientY };
    if (tool === 'text') {
      commitText();
      textInput = document.createElement('input');
      textInput.className = 'textin';
      textInput.placeholder = 'Type, then press Enter';
      textInput.style.left = `${p.x}px`;
      textInput.style.top = `${p.y}px`;
      textInput.style.background = color;
      textInput.style.color = color === '#FFFFFF' || color === '#F5D33D' ? '#111318' : '#fff';
      textInput._at = p;
      textInput.addEventListener('keydown', (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') commitText();
        if (ev.key === 'Escape') {
          textInput.remove();
          textInput = null;
        }
      });
      root.appendChild(textInput);
      setTimeout(() => textInput?.focus(), 0);
      return;
    }
    if (tool === 'step') {
      shapes.push({ tool, color, w: width(), a: p, n: stepN++, born: performance.now(), fade: fadeMs });
      kick();
      return;
    }
    ink.setPointerCapture(e.pointerId);
    current = tool === 'pen' || tool === 'hl' ? { tool, color, w: width(), pts: [p] } : { tool, color, w: width(), a: p, b: p };
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
    current.born = performance.now();
    current.fade = fadeMs;
    shapes.push(current);
    current = null;
    kick();
  });

  // ---------- spotlight, clicks, keys ----------
  function updateSpot() {
    const on = opts.spotlight && ['recording', 'paused', 'presenting', 'countdown'].includes(state.status);
    spot.style.display = on ? 'block' : 'none';
    if (on) spot.style.background = `radial-gradient(circle at ${lastPointer.x}px ${lastPointer.y}px, rgba(0,0,0,0) 0, rgba(0,0,0,0) 110px, rgba(8,10,14,.55) 160px)`;
  }

  const onMove = (e) => {
    lastPointer = { x: e.clientX, y: e.clientY };
    if (opts.spotlight) updateSpot();
    if (bar.classList.contains('hidden')) {
      const r = bar.getBoundingClientRect();
      if (e.clientY > r.top - 120 && e.clientX > r.left - 120 && e.clientX < r.right + 120) bumpVisibility();
    }
  };

  const onDown = (e) => {
    if (e.composedPath().includes(host)) return;
    if (!opts.clickPulse || !['recording', 'presenting', 'paused', 'countdown'].includes(state.status)) return;
    const ring = document.createElement('div');
    ring.className = 'ring';
    ring.style.left = `${e.clientX}px`;
    ring.style.top = `${e.clientY}px`;
    fx.appendChild(ring);
    setTimeout(() => ring.remove(), 650);
  };

  const KEYNAME = { ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', ' ': 'Space', Escape: 'Esc' };
  const onKey = (e) => {
    if (e.composedPath().includes(host)) return;
    if (drawing && e.key === 'Escape') return setDrawing(false);
    if (drawing && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      shapes.pop();
      return kick();
    }
    if (!opts.keys || !['recording', 'presenting'].includes(state.status)) return;
    if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;
    if (e.target?.type === 'password') return;
    const special = ['Enter', 'Escape', 'Tab'].includes(e.key);
    if (!(e.ctrlKey || e.metaKey || e.altKey) && !special) return; // never show ordinary typing
    const parts = [];
    if (e.ctrlKey) parts.push(IS_MAC ? '⌃' : 'Ctrl');
    if (e.altKey) parts.push(IS_MAC ? '⌥' : 'Alt');
    if (e.shiftKey) parts.push(IS_MAC ? '⇧' : 'Shift');
    if (e.metaKey) parts.push(IS_MAC ? '⌘' : 'Win');
    const k = KEYNAME[e.key] || (e.key.length === 1 ? e.key.toUpperCase() : e.key);
    parts.push(k);
    keysEl.innerHTML = parts.map((p) => `<span class="k">${p.replace(/</g, '&lt;')}</span>`).join('<span class="plus">+</span>');
    keysEl.style.display = 'flex';
    clearTimeout(keysTimer);
    keysTimer = setTimeout(() => (keysEl.style.display = 'none'), 1600);
  };

  // ---------- camera bubble ----------
  let camPos = null;
  let camSize = 150;
  function updateCamera() {
    const want = opts.camera && ['recording', 'paused', 'countdown', 'preparing'].includes(state.status);
    if (!want) {
      if (camEl.firstChild) camEl.innerHTML = '';
      camEl.style.display = 'none';
      return;
    }
    if (!camEl.firstChild) {
      const f = document.createElement('iframe');
      f.allow = 'camera';
      f.src = chrome.runtime.getURL(`pages/camera.html?cam=${encodeURIComponent(opts.camId || 'default')}`);
      camEl.appendChild(f);
    }
    camEl.style.display = 'block';
    camEl.style.width = camEl.style.height = `${camSize}px`;
    const p = camPos || { x: 28, y: innerHeight - camSize - 28 };
    camEl.style.left = `${Math.min(Math.max(8, p.x), innerWidth - camSize - 8)}px`;
    camEl.style.top = `${Math.min(Math.max(8, p.y), innerHeight - camSize - 8)}px`;
  }
  camEl.addEventListener('dblclick', () => {
    camSize = camSize === 150 ? 220 : camSize === 220 ? 110 : 150;
    updateCamera();
  });

  // ---------- dragging ----------
  function draggable(el, getPos, setPos, handleSel) {
    el.addEventListener('pointerdown', (e) => {
      if (handleSel && !e.target.closest(handleSel)) return;
      const start = { x: e.clientX, y: e.clientY };
      const r = el.getBoundingClientRect();
      const origin = { x: r.left, y: r.top };
      el.setPointerCapture(e.pointerId);
      const move = (ev) => setPos({ x: origin.x + ev.clientX - start.x, y: origin.y + ev.clientY - start.y });
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
    });
  }
  draggable(bar, null, (p) => {
    barPos = p;
    placeBar();
  }, '[data-grip]');
  draggable(camEl, null, (p) => {
    camPos = p;
    updateCamera();
  });

  // ---------- countdown ----------
  let countInt = 0;
  function updateCountdown() {
    clearInterval(countInt);
    if (state.status !== 'countdown' || !state.countdownEndsAt) {
      countEl.style.display = 'none';
      return;
    }
    const tick = () => {
      const ms = state.countdownEndsAt - Date.now();
      const left = Math.ceil(ms / 1000);
      if (ms <= 120) {
        countEl.style.display = 'none';
        clearInterval(countInt);
        return;
      }
      const n = String(left);
      if (countEl.dataset.n !== n) {
        countEl.dataset.n = n;
        countEl.innerHTML = `<div class="n">${n}</div><div class="hint">Recording starts in ${n}…<br><span style="font-weight:500;opacity:.85">The controls hide while you record. Move the pointer to them to bring them back.</span></div>`;
      }
      countEl.style.display = 'grid';
    };
    tick();
    countInt = setInterval(tick, 100);
  }

  // ---------- retake dialog ----------
  function renderDialog() {
    if (state.dialog !== 'retake') {
      dlg.innerHTML = '';
      return;
    }
    const segs = state.segments || [];
    const last = segs[segs.length - 1];
    if (!last) return;
    const total = segs.reduce((s, x) => s + x.duration, 0) || 1;
    const from = total - last.duration;
    let acc = 0;
    const blocks = segs
      .map((s, i) => {
        const left = (acc / total) * 100;
        const w = (s.duration / total) * 100;
        acc += s.duration;
        return `<div class="s ${i === segs.length - 1 ? 'last' : ''}" style="left:${left}%;width:calc(${w}% - 4px)"></div>`;
      })
      .join('');
    acc = 0;
    const marks = segs
      .map((s) => {
        const m = `<span style="left:${(acc / total) * 100}%">${mmss(acc)}</span>`;
        acc += s.duration;
        return m;
      })
      .join('');
    const secs = Math.max(1, Math.round(last.duration));
    const shortcut = IS_MAC ? '⌥ ⇧ U' : 'Alt + Shift + U';
    dlg.innerHTML = `<div class="dialog" role="dialog" aria-label="Retake">
      <div class="dhead"><div style="display:flex;align-items:center;gap:10px"><div class="dicon">${ic('retake', 20, 2)}</div><h3>Retake the last ${secs} second${secs === 1 ? '' : 's'}?</h3></div><button data-act="close-dialog" aria-label="Close" style="color:#6B7079">${ic('x', 18)}</button></div>
      <p>Recording rewinds to <b>${mmss(from)}</b>, the point where you last paused. Everything before it stays exactly as it is.</p>
      <div class="strip">${blocks}</div>
      <div class="marks">${marks}<span class="rep">to be replaced</span></div>
      <label class="check" data-act="toggle-retake-countdown"><span class="box ${retakeCountdown ? 'on' : ''}">${ic('check', 14, 2.6)}</span>Count down 3 seconds before recording resumes</label>
      <div class="btns"><button class="btn ghost" data-act="close-dialog">Keep it</button><button class="btn rec" data-act="confirm-retake">${ic('retake', 18, 2.2)}Retake from ${mmss(from)}</button></div>
      <div class="hintline">Shortcut: ${shortcut} retakes instantly</div>
    </div>`;
    const d = dlg.firstElementChild;
    const br = bar.getBoundingClientRect();
    d.style.left = `${Math.min(Math.max(12, br.left + br.width / 2 - 220), innerWidth - 452)}px`;
    d.style.top = `${Math.max(12, br.top - d.offsetHeight - 16)}px`;
  }

  // ---------- toast ----------
  function showToast(text) {
    if (!text) return;
    toast.textContent = text;
    toast.style.display = 'block';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
      send({ type: 'clear-notice' });
    }, 4500);
  }

  // ---------- actions ----------
  async function screenshot() {
    bar.style.visibility = 'hidden';
    tray.style.visibility = 'hidden';
    keysEl.style.display = 'none';
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const res = await send({ type: 'screenshot' });
    bar.style.visibility = '';
    tray.style.visibility = '';
    flash.classList.remove('go');
    void flash.offsetWidth;
    flash.classList.add('go');
    showToast(res?.ok ? 'Screenshot saved to your Downloads folder, in Retake.' : 'Could not take a screenshot of this page.');
  }

  root.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-act],[data-tool],[data-color],[data-fade],[data-size]');
    if (!t || t.disabled) return;
    if (t.dataset.tool) {
      commitText();
      tool = t.dataset.tool;
      return renderTray();
    }
    if (t.dataset.color) {
      color = t.dataset.color;
      return renderTray();
    }
    if (t.dataset.fade) {
      fadeMs = Number(t.dataset.fade);
      return renderTray();
    }
    if (t.dataset.size) {
      sizeKey = t.dataset.size;
      return renderTray();
    }
    const act = t.dataset.act;
    if (act === 'draw') return setDrawing(!drawing);
    if (act === 'undo') {
      shapes.pop();
      return kick();
    }
    if (act === 'clear') {
      shapes = [];
      stepN = 1;
      return kick();
    }
    if (act === 'pause') return send({ type: state.status === 'recording' ? 'pause' : 'resume' });
    if (act === 'retake') return send({ type: 'request-retake' });
    if (act === 'close-dialog') return send({ type: 'close-dialog' });
    if (act === 'toggle-retake-countdown') {
      e.preventDefault();
      retakeCountdown = !retakeCountdown;
      return renderDialog();
    }
    if (act === 'confirm-retake') return send({ type: 'confirm-retake', countdown: retakeCountdown });
    if (act === 'finish') return send({ type: 'finish' });
    if (act === 'shot') return screenshot();
    if (act === 'spotlight' || act === 'camera' || act === 'clickPulse') return send({ type: 'set-option', key: act, value: !opts[act] });
    if (act === 'close') return send({ type: 'cancel' });
    if (act === 'record') {
      const res = await send({ type: 'start-from-present', size: { width: innerWidth, height: innerHeight, dpr: window.devicePixelRatio || 1 } });
      if (!res?.ok) showToast(res?.error || 'Click the Retake icon in the toolbar, then Start recording.');
    }
  });

  // ---------- state ----------
  function update(next) {
    const wasRecording = state.status === 'recording';
    state = next || { status: 'idle' };
    opts = state.options || {};
    if (state.status === 'idle') return teardown();
    renderBar();
    if (state.dialog === 'retake' && drawing) setDrawing(false);
    renderDialog();
    updateCountdown();
    updateCamera();
    updateSpot();
    bumpVisibility({ immediate: !wasRecording && state.status === 'recording' });
    clearInterval(timerInt);
    if (state.status === 'recording') timerInt = setInterval(updateTimer, 250);
    if (state.notice || state.error) showToast(state.notice || state.error);
  }

  function teardown() {
    clearInterval(timerInt);
    clearInterval(countInt);
    cancelAnimationFrame(raf);
    window.removeEventListener('pointermove', onMove, true);
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('keydown', onKey, true);
    window.removeEventListener('resize', sizeCanvas);
    chrome.runtime.onMessage.removeListener(onMessage);
    host.remove();
    delete window.__retakeOverlay;
  }

  function onMessage(msg) {
    if (msg?.type === 'state') update(msg.state);
    else if (msg?.type === 'teardown') teardown();
    else if (msg?.type === 'toggle-draw') setDrawing(!drawing);
  }

  window.addEventListener('pointermove', onMove, true);
  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', sizeCanvas);
  chrome.runtime.onMessage.addListener(onMessage);
  window.__retakeOverlay = { update };
  sizeCanvas();
  send({ type: 'get-state' }).then((r) => r?.state && update(r.state));
})();
