// Chrome's MediaRecorder writes WebM files without a duration, so some players and upload
// sites show the wrong length or cannot seek. This adds the duration to the file's header.

const ID_SEGMENT = 0x18538067;
const ID_INFO = 0x1549a966;
const ID_DURATION = 0x4489;
const ID_TIMECODE_SCALE = 0x2ad7b1;

function readVint(b, p, keepMarker = false) {
  const first = b[p];
  let len = 1;
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++;
  if (len > 8) return null;
  let value = keepMarker ? first : first & (0xff >> len);
  let unknown = value === (0xff >> len);
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[p + i];
    if (b[p + i] !== 0xff) unknown = false;
  }
  return { value, len, unknown };
}

function readElement(b, p) {
  const id = readVint(b, p, true);
  if (!id) return null;
  const size = readVint(b, p + id.len);
  if (!size) return null;
  return { id: id.value, start: p, dataStart: p + id.len + size.len, size: size.unknown ? Infinity : size.value };
}

function sizeVint8(n) {
  const out = new Uint8Array(8);
  out[0] = 0x01;
  for (let i = 7; i >= 1; i--) {
    out[i] = n % 256;
    n = Math.floor(n / 256);
  }
  return out;
}

export async function fixWebmDuration(blob, durationSec) {
  try {
    const headLen = Math.min(blob.size, 256 * 1024);
    const b = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
    const ebml = readElement(b, 0);
    if (!ebml || ebml.id !== 0x1a45dfa3) return blob;
    const seg = readElement(b, ebml.dataStart + ebml.size);
    if (!seg || seg.id !== ID_SEGMENT) return blob;
    let p = seg.dataStart;
    while (p < headLen - 12) {
      const el = readElement(b, p);
      if (!el || !Number.isFinite(el.size)) return blob;
      if (el.id === ID_INFO) {
        const end = el.dataStart + el.size;
        if (end > headLen) return blob;
        let scale = 1_000_000;
        let q = el.dataStart;
        while (q < end) {
          const c = readElement(b, q);
          if (!c) break;
          if (c.id === ID_DURATION) return blob; // already present
          if (c.id === ID_TIMECODE_SCALE) {
            scale = 0;
            for (let i = 0; i < c.size; i++) scale = scale * 256 + b[c.dataStart + i];
          }
          q = c.dataStart + c.size;
        }
        const dur = new Uint8Array(11);
        dur.set([0x44, 0x89, 0x88]);
        new DataView(dur.buffer).setFloat64(3, (durationSec * 1e9) / scale);
        const body = b.slice(el.dataStart, end);
        const idBytes = b.slice(el.start, el.start + 4);
        const newInfo = new Blob([idBytes, sizeVint8(body.length + dur.length), body, dur]);
        return new Blob([blob.slice(0, el.start), newInfo, blob.slice(end)], { type: blob.type });
      }
      p = el.dataStart + el.size;
    }
    return blob;
  } catch {
    return blob;
  }
}
