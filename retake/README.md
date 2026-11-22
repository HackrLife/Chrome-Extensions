# Retake

A free screen recorder for Chrome, as an extension and as a web app. Record a tab, a window or your whole screen, fix a fluffed line with **Retake**, add callouts in the editor, and export MP4, WebM, GIF or a vertical cut for Shorts. Nothing leaves your computer: no account, no upload, no time limit, no watermark.

## Features (version 0.1)

| Area | Feature |
| --- | --- |
| Record | Tab, window or full screen · microphone · tab sound · camera bubble · 3-second countdown · pause and resume |
| Record | **Retake the last part**: throws away everything since the last pause and records it again |
| Record | Screenshot while recording · keyboard shortcuts · recording keeps going in the background |
| On screen | Pen, highlighter, line, arrow, box, circle, text, numbered steps · drawings fade after 3, 5 or 10 seconds · spotlight · click pulse · key display (shortcuts only, never ordinary typing) |
| On screen | Present only: the same tools on a live call, with nothing recorded |
| Edit | Trim start and end · callouts after recording (arrow, box, step, text, zoom, blur) on a timeline · undo and redo · the preview matches the export exactly |
| Export | MP4 (H.264), WebM or GIF · landscape or vertical 9:16 · 720p or 1080p · rendered on the computer |
| Library | All recordings in one place · storage use · back up and restore · clear old recordings · crash recovery |

## How it is built

```
retake/
├── core/          shared code with no Chrome dependency (used by the extension and the web app)
│   ├── db.js          IndexedDB storage for recordings and their video chunks
│   ├── recorder.js    segment recorder and camera compositing for the web app
│   ├── timeline.js    segments, trim and play order
│   ├── callouts.js    callout model and renderer (editor preview and export share it)
│   ├── exporter.js    renders the final video from segments, trim and callouts
│   ├── gif.js         GIF encoder
│   ├── webm.js        writes the duration into exported WebM files
│   ├── zip.js         backup and restore archive
│   ├── ticker.js      worker timer that keeps export running in a background tab
│   ├── tokens.css     design tokens and base components
│   └── icons.js, format.js, save.js, fonts/
├── extension/     the Chrome extension
│   ├── manifest.json
│   ├── background.js  service worker: recording state, commands, coordination
│   ├── content/overlay.js   control bar, drawing tools, spotlight, keys, camera bubble, retake dialog
│   └── pages/         popup, offscreen recorder, editor, library, welcome, help, camera
├── web/           the web app: home page and recorder (editor and library come from extension/pages)
├── scripts/       build.mjs (extension), build-web.mjs (web app)
├── vercel.json    web app hosting settings
└── docs/          store listing, privacy policy, changelog
```

**Recording.** The service worker gets a capture stream ID (tab capture or desktop capture) and hands it to an offscreen document, which records with `MediaRecorder`. Microphone and tab sound are mixed with the Web Audio API. Every stretch between pauses is a separate segment, saved to IndexedDB every second. Retake deletes the last segment and starts a new one.

**Export.** The editor plays the segments once into a canvas, drawing callouts on each frame, and records the canvas with its audio. Export takes about as long as the video.

## Build and run

Requires Node 18 or later. No packages to install.

```
cd retake
node scripts/build.mjs          # builds dist/extension
node scripts/build.mjs --zip    # also writes dist/retake-<version>.zip for the Web Store
```

Load it in Chrome: open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked** and choose `retake/dist/extension`.

### Web app

```
node scripts/build-web.mjs      # builds dist/web, plain static files
```

Serve `dist/web` from any static host. The web app records with the browser's screen-sharing picker, shows small floating controls (Document Picture-in-Picture) and draws the camera bubble into the video. Recordings stay in the browser's storage on that computer. It has no on-page drawing tools; those need the extension.

## Keyboard shortcuts

| Action | Shortcut |
| --- | --- |
| Pause or resume | Alt + Shift + K |
| Retake the last part | Alt + Shift + U |
| Drawing tools on or off | Alt + Shift + D |
| Finish | Alt + Shift + S |

Chrome reserves Alt + Shift + P and R, so they cannot be used. Users can change shortcuts at `chrome://extensions/shortcuts`.

## Permissions and why

| Permission | Why |
| --- | --- |
| `tabCapture`, `desktopCapture` | Record the chosen tab, window or screen |
| `offscreen` | Keep recording while the user works in other tabs |
| `activeTab`, `scripting` | Show the control bar and drawing tools on the tab being recorded |
| `storage`, `unlimitedStorage` | Keep recordings and settings on the computer |
| `downloads` | Save exports, screenshots and backups to a Retake folder in Downloads |
| `<all_urls>` (optional, asked on the welcome page) | Keep the tools on screen when the recorded tab loads a new page |

Microphone and camera access is asked for once, on the welcome page.

## Known limits

- The control bar is part of the page, so it can appear in a tab recording. It hides itself when the pointer moves away.
- Chrome does not let extensions record or draw on `chrome://` pages or the Chrome Web Store.
- System sound in full-screen recording depends on the operating system (not available on macOS).
- MP4 needs a Chrome build with H.264. Chrome on Windows, macOS and ChromeOS has it; when it is missing, Retake saves WebM and says so.

## Testing

Tested end to end in Chrome 153 (Chrome for Testing, Linux, virtual display), driven by real keyboard and mouse input:

- launcher, countdown, recording, click pulse, key display, drawing tools
- pause, resume, retake (dialog and shortcut), finish, editor opening
- callouts, trim, playback across segments
- export to WebM, MP4 fallback, vertical 9:16 and GIF, checked with ffprobe
- presenter mode, starting a recording from it, launcher live controls, library

**Not yet tested:** microphone and camera (no devices on the test machine), window and full-screen capture, H.264 MP4 output, and Chrome on macOS and Windows. These need a check on a real computer before release.
