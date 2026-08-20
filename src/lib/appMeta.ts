/**
 * Product identity — the single place the frontend hardcodes the app's name.
 *
 * Everything user-visible that isn't supplied by the backend at runtime
 * (`get_app_info`) derives from these two constants: the header brand title,
 * the web-preview `AppInfo` stub, exported backup/diagnostic filenames, and
 * localStorage key namespacing.
 *
 * `scripts/rename-project.ts` rewrites this file, so a rebrand never has to
 * hunt for product-name string literals scattered across components.
 */

/** Human-readable product name, matching `productName` in `tauri.conf.json`. */
export const APP_NAME = 'Minimalistic App';

/**
 * Filesystem- and storage-safe slug for `APP_NAME`, matching the Cargo package
 * name. Used for downloaded file names and localStorage key prefixes.
 */
export const APP_SLUG = 'minimalistic-app';

/** Builds a namespaced localStorage key, e.g. `<slug>.active_tab`. */
export function storageKey(name: string): string {
  return `${APP_SLUG}.${name}`;
}
