// Hidden window that owns the capture streams and records them in segments.
import { newRecording, putRecording, deleteRecording, requestPersistence } from '../../shared/core/db.js';
import { SegmentRecorder, compositeWithCamera, voiceCard } from '../../shared/core/recorder.js';

const api = window.retakeDesktop;
const TICKER = new URL('../../shared/core/ticker.js', import.meta.url).href;
let display = null, mic = null, cam = null, composite = null, card = null, mixed = null, ac = null, recorder = null, recordingId = null;

async function getScreen(o) {
  const video = { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: o.sourceId, maxWidth: o.maxWidth, maxHeight: o.maxHeight, maxFrameRate: 30 } };
  const sysAudio = o.sound && o.platform === 'win32' ? { mandatory: { chromeMediaSource: 'desktop' } } : false;
  const errors = [];
  const tries = sysAudio ? [{ audio: sysAudio, video }, { audio: false, video }] : [{ audio: false, video }];
  for (const c of tries) {
    try {
      return await navigator.mediaDevices.getUserMedia(c);
    } catch (e) {
      errors.push(e);
    }
  }
  try {
    // Newer path: main answers with the source picked in the panel.
    return await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: !!sysAudio });
  } catch (e) {
    throw errors[0] || e;
  }
}

const ops = {
  async prepare(o) {
    cleanup();
    let warning = '';
    if (o.kind === 'camera') {
      display = await navigator.mediaDevices.getUserMedia({ video: { deviceId: o.camId ? { exact: o.camId } : undefined, width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } } });
    } else if (o.kind === 'audio') {
      mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: o.micId ? { exact: o.micId } : undefined, echoCancellation: true, noiseSuppression: true } });
      card = voiceCard(mic, TICKER);
      display = new MediaStream(card.stream.getVideoTracks());
    } else {
      display = await getScreen(o);
    }
    display.getVideoTracks()[0].addEventListener('ended', () => api.call('rec-event', { type: 'ended' }));
    if (o.mic && !mic) {
      try {
        mic = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: o.micId ? { exact: o.micId } : undefined, echoCancellation: true, noiseSuppression: true } });
      } catch {
        warning = 'Microphone not available, so this recording has no voice.';
      }
    }
    if (o.composite) {
      try {
        cam = await navigator.mediaDevices.getUserMedia({ video: { deviceId: o.camId ? { exact: o.camId } : undefined, width: { ideal: 640 }, height: { ideal: 480 } } });
      } catch {
        warning ||= 'Camera not available for this window recording.';
      }
    }
    if (o.sound && o.platform === 'win32' && !display.getAudioTracks().length) warning ||= 'Computer sound couldn’t be included.';

    const tracks = [];
    if (cam) {
      composite = compositeWithCamera(display, cam, TICKER);
      tracks.push(...composite.stream.getVideoTracks());
    } else tracks.push(...display.getVideoTracks());
    const audio = [display, mic].filter((s) => s?.getAudioTracks().length);
    if (audio.length === 1) tracks.push(...audio[0].getAudioTracks());
    else if (audio.length > 1) {
      ac = new AudioContext();
      const dest = ac.createMediaStreamDestination();
      for (const s of audio) ac.createMediaStreamSource(s).connect(dest);
      tracks.push(...dest.stream.getAudioTracks());
    }
    mixed = new MediaStream(tracks);

    const set = display.getVideoTracks()[0].getSettings();
    const rec = newRecording({ source: { window: 'window', camera: 'camera', audio: 'audio' }[o.kind] || 'screen', width: set.width || o.maxWidth, height: set.height || o.maxHeight, hasAudio: audio.length > 0 });
    recordingId = rec.id;
    recorder = new SegmentRecorder({ stream: mixed, recordingId });
    rec.mimeType = recorder.mimeType;
    await putRecording(rec);
    requestPersistence();
    return { recordingId, warning };
  },
  async begin({ retake = false } = {}) {
    await recorder.begin({ retake });
    return {};
  },
  async end() {
    const s = await recorder.endSegment();
    return { duration: s?.duration || 0 };
  },
  async 'discard-last'() {
    const s = await recorder.discardLast();
    return { duration: s?.duration || 0 };
  },
  async finish() {
    const count = await recorder.finish();
    cleanup();
    return { count, recordingId };
  },
  async abort() {
    if (recorder) await recorder.abort();
    if (recordingId) await deleteRecording(recordingId);
    cleanup();
    return {};
  },
};

function cleanup() {
  composite?.stop();
  card?.stop();
  card = null;
  for (const s of [display, mic, cam, mixed]) s?.getTracks().forEach((t) => t.stop());
  ac?.close();
  display = mic = cam = mixed = composite = ac = null;
  recorder = null;
}

api.on('rec-op', async ({ id, op, data }) => {
  try {
    const result = await ops[op](data || {});
    api.call('rec-reply', { id, ok: true, result });
  } catch (e) {
    api.call('rec-reply', { id, ok: false, error: e?.message || e?.name || String(e) });
  }
});
api.call('rec-ready');
