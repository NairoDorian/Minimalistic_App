# Quick Development Cheat Sheet (CRUSH.md)

> Rapid reference and copy-paste code patterns for developers and AI agents working on **Minimalistic App**.

---

## ⚡ Core CLI Commands

```bash
# Development & Testing (Ultimate standard command)
bun run tauri dev              # Full Tauri desktop app in live dev mode
bun run vite                   # Web-only preview in browser

# Quality Gates & Verification
bun test                       # Run automated Bun unit test suite
bun run typecheck              # Static TypeScript typecheck (tsc -b)
bun run lint                   # Code lint (oxlint — TS7-compatible)
bun run lint:fix               # Auto-fix lint issues
bun run format                 # Format all files (Prettier + cargo fmt)
bun run format:check           # Verify formatting without modifying files
bun run before-commit --check  # Verify version mirrors are in sync
bun run validate               # Run full 6-step pre-commit validation suite

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

---

## ⚛️ React 19 & TypeScript Frontend Patterns (`src/`)

### 1. Optimistic UI Toggle with Rollback

```tsx
const handleToggle = useCallback(
  async (nextValue: boolean) => {
    const previous = isEnabled;
    setIsEnabled(nextValue); // Optimistic UI update
    try {
      await invoke('set_my_setting', { enabled: nextValue });
    } catch (error: unknown) {
      setIsEnabled(previous); // Rollback on failure
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Failed to update setting:', msg);
    }
  },
  [isEnabled]
);
```

### 2. UpdateChecker Dual-Variant Rule

```tsx
// Card variant (Preferences tab) — owns listeners and mount auto-check
<UpdateChecker autoCheckOnMount={true} listenForEvents={true} />

// Footer variant (Status bar) — purely passive visual trigger
<UpdateChecker autoCheckOnMount={false} listenForEvents={false} />
```

### 3. Accessible ARIA Switch Toggle

```tsx
<div
  role="switch"
  aria-checked={checked}
  tabIndex={disabled ? -1 : 0}
  onKeyDown={(e) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onToggle();
    }
  }}
>
  <input type="checkbox" checked={checked} readOnly className="sr-only" />
  <div className="toggle-slider" />
</div>
```

---

## 🎨 AMOLED Dark Theme Color Tokens (`src/index.css`)

| Variable           | Value                       | Purpose                        |
| :----------------- | :-------------------------- | :----------------------------- |
| `--bg-amoled`      | `#000000`                   | 100% AMOLED deep black canvas  |
| `--card-bg`        | `rgba(18, 18, 20, 0.7)`     | Translucent frosted glass card |
| `--card-border`    | `rgba(255, 255, 255, 0.08)` | Subtle border line             |
| `--accent-cyan`    | `#00f2fe`                   | Primary neon cyan accent       |
| `--accent-emerald` | `#10b981`                   | Success / active state glow    |
| `--text-primary`   | `#ffffff`                   | High contrast primary text     |
| `--text-muted`     | `#9ca3af`                   | Secondary descriptive labels   |
