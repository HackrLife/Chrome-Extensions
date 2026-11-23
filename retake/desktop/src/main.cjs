// Retake desktop: main process.
// Windows: panel (set up a recording), recorder (hidden, does the recording), bubble (camera,
// floats over everything and is filmed on full-screen recordings), bar (controls, kept out of
// the recording) and overlay (countdown, drawing and spotlight over the recorded screen).

const { app, BrowserWindow, ipcMain, desktopCapturer, screen, systemPreferences, globalShortcut, protocol, net, shell, session, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

const isMac = process.platform === 'darwin';
const ROOT = app.getAppPath();
const page = (p) => `app://retake/${p}`;
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } }]);

if (!app.requestSingleInstanceLock()) app.quit();

let panel = null, recorderWin = null, bubble = null, bar = null, overlay = null, prompter = null;
const viewers = new Set(); // editor and library windows
let recorderReady = null;
let opts = null, recordingId = null, target = null, sources = new Map();
let cursorTimer = null, warnTimer = null;

const fresh = () => ({ status: 'idle', base: 0, since: 0, parts: 0, countdown: 0, drawing: false, spotlight: false, drawAllowed: false, source: null, warning: '', error: '', platform: process.platform });
let state = fresh();

function setState(patch) {
  state = { ...state, ...patch };
  for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send('evt:state', state);
  sizeBar();
}

function makeWindow(file, options = {}) {
  const w = new BrowserWindow({
    show: false,
    backgroundColor: options.transparent ? '#00000000' : '#f3f4f6',
    ...options,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: false },
  });
  w.loadURL(page(file));
  w.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  w.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/.test(url)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  return w;
}

// ---------- panel ----------
function showPanel() {
  if (panel && !panel.isDestroyed()) {
    panel.show();
    panel.focus();
    return panel;
  }
  panel = makeWindow('src/ui/panel.html', { width: 440, height: 760, minWidth: 400, minHeight: 600, title: 'Retake', titleBarStyle: isMac ? 'hiddenInset' : 'default' });
  panel.once('ready-to-show', () => panel.show());
  panel.on('closed', () => {
    panel = null;
    if (state.status === 'idle') closeBubble();
    maybeQuit();
  });
  return panel;
}

function maybeQuit() {
  if (panel || viewers.size || state.status !== 'idle') return;
  if (!isMac) app.quit();
}

// ---------- viewers: editor and library ----------
function openViewer(file) {
  const wa = screen.getPrimaryDisplay().workArea;
  const w = makeWindow(file, { width: Math.min(1480, wa.width), height: Math.min(940, wa.height), minWidth: 1000, minHeight: 640, title: 'Retake' });
  w.once('ready-to-show', () => w.show());
  viewers.add(w);
  w.on('closed', () => {
    viewers.delete(w);
    if (!viewers.size && state.status === 'idle' && !panel) showPanel();
  });
  return w;
}

// ---------- recorder (hidden) ----------
const pending = new Map();
let seq = 0;
function ensureRecorder() {
  if (recorderWin && !recorderWin.isDestroyed()) return recorderReady;
  recorderReady = new Promise((resolve) => ipcMain.once('recorder-ready', resolve));
  recorderWin = makeWindow('src/ui/recorder.html', { width: 400, height: 300, skipTaskbar: true, focusable: false });
  recorderWin.on('closed', () => (recorderWin = null));
  return recorderReady;
}
function rec(op, data = {}) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    recorderWin.webContents.send('evt:rec-op', { id, op, data });
  });
}

// ---------- camera bubble ----------
const BUBBLE = [150, 220, 320];
let bubbleSize = 1, bubbleCam = '';
function showBubble(camId) {
  bubbleCam = camId || '';
  if (bubble && !bubble.isDestroyed()) {
    bubble.webContents.send('evt:bubble-cam', bubbleCam);
    return;
  }
  const wa = (target?.display || screen.getPrimaryDisplay()).workArea;
  const s = BUBBLE[bubbleSize];
  bubble = makeWindow(`src/ui/bubble.html?cam=${encodeURIComponent(bubbleCam)}`, {
    x: wa.x + 32, y: wa.y + wa.height - s - 32, width: s, height: s,
    transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, maximizable: false, minimizable: false,
  });
  bubble.setAlwaysOnTop(true, 'screen-saver', 2);
  bubble.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bubble.once('ready-to-show', () => bubble.showInactive());
  bubble.on('closed', () => (bubble = null));
}
function closeBubble() {
  if (bubble && !bubble.isDestroyed()) bubble.close();
  bubble = null;
}
function cycleBubble() {
  if (!bubble) return;
  const [x, y] = bubble.getPosition();
  const old = BUBBLE[bubbleSize];
  bubbleSize = (bubbleSize + 1) % BUBBLE.length;
  const s = BUBBLE[bubbleSize];
  bubble.setBounds({ x, y: y + old - s, width: s, height: s });
}

// ---------- control bar (not filmed) ----------
function barSize() {
  const extra = state.warning ? 34 : 0;
  if (state.status === 'retake') return { w: 520, h: 132 + extra };
  if (state.drawing) return { w: 640, h: 150 + extra };
  return { w: state.drawAllowed ? 500 : 410, h: 64 + extra };
}
function createBar() {
  const wa = target.display.workArea;
  const { w, h } = barSize();
  bar = makeWindow('src/ui/bar.html', {
    x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + wa.height - h - 24, width: w, height: h,
    transparent: true, frame: false, hasShadow: false, resizable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, maximizable: false, minimizable: false,
  });
  bar.setContentProtection(true); // keeps the controls out of the recording
  bar.setAlwaysOnTop(true, 'screen-saver', 3);
  bar.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  bar.once('ready-to-show', () => bar.showInactive());
  bar.on('closed', () => (bar = null));
}
function sizeBar() {
  if (!bar || bar.isDestroyed()) return;
  const { w, h } = barSize();
  const b = bar.getBounds();
  if (b.width === w && b.height === h) return;
  bar.setBounds({ x: Math.round(b.x + (b.width - w) / 2), y: b.y + b.height - h, width: w, height: h });
}

// ---------- teleprompter (not filmed) ----------
// Sits at the top centre, next to where laptop cameras are, so reading keeps you looking at the lens.
function createPrompter() {
  const wa = target.display.workArea;
  const w = Math.min(680, wa.width - 40), h = 210;
  prompter = makeWindow('src/ui/prompter.html', {
    x: Math.round(wa.x + (wa.width - w) / 2), y: wa.y + 8, width: w, height: h, minWidth: 360, minHeight: 140,
    transparent: true, frame: false, hasShadow: false, resizable: true, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, maximizable: false, minimizable: false,
  });
  prompter.setContentProtection(true);
  prompter.setAlwaysOnTop(true, 'screen-saver', 3);
  prompter.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  prompter.once('ready-to-show', () => prompter.showInactive());
  prompter.on('closed', () => (prompter = null));
}

// ---------- overlay: countdown, drawing, spotlight ----------
function createOverlay() {
  const b = target.display.bounds;
  overlay = makeWindow('src/ui/overlay.html', {
    x: b.x, y: b.y, width: b.width, height: b.height,
    transparent: true, frame: false, hasShadow: false, resizable: false, movable: false, skipTaskbar: true, alwaysOnTop: true, fullscreenable: false, enableLargerThanScreen: true, minimizable: false, maximizable: false,
  });
  overlay.setAlwaysOnTop(true, 'screen-saver', 1);
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.setIgnoreMouseEvents(true, { forward: true });
  overlay.once('ready-to-show', () => overlay.showInactive());
  overlay.on('closed', () => (overlay = null));
}
function setDrawing(on) {
  if (!overlay || !state.drawAllowed) return;
  setState({ drawing: on });
  if (on) {
    overlay.setIgnoreMouseEvents(false);
    overlay.focus();
  } else overlay.setIgnoreMouseEvents(true, { forward: true });
}
function setSpotlight(on) {
  if (!state.drawAllowed) return;
  setState({ spotlight: on });
  clearInterval(cursorTimer);
  if (on)
    cursorTimer = setInterval(() => {
      if (!overlay || overlay.isDestroyed()) return;
      const p = screen.getCursorScreenPoint();
      const b = target.display.bounds;
      overlay.webContents.send('evt:cursor', { x: p.x - b.x, y: p.y - b.y });
    }, 16);
}

// ---------- recording flow ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function displayFor(o) {
  const all = screen.getAllDisplays();
  if (o.kind === 'screen') {
    const src = sources.get(o.sourceId);
    const d = all.find((x) => String(x.id) === String(src?.display_id));
    if (d) return d;
    const i = Number(String(o.sourceId).split(':')[1]);
    if (all[i]) return all[i];
  }
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

function warn(text) {
  setState({ warning: text });
  clearTimeout(warnTimer);
  warnTimer = setTimeout(() => setState({ warning: '' }), 7000);
}

async function start(o) {
  if (state.status !== 'idle') return { ok: false, error: 'A recording is already running.' };
  opts = o;
  const display = displayFor(o);
  target = { display };
  setState({ ...fresh(), status: 'preparing', source: { kind: o.kind, name: o.name }, drawAllowed: o.kind === 'screen' });
  await ensureRecorder();
  const sf = display.scaleFactor || 1;
  let res;
  try {
    res = await rec('prepare', {
      ...o,
      platform: process.platform,
      maxWidth: o.kind === 'screen' ? Math.min(3840, Math.round(display.size.width * sf)) : o.kind === 'audio' ? 1280 : o.kind === 'camera' ? 1920 : 2560,
      maxHeight: o.kind === 'screen' ? Math.min(2400, Math.round(display.size.height * sf)) : o.kind === 'audio' ? 720 : o.kind === 'camera' ? 1080 : 1600,
      composite: o.kind === 'window' && o.cam,
    });
  } catch (e) {
    setState({ ...fresh(), error: friendly(e) });
    showPanel();
    return { ok: false, error: friendly(e) };
  }
  recordingId = res.recordingId;
  if (panel && !panel.isDestroyed()) panel.hide();
  createOverlay();
  createBar();
  if (o.cam && o.kind !== 'audio') showBubble(o.camId);
  if (o.script?.text?.trim()) createPrompter();
  registerShortcuts();
  if (res.warning) warn(res.warning);
  await countdownThen(o.countdown, () => rec('begin', { retake: false }));
  return { ok: true };
}

function friendly(e) {
  const m = String(e?.message || e);
  if (/permission|NotAllowed|denied/i.test(m))
    return isMac ? 'Retake isn’t allowed to record the screen. Turn it on in System Settings › Privacy & Security › Screen Recording, then quit and reopen Retake.' : 'Retake isn’t allowed to record the screen.';
  if (/NotFound|could not start|NotReadable/i.test(m)) return 'That screen or window is no longer available. Pick it again.';
  return `Couldn’t start recording: ${m}`;
}

async function countdownThen(on, begin) {
  if (on) {
    for (let n = 3; n > 0; n--) {
      setState({ status: 'countdown', countdown: n });
      await sleep(n === 1 ? 880 : 1000);
      if (state.status !== 'countdown') return;
    }
    setState({ countdown: 0 });
    await sleep(120); // the number is gone before the first frame
  }
  await begin();
  setState({ status: 'recording', since: Date.now(), countdown: 0 });
}

async function command(c) {
  const s = state.status;
  switch (c.cmd) {
    case 'toggle-pause':
      return command({ cmd: s === 'recording' ? 'pause' : 'resume' });
    case 'pause':
      if (s !== 'recording') return;
      setState({ status: 'paused' });
      {
        const r = await rec('end');
        setState({ base: state.base + r.duration, since: 0, parts: state.parts + 1 });
      }
      return;
    case 'resume':
      if (s !== 'paused') return;
      await rec('begin', { retake: false });
      setState({ status: 'recording', since: Date.now() });
      return;
    case 'retake':
      if (s === 'recording') await command({ cmd: 'pause' });
      if (state.status === 'paused' && state.parts > 0) setState({ status: 'retake' });
      return;
    case 'close-dialog':
      if (s === 'retake') setState({ status: 'paused' });
      return;
    case 'confirm-retake': {
      if (s !== 'retake') return;
      const r = await rec('discard-last');
      setState({ base: Math.max(0, state.base - r.duration), parts: Math.max(0, state.parts - 1) });
      overlay?.webContents.send('evt:draw', { clear: true });
      prompter?.webContents.send('evt:prompter', { rewind: true });
      return countdownThen(c.countdown !== false, () => rec('begin', { retake: true }));
    }
    case 'finish':
      return finish();
    case 'discard':
      return discard();
    case 'draw-toggle':
      return setDrawing(!state.drawing);
    case 'draw-off':
      return setDrawing(false);
    case 'spotlight-toggle':
      return setSpotlight(!state.spotlight);
    case 'draw-settings':
      return overlay?.webContents.send('evt:draw', c.settings);
  }
}

async function finish() {
  if (!['recording', 'paused', 'retake', 'countdown'].includes(state.status)) return;
  setState({ status: 'saving', drawing: false });
  let count = 0;
  try {
    ({ count } = await rec('finish'));
  } catch {}
  teardown();
  if (count) openViewer(`shared/pages/editor.html#${encodeURIComponent(recordingId)}`);
  else {
    setState({ error: 'Nothing was recorded.' });
    showPanel();
  }
}

async function discard() {
  const parent = bar && !bar.isDestroyed() ? bar : undefined;
  const { response } = await dialog.showMessageBox(parent, { type: 'warning', buttons: ['Discard', 'Keep recording'], defaultId: 1, cancelId: 1, message: 'Discard this recording?', detail: 'It can’t be recovered.' });
  if (response !== 0) return;
  try {
    await rec('abort');
  } catch {}
  teardown();
  showPanel();
}

function teardown() {
  globalShortcut.unregisterAll();
  clearInterval(cursorTimer);
  for (const w of [overlay, bar, prompter]) if (w && !w.isDestroyed()) w.close();
  overlay = bar = prompter = null;
  if (!opts?.keepBubble) closeBubble();
  setState(fresh());
}

function registerShortcuts() {
  const map = {
    'Alt+Shift+K': { cmd: 'toggle-pause' },
    'Alt+Shift+U': { cmd: 'retake' },
    'Alt+Shift+S': { cmd: 'finish' },
    'Alt+Shift+D': { cmd: 'draw-toggle' },
  };
  for (const [key, c] of Object.entries(map)) {
    try {
      globalShortcut.register(key, () => command(c));
    } catch {}
  }
}

// ---------- calls from windows ----------
ipcMain.handle('call', async (e, name, data = {}) => {
  switch (name) {
    case 'rec-ready':
      ipcMain.emit('recorder-ready');
      return true;
    case 'rec-reply': {
      const p = pending.get(data.id);
      if (!p) return;
      pending.delete(data.id);
      return data.ok ? p.resolve(data.result || {}) : p.reject(new Error(data.error));
    }
    case 'rec-event':
      if (data.type === 'ended') finish();
      if (data.type === 'warning') warn(data.text);
      return;
    case 'state':
      return state;
    case 'clear-error':
      return setState({ error: '' });
    case 'sources':
      return listSources();
    case 'permissions':
      return permissions();
    case 'ask-media':
      return isMac ? systemPreferences.askForMediaAccess(data.kind) : true;
    case 'open-settings':
      return openSettings(data.kind);
    case 'bubble':
      return data.on ? showBubble(data.camId) : closeBubble();
    case 'bubble-size':
      return cycleBubble();
    case 'start':
      return start(data);
    case 'command':
      return command(data);
    case 'prompter-script':
      return opts?.script || { text: '' };
    case 'open-library':
      return openViewer('shared/pages/library.html');
    case 'new-recording':
      showPanel();
      return true;
  }
});

async function listSources() {
  const list = await desktopCapturer.getSources({ types: ['screen', 'window'], thumbnailSize: { width: 400, height: 250 }, fetchWindowIcons: true });
  sources = new Map(list.map((s) => [s.id, s]));
  const mine = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId?.()).filter(Boolean));
  const displays = screen.getAllDisplays();
  return list
    .filter((s) => !mine.has(s.id) && s.name !== 'Retake')
    .map((s) => {
      const kind = s.id.startsWith('screen') ? 'screen' : 'window';
      const d = kind === 'screen' ? displays.find((x) => String(x.id) === String(s.display_id)) : null;
      return {
        id: s.id,
        kind,
        name: kind === 'screen' ? (displays.length > 1 ? `Screen ${displays.indexOf(d) + 1 || ''}`.trim() : 'Entire screen') : s.name,
        thumb: s.thumbnail?.isEmpty() ? '' : s.thumbnail.toDataURL(),
        icon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : '',
      };
    });
}

function permissions() {
  if (!isMac) return { screen: 'granted', camera: 'granted', microphone: 'granted' };
  return {
    screen: systemPreferences.getMediaAccessStatus('screen'),
    camera: systemPreferences.getMediaAccessStatus('camera'),
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
  };
}

function openSettings(kind) {
  if (!isMac) return shell.openExternal(kind === 'screen' ? 'ms-settings:privacy' : `ms-settings:privacy-${kind === 'camera' ? 'webcam' : 'microphone'}`);
  const pane = { screen: 'Privacy_ScreenCapture', camera: 'Privacy_Camera', microphone: 'Privacy_Microphone' }[kind] || 'Privacy';
  return shell.openExternal(`x-apple.systempreferences:com.apple.preference.security?${pane}`);
}

// ---------- app ----------
app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
    if (!file.startsWith(ROOT)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });

  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(['media', 'display-capture', 'clipboard-sanitized-write', 'fullscreen'].includes(permission)));
  ses.setPermissionCheckHandler((wc, permission) => ['media', 'display-capture', 'clipboard-sanitized-write'].includes(permission));
  // Fallback path for getDisplayMedia: use the screen or window picked in the panel.
  ses.setDisplayMediaRequestHandler(async (req, cb) => {
    let src = opts && sources.get(opts.sourceId);
    if (!src) {
      await listSources();
      src = opts && sources.get(opts.sourceId);
    }
    cb(src ? { video: src, ...(process.platform === 'win32' && opts?.sound ? { audio: 'loopback' } : {}) } : {});
  });
  // Exports go straight to Downloads/Retake.
  ses.on('will-download', (e, item) => {
    const dir = path.join(app.getPath('downloads'), 'Retake');
    fs.mkdirSync(dir, { recursive: true });
    const ext = path.extname(item.getFilename());
    const stem = path.basename(item.getFilename(), ext);
    let file = path.join(dir, item.getFilename());
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${stem} (${i})${ext}`);
    item.setSavePath(file);
  });

  showPanel();
  ensureRecorder();
});

app.on('second-instance', () => showPanel());
app.on('activate', () => {
  if (state.status === 'idle' && !viewers.size) showPanel();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => {
  if (!isMac) app.quit();
});
