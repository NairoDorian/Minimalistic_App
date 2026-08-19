/**
 * Application shortcut registry — single source of truth for what the app
 * listens for, what the cheat sheet documents, and what the user has rebound.
 *
 * Bindings are portable spec strings parsed by `./keyboard` (`'Mod+1'` is ⌘1 on
 * macOS and Ctrl+1 elsewhere), so the same persisted value works on any host.
 * User overrides live in localStorage and fall back to the defaults below, and
 * an override that no longer parses is ignored rather than breaking the binding.
 */

import {
  IS_MAC,
  formatHotkey,
  hotkeyToString,
  matchesHotkey,
  parseHotkey,
  tryParseHotkey,
  type Hotkey,
  type MatchableKeyEvent,
  type ModifierMask,
} from './keyboard';
import { storageKey } from './appMeta';

export { IS_MAC } from './keyboard';

/** What triggering a shortcut does. Dispatched by the handler in `App.tsx`. */
export type ShortcutAction =
  | 'tab-preferences'
  | 'tab-about'
  | 'tab-developer'
  | 'toggle-shortcuts'
  | 'close-modal';

/** Stable per-binding identity, so a rebind can target one row precisely. */
export type ShortcutId =
  | 'go-preferences'
  | 'go-about'
  | 'go-developer'
  | 'open-preferences'
  | 'show-shortcuts'
  | 'show-shortcuts-alt'
  | 'close-modal';

export type ShortcutCategory = 'Navigation' | 'Actions' | 'General';

export interface ShortcutDefinition {
  readonly id: ShortcutId;
  readonly action: ShortcutAction;
  /** Portable default spec (see `./keyboard`), used until the user rebinds. */
  readonly defaultSpec: string;
  readonly description: string;
  readonly category: ShortcutCategory;
  /** Fixed bindings (e.g. Escape closes a dialog) are not user-rebindable. */
  readonly fixed?: boolean;
}

export const APP_SHORTCUTS: readonly ShortcutDefinition[] = [
  {
    id: 'go-preferences',
    action: 'tab-preferences',
    defaultSpec: 'Mod+1',
    description: 'Switch to Preferences tab',
    category: 'Navigation',
  },
  {
    id: 'go-about',
    action: 'tab-about',
    defaultSpec: 'Mod+2',
    description: 'Switch to System & About tab',
    category: 'Navigation',
  },
  {
    id: 'go-developer',
    action: 'tab-developer',
    defaultSpec: 'Mod+3',
    description: 'Switch to Developer Hub tab',
    category: 'Navigation',
  },
  {
    id: 'open-preferences',
    action: 'tab-preferences',
    defaultSpec: 'Mod+Comma',
    description: 'Open Preferences',
    category: 'Navigation',
  },
  {
    id: 'show-shortcuts',
    action: 'toggle-shortcuts',
    defaultSpec: 'Mod+Slash',
    description: 'Show Keyboard Shortcuts cheat sheet',
    category: 'General',
  },
  {
    // Character-matched: this one should follow the printed `?`, wherever the
    // active keyboard layout puts it, rather than a physical key position.
    id: 'show-shortcuts-alt',
    action: 'toggle-shortcuts',
    defaultSpec: "'?'",
    description: 'Show Keyboard Shortcuts cheat sheet',
    category: 'General',
  },
  {
    id: 'close-modal',
    action: 'close-modal',
    defaultSpec: 'Escape',
    description: 'Close active modal / dialog',
    category: 'General',
    fixed: true,
  },
];

/** Categories that actually have shortcuts, in declaration order. */
export const SHORTCUT_CATEGORIES: readonly ShortcutCategory[] = [
  ...new Set(APP_SHORTCUTS.map((sc) => sc.category)),
];

const SHORTCUTS_BY_ID = new Map(APP_SHORTCUTS.map((sc) => [sc.id, sc]));

/* ─────────────────────────────  User overrides  ──────────────────────────── */

const OVERRIDES_STORAGE_KEY = storageKey('shortcut_overrides');

type OverrideMap = Partial<Record<ShortcutId, string>>;

let overrides: OverrideMap = {};
const listeners = new Set<() => void>();

/** Reads persisted overrides, dropping anything that no longer parses. */
function readOverrides(): OverrideMap {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(OVERRIDES_STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};

  const result: OverrideMap = {};
  for (const [id, spec] of Object.entries(parsed as Record<string, unknown>)) {
    // A stored binding is only honoured if it still names a known shortcut and
    // still parses — a stale or hand-edited entry must never disable a binding.
    if (!SHORTCUTS_BY_ID.has(id as ShortcutId)) continue;
    if (typeof spec !== 'string' || tryParseHotkey(spec) === null) continue;
    result[id as ShortcutId] = spec;
  }
  return result;
}

function persistOverrides(): void {
  try {
    if (Object.keys(overrides).length === 0) localStorage.removeItem(OVERRIDES_STORAGE_KEY);
    else localStorage.setItem(OVERRIDES_STORAGE_KEY, JSON.stringify(overrides));
  } catch {
    /* storage unavailable — the rebind still applies for this session */
  }
}

function notify(): void {
  listeners.forEach((listener) => listener());
}

overrides = readOverrides();

/** Subscribes to binding changes; fires immediately, returns an unsubscribe. */
export function subscribeShortcuts(listener: () => void): () => void {
  listeners.add(listener);
  listener();
  return () => {
    listeners.delete(listener);
  };
}

/** The spec currently bound to a shortcut — the user's override or the default. */
export function getShortcutSpec(id: ShortcutId): string {
  return overrides[id] ?? SHORTCUTS_BY_ID.get(id)?.defaultSpec ?? '';
}

/** True when the shortcut is currently using a user-supplied binding. */
export function isShortcutOverridden(id: ShortcutId): boolean {
  return overrides[id] !== undefined;
}

/**
 * Rebinds a shortcut. Passing `null` clears the override and restores the
 * default. Returns `false` (changing nothing) when the spec doesn't parse or
 * the shortcut is fixed.
 */
export function setShortcutSpec(id: ShortcutId, spec: string | null): boolean {
  const definition = SHORTCUTS_BY_ID.get(id);
  if (!definition || definition.fixed === true) return false;

  if (spec === null) {
    if (overrides[id] === undefined) return true;
    const { [id]: _removed, ...rest } = overrides;
    overrides = rest;
  } else {
    const hotkey = tryParseHotkey(spec);
    if (hotkey === null) return false;
    const canonical = hotkeyToString(hotkey);
    // Rebinding back to the default is a reset, not an override, so the
    // shortcut keeps tracking the default if it ever changes.
    if (canonical === hotkeyToString(parseHotkey(definition.defaultSpec))) {
      const { [id]: _removed, ...rest } = overrides;
      overrides = rest;
    } else {
      overrides = { ...overrides, [id]: canonical };
    }
  }

  persistOverrides();
  notify();
  return true;
}

/** Clears every user override, restoring all default bindings. */
export function resetShortcuts(): void {
  overrides = {};
  persistOverrides();
  notify();
}

/**
 * Shortcuts other than `id` that resolve to the same binding — surfaced by the
 * rebinding UI so two commands never silently fight over one chord.
 */
export function findShortcutConflicts(id: ShortcutId, spec: string): ShortcutDefinition[] {
  const candidate = tryParseHotkey(spec);
  if (candidate === null) return [];
  const canonical = hotkeyToString(candidate);

  return APP_SHORTCUTS.filter((sc) => {
    if (sc.id === id) return false;
    // Bindings that trigger the same action aren't in conflict — they are
    // deliberate alternates (Ctrl+/ and ? both open the cheat sheet).
    if (sc.action === SHORTCUTS_BY_ID.get(id)?.action) return false;
    const other = tryParseHotkey(getShortcutSpec(sc.id));
    return other !== null && hotkeyToString(other) === canonical;
  });
}

/* ────────────────────────────  Formatting & matching  ────────────────────── */

/** Renders a shortcut's current binding for the host platform (`⌘1` / `Ctrl+1`). */
export function formatShortcutLabel(
  shortcut: ShortcutDefinition | ShortcutId,
  isMac: boolean = IS_MAC
): string {
  const id = typeof shortcut === 'string' ? shortcut : shortcut.id;
  const spec = getShortcutSpec(id);
  const hotkey = tryParseHotkey(spec);
  return hotkey === null ? spec : formatHotkey(hotkey, isMac);
}

/** The parsed hotkey a shortcut is currently bound to, or `null` if unparseable. */
export function getShortcutHotkey(id: ShortcutId): Hotkey | null {
  return tryParseHotkey(getShortcutSpec(id));
}

/**
 * Resolves the action bound to a `keydown` event, or `null` when unbound.
 *
 * `stateMask` accepts side-aware modifier state from a
 * `createKeyboardListener`; without it the event's boolean flags are used,
 * which cannot tell left from right.
 */
export function resolveShortcutAction(
  event: MatchableKeyEvent,
  options: { isMac?: boolean; stateMask?: ModifierMask } = {}
): ShortcutAction | null {
  for (const shortcut of APP_SHORTCUTS) {
    const hotkey = getShortcutHotkey(shortcut.id);
    if (hotkey !== null && matchesHotkey(hotkey, event, options)) return shortcut.action;
  }
  return null;
}
