// Renders a finished video from the recorded segments, the trim and the callouts.
// It plays the footage once into a canvas and records that canvas, so export takes
// about as long as the video itself. Nothing leaves the computer.

import { drawFrame, viewAt } from './callouts.js';
import { playPlan, trimRange } from './timeline.js';
import { GifEncoder } from './gif.js';
import { fixWebmDuration } from './webm.js';

// MP4 only when Chrome can make H.264, so the file plays everywhere (QuickTime, phones, uploads).
const MP4_TYPES = [
  'video/mp4;codecs=avc1.640028,mp4a.40.2',
  'video/mp4;codecs=avc1.4D401F,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1,mp4a.40.2',
];
const WEBM_TYPES = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];

const AUDIO_TYPES = [
  ['audio/mp4;codecs=mp4a.40.2', 'm4a'], // AAC: plays everywhere
  ['audio/webm;codecs=opus', 'webm'],
  ['audio/webm', 'webm'],
];

export function pickMime(format) {
  const ok = (t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t);
  if (format === 'audio') {
    const [mimeType, ext] = AUDIO_TYPES.find(([t]) => ok(t)) || AUDIO_TYPES[2];
    return { mimeType, ext, fellBack: false };
  }
  if (format === 'mp4') {
    const t = MP4_TYPES.find(ok);
    if (t) return { mimeType: t, ext: 'mp4', fellBack: false };
  }
  const t = WEBM_TYPES.find(ok) || 'video/webm';
  return { mimeType: t, ext: 'webm', fellBack: format === 'mp4' };
}

export const GIF_MAX_SECONDS = 60;

export function outputSize(rec, layout, quality, format) {
  const sw = rec.width || 1920, sh = rec.height || 1080;
  const even = (n) => Math.max(2, Math.round(n / 2) * 2);
  if (format === 'gif') {
    if (layout === 'vertical') return { w: 360, h: 640 };
    const w = Math.min(640, sw);
    return { w: even(w), h: even((w * sh) / sw) };
  }
  if (layout === 'vertical') {
    const w = quality >= 1080 ? 1080 : 720;
    return { w, h: even((w * 16) / 9) };
  }
  const h = Math.min(quality, even(sh));
  return { w: even((h * sw) / sh), h };
}

export function estimateBytes(rec, layout, quality, format) {
  const { length } = trimRange(rec);
  if (format === 'gif') {
    const { w, h } = outputSize(rec, layout, quality, format);
    return length * 10 * w * h * 0.25;
  }
  if (format === 'audio') return (128000 * length) / 8;
  const videoBps = quality >= 1080 ? 6e6 : 3.5e6;
  return ((videoBps + 128000) * length) / 8;
}

function fitRect(sw, sh, W, H) {
  const s = Math.min(W / sw, H / sh);
  const w = sw * s, h = sh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

function coverRect(sw, sh, W, H) {
  const s = Math.max(W / sw, H / sh);
  const w = sw * s, h = sh * s;
  return { x: (W - w) / 2, y: (H - h) / 2, w, h };
}

let backdrop = null;
function backdropCanvas(w, h) {
  if (!backdrop) backdrop = document.createElement('canvas');
  if (backdrop.width !== w || backdrop.height !== h) {
    backdrop.width = w;
    backdrop.height = h;
  }
  return backdrop;
}

// Lay out one output frame. Used by export and by the export preview thumbnails.
export function composeFrame(ctx, source, sw, sh, W, H, layout, callouts, t) {
  ctx.save();
  ctx.fillStyle = '#0E1014';
  ctx.fillRect(0, 0, W, H);
  if (layout === 'vertical') {
    // Blurred backdrop: draw a tiny copy and scale it up, which blurs for almost no cost.
    const bw = Math.max(8, Math.round(W / 16)), bh = Math.max(8, Math.round(H / 16));
    const small = backdropCanvas(bw, bh);
    const sctx = small.getContext('2d');
    const bg = coverRect(sw, sh, bw, bh);
    sctx.filter = 'blur(1.5px) brightness(0.55)';
    sctx.drawImage(source, 0, 0, sw, sh, bg.x - 2, bg.y - 2, bg.w + 4, bg.h + 4);
    sctx.filter = 'none';
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(small, 0, 0, bw, bh, 0, 0, W, H);
    const w = W * 0.96;
    const h = (w * sh) / sw;
    const dest = { x: (W - w) / 2, y: (H - h) / 2 - H * 0.02, w, h };
    ctx.save();
    const r = W * 0.03;
    ctx.beginPath();
    ctx.roundRect(dest.x, dest.y, dest.w, dest.h, r);
    ctx.clip();
    drawFrame(ctx, source, sw, sh, dest, callouts, t, { view: viewAt(callouts, t) });
    ctx.restore();
  } else {
    const dest = fitRect(sw, sh, W, H);
    drawFrame(ctx, source, sw, sh, dest, callouts, t, { view: viewAt(callouts, t) });
  }
  ctx.restore();
}

const once = (el, ev) => new Promise((res, rej) => {
  const ok = () => { cleanup(); res(); };
  const bad = () => { cleanup(); rej(el.error || new Error(`Could not load video (${ev})`)); };
  const cleanup = () => { el.removeEventListener(ev, ok); el.removeEventListener('error', bad); };
  el.addEventListener(ev, ok, { once: true });
  el.addEventListener('error', bad, { once: true });
});

async function seek(video, t) {
  if (Math.abs(video.currentTime - t) < 0.01) return;
  const p = once(video, 'seeked');
  video.currentTime = t;
  await p;
}

export async function exportRecording({ rec, getSegmentURL, format, layout, quality, onProgress, signal, tickerURL }) {
  const plan = playPlan(rec);
  if (!plan.length) throw new Error('Nothing to export. The trimmed video is empty.');
  const { start, length } = trimRange(rec);
  const sw = rec.width || 1280, sh = rec.height || 720;
  const { w: W, h: H } = outputSize(rec, layout, quality, format);
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: format === 'gif' });
  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'auto';
  const ticker = new Worker(tickerURL);
  const onTick = (fn) => {
    ticker.onmessage = () => {
      try {
        fn();
      } finally {
        ticker.postMessage({ ack: true });
      }
    };
  };
  const callouts = rec.callouts || [];
  let item = null;
  const globalNow = () => (item ? item.globalFrom + (video.currentTime - item.from) : start);
  const report = () => onProgress?.(Math.min(1, Math.max(0, (globalNow() - start) / length)));
  const draw = () => {
    if (!item || video.readyState < 2) return;
    composeFrame(ctx, video, video.videoWidth || sw, video.videoHeight || sh, W, H, layout, callouts, globalNow());
    report();
  };

  const abortError = () => Object.assign(new Error('Export cancelled'), { name: 'AbortError' });

  try {
    if (format === 'gif') {
      video.muted = true;
      const gif = new GifEncoder(W, H);
      const frameMs = 100;
      let lastT = null;
      onTick(() => {});
      ticker.postMessage({ start: true, interval: frameMs });
      for (item of plan) {
        if (signal?.aborted) throw abortError();
        video.src = await getSegmentURL(item.index);
        await once(video, 'loadedmetadata');
        await seek(video, item.from);
        lastT = null;
        await video.play();
        await new Promise((resolve, reject) => {
          onTick(() => {
            if (signal?.aborted) return reject(abortError());
            const t = video.currentTime;
            if (video.readyState >= 2) {
              draw();
              const delay = lastT == null ? frameMs : Math.max(20, (t - lastT) * 1000);
              lastT = t;
              gif.addFrame(ctx.getImageData(0, 0, W, H), delay);
            }
            if (video.ended || t >= item.to - 0.03) resolve();
          });
        });
        video.pause();
        onTick(() => {});
      }
      ticker.postMessage({ stop: true });
      onProgress?.(1);
      return { blob: gif.finish(), ext: 'gif', mimeType: 'image/gif', fellBack: false };
    }

    const { mimeType, ext, fellBack } = pickMime(format);
    const ac = new AudioContext();
    const srcNode = ac.createMediaElementSource(video);
    const audioDest = ac.createMediaStreamDestination();
    srcNode.connect(audioDest);
    const canvasStream = canvas.captureStream(30);
    const audioOnly = format === 'audio';
    const tracks = audioOnly ? audioDest.stream.getAudioTracks() : [...canvasStream.getVideoTracks(), ...audioDest.stream.getAudioTracks()];
    const recorder = new MediaRecorder(
      new MediaStream(tracks),
      audioOnly ? { mimeType, audioBitsPerSecond: 128_000 } : { mimeType, videoBitsPerSecond: quality >= 1080 ? 6_000_000 : 3_500_000, audioBitsPerSecond: 128_000 },
    );
    const chunks = [];
    recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
    const stopped = new Promise((r) => (recorder.onstop = r));
    let started = false;
    onTick(draw);
    ticker.postMessage({ start: true, interval: 33 });

    for (item of plan) {
      if (signal?.aborted) throw abortError();
      video.src = await getSegmentURL(item.index);
      await once(video, 'loadedmetadata');
      await seek(video, item.from);
      draw();
      await ac.resume();
      if (!started) {
        recorder.start(1000);
        started = true;
      } else {
        recorder.resume();
      }
      await video.play();
      await new Promise((resolve, reject) => {
        const check = () => {
          if (signal?.aborted) return reject(abortError());
          draw();
          if (video.ended || video.currentTime >= item.to - 0.02) resolve();
        };
        onTick(check);
      });
      video.pause();
      recorder.pause();
      onTick(draw);
    }
    recorder.resume();
    recorder.stop();
    await stopped;
    ticker.postMessage({ stop: true });
    await ac.close();
    onProgress?.(1);
    let blob = new Blob(chunks, { type: mimeType.split(';')[0] });
    if (ext === 'webm') blob = await fixWebmDuration(blob, length);
    return { blob, ext, mimeType, fellBack };
  } finally {
    ticker.terminate();
    video.pause();
    video.removeAttribute('src');
    video.load();
  }
}
