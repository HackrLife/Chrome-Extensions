// Problem reports without a support inbox. Retake keeps the last few error messages on the
// user's computer (never page content, never recordings) and, when the user asks, opens a
// GitHub issue already filled in with them, the Retake version, the browser and the system.
// Nothing is sent anywhere unless the user submits that issue themselves.

const KEY = 'diagnostics';
const MAX = 30;
export const ISSUES_URL = 'https://github.com/HackrLife/Chrome-Extensions/issues/new';

const hasStorage = () => !!globalThis.chrome?.storage?.local;

// Browser noise that is not a fault in Retake.
const IGNORE = /ResizeObserver loop|The play\(\) request was interrupted/;

export async function logError(where, err) {
  try {
    if (IGNORE.test(String(err?.message || err))) return;
    const message = String(err?.message || err || 'Unknown error').replace(/\s+/g, ' ').slice(0, 300);
    if (!hasStorage()) return console.warn('Retake', where, message);
    const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
    list.push({ t: Date.now(), where, message });
    await chrome.storage.local.set({ [KEY]: list.slice(-MAX) });
  } catch {}
}

// Catch anything a page or the service worker does not handle itself.
export function watchErrors(where) {
  globalThis.addEventListener?.('error', (e) => logError(where, e.error || e.message));
  globalThis.addEventListener?.('unhandledrejection', (e) => logError(where, e.reason));
}

export async function recentErrors(limit = 10) {
  if (!hasStorage()) return [];
  const { [KEY]: list = [] } = await chrome.storage.local.get(KEY);
  return list.slice(-limit);
}

export async function clearErrors() {
  if (hasStorage()) await chrome.storage.local.remove(KEY);
}

function browserInfo() {
  const ua = navigator.userAgent;
  const chromeV = ua.match(/Chrome\/([\d.]+)/)?.[1] || 'unknown';
  const os = /Mac OS X/.test(ua) ? 'macOS' : /Windows/.test(ua) ? 'Windows' : /CrOS/.test(ua) ? 'ChromeOS' : /Linux/.test(ua) ? 'Linux' : 'unknown';
  return { chromeV, os };
}

// A GitHub "new issue" link with the details filled in. The user reads and edits it before sending.
export async function reportURL({ title = '' } = {}) {
  const version = globalThis.chrome?.runtime?.getManifest?.().version || 'web';
  const { chromeV, os } = browserInfo();
  const errors = await recentErrors(8);
  const lines = errors.length
    ? errors.map((e) => `- ${new Date(e.t).toISOString().slice(0, 16).replace('T', ' ')} · ${e.where}: ${e.message}`).join('\n')
    : '- none recorded';
  const body = `**What happened?**\n\n\n**What did you expect?**\n\n\n**Steps to make it happen again**\n1. \n\n---\nVersion: Retake ${version}\nBrowser: Chrome ${chromeV}\nSystem: ${os}\nRecent errors:\n${lines}\n`;
  const params = new URLSearchParams({ title: title || 'Retake: ', body, labels: 'retake,bug' });
  return `${ISSUES_URL}?${params}`;
}
