# Changelog

## 0.1.0 (in development)

- Extension: Slides. Upload a PDF, images or videos and present them full screen with your camera bubble, drawing tools and the teleprompter; the recording is exactly that frame. PDFs show their first page in the file list.
- Extension: Window and Screen recording now start. Chrome only lets a page use the screen it asked for, so a small Retake window shows the picker and records, minimised.
- Extension: the controls are hidden before the recorder starts, so they are not in a tab recording's first frames.
- Extension: if the recorder fails to report back when you finish, the recording is kept and opened in My recordings, instead of being thrown away.
- Extension: retake and finish shortcuts pressed when nothing is recording no longer leave an error behind.
- Report a problem: opens a GitHub issue filled in with the versions, the system and Retake's recent error messages, which are kept only on your computer.
- Older recordings keep working after updates: missing fields are filled in when read, and the database can be upgraded while Retake pages are open.
- Groundwork, switched off: a place for a future email sign-up and Retake Pro features (see docs/future-features.md).
- Tests: end-to-end suites for the extension and the web app.

- Extension, ready for the Chrome Web Store: the package now leaves out the web app's sign-in, slide presenter and PDF reader, so it contains no network code.
- Extension: the teleprompter window keeps its size on Linux systems that opened it full screen over the page.
- Editor: a callout shows straight away when you add it, instead of starting invisible at the beginning of its fade.
- Extension: the launcher fits the Chrome popup without scrolling.

- Web app: free sign-up with an emailed link before recording; marketing emails only with an unticked opt-in box.
- Web app: Slides opens a full-screen presenter with camera bubble, drawing tools and script.

- Teleprompter in the desktop app, the extension and the web app: the script scrolls while you record, stops when you pause and goes back on a retake. It is never in the video (on screen recordings in the extension and web app, keep its window outside what you record).
- Camera-only and voice-only recordings everywhere, with the script under the camera; export any recording as audio only (M4A or WebM).
- Desktop app for Mac and Windows: floating camera bubble, controls kept out of the recording, drawing on screen, cursor spotlight, global shortcuts; same editor, export and library.
- Web app: record in the browser with floating controls, camera bubble, pause, resume and retake; same editor, export and library as the extension.

First build.

- Record a tab, a window or the full screen, with microphone, tab sound and a camera bubble
- Countdown, pause and resume, and retake of the last part
- On-page drawing tools with fading, numbered steps, spotlight, click pulse and key display
- Present-only mode
- Screenshot while recording
- Editor with trim, callouts (arrow, box, step, text, zoom, blur), timeline, undo and redo
- Export to MP4 (H.264 where Chrome supports it), WebM and GIF, landscape or vertical
- Recordings library with storage use, backup, restore and recovery after a crash
- Welcome page with permissions, and a help page
