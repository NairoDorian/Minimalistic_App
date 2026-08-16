/**
 * Reactive Toast Notification Event Bus.
 *
 * Provides a decoupled, lightweight notification mechanism usable from any
 * React component or async IPC handler without prop drilling.
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
  const id = Math.random().toString(36).substring(2, 9);
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
