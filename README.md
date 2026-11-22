# HackrLife Chrome Extensions

Free Chrome extensions by HackrLife. Each extension lives in its own folder, with its own code, documentation, version number and Chrome Web Store package, so one can be released or fixed without touching the others.

| Extension | What it does | Folder | Version | Status |
| --- | --- | --- | --- | --- |
| Retake | Screen recorder with retake, drawing tools, a callout editor and vertical export. Everything stays on your computer. | [`retake/`](retake/) | 0.1.0 | In development |

## Conventions

- **One folder per extension.** Code shared inside an extension's family (for example a later web app) sits in that folder's `core/`.
- **No accounts, no tracking, no promotion inside the extensions.** Support is through GitHub issues.
- **Plain JavaScript, no build dependencies.** Each extension has a `scripts/build.mjs` that runs on Node 18 or later.

## Support

Found a problem or want a feature? [Open an issue](https://github.com/HackrLife/chrome-extensions/issues) and name the extension in the title.
