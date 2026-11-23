// Sign-in for the HackrLife apps account (email link). Only the email address and the person's
// email choice are stored on the server; recordings never leave the computer.

const API = 'https://cxtcwslqzrzjaulqcvvu.supabase.co';
// Public key: safe in the browser, it only allows what the database's access rules allow.
const KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN4dGN3c2xxenJ6amF1bHFjdnZ1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Mzk3Mzc1MTAsImV4cCI6MjA1NTMxMzUxMH0.tvokimDW4Mr9Bo7uojl2BLs3nSVxwpQqFGfXQbG0AUU';
const APP = 'retake';
const STORE = 'retake.session';
const PENDING = 'retake.pendingSignup';

const read = (k) => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null');
  } catch {
    return null;
  }
};
const write = (k, v) => {
  try {
    v == null ? localStorage.removeItem(k) : localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { apikey: KEY, 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.msg || data?.error_description || data?.message || `Error ${res.status}`);
  return data;
}

function save(tokens, user) {
  const s = { access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: Date.now() + (Number(tokens.expires_in) || 3600) * 1000, email: user?.email || '', id: user?.id || '' };
  write(STORE, s);
  return s;
}

// Returns the signed-in session, refreshing it when needed. Without a connection, a previous
// sign-in still counts, so people can record offline.
export async function getSession() {
  const s = read(STORE);
  if (!s) return null;
  if (s.expires_at - Date.now() > 60_000) return s;
  try {
    const t = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: { refresh_token: s.refresh_token } });
    return save(t, t.user || { email: s.email, id: s.id });
  } catch (e) {
    if (!navigator.onLine || /fetch/i.test(e.message)) return s;
    write(STORE, null);
    return null;
  }
}

export async function sendLink(email, { marketing = false } = {}) {
  write(PENDING, { email, marketing: !!marketing });
  const redirect = location.origin + location.pathname;
  await call(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, { method: 'POST', body: { email, create_user: true, data: { signup_app: APP } } });
}

// After the person clicks the link in their email, they land back here with their sign-in in
// the address. Finish signing in, register them for Retake and record their email choice.
export async function finishFromUrl() {
  const h = new URLSearchParams(location.hash.slice(1));
  const q = new URLSearchParams(location.search);
  const err = h.get('error_description') || q.get('error_description');
  if (err) {
    history.replaceState(null, '', location.pathname);
    return { error: err.replace(/\+/g, ' ') };
  }
  const access_token = h.get('access_token');
  if (!access_token) return null;
  history.replaceState(null, '', location.pathname);
  const user = await call('/auth/v1/user', { token: access_token });
  const s = save({ access_token, refresh_token: h.get('refresh_token'), expires_in: h.get('expires_in') }, user);
  const pending = read(PENDING);
  try {
    await call('/rest/v1/rpc/join_app', { method: 'POST', token: access_token, body: { p_slug: APP, p_marketing: !!pending?.marketing } });
  } catch (e) {
    console.warn('Retake sign-up', e);
  }
  write(PENDING, null);
  return { session: s };
}

export function pendingEmail() {
  return read(PENDING)?.email || '';
}

export async function signOut() {
  const s = read(STORE);
  write(STORE, null);
  if (s) call('/auth/v1/logout', { method: 'POST', token: s.access_token }).catch(() => {});
}
