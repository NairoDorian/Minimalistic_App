/**
 * Tests for `src/lib/hardening.ts`.
 *
 * The rules being tested are policy decisions, not mechanics, so each test
 * names the failure it prevents rather than the code path it walks. A test that
 * only asserts "Ctrl+R returns a string" would still pass after someone
 * accidentally made it match Ctrl+C as well.
 *
 * No headless DOM is involved. `blockedShortcutReason` is a pure function of a
 * plain object, and `installWebviewHardening` accepts an injectable
 * `EventTarget` — which Bun provides natively — so the whole file runs in the
 * bare test process. That is the reason both were shaped that way; see the
 * `isTextEntryTarget` docs in `src/lib/keyboard.ts`.
 */

import { describe, expect, test } from 'bun:test';
import { blockedShortcutReason, installWebviewHardening } from '../src/lib/hardening';

/** Builds the minimal event shape `blockedShortcutReason` reads. */
function keyEvent(key: string, options: { ctrl?: boolean; meta?: boolean; target?: unknown } = {}) {
  return {
    key,
    ctrlKey: options.ctrl ?? false,
    metaKey: options.meta ?? false,
    target: (options.target ?? null) as EventTarget | null,
  };
}

/** A stand-in for a focused `<input>` / `<textarea>` / contenteditable element. */
function textField(tagName: 'INPUT' | 'TEXTAREA' | 'SELECT') {
  return { tagName, isContentEditable: false };
}

/**
 * Dispatches a synthetic event carrying the extra fields a handler reads.
 *
 * `Object.assign` is not enough: `Event.prototype.target` is a getter with no
 * setter, so assigning to it throws. Defining an own data property shadows the
 * prototype accessor, which is how a handler can be shown an arbitrary target
 * without a DOM implementation behind it.
 */
function dispatch(target: EventTarget, type: string, extra: Record<string, unknown> = {}): Event {
  const event = new Event(type, { cancelable: true, bubbles: true });
  for (const [key, value] of Object.entries(extra)) {
    Object.defineProperty(event, key, { value, configurable: true, enumerable: true });
  }
  target.dispatchEvent(event);
  return event;
}

describe('blockedShortcutReason', () => {
  test('blocks the reload shortcuts that destroy in-memory app state', () => {
    // The whole reason this module exists. Ctrl+R is browser muscle memory and
    // wipes every unsaved thing in the app.
    expect(blockedShortcutReason(keyEvent('r', { ctrl: true }))).not.toBeNull();
    expect(blockedShortcutReason(keyEvent('R', { ctrl: true }))).not.toBeNull();
    expect(blockedShortcutReason(keyEvent('F5'))).not.toBeNull();
  });

  test('treats Cmd like Ctrl, so macOS is covered by the same table', () => {
    expect(blockedShortcutReason(keyEvent('r', { meta: true }))).not.toBeNull();
    expect(blockedShortcutReason(keyEvent('p', { meta: true }))).not.toBeNull();
  });

  test('blocks the browser-only affordances', () => {
    for (const key of ['p', 'f', 'g', 'u', 's', 'o']) {
      expect(blockedShortcutReason(keyEvent(key, { ctrl: true }))).not.toBeNull();
    }
  });

  test('blocks zoom, which silently breaks a fixed desktop layout', () => {
    for (const key of ['+', '=', '-', '0']) {
      expect(blockedShortcutReason(keyEvent(key, { ctrl: true }))).not.toBeNull();
    }
  });

  test('never blocks the OS text-editing shortcuts', () => {
    // Regression guard: an over-eager "block everything with Ctrl" rule would
    // break copy, paste, undo and select-all across the entire app.
    for (const key of ['c', 'v', 'x', 'z', 'y', 'a']) {
      expect(blockedShortcutReason(keyEvent(key, { ctrl: true }))).toBeNull();
    }
  });

  test('lets plain letters through when the modifier is required', () => {
    // `r` alone is just someone typing.
    expect(blockedShortcutReason(keyEvent('r'))).toBeNull();
    expect(blockedShortcutReason(keyEvent('p'))).toBeNull();
    // …but F5 needs no modifier, and must still be caught.
    expect(blockedShortcutReason(keyEvent('F5'))).not.toBeNull();
  });

  test('never intercepts anything while the user is typing', () => {
    const editable = { tagName: 'DIV', isContentEditable: true };
    const targets = [textField('INPUT'), textField('TEXTAREA'), textField('SELECT'), editable];

    // Ctrl+F in a search box means "find in this field", not "browser find".
    for (const target of targets) {
      expect(blockedShortcutReason(keyEvent('f', { ctrl: true, target }))).toBeNull();
      expect(blockedShortcutReason(keyEvent('F5', { target }))).toBeNull();
      expect(blockedShortcutReason(keyEvent('r', { ctrl: true, target }))).toBeNull();
    }
  });

  test('still guards a non-text element such as a button', () => {
    const button = { tagName: 'BUTTON', isContentEditable: false };
    expect(blockedShortcutReason(keyEvent('r', { ctrl: true, target: button }))).not.toBeNull();
  });

  test('unrecognized keys pass through untouched', () => {
    expect(blockedShortcutReason(keyEvent('Enter'))).toBeNull();
    expect(blockedShortcutReason(keyEvent('Tab'))).toBeNull();
    expect(blockedShortcutReason(keyEvent('k', { ctrl: true }))).toBeNull();
  });

  test('every blocked key carries a human-readable reason', () => {
    // The reason string is what a future reader sees when asking "why is this
    // blocked?", so an empty one is a real defect.
    const reason = blockedShortcutReason(keyEvent('r', { ctrl: true }));
    expect(typeof reason).toBe('string');
    expect((reason ?? '').length).toBeGreaterThan(10);
  });
});

describe('installWebviewHardening', () => {
  test('is inert unless explicitly enabled', () => {
    // The default in a test run (and in a dev build, and in a browser preview)
    // must be "change nothing".
    const target = new EventTarget();
    const teardown = installWebviewHardening({ target });
    expect(dispatch(target, 'keydown', { key: 'r', ctrlKey: true }).defaultPrevented).toBe(false);
    teardown();
  });

  test('cancels a blocked keydown when enabled', () => {
    const target = new EventTarget();
    const teardown = installWebviewHardening({ enabled: true, target });
    try {
      expect(dispatch(target, 'keydown', { key: 'r', ctrlKey: true }).defaultPrevented).toBe(true);
      expect(dispatch(target, 'keydown', { key: 'c', ctrlKey: true }).defaultPrevented).toBe(false);
    } finally {
      teardown();
    }
  });

  test('cancels both dragover and drop, so a dropped file cannot navigate the app away', () => {
    // Cancelling only `drop` looks correct and does nothing: without a
    // cancelled `dragover` the element is never a drop target, so the browser
    // performs its default navigation instead. This pins both halves.
    const target = new EventTarget();
    const teardown = installWebviewHardening({ enabled: true, target });
    try {
      for (const type of ['dragover', 'drop']) {
        expect(dispatch(target, type).defaultPrevented).toBe(true);
      }
    } finally {
      teardown();
    }
  });

  test('suppresses the context menu but leaves it over text fields', () => {
    const target = new EventTarget();
    const teardown = installWebviewHardening({ enabled: true, target });
    try {
      expect(dispatch(target, 'contextmenu', { target: null }).defaultPrevented).toBe(true);
      // Right-clicking an input must still offer cut/copy/paste.
      const overInput = dispatch(target, 'contextmenu', { target: textField('INPUT') });
      expect(overInput.defaultPrevented).toBe(false);
    } finally {
      teardown();
    }
  });

  test('honours the data-context-menu opt-out', () => {
    const target = new EventTarget();
    const teardown = installWebviewHardening({ enabled: true, target });
    try {
      // Stands in for an element inside a `[data-context-menu]` subtree.
      const optedOut = { tagName: 'DIV', closest: (selector: string) => selector };
      expect(dispatch(target, 'contextmenu', { target: optedOut }).defaultPrevented).toBe(false);
    } finally {
      teardown();
    }
  });

  test('teardown removes every listener', () => {
    // A hot reload calls this. A leak here means N sets of handlers after N
    // reloads, each calling preventDefault on the same event.
    const target = new EventTarget();
    installWebviewHardening({ enabled: true, target })();

    expect(dispatch(target, 'keydown', { key: 'r', ctrlKey: true }).defaultPrevented).toBe(false);
    expect(dispatch(target, 'drop').defaultPrevented).toBe(false);
    expect(dispatch(target, 'contextmenu').defaultPrevented).toBe(false);
  });

  test('teardown is idempotent and does not disarm a later install', () => {
    const target = new EventTarget();
    const first = installWebviewHardening({ enabled: true, target });
    first();

    const second = installWebviewHardening({ enabled: true, target });
    try {
      // The stale teardown must not reach into the new registration.
      first();
      expect(dispatch(target, 'keydown', { key: 'r', ctrlKey: true }).defaultPrevented).toBe(true);
    } finally {
      second();
    }
  });
});
