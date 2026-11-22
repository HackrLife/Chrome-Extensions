// A small animated GIF encoder. Colours are mapped to a fixed 252-colour palette,
// which keeps encoding fast enough to run alongside playback. Written for Retake.

const PALETTE = (() => {
  const p = new Uint8Array(256 * 3);
  let i = 0;
  for (let r = 0; r < 6; r++)
    for (let g = 0; g < 7; g++)
      for (let b = 0; b < 6; b++) {
        p[i++] = r * 51;
        p[i++] = Math.round((g * 255) / 6);
        p[i++] = b * 51;
      }
  return p; // remaining 4 entries stay black
})();

function quantize(rgba, out) {
  for (let i = 0, j = 0; j < out.length; i += 4, j++) {
    const r = (rgba[i] * 5 + 127) / 255 | 0;
    const g = (rgba[i + 1] * 6 + 127) / 255 | 0;
    const b = (rgba[i + 2] * 5 + 127) / 255 | 0;
    out[j] = r * 42 + g * 6 + b;
  }
  return out;
}

class Bytes {
  constructor() {
    this.parts = [];
    this.buf = new Uint8Array(1 << 16);
    this.len = 0;
  }
  byte(b) {
    if (this.len === this.buf.length) this.flush();
    this.buf[this.len++] = b;
  }
  word(w) {
    this.byte(w & 255);
    this.byte((w >> 8) & 255);
  }
  bytes(arr) {
    for (let i = 0; i < arr.length; i++) this.byte(arr[i]);
  }
  ascii(s) {
    for (let i = 0; i < s.length; i++) this.byte(s.charCodeAt(i));
  }
  flush() {
    if (this.len) this.parts.push(this.buf.slice(0, this.len));
    this.len = 0;
  }
}

function lzw(indices, out) {
  const minCode = 8;
  const clear = 1 << minCode;
  const eoi = clear + 1;
  let codeSize = minCode + 1;
  let next = eoi + 1;
  let table = new Map();
  const block = new Uint8Array(255);
  let blockLen = 0;
  let cur = 0;
  let shift = 0;

  const pushByte = (b) => {
    block[blockLen++] = b;
    if (blockLen === 255) {
      out.byte(255);
      out.bytes(block);
      blockLen = 0;
    }
  };
  const emit = (code) => {
    cur |= code << shift;
    shift += codeSize;
    while (shift >= 8) {
      pushByte(cur & 255);
      cur >>>= 8;
      shift -= 8;
    }
  };

  out.byte(minCode);
  emit(clear);
  let key = indices[0];
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i];
    const pair = (key << 8) | k;
    const found = table.get(pair);
    if (found === undefined) {
      emit(key);
      if (next === 4096) {
        emit(clear);
        next = eoi + 1;
        codeSize = minCode + 1;
        table = new Map();
      } else {
        if (next >= 1 << codeSize) codeSize++;
        table.set(pair, next++);
      }
      key = k;
    } else {
      key = found;
    }
  }
  emit(key);
  emit(eoi);
  if (shift > 0) pushByte(cur & 255);
  if (blockLen) {
    out.byte(blockLen);
    out.bytes(block.subarray(0, blockLen));
  }
  out.byte(0);
}

export class GifEncoder {
  constructor(width, height) {
    this.w = width;
    this.h = height;
    this.out = new Bytes();
    this.idx = new Uint8Array(width * height);
    const o = this.out;
    o.ascii('GIF89a');
    o.word(width);
    o.word(height);
    o.byte(0xf7); // global colour table, 256 entries
    o.byte(0);
    o.byte(0);
    o.bytes(PALETTE);
    // loop forever
    o.byte(0x21); o.byte(0xff); o.byte(11); o.ascii('NETSCAPE2.0'); o.byte(3); o.byte(1); o.word(0); o.byte(0);
  }

  addFrame(imageData, delayMs) {
    const o = this.out;
    o.byte(0x21); o.byte(0xf9); o.byte(4); o.byte(0);
    o.word(Math.max(2, Math.round(delayMs / 10)));
    o.byte(0); o.byte(0);
    o.byte(0x2c); o.word(0); o.word(0); o.word(this.w); o.word(this.h); o.byte(0);
    lzw(quantize(imageData.data, this.idx), o);
  }

  finish() {
    this.out.byte(0x3b);
    this.out.flush();
    return new Blob(this.out.parts, { type: 'image/gif' });
  }
}
