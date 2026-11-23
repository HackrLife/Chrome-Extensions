// Local storage for recordings. Everything lives in IndexedDB on the user's computer.
// Recordings hold metadata; chunks hold the video data, written every second while recording
// so a crash or a closed tab never loses more than a moment of footage.

const DB_NAME = 'retake';
const DB_VERSION = 1;
let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('recordings')) {
        db.createObjectStore('recordings', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('chunks')) {
        db.createObjectStore('chunks', { keyPath: ['segmentId', 'seq'] });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A newer Retake (after an update) may need to upgrade the database: let it.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

// Records written by an older version lack fields added since. Fill them in on read, so new
// code never meets a missing field and old recordings keep working after every update.
export const SCHEMA = 1;
function withDefaults(r) {
  if (!r) return r;
  return {
    status: 'ready',
    source: 'tab',
    segments: [],
    callouts: [],
    trim: { start: 0, end: null },
    thumbnail: '',
    bytes: 0,
    ...r,
    schema: r.schema || SCHEMA,
  };
}

function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

export const uid = () => crypto.randomUUID();

export function newRecording(fields = {}) {
  const now = Date.now();
  return {
    id: uid(),
    title: defaultTitle(now),
    createdAt: now,
    updatedAt: now,
    status: 'recording',
    source: 'tab',
    width: 0,
    height: 0,
    mimeType: '',
    segments: [],
    callouts: [],
    trim: { start: 0, end: null },
    thumbnail: '',
    bytes: 0,
    schema: SCHEMA,
    ...fields,
  };
}

function defaultTitle(ts) {
  const d = new Date(ts);
  const date = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `Recording ${date}, ${time}`;
}

export async function putRecording(rec) {
  rec.updatedAt = Date.now();
  return done((await store('recordings', 'readwrite')).put(rec));
}

export async function getRecording(id) {
  return withDefaults(await done((await store('recordings')).get(id)));
}

// Read, change and write in one transaction, so two updates at once cannot overwrite each other.
// patch is an object to merge, or a synchronous function that edits the record in place.
export async function updateRecording(id, patch) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recordings', 'readwrite');
    const st = tx.objectStore('recordings');
    let rec = null;
    const get = st.get(id);
    get.onsuccess = () => {
      rec = get.result;
      if (!rec) {
        tx.abort();
        return;
      }
      if (typeof patch === 'function') {
        const extra = patch(rec);
        if (extra && typeof extra === 'object') Object.assign(rec, extra);
      } else {
        Object.assign(rec, patch);
      }
      rec.updatedAt = Date.now();
      st.put(rec);
    };
    tx.oncomplete = () => resolve(rec);
    tx.onabort = () => reject(tx.error || new Error('Recording not found'));
    tx.onerror = () => reject(tx.error);
  });
}

export async function listRecordings() {
  const all = (await done((await store('recordings')).getAll())).map(withDefaults);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function addChunk(segmentId, seq, blob) {
  return done((await store('chunks', 'readwrite')).put({ segmentId, seq, blob }));
}

function segmentRange(segmentId) {
  return IDBKeyRange.bound([segmentId, 0], [segmentId, Infinity]);
}

export async function getSegmentBlob(segmentId, mimeType = 'video/webm') {
  const rows = await done((await store('chunks')).getAll(segmentRange(segmentId)));
  return new Blob(rows.map((r) => r.blob), { type: mimeType });
}

export async function deleteSegment(segmentId) {
  return done((await store('chunks', 'readwrite')).delete(segmentRange(segmentId)));
}

export async function deleteRecording(id) {
  const rec = await getRecording(id);
  if (rec) for (const s of rec.segments) await deleteSegment(s.id);
  return done((await store('recordings', 'readwrite')).delete(id));
}

// Segment ids that have chunks on disk, in write order. Used to recover a recording that
// was interrupted before it could save its segment list.
export async function segmentIdsWithChunks() {
  const keys = await done((await store('chunks')).getAllKeys());
  const seen = new Map();
  for (const [segmentId] of keys) seen.set(segmentId, true);
  return [...seen.keys()];
}

export async function storageEstimate() {
  if (!navigator.storage?.estimate) return { usage: 0, quota: 0 };
  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return { usage, quota };
}

export async function requestPersistence() {
  try {
    if (navigator.storage?.persisted && (await navigator.storage.persisted())) return true;
    return (await navigator.storage?.persist?.()) || false;
  } catch {
    return false;
  }
}
