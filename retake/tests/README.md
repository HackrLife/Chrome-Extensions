# Retake tests

Two end-to-end suites drive real Chrome. Run both before every release.

| Suite | What it checks |
|---|---|
| `e2e_extension.py` | Install and welcome page, popup, tab and full-screen recording, teleprompter window, pause, retake, drawing, finish, the editor (callouts, undo, redo, rename), WebM, vertical, GIF and audio exports, library, backup and restore, present mode, crash recovery, older recordings after an update, camera-only and voice-only recordings, help page and the problem report, shortcuts while idle, and that the future-feature hooks are off. |
| `e2e_web.py` | Sign-up with the email link (sign-in service stubbed), unticked marketing box, camera recording, editor, export, library, privacy page, problem report and sign-out. |

Each fails on any console error or uncaught exception in a Retake page.

## Setup (Linux)

```
Xvfb :99 -screen 0 1600x1000x24 &
(cd retake/tests && python3 -m http.server 8765 &)          # demo page for the extension suite
node retake/scripts/build.mjs && node retake/scripts/build-web.mjs
(cd retake/dist/web && python3 -m http.server 8766 &)
cd retake && python3 tests/e2e_extension.py && python3 tests/e2e_web.py
```

Needs Google Chrome, Python Playwright, Pillow, ImageMagick (`import`) and ffprobe.
MP4 export is not covered: the Chrome builds used for testing on Linux cannot encode H.264.
