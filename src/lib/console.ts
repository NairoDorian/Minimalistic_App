/**
 * Developer Console Event Bus.
 *
 * A decoupled, module-level log stream (mirroring the toast bus pattern) that
 * any component can append to without prop drilling. The Developer Hub's
 * console component subscribes and renders the timestamped, color-coded feed.
 */

export type DevLogLevel = 'info' | 'success' | 'warn' | 'error';

export interface DevLogEntry {
  id: string;
  level: DevLogLevel;
  message: string;
  timestamp: number;
}

type DevLogListener = (entries: DevLogEntry[]) => void;

/** Maximum entries retained in memory before the oldest are dropped. */
const MAX_ENTRIES = 200;

let entries: DevLogEntry[] = [];
const listeners = new Set<DevLogListener>();

function notify() {
  const snapshot = [...entries];
  listeners.forEach((listener) => listener(snapshot));
}

/** Appends a new console entry at the end of the feed. */
export function pushDevLog(level: DevLogLevel, message: string): void {
  const entry: DevLogEntry = {
    id: Math.random().toString(36).substring(2, 10),
    level,
    message,
    timestamp: Date.now(),
  };
  entries = [...entries, entry];
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(entries.length - MAX_ENTRIES);
  }
  notify();
}

/** Clears the entire console feed. */
export function clearDevLog(): void {
  entries = [];
  notify();
}

/** Subscribes a listener to the feed; immediately replays the current snapshot. */
export function subscribeDevLog(listener: DevLogListener): () => void {
  listeners.add(listener);
  listener([...entries]);
  return () => {
    listeners.delete(listener);
  };
}

/** Convenience API for typed console entries. */
export const devLog = {
  info: (msg: string) => pushDevLog('info', msg),
  success: (msg: string) => pushDevLog('success', msg),
  warn: (msg: string) => pushDevLog('warn', msg),
  error: (msg: string) => pushDevLog('error', msg),
  clear: clearDevLog,
};
