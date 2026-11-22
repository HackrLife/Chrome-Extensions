// Camera bubble shown on the page while recording. It runs as a Retake page inside a
// small frame, so the camera permission belongs to Retake rather than to the website.
(async () => {
  const id = new URLSearchParams(location.search).get('cam') || 'default';
  const video = document.getElementById('v');
  const msg = document.getElementById('msg');
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: id === 'default' ? undefined : { exact: id }, width: { ideal: 640 }, height: { ideal: 640 }, frameRate: { ideal: 30 } },
      audio: false,
    });
    video.srcObject = stream;
    window.addEventListener('pagehide', () => stream.getTracks().forEach((t) => t.stop()));
  } catch (e) {
    msg.hidden = false;
    msg.textContent = e.name === 'NotAllowedError' ? 'Camera blocked. Allow it in Retake’s welcome page.' : 'Camera unavailable';
  }
})();
