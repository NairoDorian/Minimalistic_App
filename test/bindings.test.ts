import { describe, it, expect } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Guards the Rust ↔ TypeScript IPC contract against silent drift.
 *
 * # The gap this closes
 *
 * `src/bindings.ts` is generated at **runtime** by the `builder.export(…)` call
 * in `run()`, which only compiles into a debug build. It is therefore refreshed
 * exactly when somebody launches `bun run tauri dev` — and not when they add a
 * command, run `cargo check`, and commit. The frontend then calls a contract the
 * backend no longer has, and nothing notices until it fails in front of a user.
 *
 * # Why this is a source comparison rather than a re-render
 *
 * The obvious implementation is a Rust test that re-renders the bindings from
 * the same `specta_builder()` and diffs them. That does not work: referencing
 * the builder from a test binary links `tauri::Wry`, which drags in the webview
 * runtime, and the resulting test executable fails to start on Windows with
 * `STATUS_ENTRYPOINT_NOT_FOUND` because WebView2's loader is not beside it. The
 * check has to happen without instantiating the Tauri runtime.
 *
 * So this reads both sides as **text**: the `collect_commands![…]` registry in
 * `lib.rs`, and the exported `commands` object in `bindings.ts`. No compilation,
 * no linking, no platform dependency, and it runs in `bun test` alongside
 * everything else.
 *
 * # What it does and does not catch
 *
 * - **Catches:** a command added, removed or renamed in Rust without
 *   regenerating the bindings. That is the common failure and the one that
 *   breaks at runtime.
 * - **Does not catch:** a changed *signature* — an argument added, or a return
 *   type narrowed — since neither is visible in the command name. Regenerating
 *   after a signature change still relies on running the app once.
 *
 * A partial guard that runs on every commit beats a complete one that never does.
 */

const REPO_ROOT = join(import.meta.dir, '..');
const LIB_RS = join(REPO_ROOT, 'src-tauri', 'src', 'lib.rs');
const BINDINGS_TS = join(REPO_ROOT, 'src', 'bindings.ts');

/** `set_minimize_to_tray` → `setMinimizeToTray`, matching Tauri Specta's output. */
function toCamelCase(snake: string): string {
  return snake.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

/**
 * Extracts the command names registered with `collect_commands![…]` in lib.rs.
 *
 * Deliberately a regex over source text rather than anything cleverer: the macro
 * invocation is a flat, comma-separated identifier list by construction, and a
 * parser would be more code to maintain than the thing it checks.
 */
function rustCommandNames(source: string): string[] {
  const macro = /collect_commands!\[([\s\S]*?)\]/.exec(source);
  if (!macro?.[1]) {
    throw new Error('collect_commands![…] not found in lib.rs — has the IPC registry moved?');
  }

  return macro[1]
    .split(',')
    .map((entry) =>
      entry
        // Strip line and block comments so a commented-out command is not counted.
        .replace(/\/\/.*$/gm, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .trim()
    )
    .filter((entry) => entry.length > 0);
}

/** Extracts the keys of the exported `commands` object in bindings.ts. */
function bindingCommandNames(source: string): string[] {
  const block = /export const commands = \{([\s\S]*?)\n\}/.exec(source);
  if (!block?.[1]) {
    throw new Error('`export const commands = {…}` not found in bindings.ts');
  }

  // Each entry is `name: (args) => __TAURI_INVOKE<…>("snake_name", …)`.
  return [...block[1].matchAll(/^\t([A-Za-z0-9_]+):\s*\(/gm)].map((match) => match[1] as string);
}

/** Extracts the raw invoke targets — the snake_case names sent over IPC. */
function invokedCommandNames(source: string): string[] {
  return [...source.matchAll(/__TAURI_INVOKE<[^>]*>\("([a-z0-9_]+)"/g)].map(
    (match) => match[1] as string
  );
}

describe('Rust ↔ TypeScript IPC contract', () => {
  const libSource = readFileSync(LIB_RS, 'utf8');
  const bindingsSource = readFileSync(BINDINGS_TS, 'utf8');

  it('registers at least one command (the extractors still match the file shape)', () => {
    // If either regex silently stops matching, every other assertion here would
    // pass vacuously. Fail loudly instead.
    expect(rustCommandNames(libSource).length).toBeGreaterThan(0);
    expect(bindingCommandNames(bindingsSource).length).toBeGreaterThan(0);
  });

  it('exposes exactly the commands the Rust registry declares', () => {
    // Order is irrelevant: both sides are compared as sets via set difference.
    const rust = rustCommandNames(libSource);
    const invoked = invokedCommandNames(bindingsSource);

    const missingFromBindings = rust.filter((name) => !invoked.includes(name));
    const staleInBindings = invoked.filter((name) => !rust.includes(name));

    expect({ missingFromBindings, staleInBindings }).toEqual({
      missingFromBindings: [],
      staleInBindings: [],
    });
  });

  it('names each wrapper as the camelCase form of its command', () => {
    const rust = rustCommandNames(libSource);
    const wrappers = bindingCommandNames(bindingsSource);

    for (const command of rust) {
      expect(wrappers).toContain(toCamelCase(command));
    }
  });

  it('carries the generated-file banner, so nobody hand-edits it', () => {
    expect(bindingsSource).toContain('generated by Tauri Specta');
    expect(bindingsSource).toContain('Do not edit this file manually');
  });

  it('camelCases the way Tauri Specta does', () => {
    expect(toCamelCase('get_app_info')).toBe('getAppInfo');
    expect(toCamelCase('set_global_hotkeys_enabled')).toBe('setGlobalHotkeysEnabled');
    expect(toCamelCase('clear_logs')).toBe('clearLogs');
    expect(toCamelCase('already_camel')).toBe('alreadyCamel');
  });
});
