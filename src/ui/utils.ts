export const escapeHtml = (value: unknown): string =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );
export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function readPreference<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`techdraw:${key}`);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
export function savePreference(key: string, value: unknown): void {
  try {
    localStorage.setItem(`techdraw:${key}`, JSON.stringify(value));
  } catch {
    /* Preferences are optional in private browsing. */
  }
}
