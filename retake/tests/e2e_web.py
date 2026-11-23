"""End-to-end checks for the Retake web app (dist/web).

Signs up with the email link (the sign-in service is stubbed, so no email is sent), records
from the camera with Chrome's fake devices, edits, exports, and checks the library, the
privacy page and the problem report. Fails on any uncaught error or console error.

Needs: Google Chrome, Xvfb on :99, Python Playwright, ffprobe, and dist/web served on 8766:
    node scripts/build-web.mjs && (cd dist/web && python3 -m http.server 8766 &) && python3 tests/e2e_web.py
Set BASE to test another address, such as the live site (sign-up is then only checked to the form).
"""
import json, os, subprocess, sys, time

os.environ.setdefault("DISPLAY", ":99")
from playwright.sync_api import sync_playwright

BASE = os.environ.get("BASE", "http://localhost:8766/")
LIVE = not BASE.startswith("http://localhost")
OUT = "/tmp/retake-e2e-web"
results, errors = [], []


def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail else ""), flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)
    with sync_playwright() as p:
        br = p.chromium.launch(executable_path=os.environ.get("CHROME", "/usr/bin/google-chrome"), headless=False,
                               args=["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream", "--window-size=1500,950"])
        ctx = br.new_context(viewport={"width": 1470, "height": 860}, permissions=["camera", "microphone"], accept_downloads=True)
        pg = ctx.new_page()
        pg.on("pageerror", lambda e: errors.append(f"page: {e}"))
        pg.on("console", lambda m: m.type == "error" and errors.append(f"console: {m.text[:200]}"))
        pg.on("requestfailed", lambda r: print("REQUEST FAILED", r.url[:120], flush=True))

        calls = []
        cors = {"content-type": "application/json", "access-control-allow-origin": "*", "access-control-allow-headers": "*"}
        if not LIVE:
            pg.route("**/auth/v1/otp*", lambda r: (calls.append(("otp", r.request.post_data)), r.fulfill(status=200, body="{}", headers=cors)))
            pg.route("**/auth/v1/user", lambda r: (calls.append(("user",)), r.fulfill(status=200, body=json.dumps({"id": "u1", "email": "test@example.com"}), headers=cors)))
            pg.route("**/auth/v1/logout*", lambda r: r.fulfill(status=204, body="", headers=cors))
            pg.route("**/rest/v1/rpc/join_app", lambda r: (calls.append(("join", r.request.post_data)), r.fulfill(status=204, body="", headers=cors)))

        pg.goto(BASE); pg.wait_for_timeout(1500)
        check("home page loads", "Retake" in pg.inner_text("h1"))
        check("sign-up form shows before recording", pg.locator("#em").count() == 1)
        check("marketing box starts unticked", pg.locator("#mk").count() == 1 and not pg.is_checked("#mk"))
        pg.fill("#em", "not-an-email"); pg.click("#sbtn"); pg.wait_for_timeout(400)
        check("bad email is refused", pg.locator("#em").count() == 1 and not any(c[0] == "otp" for c in calls))
        if LIVE:
            return done(br)

        pg.fill("#em", "test@example.com"); pg.click("#sbtn"); pg.wait_for_timeout(1200)
        otp = next((c for c in calls if c[0] == "otp"), None)
        check("sign-in email requested", otp is not None and "test@example.com" in (otp[1] or ""))
        check("check-your-email screen", "test@example.com" in pg.inner_text("#recorder"))
        pg.goto("about:blank")
        pg.goto(BASE + "#access_token=abc&refresh_token=def&expires_in=3600&token_type=bearer&type=magiclink"); pg.wait_for_timeout(3000)
        join = next((c for c in calls if c[0] == "join"), None)
        check("joining Retake records no marketing consent", join is not None and '"p_marketing":false' in (join[1] or "").replace(" ", ""), str(join))
        pg.screenshot(path=f"{OUT}/signed-in.png")
        check("signed in shows the recorder", pg.locator("#choose").count() == 1 and "test@example.com" in pg.inner_text("#acct"),
              f"acct={pg.inner_text('#acct')[:40]!r}")
        check("token removed from the address", "access_token" not in pg.url)

        # Camera-only recording.
        pg.click("[data-src=camera]"); pg.wait_for_timeout(300)
        pg.click("#choose"); pg.wait_for_timeout(2500)
        try:
            pg.click("[data-s=start]", timeout=8000); pg.wait_for_timeout(7500)
            pg.click("[data-s=finish]", timeout=8000)
            pg.wait_for_url("**/pages/editor.html#*", timeout=15000); pg.wait_for_timeout(2500)
            check("camera recording opens in the editor", True)
        except Exception as e:
            check("camera recording opens in the editor", False, str(e)[:160])
            return done(br)

        pg.click("[data-add=arrow]"); pg.wait_for_timeout(300)
        pg.click("#export"); pg.wait_for_timeout(500)
        pg.click("[data-format=webm]"); pg.wait_for_timeout(300)
        with pg.expect_download(timeout=90000) as dl:
            pg.click("#go")
        path = f"{OUT}/web-export.webm"; dl.value.save_as(path)
        info = json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", path],
                                         capture_output=True, text=True).stdout or "{}")
        dur = float(info.get("format", {}).get("duration", 0) or 0)
        check("web export plays", dur > 3, f"{dur:.1f}s")
        check("export panel has the add-on slot", pg.locator("#afterExport").count() == 1)

        pg.goto(BASE + "pages/library.html"); pg.wait_for_timeout(2000)
        check("library lists the recording", pg.locator("#grid .card, #grid article, #grid > *").count() >= 1)

        pp = ctx.new_page(); pp.goto(BASE + "privacy.html"); pp.wait_for_timeout(500)
        check("privacy page loads", "privacy policy" in pp.inner_text("h1").lower())
        pg.goto(BASE); pg.wait_for_timeout(1200)
        href = pg.get_attribute("#reportLink", "href") or ""
        check("report link is prefilled", "issues/new" in href and "Version" in __import__("urllib.parse").parse.unquote(href))
        pg.once("dialog", lambda d: d.accept())
        pg.click("#acct"); pg.wait_for_timeout(1000)
        check("sign out returns to the sign-up form", pg.locator("#em").count() == 1)
    done(None)


def done(br):
    if br:
        br.close()
    for e in errors:
        print("ERROR", e)
    failed = [r for r in results if not r[1]]
    print(f"\n{len(results) - len(failed)}/{len(results)} checks passed, {len(errors)} errors")
    sys.exit(1 if failed or errors else 0)


if __name__ == "__main__":
    main()
