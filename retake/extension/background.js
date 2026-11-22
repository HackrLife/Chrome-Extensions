// Retake service worker. Coordinates the launcher, the on-page overlay and the offscreen
// recorder. It holds the recording state; the offscreen document holds the media.

import { newRecording, putRecording, deleteRecording } from './core/db.js';

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

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument().catch(() => {});
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

function chooseDesktop(source) {
  const sources = source === 'window' ? ['window'] : ['screen', 'audio'];
  return new Promise((resolve, reject) => {
    try {
      chrome.desktopCapture.chooseDesktopMedia(sources, (streamId, options) => {
        if (!streamId) return reject(Object.assign(new Error('cancelled'), { cancelled: true }));
        resolve({ streamId, audio: !!options?.canRequestAudioTrack });
      });
    } catch (e) {
      reject(e);
    }
  });
}

// ---------- recording lifecycle ----------

async function start({ options, tabId, windowId, size }) {
  const s = await getState();
  if (!['idle', 'presenting'].includes(s.status)) throw new Error('A recording is already running.');
  const source = options.source || 'tab';
  // Create the recorder first: a capture id expires a few seconds after it is issued.
  await ensureOffscreen();
  let streamId, kind, wantAudio;
  try {
    if (source === 'tab') {
      streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tabId });
      kind = 'tab';
      wantAudio = options.tabAudio !== false;
    } else {
      const d = await chooseDesktop(source);
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
  if (s.status === 'recording') await pause();
  const now = await getState();
  if (!now.segments.length) {
    await setState({ dialog: null, notice: 'Nothing to retake yet.' });
    return;
  }
  await setState({ dialog: 'retake' });
}

async function confirmRetake({ countdown = true } = {}) {
  const s = await getState();
  const last = s.segments[s.segments.length - 1];
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
    console.warn('Retake finish', e);
  }
  await closeOffscreen();
  await removeOverlay(s.tabId);
  const id = s.recordingId;
  await setState({ ...IDLE }, true);
  if (result && result.segments > 0) {
    await chrome.tabs.create({ url: chrome.runtime.getURL(`pages/editor.html#${id}`) });
  } else if (id) {
    await deleteRecording(id).catch(() => {});
  }
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
  console.warn('Retake', e);
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
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target === 'offscreen') return false;
  const h = handlers[msg?.type];
  if (!h) return false;
  Promise.resolve(h(msg, sender))
    .then((r) => sendResponse(r && typeof r === 'object' && 'ok' in r ? r : { ok: true, ...(r || {}) }))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
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
