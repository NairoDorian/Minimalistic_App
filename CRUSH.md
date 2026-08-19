# Quick Development Cheat Sheet (CRUSH.md)

> Rapid reference and copy-paste code patterns for developers and AI agents working on **Minimalistic App**.

---

## ⚡ Core CLI Commands

```bash
# Development & Testing (Ultimate standard command)
bun run tauri dev              # Full Tauri desktop app in live dev mode
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
```

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

### 2. UpdateChecker Dual-Variant Rule

```tsx
// Card variant (Preferences tab) — owns listeners and mount auto-check
<UpdateChecker autoCheckOnMount={checkUpdatesOnLaunch} listenForEvents={() => true} />

// Footer variant (Status bar) — purely passive visual trigger (both false)
<UpdateChecker autoCheckOnMount={() => false} listenForEvents={() => false} />
```

### 3. Accessible ARIA Switch Toggle

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

### 4. Keyboard Shortcuts — Never Hand-Roll a Key Check

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
