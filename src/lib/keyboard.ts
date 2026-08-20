/**
 * Cross-platform keyboard / hotkey engine.
 *
 * A self-contained port of the model used by the `handy-keys` Rust crate
 * (https://github.com/handy-computer/handy-keys), adapted to the browser
 * `KeyboardEvent` world that a Tauri webview lives in. It has no dependencies
 * and no platform-specific code — everything is derived from the DOM event.
 *
 * What it brings over ad-hoc `e.ctrlKey && e.key === 'k'` checks:
 *
 *  - **One portable spec string.** `"Mod+Shift+K"` means ⌘⇧K on macOS and
 *    Ctrl+Shift+K everywhere else, so a stored binding is machine-portable.
 *  - **Side-aware modifiers.** `LCtrl`, `CtrlRight`, `AltGr`… parse, format,
 *    and (with `createKeyboardListener`) match distinctly.
 *  - **Modifier-only hotkeys.** `"Cmd+Shift"` with no key is a valid hotkey.
 *  - **Layout-independent matching.** Keys match on `KeyboardEvent.code`
 *    (physical position) by default, so Ctrl+Z stays on the same physical key
 *    regardless of the active keyboard layout.
 *  - **Character matching when you want the label, not the position.** A
 *    quoted token — `"Shift+'?'"` — matches `KeyboardEvent.key` instead, which
 *    is what you want for a "press ? for help" style binding.
 *  - **Strict modifier semantics.** Ctrl+Alt+K never fires a Ctrl+K binding.
 *
 * NOT included: OS-level global hotkeys. Capturing keys while the app is not
 * focused needs privileged platform hooks (CGEventTap + accessibility grants on
 * macOS, `WH_KEYBOARD_LL` on Windows, evdev + udev rules on Linux). Reach for
 * `tauri-plugin-global-shortcut` on the Rust side for that; the spec strings
 * here are intentionally compatible with its `CmdOrCtrl+Shift+K` accelerator
 * syntax, so the same string can drive both.
 */

/* ────────────────────────────────  Platform  ─────────────────────────────── */

/**
 * True when running on a macOS host. `navigator.userAgentData` is Chromium-only
 * (WebView2 / WebKitGTK); macOS runs WKWebView, so the deprecated-but-universal
 * `navigator.platform` and the user-agent string are the fallbacks.
 */
export const IS_MAC: boolean = (() => {
  if (typeof navigator === 'undefined') return false;
  const uaData = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
  return /mac/i.test(uaData?.platform ?? navigator.platform ?? navigator.userAgent ?? '');
})();

/* ───────────────────────────────  Modifiers  ─────────────────────────────── */

/**
 * Modifier bit flags. Each physical modifier has a left and a right bit; the
 * compound constants (`CTRL`, `ALT`, …) are both sides OR-ed together and mean
 * "either side".
 */
export const MOD = {
  NONE: 0,

  CTRL_LEFT: 1 << 0,
  CTRL_RIGHT: 1 << 1,
  ALT_LEFT: 1 << 2,
  ALT_RIGHT: 1 << 3,
  SHIFT_LEFT: 1 << 4,
  SHIFT_RIGHT: 1 << 5,
  META_LEFT: 1 << 6,
  META_RIGHT: 1 << 7,

  CTRL: (1 << 0) | (1 << 1),
  ALT: (1 << 2) | (1 << 3),
  SHIFT: (1 << 4) | (1 << 5),
  META: (1 << 6) | (1 << 7),

  /**
   * Virtual "primary" modifier — the one an OS uses for application commands.
   * Resolves to `META` (⌘) on macOS and `CTRL` everywhere else, at match and
   * format time rather than parse time, so a persisted spec stays portable
   * between a Mac and a PC.
   */
  PRIMARY: 1 << 8,
} as const;

/** A set of modifier flags, OR-ed together from `MOD`. */
export type ModifierMask = number;

interface ModifierGroup {
  readonly name: 'ctrl' | 'alt' | 'shift' | 'meta';
  readonly left: number;
  readonly right: number;
  readonly both: number;
  /** Reads the group's pressed state off a DOM keyboard event. */
  readonly isPressed: (event: ModifierFlags) => boolean;
}

/** The subset of `KeyboardEvent` the modifier helpers read. */
export interface ModifierFlags {
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

const MODIFIER_GROUPS: readonly ModifierGroup[] = [
  {
    name: 'ctrl',
    left: MOD.CTRL_LEFT,
    right: MOD.CTRL_RIGHT,
    both: MOD.CTRL,
    isPressed: (e) => e.ctrlKey,
  },
  {
    name: 'alt',
    left: MOD.ALT_LEFT,
    right: MOD.ALT_RIGHT,
    both: MOD.ALT,
    isPressed: (e) => e.altKey,
  },
  {
    name: 'shift',
    left: MOD.SHIFT_LEFT,
    right: MOD.SHIFT_RIGHT,
    both: MOD.SHIFT,
    isPressed: (e) => e.shiftKey,
  },
  {
    name: 'meta',
    left: MOD.META_LEFT,
    right: MOD.META_RIGHT,
    both: MOD.META,
    isPressed: (e) => e.metaKey,
  },
];

/**
 * Modifier spelling aliases, lowercased. Deliberately generous: specs are
 * written by humans and copied between projects that each have their own
 * conventions (`Cmd`, `Super`, `Win`, `Meta` all mean the same physical key).
 */
const MODIFIER_ALIASES: Readonly<Record<string, number>> = {
  // Platform-resolving primary modifier — also the Tauri/Electron spelling.
  mod: MOD.PRIMARY,
  cmdorctrl: MOD.PRIMARY,
  commandorcontrol: MOD.PRIMARY,
  cmdorcontrol: MOD.PRIMARY,

  // Either side.
  ctrl: MOD.CTRL,
  control: MOD.CTRL,
  alt: MOD.ALT,
  opt: MOD.ALT,
  option: MOD.ALT,
  shift: MOD.SHIFT,
  meta: MOD.META,
  cmd: MOD.META,
  command: MOD.META,
  super: MOD.META,
  win: MOD.META,
  windows: MOD.META,

  // Left side.
  ctrlleft: MOD.CTRL_LEFT,
  leftctrl: MOD.CTRL_LEFT,
  lctrl: MOD.CTRL_LEFT,
  controlleft: MOD.CTRL_LEFT,
  altleft: MOD.ALT_LEFT,
  leftalt: MOD.ALT_LEFT,
  lalt: MOD.ALT_LEFT,
  optleft: MOD.ALT_LEFT,
  optionleft: MOD.ALT_LEFT,
  shiftleft: MOD.SHIFT_LEFT,
  leftshift: MOD.SHIFT_LEFT,
  lshift: MOD.SHIFT_LEFT,
  metaleft: MOD.META_LEFT,
  cmdleft: MOD.META_LEFT,
  lcmd: MOD.META_LEFT,
  commandleft: MOD.META_LEFT,
  superleft: MOD.META_LEFT,
  winleft: MOD.META_LEFT,

  // Right side.
  ctrlright: MOD.CTRL_RIGHT,
  rightctrl: MOD.CTRL_RIGHT,
  rctrl: MOD.CTRL_RIGHT,
  controlright: MOD.CTRL_RIGHT,
  altright: MOD.ALT_RIGHT,
  rightalt: MOD.ALT_RIGHT,
  ralt: MOD.ALT_RIGHT,
  altgr: MOD.ALT_RIGHT,
  optright: MOD.ALT_RIGHT,
  optionright: MOD.ALT_RIGHT,
  shiftright: MOD.SHIFT_RIGHT,
  rightshift: MOD.SHIFT_RIGHT,
  rshift: MOD.SHIFT_RIGHT,
  metaright: MOD.META_RIGHT,
  cmdright: MOD.META_RIGHT,
  rcmd: MOD.META_RIGHT,
  commandright: MOD.META_RIGHT,
  superright: MOD.META_RIGHT,
  winright: MOD.META_RIGHT,
};

/** `KeyboardEvent.code` values that are modifier keys, mapped to their flag. */
const MODIFIER_CODES: Readonly<Record<string, number>> = {
  ControlLeft: MOD.CTRL_LEFT,
  ControlRight: MOD.CTRL_RIGHT,
  AltLeft: MOD.ALT_LEFT,
  AltRight: MOD.ALT_RIGHT,
  ShiftLeft: MOD.SHIFT_LEFT,
  ShiftRight: MOD.SHIFT_RIGHT,
  MetaLeft: MOD.META_LEFT,
  MetaRight: MOD.META_RIGHT,
  OSLeft: MOD.META_LEFT,
  OSRight: MOD.META_RIGHT,
};

/** Parses a single modifier token, or returns `null` when it isn't one. */
export function parseModifierToken(token: string): ModifierMask | null {
  return (
    MODIFIER_ALIASES[
      token
        .trim()
        .toLowerCase()
        .replace(/[_\-\s]/g, '')
    ] ?? null
  );
}

/** Replaces the virtual `PRIMARY` flag with the host platform's real modifier. */
export function resolveModifiers(mask: ModifierMask, isMac: boolean = IS_MAC): ModifierMask {
  if ((mask & MOD.PRIMARY) === 0) return mask;
  return (mask & ~MOD.PRIMARY) | (isMac ? MOD.META : MOD.CTRL);
}

/**
 * Builds a modifier mask from a DOM event's boolean flags.
 *
 * The booleans carry no side information, so each pressed modifier yields the
 * compound (both-sides) flag. That makes a side-specific pattern match either
 * side here; use `createKeyboardListener`, which tracks the individual
 * modifier key events, when a binding must distinguish left from right.
 */
export function modifiersFromEvent(event: ModifierFlags): ModifierMask {
  let mask = MOD.NONE;
  for (const group of MODIFIER_GROUPS) {
    if (group.isPressed(event)) mask |= group.both;
  }
  return mask;
}

/**
 * Tests a hotkey's modifier pattern against an actual modifier state.
 *
 * Per group: a compound requirement needs either side pressed, a side-specific
 * requirement needs that exact side, and a group the hotkey doesn't mention
 * must not be pressed at all — so `Ctrl+K` never fires on `Ctrl+Alt+K`.
 */
export function modifiersMatch(
  pattern: ModifierMask,
  state: ModifierMask,
  isMac: boolean = IS_MAC
): boolean {
  const wanted = resolveModifiers(pattern, isMac);

  for (const group of MODIFIER_GROUPS) {
    const wantsLeft = (wanted & group.left) !== 0;
    const wantsRight = (wanted & group.right) !== 0;
    const hasLeft = (state & group.left) !== 0;
    const hasRight = (state & group.right) !== 0;

    if (wantsLeft && wantsRight) {
      if (!hasLeft && !hasRight) return false;
    } else if (wantsLeft) {
      if (!hasLeft) return false;
    } else if (wantsRight) {
      if (!hasRight) return false;
    } else if (hasLeft || hasRight) {
      return false;
    }
  }
  return true;
}

/* ──────────────────────────────────  Keys  ───────────────────────────────── */

/**
 * Canonical key names, mapped from `KeyboardEvent.code` values that don't
 * follow the algorithmic `KeyA` / `Digit1` / `F5` / `Numpad3` patterns.
 */
const CODE_TO_KEY: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  NumpadEnter: 'KeypadEnter',
  Tab: 'Tab',
  Escape: 'Escape',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',

  Minus: 'Minus',
  Equal: 'Equal',
  BracketLeft: 'LeftBracket',
  BracketRight: 'RightBracket',
  Backslash: 'Backslash',
  Semicolon: 'Semicolon',
  Quote: 'Quote',
  Comma: 'Comma',
  Period: 'Period',
  Slash: 'Slash',
  Backquote: 'Grave',
  IntlBackslash: 'Section',

  NumpadDecimal: 'KeypadDecimal',
  NumpadMultiply: 'KeypadMultiply',
  NumpadAdd: 'KeypadPlus',
  NumpadSubtract: 'KeypadMinus',
  NumpadDivide: 'KeypadDivide',
  NumpadEqual: 'KeypadEquals',
  NumpadComma: 'KeypadComma',

  CapsLock: 'CapsLock',
  NumLock: 'NumLock',
  ScrollLock: 'ScrollLock',
  PrintScreen: 'PrintScreen',
  Pause: 'Pause',
  ContextMenu: 'ContextMenu',

  MediaPlayPause: 'PlayPause',
  MediaStop: 'Stop',
  MediaTrackPrevious: 'PrevTrack',
  MediaTrackNext: 'NextTrack',
};

/** Spelling aliases accepted when parsing a key token, lowercased. */
const KEY_ALIASES: Readonly<Record<string, string>> = {
  esc: 'Escape',
  escape: 'Escape',
  return: 'Enter',
  enter: 'Enter',
  space: 'Space',
  spacebar: 'Space',
  tab: 'Tab',
  backspace: 'Backspace',
  del: 'Delete',
  delete: 'Delete',
  forwarddelete: 'Delete',
  ins: 'Insert',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pgup: 'PageUp',
  pageup: 'PageUp',
  pgdn: 'PageDown',
  pagedown: 'PageDown',

  left: 'Left',
  leftarrow: 'Left',
  arrowleft: 'Left',
  right: 'Right',
  rightarrow: 'Right',
  arrowright: 'Right',
  up: 'Up',
  uparrow: 'Up',
  arrowup: 'Up',
  down: 'Down',
  downarrow: 'Down',
  arrowdown: 'Down',

  '-': 'Minus',
  minus: 'Minus',
  '=': 'Equal',
  equal: 'Equal',
  equals: 'Equal',
  '[': 'LeftBracket',
  leftbracket: 'LeftBracket',
  ']': 'RightBracket',
  rightbracket: 'RightBracket',
  '\\': 'Backslash',
  backslash: 'Backslash',
  ';': 'Semicolon',
  semicolon: 'Semicolon',
  "'": 'Quote',
  quote: 'Quote',
  ',': 'Comma',
  comma: 'Comma',
  '.': 'Period',
  period: 'Period',
  '/': 'Slash',
  slash: 'Slash',
  '`': 'Grave',
  grave: 'Grave',
  backtick: 'Grave',
  '§': 'Section',
  section: 'Section',

  keypaddecimal: 'KeypadDecimal',
  keypadmultiply: 'KeypadMultiply',
  keypadplus: 'KeypadPlus',
  keypadminus: 'KeypadMinus',
  keypaddivide: 'KeypadDivide',
  keypadenter: 'KeypadEnter',
  keypadequals: 'KeypadEquals',
  keypadcomma: 'KeypadComma',

  caps: 'CapsLock',
  capslock: 'CapsLock',
  numlock: 'NumLock',
  scroll: 'ScrollLock',
  scrolllock: 'ScrollLock',
  prtsc: 'PrintScreen',
  printscreen: 'PrintScreen',
  sysrq: 'PrintScreen',
  pause: 'Pause',
  break: 'Pause',
  menu: 'ContextMenu',
  apps: 'ContextMenu',
  contextmenu: 'ContextMenu',

  playpause: 'PlayPause',
  stop: 'Stop',
  prevtrack: 'PrevTrack',
  nexttrack: 'NextTrack',
};

/** Human-facing labels, when the canonical name isn't presentable as-is. */
const KEY_LABELS: Readonly<Record<string, string>> = {
  Minus: '-',
  Equal: '=',
  LeftBracket: '[',
  RightBracket: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Grave: '`',
  Section: '§',
};

/** Compact glyph labels used on macOS, matching platform shortcut conventions. */
const MAC_KEY_LABELS: Readonly<Record<string, string>> = {
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Escape: '⎋',
  Space: '␣',
  Left: '←',
  Right: '→',
  Up: '↑',
  Down: '↓',
  PageUp: '⇞',
  PageDown: '⇟',
  Home: '↖',
  End: '↘',
};

/** Canonicalizes a key token from a spec string, or `null` when unrecognized. */
function canonicalKeyFromToken(token: string): string | null {
  const trimmed = token.trim();
  if (trimmed === '') return null;

  const lower = trimmed.toLowerCase();

  if (/^[a-z]$/.test(lower)) return lower.toUpperCase();
  if (/^[0-9]$/.test(lower)) return lower;
  if (/^num[0-9]$/.test(lower)) return lower.slice(3);
  if (/^f([1-9]|1[0-9]|2[0-4])$/.test(lower)) return `F${lower.slice(1)}`;
  if (/^keypad[0-9]$/.test(lower)) return `Keypad${lower.slice(6)}`;

  return KEY_ALIASES[lower] ?? null;
}

/**
 * Canonicalizes `KeyboardEvent.code` (physical key position), or returns `null`
 * for modifier keys and codes this engine doesn't model.
 */
export function canonicalKeyFromCode(code: string): string | null {
  if (code in MODIFIER_CODES) return null;

  const letter = /^Key([A-Z])$/.exec(code);
  if (letter) return letter[1]!;

  const digit = /^Digit([0-9])$/.exec(code);
  if (digit) return digit[1]!;

  const fn = /^F([1-9]|1[0-9]|2[0-4])$/.exec(code);
  if (fn) return `F${fn[1]}`;

  const numpad = /^Numpad([0-9])$/.exec(code);
  if (numpad) return `Keypad${numpad[1]}`;

  return CODE_TO_KEY[code] ?? null;
}

/** Renders a canonical key name for display on the given platform. */
export function formatKey(key: string, isMac: boolean = IS_MAC): string {
  if (isMac && key in MAC_KEY_LABELS) return MAC_KEY_LABELS[key]!;
  return KEY_LABELS[key] ?? key;
}

/* ────────────────────────────────  Hotkeys  ──────────────────────────────── */

/**
 * How a hotkey's key part is compared against an event.
 *
 * - `code` — the physical key position (`KeyboardEvent.code`). Layout
 *   independent: Ctrl+Z stays on the same physical key on QWERTY and AZERTY.
 * - `char` — the produced character (`KeyboardEvent.key`). Follows the printed
 *   label and the active layout, which is what a "press `?` for help" binding
 *   wants. Written in a spec as a quoted token: `Shift+'?'`.
 */
export type KeyMatchMode = 'code' | 'char';

export interface Hotkey {
  readonly modifiers: ModifierMask;
  /** Canonical key name (`code` mode) or literal character (`char` mode). */
  readonly key: string | null;
  readonly matchOn: KeyMatchMode;
}

/** Thrown by `parseHotkey` when a spec string can't be understood. */
export class HotkeyParseError extends Error {
  constructor(
    message: string,
    readonly spec: string
  ) {
    super(message);
    this.name = 'HotkeyParseError';
  }
}

/**
 * Splits a spec on `+` while keeping quoted character tokens whole, so a
 * literal plus can be written as `Ctrl+'+'`.
 */
function splitSpecTokens(spec: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuote = false;

  for (const char of spec) {
    if (char === "'") {
      inQuote = !inQuote;
      current += char;
    } else if (char === '+' && !inQuote) {
      tokens.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  tokens.push(current);
  return tokens;
}

/**
 * Parses a hotkey spec such as `"Mod+Shift+K"`, `"Ctrl+Alt+Space"`, `"F5"`,
 * `"Cmd+Shift"` (modifier-only), or `"Shift+'?'"` (character match).
 *
 * @throws {HotkeyParseError} on an empty spec, an unknown token, or more than
 * one key token.
 */
export function parseHotkey(spec: string): Hotkey {
  const trimmed = spec.trim();
  if (trimmed === '') throw new HotkeyParseError('Hotkey spec is empty', spec);

  let modifiers = MOD.NONE;
  let key: string | null = null;
  let matchOn: KeyMatchMode = 'code';

  for (const rawToken of splitSpecTokens(trimmed)) {
    const token = rawToken.trim();
    if (token === '') continue;

    const modifier = parseModifierToken(token);
    if (modifier !== null) {
      modifiers |= modifier;
      continue;
    }

    if (key !== null) {
      throw new HotkeyParseError(
        `Hotkey has more than one key: already had "${key}", then found "${token}"`,
        spec
      );
    }

    // A quoted token selects character matching: 'a', '?', '€'.
    const quoted = /^'(.+)'$/.exec(token);
    if (quoted) {
      key = quoted[1]!;
      matchOn = 'char';
      continue;
    }

    const canonical = canonicalKeyFromToken(token);
    if (canonical === null) {
      throw new HotkeyParseError(`Unknown key or modifier: "${token}"`, spec);
    }
    key = canonical;
  }

  if (modifiers === MOD.NONE && key === null) {
    throw new HotkeyParseError('Hotkey must have at least one modifier or a key', spec);
  }

  return { modifiers, key, matchOn };
}

/** Parses a spec, returning `null` instead of throwing on invalid input. */
export function tryParseHotkey(spec: string): Hotkey | null {
  try {
    return parseHotkey(spec);
  } catch {
    return null;
  }
}

/** Canonical modifier token names used when rendering a spec string. */
const MODIFIER_SPEC_NAMES: Readonly<Record<ModifierGroup['name'], string>> = {
  ctrl: 'Ctrl',
  alt: 'Alt',
  shift: 'Shift',
  meta: 'Meta',
};

/**
 * Renders a hotkey back to a canonical spec string that `parseHotkey` accepts,
 * for persistence. Round-trips: `parseHotkey(hotkeyToString(h))` equals `h`.
 */
export function hotkeyToString(hotkey: Hotkey): string {
  const parts: string[] = [];

  if ((hotkey.modifiers & MOD.PRIMARY) !== 0) parts.push('Mod');

  for (const group of MODIFIER_GROUPS) {
    const name = MODIFIER_SPEC_NAMES[group.name];
    const hasLeft = (hotkey.modifiers & group.left) !== 0;
    const hasRight = (hotkey.modifiers & group.right) !== 0;
    if (hasLeft && hasRight) parts.push(name);
    else if (hasLeft) parts.push(`${name}Left`);
    else if (hasRight) parts.push(`${name}Right`);
  }

  if (hotkey.key !== null) {
    parts.push(hotkey.matchOn === 'char' ? `'${hotkey.key}'` : hotkey.key);
  }
  return parts.join('+');
}

/**
 * Renders a hotkey for display, using the host platform's conventions:
 * `⌃⌥⇧⌘K` on macOS and `Ctrl+Alt+Shift+Win+K` elsewhere.
 */
export function formatHotkey(hotkey: Hotkey, isMac: boolean = IS_MAC): string {
  const resolved = resolveModifiers(hotkey.modifiers, isMac);
  const parts: string[] = [];

  const labels: Record<ModifierGroup['name'], string> = isMac
    ? { ctrl: '⌃', alt: '⌥', shift: '⇧', meta: '⌘' }
    : { ctrl: 'Ctrl', alt: 'Alt', shift: 'Shift', meta: 'Win' };

  for (const group of MODIFIER_GROUPS) {
    const hasLeft = (resolved & group.left) !== 0;
    const hasRight = (resolved & group.right) !== 0;
    if (!hasLeft && !hasRight) continue;

    const label = labels[group.name];
    // Only annotate a side when the binding is genuinely side-specific.
    if (hasLeft && hasRight) parts.push(label);
    else parts.push(isMac ? `${label}${hasLeft ? 'L' : 'R'}` : `${hasLeft ? 'L' : 'R'}${label}`);
  }

  if (hotkey.key !== null) {
    parts.push(hotkey.matchOn === 'char' ? hotkey.key : formatKey(hotkey.key, isMac));
  }

  return parts.join(isMac ? '' : '+');
}

/** Convenience: parse a spec and render it for the host platform. */
export function formatHotkeySpec(spec: string, isMac: boolean = IS_MAC): string {
  const hotkey = tryParseHotkey(spec);
  return hotkey === null ? spec : formatHotkey(hotkey, isMac);
}

/** The subset of `KeyboardEvent` that hotkey matching reads. */
export interface MatchableKeyEvent extends ModifierFlags {
  key: string;
  code?: string | undefined;
}

/**
 * Tests whether a `keydown` event triggers a hotkey.
 *
 * Pass `stateMask` to match against side-aware modifier state tracked by
 * `createKeyboardListener`; without it the state is derived from the event's
 * boolean flags, which cannot distinguish left from right.
 *
 * A modifier-only hotkey (`key === null`) matches purely on modifier state, so
 * it will match repeatedly while held — drive those from a listener, which
 * reports the transitions.
 */
export function matchesHotkey(
  hotkey: Hotkey,
  event: MatchableKeyEvent,
  options: { isMac?: boolean; stateMask?: ModifierMask } = {}
): boolean {
  const isMac = options.isMac ?? IS_MAC;
  let state = options.stateMask ?? modifiersFromEvent(event);

  // A character-matched binding has Shift baked into the character it names —
  // `?` *is* Shift+/ on a US layout. Holding Shift to type it must therefore not
  // trip the "no unexpected modifiers" rule, or the binding could never fire.
  // A pattern that asks for Shift explicitly is still checked normally.
  if (hotkey.matchOn === 'char' && (resolveModifiers(hotkey.modifiers, isMac) & MOD.SHIFT) === 0) {
    state &= ~MOD.SHIFT;
  }

  if (!modifiersMatch(hotkey.modifiers, state, isMac)) return false;
  if (hotkey.key === null) return true;

  if (hotkey.matchOn === 'char') {
    return event.key.toLowerCase() === hotkey.key.toLowerCase();
  }

  // Physical position first; fall back to the character for environments that
  // don't populate `code` (older webviews, synthetic events, some IMEs).
  const fromCode = event.code === undefined ? null : canonicalKeyFromCode(event.code);
  if (fromCode !== null) return fromCode === hotkey.key;
  return canonicalKeyFromToken(event.key) === hotkey.key;
}

/* ───────────────────────────────  Listener  ──────────────────────────────── */

/** A keyboard event enriched with side-aware modifier state. */
export interface TrackedKeyEvent {
  /** Side-aware modifier mask at the time of the event. */
  modifiers: ModifierMask;
  /** Canonical key name, or `null` when the event is a modifier key itself. */
  key: string | null;
  /** The raw produced character (`KeyboardEvent.key`), for `char` matching. */
  char: string;
  isKeyDown: boolean;
  /** Which modifier flag changed, when this event was a modifier key. */
  changedModifier: ModifierMask | null;
  /** The originating DOM event, for `preventDefault` and target checks. */
  domEvent: KeyboardEvent;
}

export interface KeyboardListener {
  /** Current side-aware modifier mask. */
  modifiers: () => ModifierMask;
  /** Subscribes to key events; returns an unsubscribe function. */
  subscribe: (listener: (event: TrackedKeyEvent) => void) => () => void;
  /** Detaches all DOM listeners. */
  stop: () => void;
}

/**
 * Streams keyboard events with side-aware modifier tracking — the webview
 * analogue of handy-keys' `KeyboardListener`, and what a "record a shortcut"
 * flow needs.
 *
 * The DOM only reveals which side of a modifier was pressed on the modifier
 * key's own event, so the state is accumulated across events. After every
 * event it is reconciled against the event's boolean flags, which self-heals
 * the state when a modifier is released while the window is unfocused, and it
 * is cleared outright on blur.
 */
export function createKeyboardListener(
  target: Pick<Window, 'addEventListener' | 'removeEventListener'> = window
): KeyboardListener {
  let mask: ModifierMask = MOD.NONE;
  const listeners = new Set<(event: TrackedKeyEvent) => void>();

  /** Drops side bits for groups the event reports as released, and vice versa. */
  const reconcile = (event: KeyboardEvent) => {
    for (const group of MODIFIER_GROUPS) {
      const pressed = group.isPressed(event);
      const tracked = (mask & group.both) !== 0;
      if (!pressed && tracked) {
        mask &= ~group.both;
      } else if (pressed && !tracked) {
        // Pressed but we never saw which side (e.g. held across a focus change)
        // — record it as "either side".
        mask |= group.both;
      }
    }
  };

  const emit = (event: KeyboardEvent, isKeyDown: boolean) => {
    const changedModifier = MODIFIER_CODES[event.code] ?? null;
    if (changedModifier !== null) {
      if (isKeyDown) mask |= changedModifier;
      else mask &= ~changedModifier;
    }
    reconcile(event);

    const tracked: TrackedKeyEvent = {
      modifiers: mask,
      key: changedModifier !== null ? null : canonicalKeyFromCode(event.code),
      char: event.key,
      isKeyDown,
      changedModifier,
      domEvent: event,
    };
    listeners.forEach((listener) => listener(tracked));
  };

  const onKeyDown = (event: KeyboardEvent) => emit(event, true);
  const onKeyUp = (event: KeyboardEvent) => emit(event, false);
  const onBlur = () => {
    mask = MOD.NONE;
  };

  target.addEventListener('keydown', onKeyDown);
  target.addEventListener('keyup', onKeyUp);
  target.addEventListener('blur', onBlur);

  return {
    modifiers: () => mask,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop: () => {
      listeners.clear();
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
    },
  };
}

/* ─────────────────────────────  Capture guard  ───────────────────────────── */

let captureDepth = 0;

/**
 * True while a "record a shortcut" flow owns the keyboard.
 *
 * Global key handlers must bail out when this is set, otherwise pressing the
 * chord you are trying to bind also *triggers* whatever is currently bound to
 * it. A shared flag is used rather than `stopPropagation`, because listeners
 * attached to the same target can't reliably stop one another.
 */
export function isCapturingHotkey(): boolean {
  return captureDepth > 0;
}

/** Claims the keyboard for a recording flow. Call the returned function to release. */
export function beginHotkeyCapture(): () => void {
  captureDepth += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    captureDepth = Math.max(0, captureDepth - 1);
  };
}

/**
 * Builds the hotkey a tracked event represents — the "record a shortcut"
 * primitive. Returns `null` while the press can't yet form a hotkey (nothing
 * held at all).
 *
 * A press of a real key finalizes the recording; a press of only modifiers
 * yields a provisional modifier-only hotkey, which is both a valid binding in
 * its own right and the live preview to show while the user is still typing.
 */
export function hotkeyFromTrackedEvent(event: TrackedKeyEvent): Hotkey | null {
  if (event.key === null) {
    return event.modifiers === MOD.NONE
      ? null
      : { modifiers: event.modifiers, key: null, matchOn: 'code' };
  }
  return { modifiers: event.modifiers, key: event.key, matchOn: 'code' };
}
