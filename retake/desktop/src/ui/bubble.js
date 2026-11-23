// Floating camera bubble. Drag it anywhere; on full-screen recordings it is filmed where it sits.
const api = window.retakeDesktop;
const v = document.getElementById('v');
const msg = document.getElementById('msg');
let stream = null;

async function open(camId) {
  stream?.getTracks().forEach((t) => t.stop());
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: camId ? { exact: camId } : undefined, width: { ideal: 720 }, height: { ideal: 720 } } });
    v.srcObject = stream;
    msg.hidden = true;
  } catch {
    msg.textContent = 'Camera blocked. Allow it in your computer’s privacy settings.';
    msg.hidden = false;
  }
}

document.getElementById('size').onclick = () => api.call('bubble-size');
api.on('bubble-cam', open);
open(new URLSearchParams(location.search).get('cam') || '');
