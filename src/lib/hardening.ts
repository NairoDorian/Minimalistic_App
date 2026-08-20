/**
 * Frontend half of "this is an application, not a web page".
 *
 * The backend counterpart, `src-tauri/src/webview_hardening.rs`, switches the
 * browser accelerators off inside WebView2. That is the better fix — the
 * keystroke never becomes a browser command — but it exists only on Windows.
 * macOS (WKWebView) and Linux (WebKitGTK) expose no equivalent flag, so on
 * those platforms this module *is* the fix, via `preventDefault`.
 *
 * It also covers three things no engine flag addresses at all:
 *
 * - **Dropped files navigating the app away.** Dragging any file onto a webview
 *   makes it navigate to that file. In a browser tab that is a feature. In a
 *   desktop app the entire UI is replaced by a PDF viewer or a raw XML dump,
 *   with no back button, and the only recovery is restarting the app. This is
 *   the single most destructive default in the list.
 * - **The browser context menu**, which offers Reload, Back, and View Source —
 *   none of which mean anything here.
 * - **Text selection drag** of non-content chrome, which makes a tidy UI look
 *   like a half-selected document.
 *
 * ## What is deliberately *not* blocked
 *
 * - `Ctrl/Cmd+C`, `Ctrl/Cmd+V`, `Ctrl/Cmd+X`, `Ctrl/Cmd+A`, `Ctrl/Cmd+Z` —
 *   these are OS text-editing shortcuts, not browser ones. Blocking them breaks
 *   every input in the app.
 * - Anything at all while focus is in a text field. A user pressing Ctrl+A in a
 *   textarea means "select this text", never "select the whole document".
 * - Everything, in a development build. `F5` and devtools are how the frontend
 *   gets worked on; see {@link installWebviewHardening} for the switch.
 *
 * ## Why a module and not four lines in `main.tsx`
 *
 * Each rule below is a decision with a reason and a counter-argument, and the
 * reasons are the valuable part. Inline, they would be four unexplained
 * `preventDefault` calls that the next person deletes.
 *
 * ## Why the handlers are built per install
 *
 * They capture nothing, so a linter will suggest hoisting them to module scope.
 * Don't. `removeEventListener` matches on function *identity*, and
 * `addEventListener` silently ignores a duplicate `(type, listener, capture)`
 * triple. Module-scoped handlers shared between two installs on the same target
 * would therefore register once and let the *first* teardown disarm the
 * *second* install — a bug that only appears once someone calls this from a
 * component instead of from the entry module, which is exactly what a template
 * should expect people to do. Fresh closures cost one allocation per app start
 * and make each install/teardown pair independent.
 * (`unicorn/consistent-function-scoping` is switched off for this file in
 * `.oxlintrc.json`; the rule reports at the enclosing function, so it cannot be
 * suppressed inline on the handlers themselves.)
 */

import { isTextEntryTarget } from './keyboard';
import { isTauri } from './tauri';

/**
 * Browser shortcuts to suppress, as `[requiresModifier, key]` pairs.
 *
 * Keys are compared case-insensitively against `KeyboardEvent.key`, so the
 * table stays readable and layout-independent — matching on `code` would bind
 * physical positions, which is wrong for a shortcut users think of by letter.
 *
 * Each entry carries the damage it prevents, because "why is Ctrl+P blocked?"
 * is a question that will be asked.
 */
const BLOCKED_SHORTCUTS: readonly {
  readonly key: string;
  /** True when the key only misbehaves with Ctrl/Cmd held. */
  readonly withModifier: boolean;
  readonly reason: string;
}[] = [
  { key: 'r', withModifier: true, reason: 'Reload — destroys all in-memory app state' },
  { key: 'f5', withModifier: false, reason: 'Reload — destroys all in-memory app state' },
  { key: 'p', withModifier: true, reason: 'Print dialog for the app’s own UI' },
  { key: 'f', withModifier: true, reason: 'Browser find bar drawn over the app' },
  { key: 'g', withModifier: true, reason: 'Find-again, same problem as Ctrl+F' },
  { key: 'u', withModifier: true, reason: 'View source' },
  { key: 's', withModifier: true, reason: 'Save page as HTML' },
  { key: 'o', withModifier: true, reason: 'Open file — navigates away from the app' },
  { key: '+', withModifier: true, reason: 'Zoom — breaks a fixed desktop layout' },
  { key: '=', withModifier: true, reason: 'Zoom in (unshifted +)' },
  { key: '-', withModifier: true, reason: 'Zoom out' },
  { key: '0', withModifier: true, reason: 'Zoom reset' },
];

/**
 * Decides whether a keydown is a browser shortcut worth swallowing.
 *
 * Exported for the unit tests: the rules are the interesting part, and testing
 * them through a real DOM listener would test the listener instead.
 *
 * @param event - Only the fields that matter, so tests need no DOM event.
 * @returns The reason it was blocked, or `null` to let it through.
 */
export function blockedShortcutReason(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  target?: EventTarget | null;
}): string | null {
  // Never interfere with typing. This check comes first because it outranks
  // every rule below — Ctrl+F in a search box is the user's, not the browser's.
  if (isTextEntryTarget(event.target ?? null)) return null;

  const key = event.key.toLowerCase();
  // Cmd on macOS, Ctrl elsewhere. Accepting either everywhere is intentional:
  // an external keyboard on a Mac sends Ctrl, and the shortcut is just as
  // unwanted then.
  const hasModifier = event.ctrlKey || event.metaKey;

  const match = BLOCKED_SHORTCUTS.find((entry) => entry.key === key);
  if (!match) return null;
  if (match.withModifier && !hasModifier) return null;

  return match.reason;
}

/** Options for {@link installWebviewHardening}. */
export interface HardeningOptions {
  /**
   * Overrides the default (`import.meta.env.PROD && isTauri`). Passing `true`
   * is how the tests exercise production behaviour; passing `false` from a
   * debug session is how you temporarily get `F5` back.
   */
  enabled?: boolean;
  /**
   * Where to attach the listeners. Defaults to `window`.
   *
   * Injectable so the tests can pass a bare `EventTarget` instead of pulling a
   * headless-DOM dependency into the whole suite for four `addEventListener`
   * calls. It is also the honest shape of the dependency: this function needs
   * an event target, not the global object.
   */
  target?: EventTarget;
}

/**
 * Installs the frontend hardening listeners.
 *
 * @returns A teardown function removing every listener, so a hot reload does
 *   not stack duplicates and a test can clean up after itself. Idempotent.
 *
 * Listeners are registered in the **capture** phase. Bubble-phase handlers run
 * after the target's own, and a component that calls `stopPropagation` on a
 * keydown would otherwise silently punch a hole in the hardening.
 */
export function installWebviewHardening(options?: HardeningOptions): () => void {
  // Two conditions, both required:
  //
  // - Production only. A dev build keeps F5, devtools, and zoom, because that
  //   is how the frontend is worked on.
  // - Inside Tauri only. Running the same page in a browser for a quick preview
  //   should behave like a browser — swallowing F5 there would be baffling.
  const enabled = options?.enabled ?? (import.meta.env.PROD && isTauri);
  if (!enabled) return () => {};

  // `globalThis.window` rather than a bare `window`: this module is imported by
  // the test process, where the identifier does not exist at all and a bare
  // reference would throw before `enabled` could even be consulted.
  const target = options?.target ?? (globalThis as { window?: EventTarget }).window;
  if (target === undefined) return () => {};

  // The four handlers below capture nothing and could technically be hoisted to
  // module scope — see the module docs for why they are not, and
  // `.oxlintrc.json` for the matching rule override.
  const onKeyDown = (event: Event) => {
    const reason = blockedShortcutReason(event as KeyboardEvent);
    if (reason === null) return;
    event.preventDefault();
    // Not logged: this fires on ordinary mistaken keypresses and would turn the
    // Dev Console into a stream of noise. The reason lives in the table above,
    // which is where someone debugging this will look.
  };

  const onContextMenu = (event: Event) => {
    // Text the user can select, they can also copy — so the menu stays
    // available over inputs and over anything explicitly opted back in with
    // `data-context-menu`, which is the escape hatch for a future custom menu.
    if (isTextEntryTarget(event.target)) return;
    const element = event.target as { closest?: (selector: string) => unknown } | null;
    if (typeof element?.closest === 'function' && element.closest('[data-context-menu]')) {
      return;
    }
    event.preventDefault();
  };

  // Suppressing *both* events is required, and skipping either leaves the bug.
  // `dragover` must be cancelled for the drop to be deliverable to us at all;
  // `drop` must be cancelled to stop the default navigation. Cancelling only
  // `drop` does nothing, because without a cancelled `dragover` the browser
  // never treats the element as a drop target in the first place.
  //
  // Tauri's own file-drop events (`onDragDropEvent`) are unaffected: they come
  // from the native window layer, not from these DOM events.
  const onDragOver = (event: Event) => event.preventDefault();
  const onDrop = (event: Event) => event.preventDefault();

  const listeners: readonly [string, (event: Event) => void][] = [
    ['keydown', onKeyDown],
    ['contextmenu', onContextMenu],
    ['dragover', onDragOver],
    ['drop', onDrop],
  ];

  for (const [type, handler] of listeners) {
    target.addEventListener(type, handler, { capture: true });
  }

  let removed = false;
  return () => {
    // Guarded so a double teardown — a hot reload racing an unmount — cannot
    // remove a *newly* installed listener by accident.
    if (removed) return;
    removed = true;
    for (const [type, handler] of listeners) {
      target.removeEventListener(type, handler, { capture: true });
    }
  };
}
