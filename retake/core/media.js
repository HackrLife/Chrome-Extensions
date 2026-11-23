// Slides and media for the teleprompter: PDFs (one slide per page), images and videos.
// Files are kept in this browser's storage on this computer, in their own database.

const DB = 'retake-media';
let dbp = null;
function db() {
  dbp ||= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('files', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction('files', mode);
    const out = fn(t.objectStore('files'));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}

const kindOf = (f) => (f.type === 'application/pdf' || /\.pdf$/i.test(f.name) ? 'pdf' : f.type.startsWith('video/') ? 'video' : f.type.startsWith('image/') ? 'image' : null);
export const ACCEPT = 'application/pdf,.pdf,image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime';

export async function listFiles() {
  const all = await tx('readonly', (s) => s.getAll());
  return (all || []).sort((a, b) => a.order - b.order);
}

export async function addFiles(fileList) {
  const existing = await listFiles();
  let order = existing.length ? existing[existing.length - 1].order + 1 : 0;
  const skipped = [];
  for (const f of fileList) {
    const kind = kindOf(f);
    if (!kind) {
      skipped.push(f.name);
      continue;
    }
    const rec = { id: crypto.randomUUID(), name: f.name, kind, blob: f, order: order++ };
    await tx('readwrite', (s) => s.put(rec));
  }
  return { skipped };
}

export async function removeFile(id) {
  await tx('readwrite', (s) => s.delete(id));
}
export async function clearFiles() {
  await tx('readwrite', (s) => s.clear());
}

// ---------- the deck: every file turned into slides ----------
let pdfjs = null;
async function loadPdfJs() {
  if (pdfjs) return pdfjs;
  pdfjs = await import('./vendor/pdfjs/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdfjs/pdf.worker.min.mjs', import.meta.url).href;
  return pdfjs;
}

// Returns slides: { kind: 'image', url, w, h, label } or { kind: 'video', url, label }.
// PDF pages are drawn once at 1920 pixels wide and kept as JPEG images.
// The first page of a PDF as a small picture, and how many pages it has, for the file list.
export async function pdfPreview(blob, width = 320) {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), isEvalSupported: false }).promise;
  try {
    const page = await pdf.getPage(1);
    const v1 = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / v1.width });
    const c = document.createElement('canvas');
    c.width = Math.round(viewport.width);
    c.height = Math.round(viewport.height);
    await page.render({ canvasContext: c.getContext('2d'), viewport }).promise;
    return { url: c.toDataURL('image/jpeg', 0.8), pages: pdf.numPages };
  } finally {
    await (pdf.destroy?.() ?? pdf.cleanup?.());
  }
}

export async function buildDeck(files, onProgress = () => {}) {
  const slides = [];
  for (const f of files) {
    if (f.kind === 'image') {
      const url = URL.createObjectURL(f.blob);
      const img = await loadImage(url);
      slides.push({ kind: 'image', url, w: img.naturalWidth, h: img.naturalHeight, label: f.name });
    } else if (f.kind === 'video') {
      slides.push({ kind: 'video', url: URL.createObjectURL(f.blob), label: f.name });
    } else if (f.kind === 'pdf') {
      const lib = await loadPdfJs();
      // No eval: extension pages forbid it, and pdf.js draws fonts just as well without.
      const pdf = await lib.getDocument({ data: new Uint8Array(await f.blob.arrayBuffer()), isEvalSupported: false }).promise;
      for (let n = 1; n <= pdf.numPages; n++) {
        onProgress(`${f.name}: page ${n} of ${pdf.numPages}`);
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: 1920 / base.width });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width);
        c.height = Math.round(vp.height);
        await page.render({ canvas: c, canvasContext: c.getContext('2d'), viewport: vp }).promise;
        const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.9));
        slides.push({ kind: 'image', url: URL.createObjectURL(blob), w: c.width, h: c.height, label: `${f.name} · ${n}` });
        page.cleanup();
      }
      await (pdf.destroy?.() ?? pdf.cleanup?.());
    }
  }
  return slides;
}

export function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

export function releaseDeck(slides) {
  for (const s of slides || []) URL.revokeObjectURL(s.url);
}
