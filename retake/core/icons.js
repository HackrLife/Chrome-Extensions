// Line icons on a 24px grid, drawn for Retake.
export const ICONS = {
  pen: '<path d="M4 20l4.2-1.1L19 8.1 15.9 5 5.1 15.8z"/><path d="M13.5 7.4l3.1 3.1"/>',
  hl: '<path d="M8 14l7.5-7.5 3 3L11 17"/><path d="M8 14l3 3-2 2H5.5l1-2.5z"/><path d="M14 20h6"/>',
  line: '<path d="M5 19L19 5"/>',
  arrow: '<path d="M5 19L19 5"/><path d="M10 5h9v9"/>',
  rect: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
  box: '<rect x="4" y="6" width="16" height="12" rx="2"/>',
  circle: '<circle cx="12" cy="12" r="8"/>',
  text: '<path d="M6 6h12"/><path d="M12 6v13"/>',
  step: '<circle cx="12" cy="12" r="8.5"/><path d="M11 9.2l1.6-1v7.6"/>',
  pause: '<rect x="7" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.8" y="5" width="3.2" height="14" rx="1" fill="currentColor" stroke="none"/>',
  play: '<path d="M8 5l11 7-11 7z" fill="currentColor" stroke="none"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" stroke="none"/>',
  retake: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/>',
  mic: '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0"/><path d="M12 17.5V21"/>',
  cam: '<rect x="3" y="7" width="12.5" height="10" rx="2.2"/><path d="M15.5 10.5l5-3v9l-5-3"/>',
  speaker: '<path d="M4 9.5h3.5L12 5.5v13l-4.5-4H4z"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6"/><path d="M18 6.5a8 8 0 0 1 0 11"/>',
  tab: '<rect x="3" y="5" width="18" height="14" rx="2.2"/><path d="M3 9.5h18"/><path d="M7 5v4.5"/>',
  window: '<rect x="3" y="5" width="18" height="14" rx="2.2"/><circle cx="6.5" cy="8" r=".6" fill="currentColor"/><circle cx="9" cy="8" r=".6" fill="currentColor"/>',
  screen: '<rect x="3" y="4" width="18" height="12" rx="2.2"/><path d="M8.5 20h7"/><path d="M12 16v4"/>',
  spot: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  click: '<path d="M9 9l10 4-4 1.6L13.4 19z"/><path d="M5 5l2 2M9 3v2.5M3 9h2.5"/>',
  shot: '<path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/>',
  download: '<path d="M12 4v11"/><path d="M7 10.5l5 5 5-5"/><path d="M5 20h14"/>',
  upload: '<path d="M12 20V9"/><path d="M7 13.5l5-5 5 5"/><path d="M5 4h14"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  chev: '<path d="M7 10l5 5 5-5"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  zoom: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/><path d="M10.5 8v5M8 10.5h5"/>',
  blur: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  redo: '<path d="M15 14l5-5-5-5"/><path d="M20 9H10a6 6 0 0 0 0 12h3"/>',
  trim: '<circle cx="6" cy="7" r="2.6"/><circle cx="6" cy="17" r="2.6"/><path d="M8.2 8.4L20 17M8.2 15.6L20 7"/>',
  folder: '<path d="M3.5 7a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>',
  help: '<circle cx="12" cy="12" r="8.5"/><path d="M9.6 9.4a2.5 2.5 0 0 1 4.8.9c0 1.7-2.4 2-2.4 3.7"/><circle cx="12" cy="17" r=".7" fill="currentColor"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.5 15.5L20 20"/>',
  fade: '<circle cx="12" cy="12" r="8"/><path d="M12 7.5V12l3 2"/>',
  more: '<circle cx="6" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
  edit: '<path d="M4 20l4.2-1.1L19 8.1 15.9 5 5.1 15.8z"/>',
  vert: '<rect x="7.5" y="3" width="9" height="18" rx="2"/>',
  horiz: '<rect x="3" y="7.5" width="18" height="9" rx="2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  keys: '<rect x="3" y="6" width="18" height="12" rx="2.2"/><path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M8 14h8"/>',
};

export function ic(name, size = 20, sw = 1.8, extra = '') {
  return `<svg class="ic ${extra}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

export const LOGO = (s = 28) =>
  `<svg width="${s}" height="${s}" viewBox="0 0 32 32" aria-label="Retake"><rect width="32" height="32" rx="9" fill="#111318"/><path d="M9.2 16a6.8 6.8 0 1 0 2-4.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M9.2 8.6v3.8h3.8" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><circle cx="16" cy="16" r="2.6" fill="#F0464B"/></svg>`;
