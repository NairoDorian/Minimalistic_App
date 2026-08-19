import { describe, it, expect } from 'bun:test';
import {
  MOD,
  HotkeyParseError,
  canonicalKeyFromCode,
  createKeyboardListener,
  formatHotkey,
  formatHotkeySpec,
  formatKey,
  hotkeyFromTrackedEvent,
  hotkeyToString,
  matchesHotkey,
  modifiersFromEvent,
  modifiersMatch,
  parseHotkey,
  parseModifierToken,
  resolveModifiers,
  tryParseHotkey,
  type MatchableKeyEvent,
  type TrackedKeyEvent,
} from '../src/lib/keyboard';

/** Builds the subset of KeyboardEvent that matching reads. */
const ev = (
  parts: Partial<MatchableKeyEvent> & { key: string; code?: string }
): MatchableKeyEvent => ({
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...parts,
});

describe('parseModifierToken', () => {
  it('accepts the common spellings of each modifier', () => {
    for (const alias of ['ctrl', 'Control', 'CTRL']) {
      expect(parseModifierToken(alias)).toBe(MOD.CTRL);
    }
    for (const alias of ['cmd', 'Command', 'meta', 'super', 'win', 'Windows']) {
      expect(parseModifierToken(alias)).toBe(MOD.META);
    }
    for (const alias of ['alt', 'opt', 'Option']) {
      expect(parseModifierToken(alias)).toBe(MOD.ALT);
    }
    expect(parseModifierToken('shift')).toBe(MOD.SHIFT);
  });

  it('accepts the platform-resolving primary aliases', () => {
    for (const alias of ['Mod', 'CmdOrCtrl', 'CommandOrControl']) {
      expect(parseModifierToken(alias)).toBe(MOD.PRIMARY);
    }
  });

  it('accepts side-specific spellings, including AltGr', () => {
    expect(parseModifierToken('LCtrl')).toBe(MOD.CTRL_LEFT);
    expect(parseModifierToken('ctrl_left')).toBe(MOD.CTRL_LEFT);
    expect(parseModifierToken('ShiftRight')).toBe(MOD.SHIFT_RIGHT);
    expect(parseModifierToken('AltGr')).toBe(MOD.ALT_RIGHT);
    expect(parseModifierToken('rcmd')).toBe(MOD.META_RIGHT);
  });

  it('returns null for anything that is not a modifier', () => {
    expect(parseModifierToken('K')).toBeNull();
    expect(parseModifierToken('')).toBeNull();
    expect(parseModifierToken('nonsense')).toBeNull();
  });
});

describe('resolveModifiers', () => {
  it('maps the primary modifier to Cmd on macOS and Ctrl elsewhere', () => {
    expect(resolveModifiers(MOD.PRIMARY, true)).toBe(MOD.META);
    expect(resolveModifiers(MOD.PRIMARY, false)).toBe(MOD.CTRL);
  });

  it('keeps other flags and clears the virtual bit', () => {
    const resolved = resolveModifiers(MOD.PRIMARY | MOD.SHIFT, false);
    expect(resolved & MOD.PRIMARY).toBe(0);
    expect(resolved & MOD.SHIFT).toBe(MOD.SHIFT);
    expect(resolved & MOD.CTRL).toBe(MOD.CTRL);
  });

  it('is a no-op when the primary flag is absent', () => {
    expect(resolveModifiers(MOD.ALT, true)).toBe(MOD.ALT);
  });
});

describe('parseHotkey', () => {
  it('parses modifiers plus a key', () => {
    const hotkey = parseHotkey('Mod+Shift+K');
    expect(hotkey.modifiers).toBe(MOD.PRIMARY | MOD.SHIFT);
    expect(hotkey.key).toBe('K');
    expect(hotkey.matchOn).toBe('code');
  });

  it('parses a key on its own and modifiers on their own', () => {
    expect(parseHotkey('F5')).toEqual({ modifiers: MOD.NONE, key: 'F5', matchOn: 'code' });
    expect(parseHotkey('Cmd+Shift')).toEqual({
      modifiers: MOD.META | MOD.SHIFT,
      key: null,
      matchOn: 'code',
    });
  });

  it('canonicalizes key spellings and symbols', () => {
    expect(parseHotkey('esc').key).toBe('Escape');
    expect(parseHotkey('return').key).toBe('Enter');
    expect(parseHotkey('pgup').key).toBe('PageUp');
    expect(parseHotkey('arrowleft').key).toBe('Left');
    expect(parseHotkey('/').key).toBe('Slash');
    expect(parseHotkey(',').key).toBe('Comma');
    expect(parseHotkey('`').key).toBe('Grave');
    expect(parseHotkey('num5').key).toBe('5');
    expect(parseHotkey('keypad7').key).toBe('Keypad7');
    expect(parseHotkey('f24').key).toBe('F24');
  });

  it('is case- and separator-insensitive for modifiers', () => {
    expect(parseHotkey('CTRL + ALT + Delete')).toEqual(parseHotkey('ctrl+alt+delete'));
  });

  it('parses a quoted token as a character match', () => {
    const hotkey = parseHotkey("Shift+'?'");
    expect(hotkey.modifiers).toBe(MOD.SHIFT);
    expect(hotkey.key).toBe('?');
    expect(hotkey.matchOn).toBe('char');
  });

  it('keeps a quoted plus intact despite + being the separator', () => {
    const hotkey = parseHotkey("Ctrl+'+'");
    expect(hotkey.modifiers).toBe(MOD.CTRL);
    expect(hotkey.key).toBe('+');
    expect(hotkey.matchOn).toBe('char');
  });

  it('rejects an empty spec', () => {
    expect(() => parseHotkey('')).toThrow(HotkeyParseError);
    expect(() => parseHotkey('   ')).toThrow(HotkeyParseError);
  });

  it('rejects unknown tokens and multiple keys', () => {
    expect(() => parseHotkey('Ctrl+Nonsense')).toThrow(HotkeyParseError);
    expect(() => parseHotkey('Ctrl+A+B')).toThrow(/more than one key/);
  });

  it('tryParseHotkey returns null instead of throwing', () => {
    expect(tryParseHotkey('Ctrl+Nonsense')).toBeNull();
    expect(tryParseHotkey('Ctrl+K')).not.toBeNull();
  });
});

describe('hotkeyToString', () => {
  it('round-trips every spec form', () => {
    for (const spec of [
      'Mod+1',
      'Mod+Shift+K',
      'Ctrl+Alt+Delete',
      'F5',
      'Meta+Shift',
      "Shift+'?'",
      'CtrlLeft+K',
      'AltRight+Space',
    ]) {
      const hotkey = parseHotkey(spec);
      expect(parseHotkey(hotkeyToString(hotkey))).toEqual(hotkey);
    }
  });

  it('normalizes aliases to canonical names', () => {
    expect(hotkeyToString(parseHotkey('cmdorctrl+shift+k'))).toBe('Mod+Shift+K');
    expect(hotkeyToString(parseHotkey('option+esc'))).toBe('Alt+Escape');
    expect(hotkeyToString(parseHotkey('altgr+a'))).toBe('AltRight+A');
  });
});

describe('formatHotkey', () => {
  it('uses Ctrl+ style off macOS and glyphs on macOS', () => {
    const hotkey = parseHotkey('Mod+Shift+K');
    expect(formatHotkey(hotkey, false)).toBe('Ctrl+Shift+K');
    expect(formatHotkey(hotkey, true)).toBe('⇧⌘K');
  });

  it('renders every modifier in Ctrl, Alt, Shift, Meta order', () => {
    const hotkey = parseHotkey('Ctrl+Alt+Shift+Meta+K');
    expect(formatHotkey(hotkey, false)).toBe('Ctrl+Alt+Shift+Win+K');
    expect(formatHotkey(hotkey, true)).toBe('⌃⌥⇧⌘K');
  });

  it('renders punctuation keys by their label', () => {
    expect(formatHotkey(parseHotkey('Mod+Slash'), false)).toBe('Ctrl+/');
    expect(formatHotkey(parseHotkey('Mod+Comma'), false)).toBe('Ctrl+,');
    expect(formatHotkey(parseHotkey('Mod+Minus'), false)).toBe('Ctrl+-');
  });

  it('uses macOS glyphs for navigation and editing keys', () => {
    expect(formatKey('Enter', true)).toBe('↩');
    expect(formatKey('Escape', true)).toBe('⎋');
    expect(formatKey('Left', true)).toBe('←');
    expect(formatKey('Enter', false)).toBe('Enter');
  });

  it('annotates a side only when the binding is side-specific', () => {
    expect(formatHotkey(parseHotkey('CtrlLeft+K'), false)).toBe('LCtrl+K');
    expect(formatHotkey(parseHotkey('Ctrl+K'), false)).toBe('Ctrl+K');
  });

  it('formats modifier-only hotkeys', () => {
    expect(formatHotkey(parseHotkey('Cmd+Shift'), true)).toBe('⇧⌘');
  });

  it('formatHotkeySpec falls back to the raw spec when it cannot parse', () => {
    expect(formatHotkeySpec('Mod+1', false)).toBe('Ctrl+1');
    expect(formatHotkeySpec('!!bogus!!', false)).toBe('!!bogus!!');
  });
});

describe('canonicalKeyFromCode', () => {
  it('maps the algorithmic code families', () => {
    expect(canonicalKeyFromCode('KeyA')).toBe('A');
    expect(canonicalKeyFromCode('Digit7')).toBe('7');
    expect(canonicalKeyFromCode('F12')).toBe('F12');
    expect(canonicalKeyFromCode('Numpad3')).toBe('Keypad3');
  });

  it('maps named codes to canonical names', () => {
    expect(canonicalKeyFromCode('ArrowUp')).toBe('Up');
    expect(canonicalKeyFromCode('BracketLeft')).toBe('LeftBracket');
    expect(canonicalKeyFromCode('Backquote')).toBe('Grave');
    expect(canonicalKeyFromCode('NumpadEnter')).toBe('KeypadEnter');
  });

  it('returns null for modifier keys and unknown codes', () => {
    expect(canonicalKeyFromCode('ControlLeft')).toBeNull();
    expect(canonicalKeyFromCode('MetaRight')).toBeNull();
    expect(canonicalKeyFromCode('Lang1')).toBeNull();
  });
});

describe('modifiersFromEvent / modifiersMatch', () => {
  it('derives compound flags from the event booleans', () => {
    expect(modifiersFromEvent(ev({ key: 'a' }))).toBe(MOD.NONE);
    expect(modifiersFromEvent(ev({ key: 'a', ctrlKey: true }))).toBe(MOD.CTRL);
    expect(modifiersFromEvent(ev({ key: 'a', ctrlKey: true, shiftKey: true }))).toBe(
      MOD.CTRL | MOD.SHIFT
    );
  });

  it('matches a compound pattern against either side', () => {
    expect(modifiersMatch(MOD.CTRL, MOD.CTRL_LEFT, false)).toBe(true);
    expect(modifiersMatch(MOD.CTRL, MOD.CTRL_RIGHT, false)).toBe(true);
    expect(modifiersMatch(MOD.CTRL, MOD.NONE, false)).toBe(false);
  });

  it('requires the exact side for a side-specific pattern', () => {
    expect(modifiersMatch(MOD.CTRL_LEFT, MOD.CTRL_LEFT, false)).toBe(true);
    expect(modifiersMatch(MOD.CTRL_LEFT, MOD.CTRL_RIGHT, false)).toBe(false);
    // Both sides held still satisfies a left-specific pattern.
    expect(modifiersMatch(MOD.CTRL_LEFT, MOD.CTRL, false)).toBe(true);
  });

  it('rejects modifiers the pattern does not ask for', () => {
    expect(modifiersMatch(MOD.CTRL, MOD.CTRL | MOD.ALT, false)).toBe(false);
    expect(modifiersMatch(MOD.NONE, MOD.SHIFT, false)).toBe(false);
    expect(modifiersMatch(MOD.NONE, MOD.NONE, false)).toBe(true);
  });
});

describe('matchesHotkey', () => {
  const modOne = parseHotkey('Mod+1');

  it('resolves the primary modifier per platform', () => {
    expect(
      matchesHotkey(modOne, ev({ key: '1', code: 'Digit1', ctrlKey: true }), {
        isMac: false,
      })
    ).toBe(true);
    expect(
      matchesHotkey(modOne, ev({ key: '1', code: 'Digit1', metaKey: true }), {
        isMac: true,
      })
    ).toBe(true);
  });

  it('rejects the wrong platform modifier', () => {
    expect(
      matchesHotkey(modOne, ev({ key: '1', code: 'Digit1', metaKey: true }), {
        isMac: false,
      })
    ).toBe(false);
    expect(
      matchesHotkey(modOne, ev({ key: '1', code: 'Digit1', ctrlKey: true }), {
        isMac: true,
      })
    ).toBe(false);
  });

  it('rejects an unmodified press and an over-modified press', () => {
    expect(matchesHotkey(modOne, ev({ key: '1', code: 'Digit1' }), { isMac: false })).toBe(false);
    expect(
      matchesHotkey(modOne, ev({ key: '1', code: 'Digit1', ctrlKey: true, altKey: true }), {
        isMac: false,
      })
    ).toBe(false);
  });

  it('matches on physical position, not the produced character', () => {
    const hotkey = parseHotkey('Mod+Z');
    // An AZERTY layout produces "w" from the physical KeyZ position.
    expect(
      matchesHotkey(hotkey, ev({ key: 'w', code: 'KeyZ', ctrlKey: true }), { isMac: false })
    ).toBe(true);
    expect(
      matchesHotkey(hotkey, ev({ key: 'z', code: 'KeyW', ctrlKey: true }), { isMac: false })
    ).toBe(false);
  });

  it('falls back to the character when the event carries no code', () => {
    const hotkey = parseHotkey('Mod+K');
    expect(matchesHotkey(hotkey, ev({ key: 'k', ctrlKey: true }), { isMac: false })).toBe(true);
    expect(matchesHotkey(hotkey, ev({ key: 'j', ctrlKey: true }), { isMac: false })).toBe(false);
  });

  it('matches a character binding regardless of the Shift needed to type it', () => {
    const help = parseHotkey("'?'");
    expect(
      matchesHotkey(help, ev({ key: '?', code: 'Slash', shiftKey: true }), { isMac: false })
    ).toBe(true);
    expect(matchesHotkey(help, ev({ key: '?' }), { isMac: false })).toBe(true);
    // Other modifiers are still rejected.
    expect(
      matchesHotkey(help, ev({ key: '?', ctrlKey: true, shiftKey: true }), { isMac: false })
    ).toBe(false);
  });

  it('still honours an explicit Shift requirement on a character binding', () => {
    const hotkey = parseHotkey("Shift+'a'");
    expect(matchesHotkey(hotkey, ev({ key: 'a', shiftKey: true }), { isMac: false })).toBe(true);
    expect(matchesHotkey(hotkey, ev({ key: 'a' }), { isMac: false })).toBe(false);
  });

  it('matches a modifier-only hotkey on modifier state alone', () => {
    const hotkey = parseHotkey('Cmd+Shift');
    expect(
      matchesHotkey(hotkey, ev({ key: 'Shift', metaKey: true, shiftKey: true }), { isMac: true })
    ).toBe(true);
    expect(matchesHotkey(hotkey, ev({ key: 'Shift', shiftKey: true }), { isMac: true })).toBe(
      false
    );
  });

  it('distinguishes sides when given tracked modifier state', () => {
    const hotkey = parseHotkey('CtrlLeft+K');
    const event = ev({ key: 'k', code: 'KeyK', ctrlKey: true });
    expect(matchesHotkey(hotkey, event, { isMac: false, stateMask: MOD.CTRL_LEFT })).toBe(true);
    expect(matchesHotkey(hotkey, event, { isMac: false, stateMask: MOD.CTRL_RIGHT })).toBe(false);
  });
});

/* ─────────────────────────────  Listener  ──────────────────────────────── */

/** Minimal EventTarget stand-in so the listener can be driven synchronously. */
function createFakeTarget() {
  const handlers = new Map<string, Set<(event: unknown) => void>>();
  return {
    addEventListener(type: string, handler: (event: unknown) => void) {
      const set = handlers.get(type) ?? new Set();
      set.add(handler);
      handlers.set(type, set);
    },
    removeEventListener(type: string, handler: (event: unknown) => void) {
      handlers.get(type)?.delete(handler);
    },
    dispatch(type: string, event: unknown) {
      handlers.get(type)?.forEach((handler) => handler(event));
    },
    count(type: string) {
      return handlers.get(type)?.size ?? 0;
    },
  };
}

const domEvent = (
  code: string,
  key: string,
  flags: Partial<Record<'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey', boolean>> = {}
) =>
  ({
    code,
    key,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    metaKey: false,
    ...flags,
  }) as unknown as KeyboardEvent;

describe('createKeyboardListener', () => {
  it('tracks which side of a modifier is held', () => {
    const target = createFakeTarget();
    const listener = createKeyboardListener(target as never);

    target.dispatch('keydown', domEvent('ControlLeft', 'Control', { ctrlKey: true }));
    expect(listener.modifiers()).toBe(MOD.CTRL_LEFT);

    target.dispatch('keyup', domEvent('ControlLeft', 'Control', { ctrlKey: false }));
    expect(listener.modifiers()).toBe(MOD.NONE);

    target.dispatch('keydown', domEvent('ControlRight', 'Control', { ctrlKey: true }));
    expect(listener.modifiers()).toBe(MOD.CTRL_RIGHT);

    listener.stop();
  });

  it('emits canonical keys for real keys and null for modifier keys', () => {
    const target = createFakeTarget();
    const listener = createKeyboardListener(target as never);
    const seen: TrackedKeyEvent[] = [];
    listener.subscribe((event) => seen.push(event));

    target.dispatch('keydown', domEvent('ShiftLeft', 'Shift', { shiftKey: true }));
    target.dispatch('keydown', domEvent('KeyK', 'K', { shiftKey: true }));

    expect(seen).toHaveLength(2);
    expect(seen[0]!.key).toBeNull();
    expect(seen[0]!.changedModifier).toBe(MOD.SHIFT_LEFT);
    expect(seen[1]!.key).toBe('K');
    expect(seen[1]!.modifiers).toBe(MOD.SHIFT_LEFT);

    listener.stop();
  });

  it('reconciles state when a modifier was released while unfocused', () => {
    const target = createFakeTarget();
    const listener = createKeyboardListener(target as never);

    target.dispatch('keydown', domEvent('AltLeft', 'Alt', { altKey: true }));
    expect(listener.modifiers()).toBe(MOD.ALT_LEFT);

    // Alt-tab away and back: the release never arrived, but the next event
    // reports altKey false, which must drop the stale flag.
    target.dispatch('keydown', domEvent('KeyA', 'a'));
    expect(listener.modifiers()).toBe(MOD.NONE);

    // A modifier already held when focus returns is recorded as "either side".
    target.dispatch('keydown', domEvent('KeyB', 'b', { metaKey: true }));
    expect(listener.modifiers()).toBe(MOD.META);

    listener.stop();
  });

  it('clears all modifier state on blur', () => {
    const target = createFakeTarget();
    const listener = createKeyboardListener(target as never);

    target.dispatch('keydown', domEvent('ShiftLeft', 'Shift', { shiftKey: true }));
    expect(listener.modifiers()).toBe(MOD.SHIFT_LEFT);

    target.dispatch('blur', {});
    expect(listener.modifiers()).toBe(MOD.NONE);

    listener.stop();
  });

  it('unsubscribes cleanly and detaches every DOM listener on stop', () => {
    const target = createFakeTarget();
    const listener = createKeyboardListener(target as never);
    let calls = 0;
    const unsubscribe = listener.subscribe(() => calls++);

    target.dispatch('keydown', domEvent('KeyA', 'a'));
    expect(calls).toBe(1);

    unsubscribe();
    target.dispatch('keydown', domEvent('KeyA', 'a'));
    expect(calls).toBe(1);

    listener.stop();
    expect(target.count('keydown')).toBe(0);
    expect(target.count('keyup')).toBe(0);
    expect(target.count('blur')).toBe(0);
  });
});

describe('hotkeyFromTrackedEvent', () => {
  const tracked = (over: Partial<TrackedKeyEvent>): TrackedKeyEvent => ({
    modifiers: MOD.NONE,
    key: null,
    char: '',
    isKeyDown: true,
    changedModifier: null,
    domEvent: domEvent('KeyA', 'a'),
    ...over,
  });

  it('builds a full hotkey once a real key is pressed', () => {
    const hotkey = hotkeyFromTrackedEvent(tracked({ modifiers: MOD.CTRL_LEFT, key: 'K' }));
    expect(hotkey).toEqual({ modifiers: MOD.CTRL_LEFT, key: 'K', matchOn: 'code' });
  });

  it('builds a modifier-only hotkey while only modifiers are held', () => {
    const hotkey = hotkeyFromTrackedEvent(tracked({ modifiers: MOD.META | MOD.SHIFT }));
    expect(hotkey).toEqual({ modifiers: MOD.META | MOD.SHIFT, key: null, matchOn: 'code' });
  });

  it('returns null when nothing is held', () => {
    expect(hotkeyFromTrackedEvent(tracked({}))).toBeNull();
  });

  it('round-trips a recorded hotkey through the spec string', () => {
    const hotkey = hotkeyFromTrackedEvent(tracked({ modifiers: MOD.CTRL, key: 'Slash' }))!;
    expect(hotkeyToString(hotkey)).toBe('Ctrl+Slash');
    expect(parseHotkey(hotkeyToString(hotkey))).toEqual(hotkey);
  });
});
