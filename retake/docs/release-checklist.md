# Release checklist

Use for every Chrome Web Store release of Retake.

## Before building
- [ ] Version bumped in `extension/manifest.json` (store rejects a version it has seen).
- [ ] `docs/CHANGELOG.md` and the release notes updated.
- [ ] Both test suites pass: `python3 tests/e2e_extension.py` and `python3 tests/e2e_web.py` (see `tests/README.md`).

## By hand on a Mac (the tests run on Linux)
- [ ] Load `dist/extension` unpacked at chrome://extensions (Developer mode › Load unpacked).
- [ ] Record a tab with the microphone, pause, retake, finish.
- [ ] Record the whole screen and a window.
- [ ] Export one MP4 and play it.

## Build and submit
- [ ] `node scripts/build.mjs --zip` makes `dist/retake-<version>.zip`.
- [ ] Developer dashboard › Retake › Package › Upload new package.
- [ ] If a permission or data use changed, update the Privacy practices tab and `docs/privacy.md` first.
- [ ] Submit for review. Record the status honestly: submitted, approved, live.

## After it is live
- [ ] Install from the store on a clean Chrome profile and record once.
- [ ] Check GitHub issues weekly for problem reports.
