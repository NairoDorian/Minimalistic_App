/**
 * Dev Console — pure log-parsing & reconciliation helpers.
 *
 * Extracted from `DevConsole.tsx` so the terminal-style log viewer's
 * severity classification and live-vs-disk reconciliation can be unit-tested
 * independently of the Tauri runtime and SolidJS render cycle.
 *
 * Three sources feed one merged stream (see `DevConsole.tsx`):
 *   1. The module-level frontend dev log bus.
 *   2. Live `log://log` events emitted by `tauri-plugin-log`'s Webview target.
 *   3. Polled `get_recent_logs` file reads, which supersede live lines whose
 *      on-disk counterpart arrived (count-aware dedup keeps repeated lines).
 */

/** Severity classes the console can filter / color by (everything but `all`). */
export type LineSeverity = 'error' | 'warn' | 'info' | 'debug' | 'trace';

export interface LogLine {
  id: number;
  raw: string;
  severity: LineSeverity;
  timestamp: string;
  message: string;
  live: boolean;
  /** Frontend bus "success" lines render green (severity stays `info` for filtering). */
  success?: boolean;
}

/** Hard cap for the in-memory console so a chatty app can never balloon memory. */
export const MAX_LINES = 2000;

/**
 * Classifies a raw log line into a severity by scanning for marker tokens.
 * Matches both file-format bracket tokens (`[ERROR]`, `[WARN]`...) and the
 * spaced-in-message form (` ERROR `). Returns `info` when no marker matches.
 */
export function severityFromText(line: string): LineSeverity {
  const upper = line.toUpperCase();
  if (upper.includes('[ERROR]') || upper.includes(' ERROR ')) return 'error';
  if (upper.includes('[WARN]') || upper.includes(' WARN ')) return 'warn';
  if (upper.includes('[DEBUG]') || upper.includes(' DEBUG ')) return 'debug';
  if (upper.includes('[TRACE]') || upper.includes(' TRACE ')) return 'trace';
  return 'info';
}

/**
 * Reconciles a freshly-read batch of on-disk log lines against the in-memory
 * console state, so the Dev Console's live stream and its file-backed
 * snapshot converge into a single coherent view:
 *   1. Drop live-streamed lines whose on-disk counterpart arrived (matched by
 *      severity + message substring, since live and file lines use different
 *      raw formats/timestamps).
 *   2. Append file lines that are not already present (count-aware, keyed on
 *      exact `raw`, so repeated identical lines survive).
 *
 * The result is clamped to `MAX_LINES`, keeping the newest entries.
 */
export function mergeFileLines(prev: LogLine[], fetched: LogLine[]): LogLine[] {
  const rawCounts = new Map<string, number>();
  for (const line of prev) {
    rawCounts.set(line.raw, (rawCounts.get(line.raw) ?? 0) + 1);
  }

  const supersededLive = new Set<LogLine>();
  for (const line of prev) {
    if (!line.live) continue;
    if (fetched.some((f) => f.severity === line.severity && f.message.includes(line.message))) {
      supersededLive.add(line);
    }
  }

  const out: LogLine[] = [];
  for (const line of prev) {
    if (!supersededLive.has(line)) out.push(line);
  }
  for (const fetchedLine of fetched) {
    const count = rawCounts.get(fetchedLine.raw) ?? 0;
    if (count > 0) {
      rawCounts.set(fetchedLine.raw, count - 1);
      continue;
    }
    out.push(fetchedLine);
  }
  return out.length > MAX_LINES ? out.slice(out.length - MAX_LINES) : out;
}
