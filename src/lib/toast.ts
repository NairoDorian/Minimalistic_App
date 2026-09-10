/**
 * Reactive Toast Notification Event Bus.
 *
 * Provides a decoupled, lightweight notification mechanism usable from any
 * SolidJS component or async IPC handler without prop drilling.
 */

export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  durationMs: number;
}

type ToastListener = (toasts: ToastItem[]) => void;

let toasts: ToastItem[] = [];
const listeners = new Set<ToastListener>();

/**
 * Monotonic id source. `removeToast` and the keyed `<For>` in `Toast.tsx` both
 * identify a toast by id, so two toasts sharing one would be dismissed and
 * re-rendered together; a counter cannot collide, where the random string it
 * replaces only made that unlikely.
 */
let nextToastId = 0;

function notify() {
  const snapshot = [...toasts];
  listeners.forEach((listener) => listener(snapshot));
}

/**
 * Adds a new toast notification.
 */
export function showToast(
  message: string,
  type: ToastType = 'info',
  durationMs: number = 3500
): string {
  nextToastId += 1;
  const id = `toast-${nextToastId}`;
  const toast: ToastItem = { id, message, type, durationMs };
  toasts = [...toasts, toast];
  notify();
  return id;
}

/**
 * Removes a toast notification by its ID.
 */
export function removeToast(id: string) {
  toasts = toasts.filter((t) => t.id !== id);
  notify();
}

/**
 * Clears all active toasts.
 */
export function clearAllToasts() {
  toasts = [];
  notify();
}

/**
 * Subscribes a listener to toast state changes.
 */
export function subscribeToasts(listener: ToastListener): () => void {
  listeners.add(listener);
  listener([...toasts]);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Convenience API for triggering typed toast messages.
 */
export const toast = {
  info: (msg: string, duration?: number) => showToast(msg, 'info', duration),
  success: (msg: string, duration?: number) => showToast(msg, 'success', duration),
  warning: (msg: string, duration?: number) => showToast(msg, 'warning', duration),
  error: (msg: string, duration?: number) => showToast(msg, 'error', duration ?? 5000),
  remove: removeToast,
  clear: clearAllToasts,
};
