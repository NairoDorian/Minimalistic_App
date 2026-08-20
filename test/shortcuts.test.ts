import { describe, it, expect, afterEach } from 'bun:test';
import {
  APP_SHORTCUTS,
  SHORTCUT_CATEGORIES,
  findShortcutConflicts,
  formatShortcutLabel,
  getShortcutHotkey,
  getShortcutSpec,
  isShortcutOverridden,
  resetShortcuts,
  resolveShortcutAction,
  setShortcutSpec,
  subscribeShortcuts,
  type ShortcutCategory,
} from '../src/lib/shortcuts';
import { hotkeyToString, parseHotkey, type MatchableKeyEvent } from '../src/lib/keyboard';

const ev = (
  parts: Partial<MatchableKeyEvent> & { key: string; code?: string }
): MatchableKeyEvent => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...parts,
});

// Overrides are module-level state; every test starts from the defaults.
afterEach(() => resetShortcuts());

describe('Shortcut registry', () => {
  it('defines a non-empty set of shortcuts with unique ids', () => {
    expect(APP_SHORTCUTS.length).toBeGreaterThan(0);
    const ids = APP_SHORTCUTS.map((sc) => sc.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every default spec parses and every field is populated', () => {
    const categories: ShortcutCategory[] = ['Navigation', 'Actions', 'General'];
    for (const sc of APP_SHORTCUTS) {
      expect(() => parseHotkey(sc.defaultSpec)).not.toThrow();
      expect(sc.description.length).toBeGreaterThan(0);
      expect(categories).toContain(sc.category);
    }
  });

  it('default specs are already canonical, so labels never drift after a reset', () => {
    for (const sc of APP_SHORTCUTS) {
      expect(hotkeyToString(parseHotkey(sc.defaultSpec))).toBe(sc.defaultSpec);
    }
  });

  it('no two different actions share the same default binding', () => {
    const byBinding = new Map<string, string>();
    for (const sc of APP_SHORTCUTS) {
      const canonical = hotkeyToString(parseHotkey(sc.defaultSpec));
      const existing = byBinding.get(canonical);
      if (existing !== undefined) expect(existing).toBe(sc.action);
      byBinding.set(canonical, sc.action);
    }
  });

  it('SHORTCUT_CATEGORIES covers every category in use, without duplicates', () => {
    const used = new Set(APP_SHORTCUTS.map((sc) => sc.category));
    expect(new Set(SHORTCUT_CATEGORIES).size).toBe(SHORTCUT_CATEGORIES.length);
    expect(new Set(SHORTCUT_CATEGORIES)).toEqual(used);
  });
});

describe('formatShortcutLabel', () => {
  it('renders the platform-appropriate label', () => {
    expect(formatShortcutLabel('go-preferences', false)).toBe('Ctrl+1');
    expect(formatShortcutLabel('go-preferences', true)).toBe('⌘1');
    expect(formatShortcutLabel('show-shortcuts', false)).toBe('Ctrl+/');
    expect(formatShortcutLabel('close-modal', false)).toBe('Escape');
  });

  it('accepts a definition as well as an id', () => {
    const definition = APP_SHORTCUTS.find((sc) => sc.id === 'go-about')!;
    expect(formatShortcutLabel(definition, false)).toBe('Ctrl+2');
  });

  it('reflects a rebind immediately', () => {
    setShortcutSpec('go-about', 'Mod+Shift+B');
    expect(formatShortcutLabel('go-about', false)).toBe('Ctrl+Shift+B');
  });
});

describe('resolveShortcutAction', () => {
  it('resolves the default tab chords', () => {
    const opts = { isMac: false };
    expect(resolveShortcutAction(ev({ key: '1', code: 'Digit1', ctrlKey: true }), opts)).toBe(
      'tab-preferences'
    );
    expect(resolveShortcutAction(ev({ key: '2', code: 'Digit2', ctrlKey: true }), opts)).toBe(
      'tab-about'
    );
    expect(resolveShortcutAction(ev({ key: '3', code: 'Digit3', ctrlKey: true }), opts)).toBe(
      'tab-developer'
    );
  });

  it('maps Cmd+, to Preferences on macOS', () => {
    expect(
      resolveShortcutAction(ev({ key: ',', code: 'Comma', metaKey: true }), { isMac: true })
    ).toBe('tab-preferences');
  });

  it('maps both Ctrl+/ and ? to the cheat sheet', () => {
    expect(
      resolveShortcutAction(ev({ key: '/', code: 'Slash', ctrlKey: true }), { isMac: false })
    ).toBe('toggle-shortcuts');
    expect(
      resolveShortcutAction(ev({ key: '?', code: 'Slash', shiftKey: true }), { isMac: false })
    ).toBe('toggle-shortcuts');
  });

  it('resolves Escape to the modal-close action', () => {
    expect(resolveShortcutAction(ev({ key: 'Escape', code: 'Escape' }), { isMac: false })).toBe(
      'close-modal'
    );
  });

  it('returns null for unbound keys and over-modified chords', () => {
    expect(
      resolveShortcutAction(ev({ key: 'q', code: 'KeyQ', ctrlKey: true }), { isMac: false })
    ).toBeNull();
    expect(resolveShortcutAction(ev({ key: '9', code: 'Digit9' }), { isMac: false })).toBeNull();
    expect(
      resolveShortcutAction(ev({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true }), {
        isMac: false,
      })
    ).toBeNull();
  });

  it('honours a user rebind and stops matching the old chord', () => {
    setShortcutSpec('go-developer', 'Mod+Alt+D');
    const opts = { isMac: false };
    expect(
      resolveShortcutAction(ev({ key: 'd', code: 'KeyD', ctrlKey: true, altKey: true }), opts)
    ).toBe('tab-developer');
    expect(resolveShortcutAction(ev({ key: '3', code: 'Digit3', ctrlKey: true }), opts)).toBeNull();
  });

  it('restores the default binding after a reset', () => {
    setShortcutSpec('go-developer', 'Mod+Alt+D');
    resetShortcuts();
    expect(
      resolveShortcutAction(ev({ key: '3', code: 'Digit3', ctrlKey: true }), { isMac: false })
    ).toBe('tab-developer');
  });
});

describe('rebinding', () => {
  it('reports and clears override state', () => {
    expect(isShortcutOverridden('go-about')).toBe(false);
    setShortcutSpec('go-about', 'Mod+Shift+B');
    expect(isShortcutOverridden('go-about')).toBe(true);
    expect(getShortcutSpec('go-about')).toBe('Mod+Shift+B');

    setShortcutSpec('go-about', null);
    expect(isShortcutOverridden('go-about')).toBe(false);
    expect(getShortcutSpec('go-about')).toBe('Mod+2');
  });

  it('normalizes an aliased spec to its canonical form', () => {
    setShortcutSpec('go-about', 'cmdorctrl+shift+b');
    expect(getShortcutSpec('go-about')).toBe('Mod+Shift+B');
  });

  it('treats rebinding back to the default as a reset, not an override', () => {
    setShortcutSpec('go-about', 'CmdOrCtrl+2');
    expect(isShortcutOverridden('go-about')).toBe(false);
    expect(getShortcutSpec('go-about')).toBe('Mod+2');
  });

  it('rejects an unparseable spec without changing the binding', () => {
    expect(setShortcutSpec('go-about', 'Ctrl+Nonsense')).toBe(false);
    expect(getShortcutSpec('go-about')).toBe('Mod+2');
  });

  it('refuses to rebind a fixed shortcut', () => {
    expect(setShortcutSpec('close-modal', 'Mod+Q')).toBe(false);
    expect(getShortcutSpec('close-modal')).toBe('Escape');
  });

  it('exposes the parsed hotkey for the current binding', () => {
    expect(getShortcutHotkey('go-preferences')).toEqual(parseHotkey('Mod+1'));
  });

  it('notifies subscribers on rebind and reset, and stops after unsubscribe', () => {
    let calls = 0;
    const unsubscribe = subscribeShortcuts(() => calls++);
    expect(calls).toBe(1); // immediate replay

    setShortcutSpec('go-about', 'Mod+Shift+B');
    expect(calls).toBe(2);

    resetShortcuts();
    expect(calls).toBe(3);

    unsubscribe();
    setShortcutSpec('go-about', 'Mod+Shift+B');
    expect(calls).toBe(3);
  });
});

describe('findShortcutConflicts', () => {
  it('reports a shortcut already bound to the same chord', () => {
    const conflicts = findShortcutConflicts('go-about', 'Mod+1');
    expect(conflicts.map((sc) => sc.id)).toEqual(['go-preferences']);
  });

  it('matches through aliases, not just identical strings', () => {
    expect(findShortcutConflicts('go-about', 'CommandOrControl+1').map((sc) => sc.id)).toEqual([
      'go-preferences',
    ]);
  });

  it('does not report a shortcut against itself', () => {
    expect(findShortcutConflicts('go-preferences', 'Mod+1')).toEqual([]);
  });

  it('does not report deliberate alternates for the same action', () => {
    // Ctrl+/ and ? both open the cheat sheet — binding one to the other's chord
    // is redundant, not a conflict.
    expect(findShortcutConflicts('show-shortcuts', "'?'")).toEqual([]);
  });

  it('reports nothing for a free chord or an invalid spec', () => {
    expect(findShortcutConflicts('go-about', 'Mod+Alt+Shift+F9')).toEqual([]);
    expect(findShortcutConflicts('go-about', 'not a hotkey')).toEqual([]);
  });

  it('sees a chord taken by another shortcut override', () => {
    setShortcutSpec('go-developer', 'Mod+Shift+X');
    expect(findShortcutConflicts('go-about', 'Mod+Shift+X').map((sc) => sc.id)).toEqual([
      'go-developer',
    ]);
  });
});
