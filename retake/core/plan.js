// What this copy of Retake can do, and who is using it. Today everything is free and nothing
// is switched on here: there is no account, no network and no paid feature. This file is the
// one place future versions change to add an email sign-up or Retake Pro, so the rest of the
// code asks it rather than deciding for itself.

// Switches for features that are built later. All off: turning one on is a product decision,
// and some need a Web Store privacy update first (see docs/future-features.md).
export const SWITCHES = Object.freeze({
  askForEmail: false, // offer an optional email sign-up after a first export
  pro: false, // show Retake Pro features
});

// Features that will need Retake Pro. Everything not listed is free.
export const PRO_FEATURES = Object.freeze(['cloud-links', 'ai', 'branding', 'live']);

const KEY = 'account';
const store = () => globalThis.chrome?.storage?.local;

// The local account record. Empty until the user chooses to give an email in a future version.
export async function getAccount() {
  const s = store();
  const { [KEY]: a } = s ? await s.get(KEY) : {};
  return { email: null, marketing: false, plan: 'free', ...(a || {}) };
}

export async function setAccount(patch) {
  const s = store();
  if (!s) return;
  const next = { ...(await getAccount()), ...patch, updatedAt: Date.now() };
  await s.set({ [KEY]: next });
  return next;
}

export async function can(feature) {
  if (!PRO_FEATURES.includes(feature)) return true;
  if (!SWITCHES.pro) return false;
  return (await getAccount()).plan === 'pro';
}
