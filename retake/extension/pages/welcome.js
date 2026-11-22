import { ic, LOGO } from '../core/icons.js';

document.getElementById('logo').innerHTML = LOGO(30);
const PIN = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/></svg>';
document.querySelectorAll('[data-icon]').forEach((el) => (el.innerHTML = el.dataset.icon === 'pin' ? PIN : ic(el.dataset.icon, 22)));

const steps = [
  ['rec', 'Record', 'A tab, a window or your whole screen, with voice and camera.', 'var(--rec-soft)', 'var(--rec)'],
  ['retake', 'Fix', 'Fluffed a line? Retake the last part and carry on.', 'var(--accent-soft)', 'var(--accent)'],
  ['download', 'Export', 'Add callouts, trim, then save MP4, WebM, GIF or a vertical cut.', 'var(--green-soft)', 'var(--green)'],
];
document.getElementById('flow').innerHTML = steps
  .map(([icon, t, d, bg, fg], i) => {
    const glyph = icon === 'rec' ? '<span class="dot" style="width:14px;height:14px;color:var(--rec)"></span>' : ic(icon, 22);
    const card = `<div class="step"><div class="bubble" style="background:${bg};color:${fg}">${glyph}</div><b>${t}</b><span>${d}</span></div>`;
    return i < steps.length - 1 ? card + `<div class="arrow">${ic('arrow', 22)}</div>` : card;
  })
  .join('')
  .replaceAll(ic('arrow', 22), `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>`);

const avStatus = document.getElementById('av-status');
const hostStatus = document.getElementById('host-status');

async function permState(name) {
  try {
    return (await navigator.permissions.query({ name })).state;
  } catch {
    return 'prompt';
  }
}

async function renderAV() {
  const mic = await permState('microphone');
  const cam = await permState('camera');
  if (mic === 'granted' && cam === 'granted') {
    avStatus.innerHTML = `<span class="status ok">${ic('check', 18, 2.4)}Allowed</span>`;
    return;
  }
  if (mic === 'denied' || cam === 'denied') {
    avStatus.innerHTML = `<div style="max-width:220px;font-size:12.5px;color:#9b1c20">Blocked. Click the icon at the left of the address bar, allow Microphone and Camera, then reload this page.</div>`;
    return;
  }
  avStatus.innerHTML = `<button class="btn dark" id="allow-av">Allow</button>`;
  document.getElementById('allow-av').onclick = async () => {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      s.getTracks().forEach((t) => t.stop());
    } catch {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch {
        /* reflected below */
      }
    }
    renderAV();
  };
}

async function renderHost() {
  const has = await chrome.permissions.contains({ origins: ['<all_urls>'] });
  if (has) {
    hostStatus.innerHTML = `<span class="status ok">${ic('check', 18, 2.4)}On</span>`;
    return;
  }
  hostStatus.innerHTML = `<button class="btn outline" id="allow-host">Turn on</button>`;
  document.getElementById('allow-host').onclick = async () => {
    await chrome.permissions.request({ origins: ['<all_urls>'] }).catch(() => false);
    renderHost();
  };
}

renderAV();
renderHost();
if (location.hash === '#permissions') document.getElementById('permissions').scrollIntoView();
