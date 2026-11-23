# Chrome Web Store listing: Retake

Ready to submit. Paste each section into the matching field in the Chrome Web Store developer dashboard.

## Package

`dist/retake-0.1.0.zip` (build it with `node scripts/build.mjs --zip`). It contains no network code, no analytics and no remote code.

## Store listing tab

**Name** (from the package): Retake: Screen Recorder

**Summary** (from the package, 129 of 132 characters):
Free screen recorder with a teleprompter, retakes and drawing tools. Saves on your computer: no account, no upload, no watermark.

**Category:** Workflow & Planning

**Language:** English

**Description:**

Retake records your tab, a window, your whole screen, just your camera or just your voice, and keeps everything on your computer. There is no account, no upload, no time limit and no watermark.

Read while you record
Paste your script into the teleprompter. It scrolls while you record, stops when you pause, and goes back when you retake. Add [cue] labels to mark where each part starts. The script is never in the video.

Fluffed a line? Press Retake
Retake rewinds to the last time you paused and records that part again, while everything before it stays exactly as it was. No starting over, and no cutting out mistakes afterwards.

While you record
• Talk over your demo with your microphone, with the tab's own sound included
• Show yourself in a round camera bubble you can drag anywhere
• Draw with a pen, highlighter, arrows, boxes, circles, text and numbered steps
• Let drawings fade after 3, 5 or 10 seconds, so the screen never gets cluttered
• Dim the page around your pointer with the spotlight
• Show a pulse wherever you click, and display keyboard shortcuts as you press them
• Pause, retake and finish from the keyboard
• Take a screenshot without stopping

After you record
• Trim the start and the end
• Add arrows, boxes, numbered steps, text, zooms and blur on a simple timeline, and change them whenever you like
• Export MP4, WebM, GIF or audio only, in landscape or vertical 9:16 for Shorts, Reels and TikTok
• Find every recording in one library, back them all up and restore them later

Present without recording
Use the drawing tools and spotlight on a live call, with nothing recorded.

Private by design
Recordings are stored in Chrome on your computer and saved to your Downloads folder when you export. The extension collects no data and contains no analytics.

Retake is free. Questions and bug reports: https://github.com/HackrLife/chrome-extensions/issues

**Graphic assets** (all in `docs/store-assets/`):
- Store icon: the 128 × 128 icon is in the package
- Screenshots, 1280 × 800, in this order: `screenshot-1-record.png`, `screenshot-2-teleprompter.png`, `screenshot-3-retake.png`, `screenshot-4-editor.png`, `screenshot-5-export.png`
- Small promo tile, 440 × 280: `promo-tile-440x280.png`
- Marquee promo tile, 1400 × 560: `marquee-1400x560.png`

**Additional fields:**
- Homepage URL: https://chrome-extensions-retake.vercel.app
- Support URL: https://github.com/HackrLife/chrome-extensions/issues
- Mature content: No

## Privacy practices tab

**Single purpose:**
Retake records the user's tab, window, screen, camera or microphone, and lets them annotate, edit and export the recording on their own computer.

**Permission justifications:**
- **activeTab:** shows the recording controls and drawing tools on the tab the user chooses to record, after they click the Retake button.
- **tabCapture:** records the tab the user chooses.
- **desktopCapture:** records a window or the whole screen when the user picks one in Chrome's screen picker.
- **offscreen:** keeps the recorder running in the background while the user switches tabs.
- **scripting:** adds the recording controls and drawing tools to the tab being recorded.
- **storage:** keeps the user's settings and teleprompter script.
- **unlimitedStorage:** stores recordings on the user's computer, which quickly exceed the default storage limit.
- **downloads:** saves exported videos, screenshots and backups to a Retake folder in the user's Downloads.
- **Host permission (optional, all sites):** only asked for on the welcome page, so the drawing tools can come back by themselves when the recorded tab loads a new page. Retake does not read or change page content.
- **Remote code:** No, I am not using remote code. All code is in the package.

**Data usage:** tick none of the data types. Retake does not collect or transmit any user data. Tick all three certifications.

**Privacy policy URL:** https://chrome-extensions-retake.vercel.app/privacy.html

## Distribution tab

- Payments: Free of charge
- Visibility: Public
- Regions: All regions

## Submitting

1. Register as a Chrome Web Store developer at https://chrome.google.com/webstore/devconsole with the Google account that should own Retake. There is a one-off registration fee, and you will need to verify an email address for the account.
2. Click **New item** and upload `dist/retake-0.1.0.zip`.
3. Fill in the three tabs from this file and upload the images.
4. Click **Submit for review**. Google reviews new items before they go live, which can take from a day to a few weeks. Status in the dashboard moves from Pending review to Published.
