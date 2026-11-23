// Retake service worker. Coordinates the launcher, the on-page overlay and the offscreen
// recorder. It holds the recording state; the offscreen document holds the media.

import { newRecording, putRecording, deleteRecording } from './core/db.js';
import { logError, watchErrors } from './core/diagnostics.js';

watchErrors('background');

const IDLE = { status: 'idle' };
let state = null;
let countdownTimer = null;

async function getState() {
  if (state) return state;
  const s = await chrome.storage.session.get('state');
  state = s.state || { ...IDLE };
  return state;
}

async function setState(patch, replace = false) {
  state = replace ? { ...patch } : { ...(await getState()), ...patch };
  await chrome.storage.session.set({ state });
  broadcast();
  updateBadge();
  return state;
}

function broadcast() {
  chrome.runtime.sendMessage({ type: 'state', state }).catch(() => {});
  if (state.tabId != null) chrome.tabs.sendMessage(state.tabId, { type: 'state', state }).catch(() => {});
}

function updateBadge() {
  const s = state?.status;
  const text = s === 'recording' ? 'REC' : s === 'paused' ? 'II' : s === 'countdown' ? '…' : '';
  const color = s === 'paused' ? '#F5B83D' : '#F0464B';
  chrome.action.setBadgeText({ text }).catch(() => {});
  chrome.action.setBadgeBackgroundColor({ color }).catch(() => {});
}

// ---------- offscreen recorder ----------

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  await chrome.offscreen.createDocument({
    url: 'pages/offscreen.html',
    reasons: ['USER_MEDIA', 'DISPLAY_MEDIA', 'AUDIO_PLAYBACK'],
    justification: 'Records the chosen tab, window or screen with microphone audio, on the user’s computer.',
  });
}

// Tab recordings run in the offscreen document; window and screen recordings run in the small
// picker window, because Chrome only lets the page that asked for them use them.
async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
  const { recorderWindowId } = await chrome.storage.session.get('recorderWindowId');
  if (recorderWindowId != null) {
    await chrome.storage.session.remove('recorderWindowId');
    await chrome.windows.remove(recorderWindowId).catch(() => {});
  }
}

async function rec(type, data = {}) {
  const res = await chrome.runtime.sendMessage({ target: 'offscreen', type, ...data });
  if (!res?.ok) throw new Error(res?.error || 'The recorder did not respond.');
  return res;
}

// ---------- overlay on the page ----------

function canInject(url = '') {
  return /^https?:|^file:/.test(url) && !/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/.test(url);
}

async function injectOverlay(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!canInject(tab.url)) return false;
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content/overlay.js'] });
    await chrome.tabs.sendMessage(tabId, { type: 'state', state }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

async function removeOverlay(tabId) {
  if (tabId == null) return;
  await chrome.tabs.sendMessage(tabId, { type: 'teardown' }).catch(() => {});
}

// ---------- capture sources ----------

// Chrome shows its screen picker only for a page, so a small Retake window asks for the choice.
let picking = null;

async function chooseDesktop(source) {
  if (picking) picking.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
  let base = null;
  try {
    base = await chrome.windows.getLastFocused();
  } catch {}
  const width = 420, height = 170;
  const left = base ? Math.round(base.left + (base.width - width) / 2) : undefined;
  const top = base ? Math.round(base.top + 120) : undefined;
  return new Promise((resolve, reject) => {
    picking = { resolve, reject, windowId: null };
    chrome.windows
      .create({ url: chrome.runtime.getURL(`pages/picker.html#${source}`), type: 'popup', width, height, left, top, focused: true })
      .then((w) => {
        if (picking) picking.windowId = w.id;
      })
      .catch((e) => {
        picking = null;
        reject(e);
      });
  });
}

function picked({ streamId, audio, error }) {
  const p = picking;
  picking = null;
  if (!p) return;
  if (streamId) p.resolve({ streamId, audio: !!audio, windowId: p.windowId });
  else if (error) p.reject(new Error(error));
  else p.reject(Object.assign(new Error('cancelled'), { cancelled: true }));
}

// ---------- teleprompter window ----------
// A small separate window, so it is never in a tab recording. Shown at the top centre of the
// browser window, near the laptop camera.
async function openPrompter({ edit = false, windowId } = {}) {
  const { prompterWindowId } = await chrome.storage.session.get('prompterWindowId');
  let base = null;
  try {
    base = windowId != null ? await chrome.windows.get(windowId) : await chrome.windows.getLastFocused();
  } catch {}
  const width = edit ? 560 : 640, height = edit ? 440 : 240;
  const left = base ? Math.round(base.left + (base.width - width) / 2) : undefined;
  const top = base ? base.top + (edit ? 80 : 4) : undefined;
  if (prompterWindowId) {
    try {
      await chrome.windows.get(prompterWindowId);
      await chrome.windows.update(prompterWindowId, edit ? { focused: true } : { left, top, width, height });
      return;
    } catch {}
  }
  const w = await chrome.windows.create({ url: chrome.runtime.getURL(`pages/prompter.html${edit ? '#edit' : ''}`), type: 'popup', width, height, left, top, focused: edit });
  // Some Linux window managers ignore the size given at creation and open the window full screen,
  // which would cover the page being recorded. Setting the bounds again afterwards fixes it.
  if (w.width !== width || w.height !== height) {
    await chrome.windows.update(w.id, { left, top, width, height }).catch(() => {});
  }
  await chrome.storage.session.set({ prompterWindowId: w.id });
}

async function closePrompter() {
  const { prompterWindowId } = await chrome.storage.session.get('prompterWindowId');
  if (!prompterWindowId) return;
  await chrome.storage.session.remove('prompterWindowId');
  chrome.windows.remove(prompterWindowId).catch(() => {});
}

chrome.windows.onRemoved.addListener(async (id) => {
  // Closing the picker window without choosing counts as cancelling.
  if (picking && picking.windowId === id) setTimeout(() => picked({}), 300);
  // Closing the recorder window mid-recording ends the recording; what was saved is kept.
  const { recorderWindowId } = await chrome.storage.session.get('recorderWindowId');
  if (id === recorderWindowId) {
    await chrome.storage.session.remove('recorderWindowId');
    const s = await getState();
    if (['recording', 'paused', 'countdown', 'preparing'].includes(s.status)) finish().catch(fail);
  }
  const { prompterWindowId } = await chrome.storage.session.get('prompterWindowId');
  if (id === prompterWindowId) chrome.storage.session.remove('prompterWindowId');
});

// ---------- recording lifecycle ----------

async function start({ options, tabId, windowId, size }) {
  const s = await getState();
  if (!['idle', 'presenting'].includes(s.status)) throw new Error('A recording is already running.');
  const source = options.source || 'tab';
  // Create the recorder first: a capture id expires a few seconds after it is issued.
  let streamId, kind, wantAudio;
  try {
    if (source === 'tab') {
      await ensureOffscreen();
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      kind = 'tab';
      wantAudio = options.tabAudio !== false;
    } else {
      await closeOffscreen();
      const d = await chooseDesktop(source);
      await chrome.storage.session.set({ recorderWindowId: d.windowId });
      streamId = d.streamId;
      kind = 'desktop';
      wantAudio = d.audio;
    }
  } catch (e) {
    if (s.status !== 'presenting') await closeOffscreen();
    if (e.cancelled) return { ok: true, cancelled: true };
    if (source === 'tab') throw new Error('Retake could not record this tab. Click the Retake icon in the toolbar and press Start recording again.');
    throw e;
  }

  const recording = newRecording({ source });
  await putRecording(recording);
  let prep;
  try {
    prep = await rec('prepare', {
      kind,
      streamId,
      wantAudio,
      micId: options.mic ? options.micId || 'default' : null,
      recordingId: recording.id,
      size,
    });
  } catch (e) {
    await deleteRecording(recording.id).catch(() => {});
    await closeOffscreen();
    if (s.status === 'presenting') await setState({ error: e.message });
    throw new Error(e.message || 'Could not start recording.');
  }
  if (kind === 'desktop') {
    const { recorderWindowId } = await chrome.storage.session.get('recorderWindowId');
    if (recorderWindowId != null) await chrome.windows.update(recorderWindowId, { state: 'minimized' }).catch(() => {});
    // Give the keyboard back to the browser window, so the shortcuts and the page work at once.
    if (windowId != null) await chrome.windows.update(windowId, { focused: true }).catch(() => {});
  }
  await setState({
    status: 'preparing',
    mode: 'record',
    source,
    tabId,
    windowId,
    recordingId: recording.id,
    options,
    segments: [],
    segmentStartedAt: null,
    retakeNext: false,
    dialog: null,
    error: null,
    hasAudio: prep.hasAudio,
    micFailed: prep.micFailed || false,
  });

  // The tools live on the recorded tab. For a window or screen they sit on the current tab, when it allows it.
  await injectOverlay(tabId);
  if (options.prompter) {
    const { script } = await chrome.storage.local.get('script');
    if (script?.text?.trim()) await openPrompter({ windowId }).catch(() => {});
  }
  await runCountdown(options.countdown !== false);
  return { ok: true };
}

async function runCountdown(withCountdown) {
  clearTimeout(countdownTimer);
  if (!withCountdown) return begin();
  const ms = 3000;
  await setState({ status: 'countdown', countdownEndsAt: Date.now() + ms });
  // Start a beat after the countdown disappears, so the number never shows in the video.
  countdownTimer = setTimeout(() => begin().catch(fail), ms + 250);
}

async function begin() {
  const s = await getState();
  if (!['countdown', 'paused', 'preparing'].includes(s.status)) return;
  // Hide the controls on a recorded tab first, so they are not in the opening frames.
  if (s.source === 'tab' && s.tabId != null) {
    await Promise.race([chrome.tabs.sendMessage(s.tabId, { type: 'hide-bar' }).catch(() => {}), new Promise((r) => setTimeout(r, 300))]);
  }
  const res = await rec('begin', { retake: !!s.retakeNext });
  await setState({ status: 'recording', segmentStartedAt: Date.now(), currentSegmentId: res.segmentId, retakeNext: false, countdownEndsAt: null, dialog: null });
}

async function pause() {
  const s = await getState();
  if (s.status === 'countdown') {
    clearTimeout(countdownTimer);
    await setState({ status: 'paused', countdownEndsAt: null });
    return;
  }
  if (s.status !== 'recording') return;
  const res = await rec('end-segment');
  await setState({
    status: 'paused',
    segments: res.segmentId ? [...s.segments, { id: res.segmentId, duration: res.duration, retake: res.retake }] : s.segments,
    segmentStartedAt: null,
    currentSegmentId: null,
  });
}

async function resume() {
  const s = await getState();
  if (s.status !== 'paused') return;
  await begin();
}

async function requestRetake() {
  const s = await getState();
  if (!['recording', 'paused'].includes(s.status)) return;
  if (s.status === 'recording') await pause();
  const now = await getState();
  if (!now.segments?.length) {
    await setState({ dialog: null, notice: 'Nothing to retake yet.' });
    return;
  }
  await setState({ dialog: 'retake' });
}

async function confirmRetake({ countdown = true } = {}) {
  const s = await getState();
  if (s.status !== 'paused') return;
  const last = s.segments?.[s.segments.length - 1];
  if (!last) return;
  await rec('discard', { segmentId: last.id });
  await setState({ segments: s.segments.slice(0, -1), retakeNext: true, dialog: null, status: 'paused' });
  await runCountdown(countdown);
}

async function finish() {
  clearTimeout(countdownTimer);
  const s = await getState();
  if (!['recording', 'paused', 'countdown', 'preparing'].includes(s.status)) return;
  if (s.status === 'recording') await pause();
  await setState({ status: 'saving', dialog: null });
  let result = null;
  try {
    result = await rec('finish');
  } catch (e) {
    logError('finish', e);
  }
  await closeOffscreen();
  await removeOverlay(s.tabId);
  await closePrompter();
  const id = s.recordingId;
  await setState({ ...IDLE }, true);
  if (!id) return;
  if (result && result.segments > 0) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`pages/editor.html#${id}`) });
    return;
  }
  // If the recorder failed to report back, never throw footage away: the library recovers
  // whatever was saved, the same way it does after a crash.
  if (!result) {
    await chrome.tabs.create({ url: chrome.runtime.getURL('pages/library.html') });
    return;
  }
  await deleteRecording(id).catch(() => {});
}

async function cancel() {
  clearTimeout(countdownTimer);
  const s = await getState();
  if (s.status === 'presenting') {
    await removeOverlay(s.tabId);
    await setState({ ...IDLE }, true);
    return;
  }
  await rec('abort').catch(() => {});
  await closeOffscreen();
  await removeOverlay(s.tabId);
  await closePrompter();
  if (s.recordingId) await deleteRecording(s.recordingId).catch(() => {});
  await setState({ ...IDLE }, true);
}

async function present({ options, tabId, windowId }) {
  const s = await getState();
  if (s.status !== 'idle') throw new Error('Retake is already running.');
  await setState({ status: 'presenting', mode: 'present', tabId, windowId, options, segments: [] });
  const ok = await injectOverlay(tabId);
  if (!ok) {
    await setState({ ...IDLE }, true);
    throw new Error('Retake can’t draw on this page. Open a website and try again.');
  }
  return { ok: true };
}

async function screenshot() {
  const s = await getState();
  const windowId = s.windowId ?? (await chrome.windows.getLastFocused()).id;
  const url = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  await chrome.downloads.download({ url, filename: `Retake/screenshot-${stamp}.png` });
  return { ok: true };
}

async function fail(e) {
  logError('background', e);
  await setState({ error: e?.message || String(e) });
}

// ---------- messages ----------

const handlers = {
  'get-state': async () => ({ ok: true, state: await getState() }),
  start: (m) => start(m),
  present: (m) => present(m),
  'start-from-present': async (m) => {
    const s = await getState();
    return start({ options: { ...s.options, source: 'tab' }, tabId: s.tabId, windowId: s.windowId, size: m.size || null });
  },
  pause: () => pause(),
  resume: () => resume(),
  'toggle-pause': async () => ((await getState()).status === 'recording' ? pause() : resume()),
  'request-retake': () => requestRetake(),
  'confirm-retake': (m) => confirmRetake(m),
  'close-dialog': () => setState({ dialog: null }),
  finish: () => finish(),
  cancel: () => cancel(),
  screenshot: () => screenshot(),
  'set-option': async (m) => setState({ options: { ...(await getState()).options, [m.key]: m.value } }),
  'clear-notice': () => setState({ notice: null, error: null }),
  'source-ended': () => finish(),
  'open-prompter': (m) => openPrompter({ edit: !!m.edit, windowId: m.windowId }),
  picked: (m) => picked(m),
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve(h(msg, sender))
    .then((r) => sendResponse(r && typeof r === 'object' && 'ok' in r ? r : { ok: true, ...(r || {}) }))
    .catch((e) => {
      logError(msg.type, e);
      sendResponse({ ok: false, error: e?.message || String(e) });
    });
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  const s = await getState();
  try {
    if (command === 'toggle-pause') await handlers['toggle-pause']();
    else if (command === 'retake') {
      if (s.dialog === 'retake') await confirmRetake({ countdown: true });
      else await requestRetake();
    } else if (command === 'finish') await finish();
    else if (command === 'toggle-draw' && s.tabId != null) chrome.tabs.sendMessage(s.tabId, { type: 'toggle-draw' }).catch(() => {});
  } catch (e) {
    fail(e);
  }
});

// Keep the tools on screen when the recorded tab loads a new page.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete') return;
  const s = await getState();
  if (s.tabId === tabId && ['recording', 'paused', 'countdown', 'presenting'].includes(s.status)) {
    await injectOverlay(tabId);
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const s = await getState();
  if (s.tabId !== tabId) return;
  if (s.status === 'presenting') await setState({ ...IDLE }, true);
  else if (s.source === 'tab' && s.status !== 'idle') await finish();
});

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') chrome.tabs.create({ url: chrome.runtime.getURL('pages/welcome.html') });
});

// If the browser restarted mid-recording, the recorder is gone: reset and let the library recover the footage.
chrome.runtime.onStartup.addListener(async () => {
  await chrome.storage.session.clear();
  state = { ...IDLE };
  updateBadge();
});
