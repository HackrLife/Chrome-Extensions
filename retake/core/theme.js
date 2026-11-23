// Light and dark theme. The choice is remembered on this computer; the first time, Retake
// follows the computer's own setting.
const KEY = 'retake.theme';

export function savedTheme() {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
export function currentTheme() {
  return document.documentElement.dataset.theme || savedTheme() || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
export function applyTheme(t = currentTheme()) {
  document.documentElement.dataset.theme = t;
  return t;
}
export function toggleTheme() {
  const t = currentTheme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem(KEY, t);
  } catch {}
  return applyTheme(t);
}
applyTheme();
