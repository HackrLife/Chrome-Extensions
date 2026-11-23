// Present slides with your camera: pick a PDF, images or videos, then Retake opens them full
// screen with a camera bubble, drawing tools and the teleprompter, and records exactly that.
// Nothing is captured from the screen, so no screen-sharing permission is needed.
import '../core/theme.js';
import { ic, LOGO } from '../core/icons.js';
import { escapeHtml, fmtBytes } from '../core/format.js';
import { ACCEPT, listFiles, addFiles, removeFile, buildDeck, releaseDeck, pdfPreview } from '../core/media.js';
import { openPresenter } from '../core/presenter.js';
import { watchErrors, logError } from '../core/diagnostics.js';

watchErrors('slides');
const $ = (s) => document.querySelector(s);
$('#logo').innerHTML = LOGO(30);
$('#pick').accept = ACCEPT;

let files = [];
let error = '';
let busy = '';
let { prefs = {}, script = {} } = await chrome.storage.local.get(['prefs', 'script']);
prefs = { mic: true, camera: true, countdown: true, prompter: false, ...prefs };
const thumbs = new Map();

function words() {
  return (script.text?.match(/\S+/g) || []).length;
}

const pdfInfo = new Map();
function thumb(f) {
  if (f.kind === 'pdf') {
    const info = pdfInfo.get(f.id);
    if (info === undefined) {
      pdfInfo.set(f.id, null);
      pdfPreview(f.blob)
        .then((p) => pdfInfo.set(f.id, p))
        .catch((e) => logError('slides preview', e))
        .finally(render);
    }
    return info?.url ? `style="background-image:url(${info.url})"` : '';
  }
  if (f.kind !== 'image') return '';
  if (!thumbs.has(f.id)) thumbs.set(f.id, URL.createObjectURL(f.blob));
  return `style="background-image:url(${thumbs.get(f.id)})"`;
}
const hasThumb = (f) => (f.kind === 'pdf' ? !!pdfInfo.get(f.id)?.url : f.kind === 'image');
const kindLabel = (f) => (f.kind === 'pdf' ? (pdfInfo.get(f.id)?.pages ? `PDF · ${pdfInfo.get(f.id).pages} slides` : 'PDF') : f.kind === 'video' ? 'Video' : 'Image');

function toggle(key, on, label) {
  return `<button class="toggle ${on ? 'on' : ''}" data-toggle="${key}" aria-pressed="${on}" aria-label="${label}"></button>`;
}

function render() {
  const n = words();
  $('#setup').innerHTML = `
    <div class="hero" style="margin-bottom:18px"><h1>Present your slides with your camera</h1>
      <p>Retake shows them full screen with your face in a bubble, a pen to draw on them and your script on top, and records it all on this computer.</p></div>
    <div class="drop" id="drop"><div class="dropic">${ic('slides', 30)}</div><b>Add your slides</b><p>A PDF (one slide per page), images or short videos. Drop them here or choose files.</p>
      <button class="btn dark" data-act="pick">${ic('upload', 16)} Choose files</button></div>
    ${files.length ? `<div class="files">${files
      .map((f, i) => `<div class="file"><div class="th" ${thumb(f)}>${hasThumb(f) ? '' : ic(f.kind === 'video' ? 'play' : 'slides', 26)}</div>
        <div class="nm">${i + 1}. ${escapeHtml(f.name)}<small>${kindLabel(f)} · ${fmtBytes(f.size || f.blob?.size || 0)}</small></div>
        <button data-rm="${f.id}" title="Remove" aria-label="Remove ${escapeHtml(f.name)}">${ic('x', 13)}</button></div>`)
      .join('')}</div>` : ''}
    <div class="opts">
      <div class="opt">${ic('cam', 18)}Camera bubble<span class="s">your face in a corner</span><span class="push">${toggle('camera', prefs.camera, 'Camera bubble')}</span></div>
      <div class="opt">${ic('mic', 18)}Microphone<span class="push">${toggle('mic', prefs.mic, 'Microphone')}</span></div>
      <div class="opt">${ic('text', 18)}Teleprompter<span class="s">${n ? `${n} words` : 'No script yet'}</span><span class="push"><button class="mini-link btn ghost" style="height:32px;font-size:13px" data-act="script">${n ? 'Edit' : 'Write'}</button>${toggle('prompter', prefs.prompter, 'Teleprompter')}</span></div>
    </div>
    ${error ? `<div class="notice err">${escapeHtml(error)}</div>` : ''}
    <button class="btn rec startbtn" data-act="start" ${busy || !files.length ? 'disabled' : ''}>${busy || `${ic('slides', 18)} Start presenting`}</button>
    <p class="small" style="text-align:center;margin-top:12px">Opens full screen. Change slides with the arrow keys or a clicker, press D to draw, Esc to stop drawing.</p>`;
}

async function refresh() {
  files = await listFiles().catch(() => []);
  render();
}

async function add(list) {
  const { skipped } = await addFiles([...list]);
  error = skipped.length ? `Skipped ${skipped.join(', ')}: use a PDF, PNG, JPEG, WebP, GIF, MP4, WebM or MOV file.` : '';
  await refresh();
}

document.addEventListener('click', async (e) => {
  const t = e.target.closest('[data-act],[data-rm],[data-toggle]');
  if (!t) return;
  if (t.dataset.rm) {
    await removeFile(t.dataset.rm);
    URL.revokeObjectURL(thumbs.get(t.dataset.rm) || '');
    thumbs.delete(t.dataset.rm);
    return refresh();
  }
  if (t.dataset.toggle) {
    prefs[t.dataset.toggle] = !prefs[t.dataset.toggle];
    const { prefs: stored = {} } = await chrome.storage.local.get('prefs');
    await chrome.storage.local.set({ prefs: { ...stored, [t.dataset.toggle]: prefs[t.dataset.toggle] } });
    return render();
  }
  const act = t.dataset.act;
  if (act === 'pick') $('#pick').click();
  if (act === 'script') {
    const w = await chrome.windows.getCurrent();
    chrome.runtime.sendMessage({ type: 'open-prompter', edit: true, windowId: w.id }).catch(() => {});
  }
  if (act === 'start') start();
});

$('#pick').addEventListener('change', (e) => {
  add(e.target.files);
  e.target.value = '';
});
document.addEventListener('dragover', (e) => {
  e.preventDefault();
  $('#drop')?.classList.add('over');
});
document.addEventListener('dragleave', () => $('#drop')?.classList.remove('over'));
document.addEventListener('drop', (e) => {
  e.preventDefault();
  $('#drop')?.classList.remove('over');
  if (e.dataTransfer?.files?.length) add(e.dataTransfer.files);
});

// The script can be edited in its own window; pick up the change.
chrome.storage.onChanged.addListener((c) => {
  if (c.script) {
    script = c.script.newValue || {};
    if ($('#setup').innerHTML) render();
  }
});

async function start() {
  if (!files.length) return;
  // Full screen needs the click that started it, so ask before the slides are prepared.
  document.documentElement.requestFullscreen?.().catch(() => {});
  error = '';
  let deck;
  try {
    busy = 'Preparing your slides…';
    render();
    deck = await buildDeck(files, (msg) => {
      busy = `Preparing ${msg}…`;
      render();
    });
  } catch (e) {
    logError('slides', e);
    busy = '';
    error = `Couldn’t open your slides: ${e.message || e}.`;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    return render();
  }
  busy = '';
  $('#setup').hidden = true;
  document.querySelector('.top').hidden = true;
  const host = $('#stage');
  openPresenter(host, {
    mic: prefs.mic,
    micId: prefs.micId,
    cam: prefs.camera,
    camId: prefs.camId,
    deck,
    countdown: prefs.countdown !== false,
    script: prefs.prompter && script.text?.trim() ? { text: script.text, speed: script.speed || 1, size: 28 } : null,
    tickerURL: chrome.runtime.getURL('core/ticker.js'),
    onFinish: (id) => {
      releaseDeck(deck);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      location.href = `editor.html#${encodeURIComponent(id)}`;
    },
    onClose: () => {
      releaseDeck(deck);
      host.innerHTML = '';
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      $('#setup').hidden = false;
      document.querySelector('.top').hidden = false;
      render();
    },
  });
}

refresh();
