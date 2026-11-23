// Shows Chrome's screen picker for window and screen recordings. Chrome only shows it for a
// page, not for the background worker, so the worker opens this small window.
import '../core/theme.js';
import { logError, watchErrors } from '../core/diagnostics.js';
// Chrome only lets the page that asked for a window or screen use it, so this page is also
// the recorder for those recordings. It minimises itself while recording.
import './offscreen.js';

watchErrors('picker');
const source = location.hash.slice(1) === 'window' ? 'window' : 'screen';
const sources = source === 'window' ? ['window', 'audio'] : ['screen', 'audio'];

try {
  chrome.desktopCapture.chooseDesktopMedia(sources, (streamId, options) => {
    // On cancel there is nothing to keep, so the window closes.
    if (streamId) document.body.innerHTML = '<div><b>Retake is recording</b><p>Keep this window open. It records your screen and closes by itself when you finish.</p></div>';
    chrome.runtime
      .sendMessage({ type: 'picked', streamId: streamId || null, audio: !!options?.canRequestAudioTrack })
      .catch((e) => logError('picker', e))
      .finally(() => {
        if (!streamId) window.close();
      });
  });
} catch (e) {
  logError('picker', e);
  chrome.runtime.sendMessage({ type: 'picked', streamId: null, error: e.message }).finally(() => window.close());
}
