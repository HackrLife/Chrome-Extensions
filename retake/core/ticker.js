// Runs in a worker so export keeps drawing frames even when its tab is in the background,
// where timers on the page itself are slowed down. It waits for the page to finish each
// frame before sending the next tick, so slow frames never pile up.
let interval = 33;
let running = false;
let timer = null;
let last = 0;

function schedule() {
  if (!running) return;
  const wait = Math.max(0, interval - (performance.now() - last));
  timer = setTimeout(() => {
    last = performance.now();
    self.postMessage(last);
  }, wait);
}

self.onmessage = (e) => {
  const d = e.data || {};
  if (d.start) {
    interval = d.interval || 33;
    running = true;
    clearTimeout(timer);
    last = 0;
    schedule();
  } else if (d.ack) {
    schedule();
  } else if (d.stop) {
    running = false;
    clearTimeout(timer);
  }
};
