// Camera-only and voice-only recordings, with the script under the camera.
import { openStudio } from '../core/studio.js';

const kind = location.hash === '#voice' ? 'voice' : 'camera';
const { prefs = {}, script = {} } = await chrome.storage.local.get(['prefs', 'script']);
document.title = kind === 'camera' ? 'Retake · Camera recording' : 'Retake · Voice recording';

const closeTab = async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab) chrome.tabs.remove(tab.id);
  else window.close();
};

openStudio(document.getElementById('studio'), {
  kind,
  mic: kind === 'voice' || prefs.mic !== false,
  micId: prefs.micId,
  camId: prefs.camId,
  countdown: prefs.countdown !== false,
  script: prefs.prompter && script.text?.trim() ? { text: script.text, speed: script.speed || 1, size: 28 } : null,
  tickerURL: chrome.runtime.getURL('core/ticker.js'),
  onFinish: (id) => (location.href = `editor.html#${encodeURIComponent(id)}`),
  onClose: closeTab,
});
