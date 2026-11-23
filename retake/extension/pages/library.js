import { listRecordings, deleteRecording, updateRecording, putRecording, getSegmentBlob, addChunk, getRecording, storageEstimate, requestPersistence } from '../core/db.js';
import { ic, LOGO } from '../core/icons.js';
import { fmtTime, fmtBytes, fmtWhen, escapeHtml } from '../core/format.js';
import { totalDuration } from '../core/timeline.js';
import { createZip, readZip } from '../core/zip.js';
import { saveFile } from '../core/save.js';

const $ = (s) => document.querySelector(s);
const IS_EXTENSION = !!globalThis.chrome?.runtime?.id;
let recs = [];
let activeId = null;

$('#logo').innerHTML = LOGO(30);
$('#searchIcon').innerHTML = ic('search', 18);
$('#sortIcon').innerHTML = ic('chev', 16);
$('#helpLink').innerHTML = `${ic('help', 16)}Help`;
$('#newRec').innerHTML = '<span class="dot" style="width:10px;height:10px;color:#fff"></span>New recording';

function toast(text) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 4200);
}

async function load() {
  const s = IS_EXTENSION ? await chrome.runtime.sendMessage({ type: 'get-state' }).catch(() => null) : null;
  activeId = s?.state && s.state.status !== 'idle' ? s.state.recordingId : null;
  recs = await listRecordings();
  // A recording left "in progress" with no recorder running was interrupted. Keep what was saved.
  for (const r of recs) {
    if (r.status === 'recording' && r.id !== activeId) {
      r.status = 'ready';
      r.recovered = true;
      await updateRecording(r.id, { status: 'ready', recovered: true }).catch(() => {});
    }
  }
  render();
  renderStorage();
}

function visible() {
  const q = $('#q').value.trim().toLowerCase();
  const sort = $('#sort').value;
  const list = recs.filter((r) => !q || r.title.toLowerCase().includes(q));
  const dur = (r) => totalDuration(r.segments);
  const cmp = { new: (a, b) => b.createdAt - a.createdAt, old: (a, b) => a.createdAt - b.createdAt, long: (a, b) => dur(b) - dur(a), big: (a, b) => (b.bytes || 0) - (a.bytes || 0) }[sort];
  return list.sort(cmp);
}

function render() {
  const grid = $('#grid');
  if (!recs.length) {
    const how = IS_EXTENSION ? 'Click the Retake icon in Chrome’s toolbar and press <b>Start recording</b>.' : 'Press <b>New recording</b> to make your first one.';
    grid.innerHTML = `<div class="empty">${LOGO(48)}<h2>No recordings yet</h2><p>${how}<br>Your recordings will appear here, stored only on this computer.</p></div>`;
    return;
  }
  const list = visible();
  if (!list.length) {
    grid.innerHTML = `<div class="empty"><h2>Nothing matches “${escapeHtml($('#q').value)}”</h2><p>Try a different word.</p></div>`;
    return;
  }
  const newest = Math.max(...recs.map((r) => r.createdAt));
  grid.innerHTML = list
    .map((r) => {
      const d = totalDuration(r.segments);
      const live = r.id === activeId;
      const tag = live ? '<span class="tag" style="background:var(--rec)">RECORDING</span>' : r.recovered ? '<span class="tag" style="background:var(--amber);color:#111318">RECOVERED</span>' : r.createdAt === newest && Date.now() - r.createdAt < 86_400_000 ? '<span class="tag" style="background:var(--rec)">NEW</span>' : '';
      return `<article class="card" data-id="${r.id}" tabindex="0" aria-label="${escapeHtml(r.title)}">
        <div class="thumb" style="${r.thumbnail ? `background-image:url(${r.thumbnail})` : ''}">${tag}${d ? `<span class="dur">${fmtTime(d)}</span>` : ''}</div>
        <div class="meta"><div class="name" title="${escapeHtml(r.title)}">${escapeHtml(r.title)}</div><div class="sub">${fmtWhen(r.createdAt)} · ${fmtBytes(r.bytes)}${r.callouts?.length ? ` · ${r.callouts.length} callout${r.callouts.length > 1 ? 's' : ''}` : ''}</div></div>
        <button class="more" data-more="${r.id}" aria-label="More actions">${ic('more', 18)}</button>
      </article>`;
    })
    .join('');
}

async function renderStorage() {
  const bytes = recs.reduce((s, r) => s + (r.bytes || 0), 0);
  const { usage, quota } = await storageEstimate();
  const used = Math.max(bytes, usage);
  const pct = quota ? Math.min(100, (used / quota) * 100) : 0;
  const low = quota && quota - used < 2 * 1024 ** 3;
  $('#storage').innerHTML = `
    <div class="badge">${ic('lock', 22)}</div>
    <div class="body"><b>Everything is stored on this computer</b>
      <p>Retake uses ${fmtBytes(used)} for ${recs.length} recording${recs.length === 1 ? '' : 's'}.${quota ? ` About ${fmtBytes(Math.max(0, quota - used))} more is available to Chrome.` : ''}</p>
      <div class="meter"><i style="width:${Math.max(pct, used ? 1 : 0)}%;${low ? 'background:var(--rec)' : ''}"></i></div>
      ${low ? '<p style="color:#9b1c20;margin-top:8px">Space is running low. Back up and delete old recordings to keep recording safely.</p>' : ''}
    </div>
    <div class="actions">
      <button class="chip" id="backup" ${recs.length ? '' : 'disabled'}>${ic('download', 16)}Back up all</button>
      <button class="chip" id="restore">${ic('upload', 16)}Restore</button>
      <button class="chip" id="clearOld" ${recs.length ? '' : 'disabled'}>${ic('trash', 16)}Clear old recordings</button>
    </div>`;
}

// ---------- backup and restore ----------
async function backup(ids) {
  toast('Preparing your backup…');
  const chosen = recs.filter((r) => ids.includes(r.id));
  const files = [];
  const meta = [];
  for (const r of chosen) {
    const full = await getRecording(r.id);
    meta.push(full);
    for (const s of full.segments) files.push({ name: `segments/${s.id}.webm`, data: await getSegmentBlob(s.id, full.mimeType) });
  }
  files.unshift({ name: 'retake-backup.json', data: new TextEncoder().encode(JSON.stringify({ app: 'Retake', version: 1, recordings: meta })) });
  const zip = await createZip(files);
  await saveFile(zip, `retake-backup-${new Date().toISOString().slice(0, 10)}.zip`);
  toast('Backup saved to your Downloads folder, in Retake.');
}

async function restore(file) {
  try {
    const files = await readZip(file);
    const index = files.find((f) => f.name === 'retake-backup.json');
    if (!index) throw new Error('This file is not a Retake backup.');
    const data = JSON.parse(new TextDecoder().decode(index.data));
    let added = 0;
    for (const r of data.recordings || []) {
      if (await getRecording(r.id)) continue;
      for (const s of r.segments) {
        const f = files.find((x) => x.name === `segments/${s.id}.webm`);
        if (f) await addChunk(s.id, 0, new Blob([f.data], { type: r.mimeType || 'video/webm' }));
      }
      await putRecording({ ...r, status: 'ready' });
      added++;
    }
    toast(added ? `Restored ${added} recording${added > 1 ? 's' : ''}.` : 'Those recordings are already here.');
    load();
  } catch (e) {
    toast(e.message || 'Could not read that backup.');
  }
}

// ---------- dialogs ----------
function dialog(html) {
  $('#modal').innerHTML = `<div class="scrim"><div class="panel dialog" role="dialog">${html}</div></div>`;
}
const closeDialog = () => ($('#modal').innerHTML = '');

function confirmDelete(id) {
  const r = recs.find((x) => x.id === id);
  dialog(`<h3>Delete “${escapeHtml(r.title)}”?</h3><p>It will be removed from this computer and cannot be recovered. Back it up first if you might need it.</p>
    <div class="row"><button class="btn ghost" data-close>Keep it</button><button class="btn rec" data-confirm-delete="${id}">Delete</button></div>`);
}

function rename(id) {
  const r = recs.find((x) => x.id === id);
  dialog(`<h3>Rename recording</h3><label class="field"><input id="newName" value="${escapeHtml(r.title)}" maxlength="120"></label>
    <div class="row"><button class="btn ghost" data-close>Cancel</button><button class="btn dark" data-save-name="${id}">Save</button></div>`);
  setTimeout(() => $('#newName')?.select(), 0);
}

function clearOld() {
  const cutoff = Date.now() - 30 * 86_400_000;
  const old = recs.filter((r) => r.createdAt < cutoff && r.id !== activeId);
  if (!old.length) {
    dialog(`<h3>Nothing older than 30 days</h3><p>All your recordings are from the last month.</p><div class="row"><button class="btn dark" data-close>OK</button></div>`);
    return;
  }
  const size = old.reduce((s, r) => s + (r.bytes || 0), 0);
  dialog(`<h3>Delete ${old.length} recording${old.length > 1 ? 's' : ''} older than 30 days?</h3><p>This frees about ${fmtBytes(size)}. They cannot be recovered, so back them up first if you might need them.</p>
    <div class="row"><button class="btn ghost" data-backup-old>Back them up</button><button class="btn rec" data-confirm-clear>Delete ${old.length}</button></div>`);
}

function showMenu(id, anchor) {
  document.querySelector('.menu')?.remove();
  const m = document.createElement('div');
  m.className = 'menu';
  m.innerHTML = `<button data-open="${id}">${ic('edit', 16)}Open in editor</button><button data-rename="${id}">${ic('text', 16)}Rename</button><button data-backup-one="${id}">${ic('download', 16)}Back up</button><button class="danger" data-delete="${id}">${ic('trash', 16)}Delete</button>`;
  document.body.appendChild(m);
  const r = anchor.getBoundingClientRect();
  m.style.left = `${Math.min(r.left, innerWidth - 200)}px`;
  m.style.top = `${r.bottom + 6}px`;
}

// ---------- events ----------
document.addEventListener('click', async (e) => {
  const t = e.target;
  if (!t.closest('.menu') && !t.closest('[data-more]')) document.querySelector('.menu')?.remove();
  const more = t.closest('[data-more]');
  if (more) {
    e.stopPropagation();
    return showMenu(more.dataset.more, more);
  }
  const open = t.closest('[data-open]')?.dataset.open || (!t.closest('.menu') && t.closest('.card')?.dataset.id);
  if (open) {
    if (open === activeId) return toast('This recording is still in progress. Finish it first.');
    location.href = `editor.html#${open}`;
    return;
  }
  const b = t.closest('button');
  if (!b) return;
  if (b.dataset.rename) return rename(b.dataset.rename);
  if (b.dataset.delete) return confirmDelete(b.dataset.delete);
  if (b.dataset.backupOne) return backup([b.dataset.backupOne]);
  if (b.dataset.close !== undefined) return closeDialog();
  if (b.dataset.confirmDelete) {
    await deleteRecording(b.dataset.confirmDelete);
    closeDialog();
    return load();
  }
  if (b.dataset.saveName) {
    const name = $('#newName').value.trim() || 'Untitled recording';
    await updateRecording(b.dataset.saveName, { title: name });
    closeDialog();
    return load();
  }
  if (b.dataset.confirmClear !== undefined) {
    const cutoff = Date.now() - 30 * 86_400_000;
    for (const r of recs.filter((x) => x.createdAt < cutoff && x.id !== activeId)) await deleteRecording(r.id);
    closeDialog();
    return load();
  }
  if (b.dataset.backupOld !== undefined) {
    const cutoff = Date.now() - 30 * 86_400_000;
    closeDialog();
    return backup(recs.filter((r) => r.createdAt < cutoff).map((r) => r.id));
  }
  if (b.id === 'backup') return backup(recs.map((r) => r.id));
  if (b.id === 'restore') return $('#restoreFile').click();
  if (b.id === 'clearOld') return clearOld();
  if (b.id === 'newRec') {
    if (window.retakeDesktop) {
      window.retakeDesktop.call('new-recording');
      return;
    }
    if (!IS_EXTENSION) {
      location.href = '../index.html#record';
      return;
    }
    try {
      await chrome.action.openPopup();
    } catch {
      toast('Click the Retake icon in Chrome’s toolbar to start recording.');
    }
  }
});

document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList?.contains('card')) location.href = `editor.html#${e.target.dataset.id}`;
  if (e.key === 'Enter' && e.target.id === 'newName') document.querySelector('[data-save-name]')?.click();
  if (e.key === 'Escape') closeDialog();
});

$('#q').addEventListener('input', render);
$('#sort').addEventListener('change', render);
$('#restoreFile').addEventListener('change', (e) => {
  const f = e.target.files?.[0];
  if (f) restore(f);
  e.target.value = '';
});
if (IS_EXTENSION) {
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === 'state' && msg.state.status === 'idle') load();
  });
} else {
  $('#helpLink').href = 'https://github.com/HackrLife/chrome-extensions/issues';
  $('#helpLink').target = '_blank';
}

requestPersistence();
load();
