// The recorder. Lives in an offscreen document so recording carries on while the user
// works in any tab. Each stretch between pauses is a separate segment, which is what
// makes "retake the last segment" possible: the last segment is simply thrown away.

import { addChunk, deleteSegment, getRecording, updateRecording, uid } from '../core/db.js';

let source = null; // captured tab or screen
let mic = null;
let audioCtx = null;
let mixed = null; // what MediaRecorder records
let mimeType = '';
let recordingId = null;
let recorder = null;
let seg = null;
let thumbTaken = false;

const WEBM = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
const WEBM_NOAUDIO = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];

function capSize(size) {
  if (!size?.width || !size?.height) return null;
  let w = Math.round(size.width * (size.dpr || 1));
  let h = Math.round(size.height * (size.dpr || 1));
  const max = 1920;
  if (w > max) {
    h = Math.round((h * max) / w);
    w = max;
  }
  return { w: w - (w % 2), h: h - (h % 2) };
}

async function prepare({ kind, streamId, wantAudio, micId, recordingId: id, size }) {
  recordingId = id;
  const cap = kind === 'tab' ? capSize(size) : null;
  const videoConstraint = {
    mandatory: {
      chromeMediaSource: kind,
      chromeMediaSourceId: streamId,
      maxFrameRate: 30,
      ...(cap ? { maxWidth: cap.w, maxHeight: cap.h } : { maxWidth: 2560, maxHeight: 1600 }),
    },
  };
  const audioConstraint = wantAudio ? { mandatory: { chromeMediaSource: kind, chromeMediaSourceId: streamId } } : false;

  // The capture id can be used once. Try the exact size first, then looser settings.
  const attempts = [
    { video: videoConstraint, audio: audioConstraint },
    { video: { mandatory: { chromeMediaSource: kind, chromeMediaSourceId: streamId } }, audio: audioConstraint },
  ];
  const errors = [];
  for (const c of attempts) {
    try {
      source = await navigator.mediaDevices.getUserMedia(c);
      break;
    } catch (e) {
      errors.push(`${e.name}: ${e.message}`);
    }
  }
  if (!source) throw new Error(`Could not capture the ${kind === 'tab' ? 'tab' : 'screen'} (${errors.join(' | ')})`);

  let micFailed = false;
  if (micId) {
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: micId === 'default' ? undefined : { exact: micId }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch {
      micFailed = true;
    }
  }

  audioCtx = new AudioContext();
  const dest = audioCtx.createMediaStreamDestination();
  let hasAudio = false;
  if (source.getAudioTracks().length) {
    const node = audioCtx.createMediaStreamSource(new MediaStream(source.getAudioTracks()));
    node.connect(dest);
    // Capturing a tab silences it, so play it back to keep it audible.
    if (kind === 'tab') node.connect(audioCtx.destination);
    hasAudio = true;
  }
  if (mic) {
    audioCtx.createMediaStreamSource(mic).connect(dest);
    hasAudio = true;
  }

  const videoTrack = source.getVideoTracks()[0];
  videoTrack.addEventListener('ended', () => chrome.runtime.sendMessage({ type: 'source-ended' }).catch(() => {}));
  mixed = new MediaStream([videoTrack, ...(hasAudio ? dest.stream.getAudioTracks() : [])]);
  mimeType = (hasAudio ? WEBM : WEBM_NOAUDIO).find((t) => MediaRecorder.isTypeSupported(t)) || 'video/webm';

  const { width = 0, height = 0 } = videoTrack.getSettings();
  await updateRecording(recordingId, { width, height, mimeType: mimeType.split(';')[0], hasAudio });
  return { ok: true, width, height, hasAudio, micFailed };
}

function bitrate() {
  const { width = 1280, height = 720 } = mixed.getVideoTracks()[0].getSettings();
  return Math.min(10_000_000, Math.max(2_500_000, Math.round(width * height * 3)));
}

async function begin({ retake }) {
  if (!mixed) throw new Error('Recorder is not ready.');
  if (seg) await endSegment();
  const s = { id: uid(), seq: 0, bytes: 0, retake: !!retake, started: 0, writes: Promise.resolve() };
  recorder = new MediaRecorder(mixed, { mimeType, videoBitsPerSecond: bitrate(), audioBitsPerSecond: 128_000 });
  recorder.ondataavailable = (e) => {
    if (!e.data?.size) return;
    const n = s.seq++;
    s.bytes += e.data.size;
    s.writes = s.writes.then(() => addChunk(s.id, n, e.data)).catch((err) => console.warn('Retake save', err));
  };
  await updateRecording(recordingId, (rec) => {
    rec.segments.push({ id: s.id, duration: 0, bytes: 0, retake: s.retake, open: true });
  });
  recorder.start(1000);
  s.started = performance.now();
  seg = s;
  if (!thumbTaken) setTimeout(takeThumbnail, 700);
  return { ok: true, segmentId: s.id };
}

async function endSegment() {
  if (!seg) return null;
  const s = seg;
  seg = null;
  const r = recorder;
  recorder = null;
  if (r && r.state !== 'inactive') {
    const stopped = new Promise((res) => (r.onstop = res));
    r.stop();
    await stopped;
  }
  const duration = (performance.now() - s.started) / 1000;
  await s.writes;
  await updateRecording(recordingId, (rec) => {
    const entry = rec.segments.find((x) => x.id === s.id);
    if (entry) Object.assign(entry, { duration, bytes: s.bytes, open: false });
    rec.bytes = rec.segments.reduce((sum, x) => sum + (x.bytes || 0), 0);
  });
  return { segmentId: s.id, duration, retake: s.retake };
}

async function discard({ segmentId }) {
  if (seg?.id === segmentId) await endSegment();
  await deleteSegment(segmentId);
  await updateRecording(recordingId, (rec) => {
    rec.segments = rec.segments.filter((x) => x.id !== segmentId);
    rec.bytes = rec.segments.reduce((sum, x) => sum + (x.bytes || 0), 0);
  });
  return { ok: true };
}

async function takeThumbnail() {
  try {
    const track = mixed?.getVideoTracks()[0];
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
    thumbTaken = true;
    await updateRecording(recordingId, { thumbnail: c.toDataURL('image/jpeg', 0.72) });
  } catch (e) {
    console.warn('Retake thumbnail', e);
  }
}

function releaseMedia() {
  for (const s of [source, mic, mixed]) s?.getTracks().forEach((t) => t.stop());
  audioCtx?.close().catch(() => {});
  source = mic = mixed = audioCtx = null;
}

async function finish() {
  if (seg) await endSegment();
  releaseMedia();
  const rec = await updateRecording(recordingId, (r) => {
    r.segments = r.segments.filter((x) => (x.bytes || 0) > 0);
    r.status = 'ready';
  });
  return { ok: true, segments: rec.segments.length };
}

async function abort() {
  if (recorder && recorder.state !== 'inactive') recorder.stop();
  seg = recorder = null;
  releaseMedia();
  const rec = recordingId ? await getRecording(recordingId) : null;
  if (rec) for (const s of rec.segments) await deleteSegment(s.id);
  return { ok: true };
}

const handlers = {
  prepare,
  begin,
  'end-segment': async () => ({ ok: true, ...(await endSegment()) }),
  discard,
  finish,
  abort,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen') return false;
  const h = handlers[msg.type];
  if (!h) return false;
  h(msg)
    .then((r) => sendResponse(r?.ok === undefined ? { ok: true, ...r } : r))
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e) }));
  return true;
});
