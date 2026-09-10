/**
 * OS notifications, with the permission dance in one place.
 *
 * Two callers need to reach the user *outside* the window: the update checker
 * (a new version was found while the app sat hidden in the tray) and the
 * Developer Hub's notification bench. Both used to carry their own copy of the
 * "is it granted? if not, ask; if yes, send" sequence, and the two copies had
 * already drifted apart in how they mapped the plugin's answers. This module is
 * the single implementation.
 *
 * Three transports, chosen by environment:
 *
 * 1. **Native** — `@tauri-apps/plugin-notification` inside the desktop build.
 *    The webview holds the `notification:default` capability for exactly this
 *    (see `src-tauri/capabilities/default.json`).
 * 2. **Web Notification API** — in the browser preview (`bun run vite`), so the
 *    flow can be exercised without compiling the backend.
 * 3. **In-app toast** — the fallback when the OS or the user said no, used only
 *    by {@link sendAppNotification}. {@link sendOsNotification} deliberately has
 *    no fallback: a toast is invisible while the window is hidden, which is the
 *    one situation an OS notification exists for.
 *
 * ## Permission states
 *
 * The four-way {@link NotificationPermissionState} is the browser's model
 * (`granted` / `denied` / `default`) plus `unsupported` for an environment with
 * no notification API at all (a bare Bun test process, some embedded webviews).
 * The Tauri plugin only answers "granted or not", so inside the desktop build a
 * denial and a never-asked state both read as `default`; the badge in the
 * Developer Hub therefore says "ask" rather than claiming a denial it cannot see.
 */

import {
  isPermissionGranted as tauriIsPermissionGranted,
  requestPermission as tauriRequestPermission,
  sendNotification as tauriSendNotification,
} from '@tauri-apps/plugin-notification';
import { isTauri } from './tauri';
import { APP_NAME } from './appMeta';
import { toast } from './toast';

export type NotificationPermissionState = 'granted' | 'denied' | 'default' | 'unsupported';

/** Which transport ended up presenting a notification. */
export type NotificationTransport = 'tauri' | 'web-api' | 'toast-fallback';

export interface AppNotificationOptions {
  /** Notification title. Defaults to the product name when omitted or blank. */
  title?: string;
  /** Notification body message. */
  body: string;
  /** Optional sound identifier or path, passed through to the native plugin. */
  sound?: string;
}

export interface NotificationDeliveryResult {
  /** Always true: the toast fallback cannot fail. Kept for call-site clarity. */
  success: boolean;
  /** Mechanism used to present the notification. */
  deliveredVia: NotificationTransport;
  /** Permission state at the time of delivery. */
  permission: NotificationPermissionState;
  /** Why the preferred transport was skipped, when it threw. */
  error?: string;
}

/**
 * The browser's `Notification` constructor, or `null` where the API is absent.
 *
 * Read off `globalThis` rather than `window`: the test process has no `window`,
 * and the tests install a stand-in on the global to drive the web transport.
 */
function webNotificationApi(): typeof Notification | null {
  const candidate = (globalThis as { Notification?: unknown }).Notification;
  return candidate === undefined || candidate === null ? null : (candidate as typeof Notification);
}

/** Normalizes whatever a permission API returned into the four-way state. */
function normalizePermission(value: unknown): NotificationPermissionState {
  return value === 'granted' || value === 'denied' ? value : 'default';
}

/** Applies the title default and trims the fields the OS will display. */
function normalizeOptions(options: AppNotificationOptions | string): {
  title: string;
  body: string;
  sound: string | undefined;
} {
  const raw: AppNotificationOptions = typeof options === 'string' ? { body: options } : options;
  const title = raw.title?.trim();
  return {
    title: title === undefined || title === '' ? APP_NAME : title,
    body: raw.body,
    sound: raw.sound,
  };
}

/**
 * Reads the current permission without prompting.
 *
 * Errors from the plugin (a webview without the capability, an IPC hiccup)
 * degrade to `default`, which is the honest answer: nothing is known, and a
 * later request will find out.
 */
export async function checkNotificationPermission(): Promise<NotificationPermissionState> {
  if (isTauri) {
    try {
      return (await tauriIsPermissionGranted()) ? 'granted' : 'default';
    } catch {
      return 'default';
    }
  }

  const api = webNotificationApi();
  return api === null ? 'unsupported' : normalizePermission(api.permission);
}

/**
 * Prompts the user (or the OS) for permission and reports the outcome.
 *
 * A prompt that throws is reported as `denied`: from the caller's point of view
 * the request was refused, and reporting `default` would invite an immediate
 * second prompt.
 */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (isTauri) {
    try {
      return normalizePermission(await tauriRequestPermission());
    } catch {
      return 'denied';
    }
  }

  const api = webNotificationApi();
  if (api === null) return 'unsupported';
  try {
    return normalizePermission(await api.requestPermission());
  } catch {
    return 'denied';
  }
}

/** Result of an attempt to present a notification through the OS or browser. */
interface OsDeliveryOutcome {
  /** The transport that presented it, or `null` when neither could. */
  deliveredVia: 'tauri' | 'web-api' | null;
  permission: NotificationPermissionState;
  error?: string;
}

/**
 * Sends through the OS (Tauri) or the browser Notification API, asking for
 * permission first when it has not been decided yet.
 *
 * The one-time prompt is what makes this usable from a background path: the
 * update checker cannot pop a permission dialog itself, so the first
 * notification it ever tries to send is also the first time the OS asks.
 */
async function deliverViaOs(
  title: string,
  body: string,
  sound: string | undefined
): Promise<OsDeliveryOutcome> {
  let permission = await checkNotificationPermission();
  if (permission === 'default') {
    permission = await requestNotificationPermission();
  }
  if (permission !== 'granted') {
    return { deliveredVia: null, permission };
  }

  try {
    if (isTauri) {
      // The plugin's `sendNotification` is synchronous: it fires the IPC call
      // and returns without awaiting delivery, so there is nothing to await.
      // `sound` is spread conditionally because `exactOptionalPropertyTypes`
      // forbids passing an explicit `undefined` for an optional field.
      tauriSendNotification({ title, body, ...(sound === undefined ? {} : { sound }) });
      return { deliveredVia: 'tauri', permission };
    }

    const api = webNotificationApi();
    if (api === null) {
      return { deliveredVia: null, permission: 'unsupported' };
    }
    // Constructing the object is what shows it. The instance is only useful
    // for `close()`, which this app never calls, so it is deliberately not
    // kept — hence the lint opt-out rather than a dead variable.
    // eslint-disable-next-line no-new
    new api(title, { body });
    return { deliveredVia: 'web-api', permission };
  } catch (err: unknown) {
    return {
      deliveredVia: null,
      permission,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Presents a notification through the operating system (or the browser's
 * Notification API in the web preview), with **no in-app fallback**.
 *
 * Resolves `true` only when the OS or browser accepted it. This is the right
 * primitive for anything that runs while the window may be hidden: a toast
 * fallback there would be shown to nobody and would expire before the window
 * is next opened, so the caller is better off knowing it was not delivered.
 */
export async function sendOsNotification(
  options: AppNotificationOptions | string
): Promise<boolean> {
  const { title, body, sound } = normalizeOptions(options);
  const outcome = await deliverViaOs(title, body, sound);
  return outcome.deliveredVia !== null;
}

/**
 * Presents a notification through the OS or browser, falling back to an
 * in-app toast when that is denied, unsupported, or throws.
 *
 * Never fails: the toast is always available while the app is running. The
 * returned result says which transport actually presented it, which is what
 * the Developer Hub's bench displays.
 */
export async function sendAppNotification(
  options: AppNotificationOptions | string
): Promise<NotificationDeliveryResult> {
  const { title, body, sound } = normalizeOptions(options);
  const outcome = await deliverViaOs(title, body, sound);

  if (outcome.deliveredVia !== null) {
    return { success: true, deliveredVia: outcome.deliveredVia, permission: outcome.permission };
  }

  toast.info(`[${title}] ${body}`);
  return {
    success: true,
    deliveredVia: 'toast-fallback',
    permission: outcome.permission,
    ...(outcome.error === undefined ? {} : { error: outcome.error }),
  };
}
