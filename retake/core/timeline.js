// A recording is a list of segments (one per stretch between pauses). These helpers treat
// them as one continuous timeline and apply the trim range.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function totalDuration(segments) {
  return segments.reduce((sum, s) => sum + (s.duration || 0), 0);
}

export function segmentStarts(segments) {
  const starts = [];
  let acc = 0;
  for (const s of segments) {
    starts.push(acc);
    acc += s.duration || 0;
  }
  return starts;
}

export function trimRange(rec) {
  const total = totalDuration(rec.segments);
  const start = clamp(rec.trim?.start || 0, 0, total);
  const end = rec.trim?.end == null ? total : clamp(rec.trim.end, start, total);
  return { start, end, total, length: end - start };
}

// Global time -> which segment and where inside it.
export function locate(segments, t) {
  let acc = 0;
  for (let i = 0; i < segments.length; i++) {
    const d = segments[i].duration || 0;
    if (t < acc + d || i === segments.length - 1) {
      return { index: i, local: clamp(t - acc, 0, d), offset: acc };
    }
    acc += d;
  }
  return { index: 0, local: 0, offset: 0 };
}

// The pieces of each segment that fall inside the trim range, in play order.
export function playPlan(rec) {
  const { start, end } = trimRange(rec);
  const plan = [];
  let acc = 0;
  rec.segments.forEach((s, index) => {
    const segStart = acc;
    const segEnd = acc + (s.duration || 0);
    acc = segEnd;
    const from = Math.max(start, segStart);
    const to = Math.min(end, segEnd);
    if (to - from > 0.01) plan.push({ index, segment: s, from: from - segStart, to: to - segStart, globalFrom: from });
  });
  return plan;
}

// MediaRecorder WebM files often report an unknown duration. Seeking far past the end
// forces Chrome to work it out.
export function measureDuration(url) {
  return new Promise((resolve) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    v.muted = true;
    const finish = (d) => {
      v.removeAttribute('src');
      v.load();
      resolve(Number.isFinite(d) ? d : 0);
    };
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 0) return finish(v.duration);
      v.ontimeupdate = () => {
        v.ontimeupdate = null;
        finish(v.duration);
      };
      v.currentTime = 1e7;
    };
    v.onerror = () => finish(0);
    v.src = url;
  });
}
