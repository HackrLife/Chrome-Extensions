# Chrome Web Store listing: Retake

Draft for review. Not submitted.

## Name

Retake: Screen Recorder

## Short description (132 characters maximum)

Free screen recorder with retake, drawing tools, callouts and vertical export. No account, no upload, no time limit, no watermark.

## Category

Workflow & Planning

## Detailed description

Retake records your tab, a window or your whole screen, and keeps everything on your computer. There is no account, no upload, no time limit and no watermark.

Fluffed a line? Press Retake. It rewinds to the last time you paused and records that part again, while everything before it stays exactly as it was. No starting over, and no editing out mistakes afterwards.

While you record
• Talk over your demo with your microphone, with the tab's own sound included
• Show yourself in a round camera bubble you can drag anywhere
• Draw with a pen, highlighter, arrows, boxes, circles, text and numbered steps
• Let drawings fade away after 3, 5 or 10 seconds, so the screen never gets cluttered
• Dim the page around your pointer with the spotlight
• Show a pulse wherever you click, and display keyboard shortcuts as you press them
• Pause, retake and finish from the keyboard
• Take a screenshot without stopping

After you record
• Trim the start and the end
• Add arrows, boxes, numbered steps, text, zooms and blur on a simple timeline, then move or change them whenever you like
• Export MP4, WebM or GIF, in landscape or vertical 9:16 for Shorts, Reels and TikTok
• Find every recording in one library, back them all up, and restore them later

Present without recording
Use the drawing tools and spotlight on a live call, with nothing recorded.

Private by design
Recordings are stored in Chrome on your computer and saved to your Downloads folder when you export. Retake collects no data and contains no analytics.

Support: https://github.com/HackrLife/chrome-extensions/issues

## Single purpose (Web Store form)

Retake records the user's tab, window or screen, and lets them annotate, edit and export the recording on their own computer.

## Permission justifications (Web Store form)

- **tabCapture**: records the tab the user chooses.
- **desktopCapture**: records a window or the whole screen when the user chooses those.
- **offscreen**: keeps the recorder running while the user switches tabs.
- **activeTab**: shows the recording controls and drawing tools on the tab the user is recording.
- **scripting**: adds the recording controls and drawing tools to that tab.
- **storage**: keeps the user's settings.
- **unlimitedStorage**: stores recordings on the user's computer, which can exceed the default limit.
- **downloads**: saves exported videos, screenshots and backups to a Retake folder in Downloads.
- **Optional host permission (all sites)**: asked for on the welcome page, only so the tools can come back automatically when the recorded tab loads a new page. Retake does not read page content.
- **Remote code**: none. All code is in the package.

## Data use disclosures (Web Store form)

Retake does not collect or transmit any user data. Tick "This item does not collect user data" and the three certifications.

## Assets still needed

- Icon 128 × 128: in the package (`extension/icons/icon-128.png`)
- Screenshots 1280 × 800: recording with drawing tools, retake dialog, editor with callouts, export with vertical layout, library
- Small promotional tile 440 × 280
- Privacy policy URL: publish `docs/privacy.md` (for example on GitHub Pages) and link it
