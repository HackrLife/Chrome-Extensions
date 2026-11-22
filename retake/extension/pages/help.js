import { LOGO } from '../core/icons.js';
document.getElementById('logo').innerHTML = LOGO(30);
document.getElementById('version').textContent = `Retake ${chrome.runtime.getManifest().version}`;
