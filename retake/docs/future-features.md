# Adding email sign-up and Retake Pro later

Retake is free today. The extension has no account, sends nothing anywhere and declares "no data
collected" on the Chrome Web Store. The code is ready for an optional email sign-up and paid
features without changing how recording works.

## Where things plug in

- `core/plan.js` holds the switches (`askForEmail`, `pro`, both off), the list of features that
  will need Pro (`cloud-links`, `ai`, `branding`, `live`), the local account record
  (`getAccount`, `setAccount`) and `can(feature)`. Code asks `can()` instead of deciding itself.
- `core/hooks.js` raises named moments. Today: `export-finished`, with an empty `slot` element in
  the "Saved to Downloads" panel that a listener can fill (for example an email offer).
  A listener that fails is logged and ignored, so an add-on cannot break exporting.
- `core/addons.js` is where a new feature registers its listeners, behind its switch.
- `core/db.js` fills in missing fields when it reads an older recording (`withDefaults`), and
  lets a newer version upgrade the database. Add new fields there with a default.

## Email sign-up in the extension: what has to change outside the code

1. Write `core/email-ask.js`: listen for `export-finished`, show the offer in `slot`, keep the
   marketing box unticked, and save with `setAccount`. Import it in `core/addons.js` and turn on
   `SWITCHES.askForEmail`.
2. Sending the email to HackrLife's sign-in service (Supabase) is network code. Add
   `https://cxtcwslqzrzjaulqcvvu.supabase.co/*` to `host_permissions` in the manifest, or the
   request will be blocked. Chrome may ask existing users to accept the new permission.
3. Update the Chrome Web Store privacy tab: tick "Personally identifiable information"
   (email address) and say what it is used for. Update `docs/privacy.md` and `web/privacy.html`.
4. Bump the version and resubmit for review.

## Retake Pro

Turn on `SWITCHES.pro`, set `plan: 'pro'` in the account record after a verified purchase, and
gate each paid feature with `await can('feature')`. Recording, editing and exporting stay free.
Payment and cloud storage need a server and a privacy update, as above.

## Checking nothing broke

Run both test suites before every release (see `tests/README.md`). They check that the switches
are off and the hooks change nothing.
