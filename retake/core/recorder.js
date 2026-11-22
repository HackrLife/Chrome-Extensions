// Records a media stream in segments, one per stretch between pauses, saving every second.
// Retake throws away the last segment. Used by the web app; the extension's offscreen
// recorder follows the same model.

import { addChunk, deleteSegment, getRecording, updateRecording, uid } from './db.js';

const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const WEBM_NOAUDIO = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

export class SegmentRecorder {
  constructor({ stream, recordingId }) {
    this.stream = stream;
    this.recordingId = recordingId;
    const hasAudio = stream.getAudioTracks().length > 0;
    this.mimeType = (hasAudio ? WEBM : WEBM_NOAUDIO).find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';
    this.seg = null;
    this.recorder = null;
    this.segments = []; // finished: { id, duration, retake }
    this.thumbTaken = false;
  }

  bitrate() {
    const { width = 1280, height = 720 } = this.stream.getVideoTracks()[0]?.getSettings() || {};
    return Math.min(10_000_000, Math.max(2_500_000, Math.round(width * height * 3)));
  }

  get recording() {
    return !!this.seg;
  }

  elapsed() {
    const done = this.segments.reduce((s, x) => s + x.duration, 0);
    return done + (this.seg ? (performance.now() - this.seg.started) / 1000 : 0);
  }

  async begin({ retake = false } = {}) {
    if (this.seg) return;
    const s = { id: uid(), seq: 0, bytes: 0, retake, started: 0, writes: Promise.resolve() };
    const r = new MediaRecorder(this.stream, { mimeType: this.mimeType, videoBitsPerSecond: this.bitrate(), audioBitsPerSecond: 128_000 });
    r.ondataavailable = (e) => {
      if (!e.data?.size) return;
      const n = s.seq++;
      s.bytes += e.data.size;
      s.writes = s.writes.then(() => addChunk(s.id, n, e.data)).catch((err) => console.warn('Retake save', err));
    };
    await updateRecording(this.recordingId, (rec) => {
      rec.segments.push({ id: s.id, duration: 0, bytes: 0, retake, open: true });
    });
    r.start(1000);
    s.started = performance.now();
    this.seg = s;
    this.recorder = r;
    if (!this.thumbTaken) setTimeout(() => this.takeThumbnail(), 700);
  }

  async endSegment() {
    if (!this.seg) return null;
    const s = this.seg;
    const r = this.recorder;
    this.seg = null;
    this.recorder = null;
    if (r && r.state !== 'inactive') {
      const stopped = new Promise((res) => (r.onstop = res));
      r.stop();
      await stopped;
    }
    const duration = (performance.now() - s.started) / 1000;
    await s.writes;
    await updateRecording(this.recordingId, (rec) => {
      const entry = rec.segments.find((x) => x.id === s.id);
      if (entry) Object.assign(entry, { duration, bytes: s.bytes, open: false });
      rec.bytes = rec.segments.reduce((sum, x) => sum + (x.bytes || 0), 0);
    });
    const done = { id: s.id, duration, retake: s.retake };
    this.segments.push(done);
    return done;
  }

  async discardLast() {
    if (this.seg) await this.endSegment();
    const last = this.segments.pop();
    if (!last) return null;
    await deleteSegment(last.id);
    await updateRecording(this.recordingId, (rec) => {
      rec.segments = rec.segments.filter((x) => x.id !== last.id);
      rec.bytes = rec.segments.reduce((sum, x) => sum + (x.bytes || 0), 0);
    });
    return last;
  }

  async finish() {
    if (this.seg) await this.endSegment();
    const rec = await updateRecording(this.recordingId, (r) => {
      r.segments = r.segments.filter((x) => (x.bytes || 0) > 0);
      r.status = 'ready';
    });
    return rec.segments.length;
  }

  async abort() {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop();
    this.seg = this.recorder = null;
    const rec = await getRecording(this.recordingId);
    if (rec) for (const s of rec.segments) await deleteSegment(s.id);
  }

  async takeThumbnail() {
    try {
      const track = this.stream.getVideoTracks()[0];
      if (!track || track.readyState !== 'live') return;
      const v = document.createElement('video');
      v.muted = true;
      v.srcObject = new MediaStream([track]);
      await v.play();
      await new Promise((r) => setTimeout(r, 150));
      const w = 480;
      const h = Math.round((w * v.videoHeight) / v.videoWidth) || 270;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      v.pause();
      v.srcObject = null;
      this.thumbTaken = true;
      await updateRecording(this.recordingId, { thumbnail: c.toDataURL('image/jpeg', 0.72) });
    } catch (e) {
      console.warn('Retake thumbnail', e);
    }
  }
}

// Draws the shared screen with a round camera bubble on top, so the camera is part of the
// video whatever the user shares. Driven by a worker timer so it keeps going in the background.
export function compositeWithCamera(display, camera, tickerURL) {
  const dv = document.createElement('video');
  dv.muted = true;
  dv.playsInline = true;
  dv.srcObject = new MediaStream(display.getVideoTracks());
  const cv = document.createElement('video');
  cv.muted = true;
  cv.playsInline = true;
  cv.srcObject = camera;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const ticker = new Worker(tickerURL);
  let on = true;
  const draw = () => {
    if (!on) return;
    const w = dv.videoWidth, h = dv.videoHeight;
    if (w && h) {
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      ctx.drawImage(dv, 0, 0, w, h);
      if (cv.videoWidth) {
        const d = Math.round(Math.min(w, h) * 0.2);
        const x = Math.round(w * 0.025), y = h - d - Math.round(w * 0.025);
        const s = Math.min(cv.videoWidth, cv.videoHeight);
        ctx.save();
        ctx.beginPath();
        ctx.arc(x + d / 2, y + d / 2, d / 2 + Math.max(3, d * 0.03), 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x + d / 2, y + d / 2, d / 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.translate(x + d, y);
        ctx.scale(-1, 1); // mirrored, as people expect to see themselves
        ctx.drawImage(cv, (cv.videoWidth - s) / 2, (cv.videoHeight - s) / 2, s, s, 0, 0, d, d);
        ctx.restore();
      }
    }
  };
  ticker.onmessage = () => {
    try {
      draw();
    } finally {
      ticker.postMessage({ ack: true });
    }
  };
  dv.play();
  cv.play();
  ticker.postMessage({ start: true, interval: 33 });
  const out = canvas.captureStream(30);
  return {
    stream: out,
    stop() {
      on = false;
      ticker.postMessage({ stop: true });
      ticker.terminate();
      out.getTracks().forEach((t) => t.stop());
      dv.srcObject = null;
      cv.srcObject = null;
    },
  };
}
