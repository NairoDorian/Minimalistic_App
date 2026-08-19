# Quick Development Cheat Sheet (CRUSH.md)

> Rapid reference and copy-paste code patterns for developers and AI agents working on **Minimalistic App**.

---

## ⚡ Core CLI Commands

```bash
# Development & Testing (Ultimate standard command)
bun run tauri dev              # Full Tauri desktop app in live dev mode
bun run dev:fast               # Same, with the fastest linker available (2.6x here)
bun run vite                   # Web-only preview in browser

# Quality Gates & Verification
bun test                       # Run the Bun frontend unit test suite
bun run typecheck              # Static TypeScript typecheck (tsc -b)
bun run lint                   # Code lint (oxlint — TS7-compatible)
bun run lint:fix               # Auto-fix lint issues
bun run format                 # Format all files (Prettier + cargo fmt)
bun run format:check           # Verify formatting without modifying files
bun run before-commit --check  # Verify version mirrors are in sync
bun run validate               # Run the full 8-gate pre-commit validation suite

# Production, Scaffolding & Maintenance
bun run rename-project         # 1-command project rebranding & customization CLI
bun run build                  # Compile production native desktop bundles
bun run arch                   # Regenerate ARCHITECTURE.md map
bun run create-icons           # Regenerate multi-platform app icons
bun run update-deps            # Automated @latest dependency upgrade pipeline
bun run clean                  # Purge compiled Rust target artifacts

# Local documentation mirrors (Tauri 2 / SolidJS 2 / Bun / TypeScript 7)
bun run docs:sync              # Clone or fast-forward every mirror into .docs/ (gitignored)
bun run docs:check             # Status table: branch, commit, freshness, size
bun run docs:find "<query>"    # Search all mirrors at once (translations excluded)
```

> **Read the mirror, not your memory.** `solid-docs` is pinned to `v2-rebuild`
> because `main` documents SolidJS 1.x — a different runtime. Full reading map:
> [`DOCUMENTATION.md`](DOCUMENTATION.md).

---

## 🦀 Rust Backend Patterns (`src-tauri/src/lib.rs`)

### 1. Poison-Safe Mutex Lock

```rust
fn lock_guard<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}
```

### 2. Tauri IPC Command Handler

```rust
#[tauri::command]
fn my_command(value: String, state: State<'_, AppState>) -> Result<String, String> {
    let settings = lock_guard(&state.settings);
    // Return Result with descriptive error strings
    Ok(format!("Received: {value}"))
}
```

### 3. Disk-First Atomic File Persistence

```rust
// 1. Write to temporary sibling file
let tmp_path = path.with_extension("tmp");
fs::write(&tmp_path, json_bytes)
    .map_err(|e| format!("Failed to write tmp settings: {e}"))?;

// 2. Atomically rename to target path
fs::rename(&tmp_path, path)
    .map_err(|e| format!("Failed to commit settings: {e}"))?;

// 3. Mutate in-memory state only AFTER disk write succeeds
*lock_guard(&state.settings) = new_settings;
```

### 4. Read-Modify-Write Under One Lock

Take the settings lock **once** and hold it across the disk write. Locking three
separate times lets a concurrent writer (another IPC command, or a window move
updating the in-memory geometry) slip in between the read and the write-back and
have its change silently discarded.

```rust
#[tauri::command]
fn set_flag(enabled: bool, state: State<'_, AppState>) -> Result<(), String> {
    let mut settings = lock_guard(&state.settings); // one guard for the whole RMW
    if settings.some_flag == enabled {
        return Ok(());
    }
    let mut next = settings.clone();
    next.some_flag = enabled;
    save_settings_to_disk(&state.settings_path, &next)?; // fail -> memory untouched
    *settings = next;
    Ok(())
}
```

### 5. Never Assume Managed State Exists in Window Events

Tauri creates configured windows **before** `setup()` runs, so a `Moved`/`Resized`
event can arrive before `app.manage(...)`. `state::<T>()` panics there — always
use `try_state`:

```rust
let Some(state) = window.try_state::<AppState>() else {
    return; // event fired before setup completed
};
```

---

## ⚛️ SolidJS 2 & TypeScript Frontend Patterns (`src/`)

### 1. Optimistic UI Toggle with Rollback

```tsx
const [checked, setChecked] = createSignal<boolean>(false);

const handleToggle = async (nextValue: boolean) => {
  const previous = checked();
  setChecked(nextValue); // Optimistic UI update
  try {
    await commands.setMinimizeToTray(nextValue);
  } catch (error: unknown) {
    setChecked(previous); // Rollback on failure
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Failed to update setting:', msg);
  }
};
```

### 2. Async Data → Writable Derived Signal → Loading Boundary

The SolidJS 2 shape for "read persisted state, let the user edit it". Never
`.then()` an IPC result into a pile of signals — the window between mount and
resolution is one where the UI shows placeholder values that a user click can
be silently overwritten by.

```tsx
// 1. One async memo for the whole read — async lives in the graph.
const persisted = createMemo(async (): Promise<PersistedPreferences> => {
  const settings = await commands.getAppSettings();
  return { settings, accent: resolveThemeAccent(settings.theme_accent) };
});

// 2. Writable derived signals: persisted value is the source, a toggle is a
//    local override on top of it.
const [minimizeToTray, setMinimizeToTray] = createSignal(
  () => persisted().settings.minimize_to_tray ?? false
);

// 3. Side effects live at the imperative boundary, never inside the memo.
createEffect(
  () => currentAccent(),
  (accent) => applyThemeAccent(accent)
);

// 4. A boundary scoped to the data-dependent rows — NOT the whole card.
//    Nothing inside is interactive until the read settles.
return (
  <div class="settings-card">
    <div class="settings-card-header">…</div> {/* stays put */}
    <Loading fallback={<PreferencesSkeleton />}>…rows…</Loading>
  </div>
);
```

Rules of thumb, straight from `.docs/solid-docs`:

- `createMemo(async …)` for a fetch — never an effect that writes a signal.
- `createSignal(fn)` for "derived, but locally overridable".
- `createEffect(compute, apply)` **only** at an imperative boundary (DOM, IPC
  write, subscription). Memo computes stay side-effect free.
- `onSettled(() => cleanup)` for component setup/teardown. `onCleanup` is for
  library internals now.
- Scope `<Loading>` to the smallest region its fallback should replace.

### 3. UpdateChecker Dual-Variant Rule

Exactly one instance may auto-check, and exactly one may listen — but they are
**not the same instance**, because the two jobs have different lifetimes.

```tsx
// Card variant (Preferences tab) — auto-checks on mount, gated on the saved
// preference. Mounted inside the tab's <Loading> boundary, so by the time it
// reads the preference the value is the persisted one, not a placeholder.
// Does NOT listen: this card unmounts whenever another tab is selected.
<UpdateChecker variant="card" autoCheckOnMount={checkUpdatesOnLaunch} listenForEvents={() => false} />

// Footer variant (status bar) — mounted for the whole session, so it owns the
// tray's "check-for-updates" event. Never auto-checks.
<UpdateChecker variant="footer" autoCheckOnMount={() => false} listenForEvents={() => true} />
```

Both props are read **once**, untracked, in `onSettled`. They describe what an
instance does when it mounts; the caller controls that by choosing when to mount
it. Making them reactive meant that merely enabling the "check on launch"
preference fired an immediate network check.

### 4. Effect Apply Phases Take a Block Body — Always

Solid calls whatever an effect's apply phase **returns** as its cleanup
function. A concise arrow body that happens to return a value therefore halts
the whole reactive system the next time the effect runs.

```tsx
// ❌ returns a ThemeAccent string -> "E is not a function" -> REACTIVITY_HALTED
createEffect(
  () => currentAccent(),
  (accent) => applyThemeAccent(accent)
);

// ❌ returns a number (Array.prototype.push)
createEffect(
  () => n(),
  (v) => seen.push(v)
);

// ✅ block body: returns undefined
createEffect(
  () => currentAccent(),
  (accent) => {
    applyThemeAccent(accent);
  }
);

// ✅ or return a real cleanup
createEffect(
  () => props.roomId,
  (id) => {
    const conn = chat.connect(id);
    return () => conn.close();
  }
);
```

The same rule applies to `onSettled` — its return value is also treated as a
cleanup. `test/reactivity.test.ts` pins this behaviour.

### 5. Accessible ARIA Switch Toggle

Note SolidJS uses the DOM attribute names — `class`, `tabindex` — not React's
`className` / `tabIndex`.

```tsx
<label
  class="switch"
  role="switch"
  aria-checked={checked() ? 'true' : 'false'}
  aria-disabled={disabled ? 'true' : 'false'}
  tabindex={disabled ? -1 : 0}
  onKeyDown={(e: KeyboardEvent) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onToggle(!checked());
    }
  }}
>
  <input
    type="checkbox"
    checked={checked()}
    onChange={(e) => onToggle(e.currentTarget.checked)}
    tabindex={-1}
    aria-hidden="true"
  />
  <span class="slider" />
</label>
```

### 6. Keyboard Shortcuts — Never Hand-Roll a Key Check

All key handling goes through the registry in `src/lib/shortcuts.ts`, which sits
on the engine in `src/lib/keyboard.ts`. Specs are portable: `Mod` resolves to ⌘
on macOS and Ctrl elsewhere, keys match on physical position (`KeyboardEvent.code`)
so a binding survives a layout change, and a quoted token matches the produced
character instead.

```tsx
import { resolveShortcutAction } from './lib/shortcuts';
import { isCapturingHotkey } from './lib/keyboard';

const onKeyDown = (e: KeyboardEvent) => {
  if (isCapturingHotkey()) return; // a rebind recorder owns the keyboard
  const action = resolveShortcutAction(e);
  if (action === null) return;
  e.preventDefault();
  // ...dispatch on `action`
};
```

Adding a shortcut = one entry in `APP_SHORTCUTS` (id, action, `defaultSpec`,
description, category). The cheat sheet, the platform-correct label, the
rebinding UI, and conflict detection all follow automatically.

```ts
// Spec syntax
'Mod+Shift+K'; // ⌘⇧K on macOS, Ctrl+Shift+K elsewhere
'Ctrl+Alt+Delete'; // literal modifiers
'F5'; // key only
'Cmd+Shift'; // modifier-only hotkey
"Shift+'?'"; // quoted -> match the CHARACTER, not the physical key
'AltGr+A'; // side-specific (AltRight)
```

---

## 🎨 AMOLED Dark Theme Color Tokens (`src/index.css`)

Accent tokens are rewritten at runtime by `applyThemeAccent()` (`src/lib/theme.ts`),
so never hardcode an accent color — read the variable.

| Variable              | Value                       | Purpose                                     |
| :-------------------- | :-------------------------- | :------------------------------------------ |
| `--bg-amoled`         | `#000000`                   | 100% AMOLED deep black canvas               |
| `--card-bg`           | `rgba(20, 20, 22, 0.65)`    | Translucent frosted glass card              |
| `--card-border`       | `rgba(255, 255, 255, 0.08)` | Subtle border line                          |
| `--card-border-hover` | `rgba(255, 255, 255, 0.16)` | Card border on hover                        |
| `--accent-cyan`       | `#00f2fe`                   | Primary accent — **swapped by the theme**   |
| `--accent-blue`       | `#4facfe`                   | Secondary accent — **swapped by the theme** |
| `--accent-glow`       | `rgba(0, 242, 254, 0.25)`   | Focus / glow shadow — swapped by the theme  |
| `--accent-badge-bg`   | `rgba(0, 242, 254, 0.08)`   | Accent-tinted badge fill — theme-swapped    |
| `--text-main`         | `#f0f3f8`                   | High contrast primary text                  |
| `--text-muted`        | `#8a8f9d`                   | Secondary descriptive labels                |
| `--text-dim`          | `#5c606d`                   | Tertiary / disabled text                    |
