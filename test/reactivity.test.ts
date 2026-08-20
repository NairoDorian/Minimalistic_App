import { describe, it, expect } from 'bun:test';
import { createRoot, createSignal, createMemo, createEffect, flush } from 'solid-js';

/**
 * Contract tests for the SolidJS 2 reactive shapes this app's components are
 * built on. They exist because those shapes are load-bearing and non-obvious:
 * `PreferencesTab` renders every toggle from a writable derived signal layered
 * over an async memo, and if the override semantics were not what the reference
 * describes, every preference toggle in the app would be silently inert.
 *
 * ---
 *
 * **These tests only mean anything under `bun run test`.**
 *
 * `solid-js` exports its **SSR build** under the default Node/Bun resolution
 * conditions (`"main": "./dist/server.cjs"`), and in that build effects never
 * run and writes never propagate — a reactivity test would pass by doing
 * nothing, or fail for reasons that have no bearing on the shipped app. The
 * `test` script therefore passes `--conditions browser`, which selects
 * `dist/solid.js`, the same client runtime Vite bundles for the webview.
 *
 * A bare `bun test` (no script) silently gets the SSR build. See TESTING.md.
 */

/** Guards a read that may throw `NotReadyError` while an async memo is in flight. */
function read<T>(fn: () => T): T | 'NOT_READY' {
  try {
    return fn();
  } catch {
    return 'NOT_READY';
  }
}

describe('the test runner resolves Solid to its client build', () => {
  it('propagates a write through a derived signal (SSR build would not)', () => {
    createRoot((dispose) => {
      const [count, setCount] = createSignal(0);
      const doubled = createMemo(() => count() * 2);

      flush(() => setCount(5));
      expect(doubled()).toBe(10);

      dispose();
    });
  });

  it('actually runs effect apply phases', () => {
    createRoot((dispose) => {
      const [n, setN] = createSignal(0);
      const seen: number[] = [];
      createEffect(
        () => n(),
        (value) => {
          seen.push(value);
        }
      );

      flush();
      flush(() => setN(1));
      flush(() => setN(2));

      expect(seen).toEqual([0, 1, 2]);
      dispose();
    });
  });
});

describe('writable derived signal — createSignal(fn)', () => {
  it('starts at the derivation and accepts a local override', () => {
    createRoot((dispose) => {
      const [source] = createSignal({ enabled: true });
      const [flag, setFlag] = createSignal(() => source().enabled);

      flush();
      expect(flag()).toBe(true);

      // A toggle click: a local override on top of the derived value.
      flush(() => setFlag(false));
      expect(flag()).toBe(false);

      dispose();
    });
  });

  it('discards the override once a dependency of the derivation changes', () => {
    createRoot((dispose) => {
      const [source, setSource] = createSignal({ enabled: true });
      const [flag, setFlag] = createSignal(() => source().enabled);

      flush();
      flush(() => setFlag(false));
      expect(flag()).toBe(false);

      // The derivation produces another value, which replaces the override.
      flush(() => setSource({ enabled: true }));
      expect(flag()).toBe(true);

      dispose();
    });
  });

  it('keeps the override when the derivation never re-runs', () => {
    // This is the case PreferencesTab relies on: `persisted` is a one-shot read
    // with no reactive dependencies, so nothing ever re-runs the derivation and
    // a user's toggle survives for the lifetime of the panel.
    createRoot((dispose) => {
      const [flag, setFlag] = createSignal(() => true);

      flush();
      flush(() => setFlag(false));
      expect(flag()).toBe(false);

      flush();
      expect(flag()).toBe(false);

      dispose();
    });
  });
});

describe('async memo — createMemo(async …)', () => {
  it('reads as not-ready until it settles, then yields the value', async () => {
    let resolveSettings!: (value: { minimizeToTray: boolean }) => void;
    const pending = new Promise<{ minimizeToTray: boolean }>((resolve) => {
      resolveSettings = resolve;
    });

    await createRoot(async (dispose) => {
      const persisted = createMemo(async () => await pending);

      // Before it settles a read throws — this is precisely what a `<Loading>`
      // boundary catches to show its fallback, and why the Preferences rows
      // cannot be clicked while the settings IPC is still in flight.
      flush();
      expect(read(persisted)).toBe('NOT_READY');

      resolveSettings({ minimizeToTray: true });
      await pending;
      await Promise.resolve();
      flush();

      expect(read(persisted)).toEqual({ minimizeToTray: true });
      dispose();
    });
  });

  it('supports a writable derived signal layered over it', async () => {
    let resolveSettings!: (value: { minimizeToTray: boolean }) => void;
    const pending = new Promise<{ minimizeToTray: boolean }>((resolve) => {
      resolveSettings = resolve;
    });

    await createRoot(async (dispose) => {
      const persisted = createMemo(async () => await pending);
      const [minimizeToTray, setMinimizeToTray] = createSignal(() => persisted().minimizeToTray);

      flush();
      expect(read(minimizeToTray)).toBe('NOT_READY');

      resolveSettings({ minimizeToTray: true });
      await pending;
      await Promise.resolve();
      flush();
      expect(read(minimizeToTray)).toBe(true);

      // The toggle: an override lands on top of the settled persisted value.
      flush(() => setMinimizeToTray(false));
      expect(read(minimizeToTray)).toBe(false);

      dispose();
    });
  });
});

describe('effect apply phases must not return a non-function', () => {
  it('treats an apply-phase return value as a cleanup function', () => {
    // Solid calls whatever the apply phase returns when the effect re-runs or
    // is disposed. A concise arrow body that happens to return a value — say
    // `(accent) => applyThemeAccent(accent)`, which returns a string, or
    // `(v) => list.push(v)`, which returns a number — therefore halts the
    // reactive system on the next run. Every effect in `src/` uses a block
    // body for this reason; this test pins the hazard so the rule has a
    // demonstrable cause rather than being folklore.
    let cleanupRan = false;

    createRoot((dispose) => {
      const [n, setN] = createSignal(0);
      createEffect(
        () => n(),
        () => {
          return () => {
            cleanupRan = true;
          };
        }
      );

      flush();
      expect(cleanupRan).toBe(false);

      // Re-running the effect disposes the previous run's cleanup.
      flush(() => setN(1));
      expect(cleanupRan).toBe(true);

      dispose();
    });
  });
});
