import {
  createSignal,
  createEffect,
  createMemo,
  onSettled,
  untrack,
  For,
  type Component,
} from 'solid-js';
import { listen } from '@tauri-apps/api/event';
import { commands } from '../bindings';
import { TerminalSquare, Copy, Check, Trash2, RefreshCw, Pause, Play } from '../lib/icons';
import { subscribeDevLog, clearDevLog, type DevLogEntry } from '../lib/console';
import { toast } from '../lib/toast';
import { isTauri } from '../lib/tauri';
import {
  mergeFileLines,
  severityFromText,
  type LineSeverity,
  type LogLine,
  MAX_LINES,
} from '../lib/logViewer';

/**
 * Debug Console — ported from the S2B2S `LogViewer` debug panel.
 *
 * Three sources feed one merged stream:
 *   1. The module-level frontend dev log bus (IPC playground results).
 *   2. Live `log://log` events emitted by `tauri-plugin-log`'s Webview target.
 *   3. Polled `get_recent_logs` file reads, which supersede live lines whose
 *      on-disk counterpart arrived (count-aware dedup keeps repeated lines).
 * Supports severity filtering, text search, pause/resume with buffering,
 * auto-refresh polling, copy, and clear.
 *
 * In SolidJS 2.0 the signal getters carry reactivity through JSX, so the
 * mutable refs that guarded React stale-closures (pausedRef, pendingRef)
 * collapse to plain variables inside the component's single setup scope.
 */

type LogSeverity = 'all' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

interface LogEventPayload {
  message: string;
  level: number;
}

/** Payload emitted by tauri-plugin-log's `Webview` target on the `log://log`
 * event. `level` is the numeric LogLevel repr: Trace=1, Debug=2, Info=3,
 * Warn=4, Error=5. */
const LIVE_LEVEL_TO_SEVERITY: Record<number, LineSeverity> = {
  1: 'trace',
  2: 'debug',
  3: 'info',
  4: 'warn',
  5: 'error',
};

/** Maps the frontend dev log bus levels onto Rust-compatible severities. */
const BUS_LEVEL_TO_SEVERITY: Record<DevLogEntry['level'], LineSeverity> = {
  info: 'info',
  success: 'info',
  warn: 'warn',
  error: 'error',
};

/** File lines look like:
 *   [2026-08-15][00:04:36][minimalistic_app_lib::setup][INFO] message */
const parseFileLine = (raw: string): LogLine => {
  const severity = severityFromText(raw);
  const tsMatch = raw.match(/^\[([^\]]+)\]/);
  const timestamp = tsMatch ? (tsMatch[1] ?? '') : '';
  const message = tsMatch ? raw.substring(tsMatch[0].length).trim() : raw;
  return withLineId({ raw, severity, timestamp, message, live: false });
};

/** Monotonic counter giving every rendered line a stable, unique key. */
let lineSeq = 0;

const withLineId = (line: Omit<LogLine, 'id'>): LogLine => ({ ...line, id: lineSeq++ });

const formatClock = (date: Date): string => {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(
    2,
    '0'
  )}:${String(date.getSeconds()).padStart(2, '0')}`;
};

const liveLineFrom = (payload: LogEventPayload): LogLine => {
  const severity = LIVE_LEVEL_TO_SEVERITY[payload.level] ?? 'info';
  const timestamp = formatClock(new Date());
  return withLineId({
    raw: `[${timestamp}] ${payload.message}`,
    severity,
    timestamp,
    message: payload.message,
    live: true,
  });
};

const busLinesFrom = (entries: DevLogEntry[]): LogLine[] =>
  entries.map((entry) => {
    const timestamp = formatClock(new Date(entry.timestamp));
    return withLineId({
      raw: `[${timestamp}] ${entry.level.toUpperCase()} ${entry.message}`,
      severity: BUS_LEVEL_TO_SEVERITY[entry.level],
      timestamp,
      message: `${entry.level.toUpperCase()} ${entry.message}`,
      live: false,
      success: entry.level === 'success',
    });
  });

const badgeLabel = (line: LogLine): string => {
  if (line.success) return 'SUC';
  switch (line.severity) {
    case 'error':
      return 'ERR';
    case 'warn':
      return 'WRN';
    case 'debug':
      return 'DBG';
    case 'trace':
      return 'TRC';
    default:
      return 'INF';
  }
};

export const DevConsole: Component = () => {
  const [lines, setLines] = createSignal<LogLine[]>([]);
  const [linesLimit, setLinesLimit] = createSignal<number>(200);
  const [searchQuery, setSearchQuery] = createSignal<string>('');
  const [severityFilter, setSeverityFilter] = createSignal<LogSeverity>('all');
  const [autoRefresh, setAutoRefresh] = createSignal<boolean>(true);
  const [paused, setPaused] = createSignal<boolean>(false);
  const [loading, setLoading] = createSignal<boolean>(false);
  const [copied, setCopied] = createSignal<boolean>(false);

  // Mutable scratch state — never read in JSX, so plain vars are correct.
  let pending: LogLine[] = [];
  let consoleContainer: HTMLDivElement | undefined;

  // Derived: filter the merged line stream by severity search term.
  const filteredLines = createMemo(() => {
    const sf = severityFilter();
    const sq = searchQuery();
    const lowSq = sq === '' ? '' : sq.toLowerCase();
    return lines().filter((line) => {
      const matchesSeverity = sf === 'all' || line.severity === sf;
      const matchesSearch = lowSq === '' || line.raw.toLowerCase().includes(lowSq);
      return matchesSeverity && matchesSearch;
    });
  });

  /** Appends incoming lines to the tail, clamped to MAX_LINES. */
  const appendLiveLines = (incoming: LogLine[]) => {
    if (incoming.length === 0) return;
    setLines((prev) => {
      const next = prev.concat(incoming);
      return next.length > MAX_LINES ? next.slice(next.length - MAX_LINES) : next;
    });
  };

  /** Reads the backend log file and reconciles with the current buffer. */
  const fetchLogs = async (silent = false) => {
    if (!isTauri) return;
    if (!silent) setLoading(true);
    try {
      const content = await commands.getRecentLogs(linesLimit());
      const fetched = content
        .split('\n')
        .filter((line) => line.trim().length > 0)
        .map(parseFileLine);
      setLines((prev) => mergeFileLines(prev, fetched));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to fetch backend logs: ${msg}`);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  // Poll the log file if auto-refresh is enabled. The live event stream below
  // still provides real-time appends between polls.
  createEffect(
    () => ({ autoRefresh: autoRefresh(), limit: linesLimit() }),
    (state) => {
      void fetchLogs();
      let interval: ReturnType<typeof setInterval> | null = null;
      if (state.autoRefresh) {
        interval = setInterval(() => {
          // paused() read inside the interval callback is untracked — we want
          // the *current* value each tick, not a tracked dependency.
          if (!paused()) void fetchLogs(true);
        }, 2000);
      }
      return () => {
        if (interval) clearInterval(interval);
      };
    }
  );

  // Flush buffered live lines and re-sync with the file whenever unpaused.
  createEffect(
    () => paused(),
    (p) => {
      if (!p) {
        if (pending.length > 0) {
          const buffered = pending;
          pending = [];
          appendLiveLines(buffered);
        }
        void fetchLogs(true);
      }
    }
  );

  // Frontend dev log bus — replays the snapshot on subscribe, then streams.
  onSettled(() => {
    return subscribeDevLog((entries) => appendLiveLines(busLinesFrom(entries)));
  });

  // Subscribe to the backend log stream so new lines appear instantly.
  onSettled(() => {
    if (!isTauri) return;
    let isCancelled = false;
    let unlistenFn: (() => void) | undefined;
    void listen<LogEventPayload>('log://log', (event) => {
      const line = liveLineFrom(event.payload);
      if (paused()) {
        pending.push(line);
        if (pending.length > MAX_LINES) pending.shift();
        return;
      }
      appendLiveLines([line]);
    }).then((fn) => {
      if (isCancelled) {
        fn(); // unlisten immediately if already torn down
      } else {
        unlistenFn = fn;
      }
    });
    return () => {
      isCancelled = true;
      unlistenFn?.();
    };
  });

  // Keep the view pinned to the latest line unless the user has scrolled up.
  createEffect(
    () => lines().length,
    () => {
      if (consoleContainer) {
        const { scrollTop, scrollHeight, clientHeight } = consoleContainer;
        const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
        if (isNearBottom) {
          // Scroll the container directly instead of scrollIntoView to avoid
          // scrolling the nearest ancestor (e.g. the viewport/page) when the
          // terminal uses a flex layout.
          consoleContainer.scrollTop = scrollHeight;
        }
      }
    }
  );

  const handleClearLogs = async () => {
    if (!window.confirm('Clear the entire debug console and backend log file?')) return;
    try {
      if (isTauri) {
        await commands.clearLogs();
      }
      pending = [];
      clearDevLog();
      setLines([]);
      toast.success('Console and backend log cleared');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to clear logs: ${msg}`);
    }
  };

  const handleCopyLogs = async () => {
    const text = untrack(() =>
      filteredLines()
        .map((line) => line.raw)
        .join('\n')
    );
    if (!text) {
      toast.warning('No matching log lines to copy');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success('Console log copied to clipboard');
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`Failed to copy console log: ${msg}`);
    }
  };

  const severityOptions: { value: LogSeverity; label: string }[] = [
    { value: 'all', label: 'All levels' },
    { value: 'error', label: 'Error' },
    { value: 'warn', label: 'Warn' },
    { value: 'info', label: 'Info' },
    { value: 'debug', label: 'Debug' },
    { value: 'trace', label: 'Trace' },
  ];

  return (
    <div class="dev-console-box">
      <div class="dev-console-header">
        <div class="dev-console-title">
          <TerminalSquare size={13} color="var(--accent-cyan)" />
          <span>Debug Console</span>
          <span class="dev-console-count" aria-label={`${lines().length} log lines`}>
            {lines().length}
          </span>
        </div>
        <div class="dev-console-actions">
          <button
            type="button"
            class="dev-console-btn"
            onClick={handleCopyLogs}
            aria-label="Copy console log"
            title="Copy console log"
          >
            {copied() ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
          </button>
          <button
            type="button"
            class="dev-console-btn"
            onClick={() => void handleClearLogs()}
            aria-label="Clear console"
            title="Clear console and backend log file"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Controls Bar */}
      <div class="dev-console-toolbar">
        <div class="dev-console-toolbar-group">
          <select
            value={severityFilter()}
            onChange={(e) => setSeverityFilter(e.currentTarget.value as LogSeverity)}
            class="dev-console-control"
            aria-label="Filter by log severity"
          >
            {severityOptions.map((opt) => (
              <option value={opt.value}>{opt.label}</option>
            ))}
          </select>

          <select
            value={linesLimit()}
            onChange={(e) => setLinesLimit(Number(e.currentTarget.value))}
            class="dev-console-control"
            aria-label="Lines to fetch from the log file"
          >
            {[50, 100, 200, 500].map((count) => (
              <option value={count}>Last {count} lines</option>
            ))}
          </select>

          <input
            type="text"
            placeholder="Search logs..."
            value={searchQuery()}
            onInput={(e) => setSearchQuery(e.currentTarget.value)}
            class="dev-console-control dev-console-search"
            aria-label="Search console log lines"
          />
        </div>

        <div class="dev-console-toolbar-group">
          <div class="dev-console-live-status" role="status" aria-live="polite">
            <span
              class={`dev-console-live-dot ${paused() ? 'paused' : 'live'}`}
              aria-hidden="true"
            />
            <span>{paused() ? 'Paused' : 'Live'}</span>
            <span class="dev-console-live-sep">·</span>
            <span>{lines().length} lines</span>
          </div>

          <button
            type="button"
            class="dev-console-action"
            onClick={() => setPaused((prev) => !prev)}
            aria-pressed={paused() ? 'true' : 'false'}
            title={paused() ? 'Resume live streaming' : 'Pause live streaming'}
          >
            {paused() ? <Play size={12} /> : <Pause size={12} />}
            <span>{paused() ? 'Resume' : 'Pause'}</span>
          </button>

          <label class="dev-console-checkbox" title="Poll the backend log file every 2s">
            <input
              type="checkbox"
              checked={autoRefresh()}
              onChange={(e) => setAutoRefresh(e.currentTarget.checked)}
            />
            <span>Auto-refresh</span>
          </label>

          <button
            type="button"
            class="dev-console-action"
            onClick={() => void fetchLogs(false)}
            disabled={loading()}
            title="Fetch recent lines from the backend log file"
          >
            <RefreshCw size={12} class={loading() ? 'dev-console-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Log Stream Terminal */}
      <div
        ref={(el) => {
          consoleContainer = el ?? undefined;
        }}
        class="dev-console-terminal"
        tabindex={0}
        aria-label="Debug console log feed"
      >
        <For each={filteredLines()}>
          {(line) => (
            <div
              class={`dev-console-line dev-console-line-${line.severity} ${
                line.success ? 'dev-console-line-success' : ''
              }`}
            >
              {line.timestamp && <span class="dev-console-time">[{line.timestamp}]</span>}
              <span
                class={`dev-console-badge badge-${line.severity} ${
                  line.success ? 'badge-success' : ''
                }`}
              >
                {badgeLabel(line)}
              </span>
              <span class="dev-console-message">{line.message}</span>
            </div>
          )}
        </For>
      </div>

      {/* Counter Summary */}
      <div class="dev-console-summary">
        <span>
          Showing {filteredLines().length} of {lines().length} lines
        </span>
        <span>Level filter: {severityFilter().toUpperCase()}</span>
      </div>
    </div>
  );
};
