"""End-to-end checks for the Retake Chrome extension.

Runs real Chrome against the built extension (dist/extension) on an X display, drives the
toolbar popup and keyboard shortcuts with XTest, and checks every user flow: install, popup,
tab and screen recording, pause, retake, drawing, teleprompter, finish, editor, every export
format, library, backup and restore, camera-only and voice-only recordings, present mode,
crash recovery, help and the problem report. It fails on any uncaught error or console error
in any Retake page.

Needs: Google Chrome, Xvfb on :99 (1600x1000), Python Playwright, ffprobe, a static server
for tests/ on port 8765.  Run from retake/:
    node scripts/build.mjs && python3 tests/e2e_extension.py
"""
import json, os, shutil, subprocess, sys, time, zipfile

os.environ.setdefault("DISPLAY", ":99")
sys.path.insert(0, os.path.dirname(__file__))
import xinput as X
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
EXT = os.path.join(ROOT, "dist", "extension")
DEMO = "http://localhost:8765/demo.html"
OUT = "/tmp/retake-e2e"
CHROME = os.environ.get("CHROME", "/usr/bin/google-chrome")

results, errors = [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def shot(name):
    os.makedirs(OUT, exist_ok=True)
    subprocess.run(["import", "-display", ":99", "-window", "root", f"{OUT}/{name}.png"])


def ffprobe(path):
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=codec_type,codec_name,width,height",
                        "-of", "json", path], capture_output=True, text=True)
    return json.loads(r.stdout or "{}")


def watch(page):
    """Collect console errors and uncaught exceptions from Retake's own pages."""
    def on_console(m):
        if m.type == "error" and "chrome-extension://" in (page.url or ""):
            errors.append(f"{page.url.split('/')[-1]}: {m.text}")
    page.on("console", on_console)
    page.on("pageerror", lambda e: errors.append(f"{(page.url or '').split('/')[-1]}: {e}"))


def launch(p, profile, fake_media=False, fresh=True, extra=()):
    if fresh:
        shutil.rmtree(profile, ignore_errors=True)
    args = [f"--disable-extensions-except={EXT}", f"--load-extension={EXT}",
            os.environ.get("PICK","--auto-select-desktop-capture-source=Entire screen"),
            "--window-position=0,0", "--window-size=1600,1000", "--no-first-run", "--no-default-browser-check",
            "--autoplay-policy=no-user-gesture-required"]
    # Chrome's fake camera and microphone replace every capture, tab capture included, so they are
    # only switched on for the camera and voice tests.
    if fake_media:
        args += ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"]
    args += list(extra)
    ctx = p.chromium.launch_persistent_context(profile, executable_path=CHROME, headless=False, args=args,
                                               no_viewport=True, accept_downloads=True, downloads_path=OUT + "/dl")
    ctx.on("page", watch)
    for pg in ctx.pages:
        watch(pg)
    sw = ctx.service_workers[0] if ctx.service_workers else ctx.wait_for_event("serviceworker", timeout=15000)
    eid = sw.url.split("/")[2]
    return ctx, sw, eid


def page_for(ctx, part, timeout=10):
    """Find an open page by URL. Asks the page itself, because Playwright can keep a stale URL
    for a target Chrome has reused (the editor can open in the teleprompter's old target)."""
    end = time.time() + timeout
    while True:
        for pg in ctx.pages:
            try:
                url = pg.evaluate("location.href")
            except Exception:
                url = pg.url or ""
            if part in url:
                return pg
        if time.time() >= end:
            return None
        time.sleep(0.25)


def state(sw):
    return sw.evaluate("chrome.storage.session.get('state').then(s => s.state || {status:'idle'})")


def wait_status(sw, want, timeout=15):
    end = time.time() + timeout
    while time.time() < end:
        s = state(sw)
        if s.get("status") in want:
            return s
        time.sleep(0.25)
    return state(sw)


def retake_icon_x():
    """Where Retake's toolbar icon is: other icons (downloads) can push it left."""
    from PIL import Image
    path = f"{OUT}/_bar.png"
    subprocess.run(["import", "-display", ":99", "-window", "root", path])
    px = Image.open(path).convert("RGB").load()
    cols = [x for x in range(1360, 1475) if sum(1 for y in range(54, 72) if max(px[x, y]) < 40) >= 8]
    # The extensions (puzzle) icon is outlined, not filled, so the filled dark square is Retake.
    return (min(cols) + max(cols)) // 2 if cols else 1449


def open_popup():
    X.click(retake_icon_x(), 62); time.sleep(1.5)


def pin_and_open_popup():
    """Pin Retake to the toolbar, then open its popup with a real click (which grants activeTab)."""
    X.click(1487, 62); time.sleep(1); X.click(1416, 223); time.sleep(0.6); X.combo("Escape"); time.sleep(0.5)
    X.click(1449, 62); time.sleep(1.5)


def click_popup_start(dark=False):
    """Find the Start button in the popup by colour (red to record, near-black to present) and click it."""
    from PIL import Image
    path = f"{OUT}/_popup.png"
    subprocess.run(["import", "-display", ":99", "-window", "root", path])
    im = Image.open(path).convert("RGB"); px = im.load()
    for y in range(900, 100, -2):
        want = (lambda c: c[0] < 40 and c[1] < 40 and c[2] < 45) if dark else (lambda c: c[0] > 220 and 50 < c[1] < 100 and 50 < c[2] < 110)
        row = [x for x in range(1060, 1480, 3) if want(px[x, y])]
        if len(row) > 40:
            X.click(sum(row) // len(row), y - 4)
            return True
    return False


def set_prefs(sw, **over):
    prefs = {"mode": "record", "source": "tab", "mic": False, "camera": False, "tabAudio": True, "clickPulse": True,
             "spotlight": False, "countdown": True, "keys": True, "prompter": False}
    prefs.update(over)
    sw.evaluate("(p) => chrome.storage.local.set({prefs: p})", prefs)


def recordings(page):
    return page.evaluate("""async () => { const m = await import('/core/db.js'); return (await m.listRecordings())
        .map(r => ({id: r.id, status: r.status, segments: (r.segments||[]).length, duration: r.duration, source: r.source})) }""")


def main():
    os.makedirs(OUT + "/dl", exist_ok=True)
    with sync_playwright() as p:
        # ---------- 1. install, welcome, popup, tab recording ----------
        ctx, sw, eid = launch(p, "/tmp/retake-e2e-prof")
        base = f"chrome-extension://{eid}/pages/"
        # Chrome opens the welcome page on install; with --load-extension it can race the first window.
        welcome = page_for(ctx, "welcome.html", 4)
        if welcome is None:
            welcome = ctx.new_page(); welcome.goto(base + "welcome.html")
        if welcome:
            welcome.wait_for_load_state(); time.sleep(0.8)
            check("welcome page has content", "Retake" in welcome.inner_text("body"))

        # A shortcut pressed while nothing is recording must do nothing and leave no error behind.
        X.combo("Alt_L", "Shift_L", "u"); X.combo("Alt_L", "Shift_L", "k"); X.combo("Alt_L", "Shift_L", "s"); time.sleep(0.8)
        s = state(sw)
        check("shortcuts while idle leave no error", s.get("status", "idle") == "idle" and not s.get("error"), json.dumps(s)[:160])

        script = ("Here is how the launch went. [numbers] Sign-ups grew eighteen percent on last quarter, and week seven "
                  "was our best week. [next] Next quarter we cut onboarding from five steps to three.")
        sw.evaluate("(t) => chrome.storage.local.set({script:{text:t, speed:1}})", script)
        set_prefs(sw, prompter=True)
        demo = ctx.new_page(); demo.goto(DEMO); demo.bring_to_front(); time.sleep(0.8)
        for pg in list(ctx.pages):
            if pg is not demo:
                pg.close()
        pin_and_open_popup(); shot("01-popup")
        check("popup Start button found", click_popup_start())
        s = wait_status(sw, ["countdown", "recording"], 8)
        check("tab recording starts with countdown", s.get("status") in ("countdown", "recording"), s.get("error") or "")
        s = wait_status(sw, ["recording"], 8)
        check("recording after countdown", s.get("status") == "recording", s.get("error") or "")
        check("teleprompter window opens", page_for(ctx, "prompter.html", 5) is not None)
        wins = sw.evaluate("chrome.windows.getAll().then(ws => ws.filter(w => w.type==='popup').map(w => [w.width, w.height]))")
        check("teleprompter window is small", wins and wins[0][0] <= 700 and wins[0][1] <= 300, str(wins))
        check("overlay injected on the tab", demo.evaluate("!!document.querySelector('retake-overlay, #retake-root, [data-retake]') || [...document.documentElement.children].some(e => e.tagName.startsWith('RETAKE'))"))
        time.sleep(2.5)

        X.combo("Alt_L", "Shift_L", "k"); s = wait_status(sw, ["paused"], 5)
        check("pause with Alt+Shift+K", s.get("status") == "paused" and len(s.get("segments", [])) == 1)
        X.combo("Alt_L", "Shift_L", "k"); s = wait_status(sw, ["recording", "countdown"], 5)
        check("resume with Alt+Shift+K", s.get("status") in ("recording", "countdown"))
        wait_status(sw, ["recording"], 6); time.sleep(2)

        # Draw a circle with the on-page tools.
        X.move(800, 930); time.sleep(0.8); X.click(778, 940); time.sleep(0.6)
        X.click(782, 805); time.sleep(0.3)
        X.drag([(585 + i * 6, 500 + i * 14) for i in range(20)]); time.sleep(0.4)
        X.combo("Escape"); X.move(1200, 600); time.sleep(0.4); shot("02-drawing")

        X.combo("Alt_L", "Shift_L", "u"); time.sleep(1)
        s = state(sw)
        check("retake shows its dialog", s.get("dialog") == "retake", s.get("status"))
        shot("03-retake")
        segs_before = len(s.get("segments", []))
        X.combo("Alt_L", "Shift_L", "u"); time.sleep(0.6)
        s = wait_status(sw, ["recording"], 8)
        check("retake discards the last part", len(s.get("segments", [])) == segs_before - 1 and s.get("status") == "recording",
              f"{segs_before}->{len(s.get('segments', []))}")
        time.sleep(2)

        t0 = time.time()
        X.combo("Alt_L", "Shift_L", "s")
        editor = page_for(ctx, "editor.html", 20)
        check("finish opens the editor", editor is not None, f"{time.time() - t0:.1f}s")
        check("teleprompter closes on finish", page_for(ctx, "prompter.html", 1) is None)
        check("overlay removed on finish", demo.evaluate("[...document.documentElement.children].every(e => !e.tagName.startsWith('RETAKE'))"))
        check("badge cleared", sw.evaluate("chrome.action.getBadgeText({})") == "")
        if not editor:
            return finish(ctx)
        editor.wait_for_load_state(); time.sleep(3)
        recs = recordings(editor)
        check("recording saved as ready", recs and recs[0]["status"] == "ready" and recs[0]["segments"] == 2, json.dumps(recs)[:200])

        # ---------- 2. editor ----------
        editor.bring_to_front(); time.sleep(0.5)
        for k in ["arrow", "box", "step", "text", "zoom", "blur"]:
            editor.click(f"[data-add={k}]"); time.sleep(0.25)
        editor.keyboard.press("Escape")
        n = editor.evaluate("document.querySelectorAll('.cchip').length")
        check("six callout types added", n == 6, str(n))
        editor.keyboard.press("Control+z"); time.sleep(0.3)
        check("undo removes a callout", editor.evaluate("document.querySelectorAll('.cchip').length") == 5)
        editor.keyboard.press("Control+Shift+z"); time.sleep(0.3)
        check("redo restores it", editor.evaluate("document.querySelectorAll('.cchip').length") == 6)
        editor.fill("#title", "Launch review"); editor.keyboard.press("Enter"); time.sleep(0.8)
        editor.click("#play"); time.sleep(1.5); editor.click("#play")
        check("preview plays", editor.evaluate("document.getElementById('video').currentTime") > 0.5)

        exports = [("webm", "landscape"), ("webm", "vertical"), ("gif", "landscape"), ("audio", "landscape")]
        for fmt, lay in exports:
            try:
                editor.click("#export"); time.sleep(0.6)
                if fmt != "audio":
                    editor.click(f"[data-layout={lay}]"); time.sleep(0.2)
                editor.click(f"[data-format={fmt}]"); time.sleep(0.3)
                with editor.expect_download(timeout=120000) as dl:
                    editor.click("#go")
                path = f"{OUT}/export-{lay}-{fmt}-{dl.value.suggested_filename}"
                dl.value.save_as(path)
                info = ffprobe(path)
                streams = info.get("streams", [])
                dur = float(info.get("format", {}).get("duration", 0) or 0)
                v = next((st for st in streams if st.get("codec_type") == "video"), {})
                if fmt == "audio":
                    ok = streams and all(st.get("codec_type") == "audio" for st in streams) and dur > 3
                elif lay == "vertical":
                    ok = v and v.get("height", 0) > v.get("width", 0) and dur > 3
                else:
                    ok = v and v.get("width", 0) > v.get("height", 0) and (dur > 3 or fmt == "gif")
                check(f"export {fmt} {lay}", ok, f"{os.path.basename(path)} {v.get('width')}x{v.get('height')} {dur:.1f}s")
                time.sleep(0.4)
                editor.click("[data-x]"); time.sleep(0.3)
            except Exception as e:
                check(f"export {fmt} {lay}", False, str(e)[:160])
                editor.keyboard.press("Escape")

        # The future-feature hooks are switched off: no account is written, the slot stays empty.
        check("future hooks are inert", sw.evaluate("chrome.storage.local.get('account')") == {}, "")

        # Callouts and title survive a reload.
        editor.reload(); time.sleep(3)
        check("edits persist after reload", editor.evaluate("document.querySelectorAll('.cchip').length") == 6
              and editor.input_value("#title") == "Launch review")

        # ---------- 3. library, backup, restore ----------
        lib = ctx.new_page(); lib.goto(base + "library.html"); time.sleep(2)
        check("library lists the recording", "Launch review" in lib.inner_text("#grid"))
        check("library shows storage", len(lib.inner_text("#storage")) > 5)
        try:
            with lib.expect_download(timeout=60000) as dl:
                lib.click("#backup")
            bpath = f"{OUT}/backup.zip"; dl.value.save_as(bpath)
            with zipfile.ZipFile(bpath) as z:
                names = z.namelist()
            check("backup zip has the recording", "retake-backup.json" in names and len(names) > 1, f"{len(names)} files")
        except Exception as e:
            bpath = None
            check("backup zip has the recording", False, str(e)[:160])
        lib.keyboard.press("Escape")

        # ---------- 4. help and problem report ----------
        hp = ctx.new_page(); hp.goto(base + "help.html"); time.sleep(1)
        check("help page loads", "Retake" in hp.inner_text("body"))
        rep = hp.locator("#report")
        if rep.count():
            with ctx.expect_page(timeout=5000) as np:
                rep.click()
            u = np.value.url
            check("report a problem opens a prefilled GitHub issue", "github.com" in u and "issues/new" in u and "Version" in __import__("urllib.parse").parse.unquote(u), u[:120])
            np.value.close()
        else:
            check("report a problem opens a prefilled GitHub issue", False, "no #report button")

        # ---------- 5. present mode ----------
        set_prefs(sw, mode="present")
        demo.bring_to_front(); time.sleep(0.5)
        open_popup(); shot("05-present-popup")
        click_popup_start(dark=True)
        s = wait_status(sw, ["presenting"], 5)
        check("present mode draws without recording", s.get("status") == "presenting", s.get("error") or s.get("status"))
        sw.evaluate("chrome.storage.session.get('state')")
        X.combo("Alt_L", "Shift_L", "s"); time.sleep(0.3)
        # Stop presenting through the bar's own message, as the Stop button does.
        demo.evaluate("1")
        lib.evaluate("chrome.runtime.sendMessage({type:'cancel'})"); time.sleep(0.8)
        check("presenting stops cleanly", state(sw).get("status", "idle") == "idle")
        set_prefs(sw)

        # ---------- 6. full-screen recording ----------
        demo.bring_to_front(); time.sleep(0.5)
        set_prefs(sw, source="screen", countdown=False)
        open_popup(); shot("06-screen-popup")
        click_popup_start()
        s = wait_status(sw, ["recording"], 10)
        check("screen recording starts", s.get("status") == "recording", s.get("error") or s.get("status"))
        time.sleep(3)
        X.combo("Alt_L", "Shift_L", "s")
        time.sleep(3)
        recs = recordings(lib)
        check("screen recording saved and opened", any(r["source"] == "screen" and r["status"] == "ready" and r["segments"] == 1 for r in recs)
              and sum(1 for pg in ctx.pages if "editor.html" in pg.evaluate("location.href")) >= 2, json.dumps([(r["source"], r["status"], r["segments"]) for r in recs]))
        set_prefs(sw)

        # ---------- 7. recovery after a crash mid-recording ----------
        demo.bring_to_front(); time.sleep(0.5)
        set_prefs(sw, countdown=False)
        open_popup(); click_popup_start()
        s = wait_status(sw, ["recording"], 10)
        time.sleep(4)
        ctx.close()
        ctx, sw, eid = launch(p, "/tmp/retake-e2e-prof", fresh=False)
        time.sleep(2)
        check("state resets after a browser restart", state(sw).get("status", "idle") == "idle")
        lib = ctx.new_page(); lib.goto(f"chrome-extension://{eid}/pages/library.html"); time.sleep(3)
        recs = recordings(lib)
        tab_recs = [r for r in recs if r["source"] == "tab"]
        check("interrupted recording is kept", len(tab_recs) >= 2 and all(r["status"] == "ready" and r["segments"] >= 1 for r in tab_recs),
              json.dumps([(r["source"], r["status"], r["segments"]) for r in recs]))
        shot("07-library-after-crash")

        # ---------- 8. restore from backup into a fresh profile ----------
        ctx.close()
        if bpath:
            ctx, sw, eid = launch(p, "/tmp/retake-e2e-prof2")
            lib = ctx.new_page(); lib.goto(f"chrome-extension://{eid}/pages/library.html"); time.sleep(1.5)
            lib.set_input_files("#restoreFile", bpath); time.sleep(4)
            check("restore brings recordings back", "Launch review" in lib.inner_text("#grid"))
            # A recording saved by an older version, missing fields added since, still opens.
            old_id = lib.evaluate("""async () => { const m = await import('/core/db.js'); const [r] = await m.listRecordings();
                const raw = { id: 'old-' + r.id, title: 'Old format', createdAt: r.createdAt - 1000, updatedAt: r.updatedAt, segments: r.segments, mimeType: r.mimeType, width: r.width, height: r.height };
                const db = await m.openDB(); await new Promise((ok, no) => { const t = db.transaction('recordings', 'readwrite'); t.objectStore('recordings').put(raw); t.oncomplete = ok; t.onerror = no; });
                return raw.id }""")
            ed = ctx.new_page(); ed.goto(f"chrome-extension://{eid}/pages/editor.html#{old_id}"); time.sleep(3)
            check("older recordings open after an update", ed.input_value("#title") == "Old format" and ed.evaluate("!document.getElementById('loading') || document.getElementById('loading').offsetParent === null"))
            ctx.close()

        # ---------- 9. camera-only and voice-only ----------
        ctx, sw, eid = launch(p, "/tmp/retake-e2e-prof3", fake_media=True)
        set_prefs(sw, source="camera", mic=True, camera=True, countdown=False)
        for kind in ("camera", "voice"):
            st = ctx.new_page(); st.goto(f"chrome-extension://{eid}/pages/studio.html#{kind}"); time.sleep(2.5)
            try:
                st.click("[data-s=start]", timeout=8000); time.sleep(4)
                st.click("[data-s=finish]", timeout=8000)
                ok = False
                for _ in range(40):
                    try:
                        if "editor.html" in st.evaluate("location.href"):
                            ok = True; break
                    except Exception:
                        pass
                    time.sleep(0.25)
                check(f"{kind}-only recording reaches the editor", ok, json.dumps(sw.evaluate("chrome.storage.local.get('diagnostics')"))[:300])
                shot(f"09-{kind}")
            except Exception as e:
                check(f"{kind}-only recording reaches the editor", False, str(e)[:160])
            st.close()
        # Slides: upload a PDF and an image, present them with the camera, record, finish.
        sl = ctx.new_page(); sl.goto(f"chrome-extension://{eid}/pages/slides.html"); time.sleep(1.5)
        try:
            here = os.path.dirname(os.path.abspath(__file__))
            sl.set_input_files("#pick", [os.path.join(here, "deck.pdf"), os.path.join(here, "slide.png")]); time.sleep(1.5)
            check("slides upload a PDF and an image", sl.locator(".file").count() == 2)
            sl.click("[data-act=start]"); time.sleep(4)
            check("presenter opens with the slides", sl.locator("[data-a=start]").count() == 1)
            sl.click("[data-a=start]"); time.sleep(5)
            sl.keyboard.press("ArrowRight"); time.sleep(1.5); sl.keyboard.press("ArrowRight"); time.sleep(1.5)
            sl.click("[data-a=finish]")
            ok = False
            for _ in range(60):
                try:
                    if "editor.html" in sl.evaluate("location.href"):
                        ok = True; break
                except Exception:
                    pass
                time.sleep(0.25)
            check("slides recording reaches the editor", ok, json.dumps(sw.evaluate("chrome.storage.local.get('diagnostics')"))[:300])
        except Exception as e:
            check("slides recording reaches the editor", False, str(e)[:200])
        # Teleprompter editor window
        pe = ctx.new_page(); pe.goto(f"chrome-extension://{eid}/pages/prompter.html#edit"); time.sleep(1)
        check("teleprompter editor loads", pe.locator("textarea").count() >= 1)
        ctx.close()

    finish(None)


def finish(ctx):
    if ctx:
        ctx.close()
    for e in errors:
        print("CONSOLE ERROR", e)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed, {len(errors)} console errors")
    sys.exit(1 if failed or errors else 0)


if __name__ == "__main__":
    main()
