// Named moments in Retake that later features can attach to without touching the code that
// raises them, such as an email sign-up after an export. Nothing listens today. A listener
// that fails is logged and ignored, so an add-on can never break recording or exporting.
import { logError } from './diagnostics.js';

const listeners = new Map();

export function on(event, fn) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(fn);
  return () => listeners.get(event)?.delete(fn);
}

export async function emit(event, data) {
  for (const fn of listeners.get(event) || []) {
    try {
      await fn(data);
    } catch (e) {
      logError(`hook ${event}`, e);
    }
  }
}

// Events raised today:
//   'export-finished'  { recordingId, format, layout, bytes, slot }  slot is an empty element
//                      in the "Saved to Downloads" panel that a listener may fill.
