import { describe, expect, test } from 'bun:test';
import { mergeFileLines, severityFromText, type LogLine, MAX_LINES } from '../src/lib/logViewer';

/** Builds a LogLine with sensible defaults for tests. */
function mk(overrides: Partial<LogLine> & Pick<LogLine, 'raw' | 'message'>): LogLine {
  return {
    id: 0,
    severity: 'info',
    timestamp: '',
    live: false,
    ...overrides,
  };
}

describe('severityFromText', () => {
  test('detects bracketed level tokens', () => {
    expect(
      severityFromText('[2026-08-15][00:04:36][minimalistic_app_lib::setup][ERROR] boom')
    ).toBe('error');
    expect(severityFromText('[2026-08-15][00:04:36][mod][WARN] hmm')).toBe('warn');
    expect(severityFromText('[2026-08-15][00:04:36][mod][DEBUG] trace')).toBe('debug');
    expect(severityFromText('[2026-08-15][00:04:36][mod][TRACE] deep')).toBe('trace');
    expect(severityFromText('[2026-08-15][00:04:36][mod][INFO] hello')).toBe('info');
  });

  test('detects spaced level tokens in message body', () => {
    expect(severityFromText(' ERROR ')).toBe('error');
    expect(severityFromText(' WARN ')).toBe('warn');
  });

  test('defaults to info when no marker is present', () => {
    expect(severityFromText('just a plain log line')).toBe('info');
  });

  test('error takes precedence over warn (first match wins)', () => {
    expect(severityFromText('[ERROR] a WARN inside the body')).toBe('error');
  });
});

describe('mergeFileLines', () => {
  test('appends fetched file lines that are not already present', () => {
    const prev = [mk({ raw: 'a', message: 'a' })];
    const fetched = [mk({ raw: 'b', message: 'b' })];
    expect(mergeFileLines(prev, fetched).map((l) => l.raw)).toEqual(['a', 'b']);
  });

  test('drops a fetched line whose raw text already appeared in prev (count-aware)', () => {
    const prev = [mk({ raw: 'dup', message: 'dup' }), mk({ raw: 'other', message: 'other' })];
    const fetched = [mk({ raw: 'dup', message: 'dup' })];
    // 'dup' already counted once in prev → the fetched copy is dropped.
    expect(mergeFileLines(prev, fetched).map((l) => l.raw)).toEqual(['dup', 'other']);
  });

  test('suppresses a fetched file line that duplicates an existing prev line (file polling re-reads the whole log)', () => {
    const prev = [
      mk({ raw: 'dup', message: 'dup' }),
      mk({ raw: 'dup', message: 'dup' }), // two copies already present
    ];
    const fetched = [mk({ raw: 'dup', message: 'dup' })]; // third copy
    // The count-aware dedup drops the fetched copy: prev already accounts for it.
    expect(mergeFileLines(prev, fetched).map((l) => l.raw)).toEqual(['dup', 'dup']);
  });

  test('supersedes a live line when a file line matches severity + message', () => {
    const live = mk({
      raw: '[12:00:00] ERROR boom',
      message: 'boom',
      severity: 'error',
      live: true,
    });
    const prev = [live, mk({ raw: 'x', message: 'x' })];
    const fetched = [
      mk({ raw: '[2026-08-15][00:04:36][mod][ERROR] boom', message: 'boom', severity: 'error' }),
    ];
    const out = mergeFileLines(prev, fetched);
    // The live ERROR line is removed (a file counterpart arrived); the surviving
    // prev line 'x' stays and the file-derived line is appended after it.
    expect(out.every((l) => l.live !== true)).toBe(true);
    expect(out.map((l) => l.raw)).toEqual(['x', '[2026-08-15][00:04:36][mod][ERROR] boom']);
  });

  test('does not supersede a non-live prev line even on a message+severity match', () => {
    const disk = mk({
      raw: '[t] ERROR boom',
      message: 'boom',
      severity: 'error',
      live: false,
    });
    const prev = [disk];
    const fetched = [mk({ raw: '[2026][ERROR] boom', message: 'boom', severity: 'error' })];
    // Non-live lines are never removed; the file line (different raw) still appends.
    expect(mergeFileLines(prev, fetched).map((l) => l.raw)).toEqual([
      '[t] ERROR boom',
      '[2026][ERROR] boom',
    ]);
  });

  test('does not supersede a live line when severity differs', () => {
    const live = mk({ raw: '[t] WARN boom', message: 'boom', severity: 'warn', live: true });
    const prev = [live];
    const fetched = [mk({ raw: '[f] ERROR boom', message: 'boom', severity: 'error' })];
    // Different severity → live line survives; file line appends.
    expect(mergeFileLines(prev, fetched).map((l) => l.raw)).toEqual([
      '[t] WARN boom',
      '[f] ERROR boom',
    ]);
  });

  test('clamps to MAX_LINES, dropping the oldest entries', () => {
    const total = MAX_LINES + 5;
    const prev = Array.from({ length: total }, (_, i) =>
      mk({ raw: `prev-${i}`, message: `prev-${i}` })
    );
    const out = mergeFileLines(prev, []);
    expect(out.length).toBe(MAX_LINES);
    // Oldest 5 are dropped, newest MAX_LINES remain.
    expect(out[0]?.raw).toBe(`prev-${5}`);
    expect(out[MAX_LINES - 1]?.raw).toBe(`prev-${total - 1}`);
  });
});
