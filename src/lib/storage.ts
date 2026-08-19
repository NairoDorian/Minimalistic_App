/**
 * Fail-soft `localStorage` access.
 *
 * `localStorage` is not guaranteed to exist or to work: it throws on access in
 * some privacy modes, when storage is disabled by policy, and on `setItem` once
 * the origin's quota is exhausted. Every value this app keeps there — the active
 * tab, the browser-preview theme accent, shortcut overrides — is a convenience,
 * never a correctness requirement, so a storage failure must degrade to "not
 * persisted" rather than propagate into the render tree and trip the error
 * boundary.
 *
 * Import these instead of touching `localStorage` directly, so the guard can
 * never be forgotten at one call site while being present at another.
 */

/** Reads a key, returning `null` when absent or when storage is unavailable. */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** Writes a key. Returns `false` when storage is unavailable or the quota is full. */
export function writeStored(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Removes a key. Returns `false` when storage is unavailable. */
export function removeStored(key: string): boolean {
  try {
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
