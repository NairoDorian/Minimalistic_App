import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { platform } from 'node:process';

/**
 * Runs `tauri dev` with the fastest link configuration this machine can offer.
 *
 *   bun run dev:fast              # detect, report, and launch
 *   bun run dev:fast --check      # report what would be used, then exit
 *   bun run dev:fast --debug none # override the debuginfo level for this run
 *
 * ## What it changes, and why it is a script rather than a config file
 *
 * The slow half of a Tauri edit→relaunch loop is linking, not compiling. Two
 * settings dominate it:
 *
 *   - the **linker**: LLVM's `lld` links in parallel; the default platform
 *     linkers largely do not;
 *   - **debuginfo**: emitting and linking full debug symbols is expensive, and
 *     `limited` keeps file/line numbers in backtraces at a fraction of the cost.
 *
 * Measured on this repository (Windows, warm target dir): a one-line edit to
 * `src-tauri/src/lib.rs` went from **10.17 s** to **3.92 s** — 2.6× faster. The
 * full table, and the settings that were measured and did *not* help, are in
 * `.cargo/config.toml`.
 *
 * ⚠️  Changing the debuginfo level invalidates the dependency cache, so the
 * first build after switching modes recompiles everything. Alternating between
 * `bun run tauri dev` and `bun run dev:fast` therefore costs a full rebuild each
 * way. Use `--debug full` to get the fast linker at the stock debuginfo level
 * if you need to switch back and forth.
 *
 * Both are set as **environment variables for this process only**. Writing them
 * into `.cargo/config.toml` would apply to every build on every machine and
 * break the clone-and-build guarantee for anyone without LLVM installed —
 * including CI. Nothing here touches a file, so there is nothing to remember to
 * revert and nothing that can leak into a commit.
 *
 * If no fast linker is found the script says how to install one and runs a
 * normal `tauri dev`, so it is always safe to use as your default dev command.
 */

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const CYAN = '\x1b[36m';

/** Debuginfo levels, cheapest first. `limited` is the default: it keeps
 *  file/line information in panics, which is the reason to have symbols at all
 *  during development, while dropping the expensive rest. */
const DEBUG_LEVELS = ['none', 'line-tables-only', 'limited', 'full'] as const;
type DebugLevel = (typeof DEBUG_LEVELS)[number];
const DEFAULT_DEBUG_LEVEL: DebugLevel = 'limited';

interface LinkerChoice {
  /** Executable that was found on PATH (or at a well-known location). */
  readonly name: string;
  /** Environment variables that select it for this process. */
  readonly env: Record<string, string>;
  /** How to get it if it is missing. */
  readonly install: string;
}

/** True when `command` resolves on PATH. */
function onPath(command: string): boolean {
  // `--version` is the one flag every candidate linker accepts, and a non-zero
  // exit or a spawn failure both mean "not usable", which is all we need.
  const probe = spawnSync(command, ['--version'], { stdio: 'ignore' });
  return probe.error === undefined && probe.status === 0;
}

/**
 * Picks the best available fast linker for the host platform.
 *
 * Returns null when none is installed — the caller then runs an ordinary dev
 * session rather than failing.
 */
function detectLinker(): LinkerChoice | null {
  if (platform === 'win32') {
    // Cargo takes an absolute path or a bare name; the bare name is preferred
    // so a PATH-installed LLVM works without hardcoding an install location.
    const wellKnown = 'C:\\Program Files\\LLVM\\bin\\lld-link.exe';
    if (onPath('lld-link')) {
      return {
        name: 'lld-link',
        env: { CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER: 'lld-link.exe' },
        install: 'winget install LLVM.LLVM',
      };
    }
    if (existsSync(wellKnown)) {
      return {
        name: wellKnown,
        env: { CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER: wellKnown },
        install: 'winget install LLVM.LLVM',
      };
    }
    return null;
  }

  if (platform === 'linux') {
    // mold outperforms lld on Linux; prefer it when present.
    if (onPath('mold')) {
      return {
        name: 'mold',
        env: { RUSTFLAGS: '-C link-arg=-fuse-ld=mold' },
        install: 'apt install mold  /  pacman -S mold  /  dnf install mold',
      };
    }
    if (onPath('ld.lld')) {
      return {
        name: 'ld.lld',
        env: { RUSTFLAGS: '-C link-arg=-fuse-ld=lld' },
        install: 'apt install lld  /  pacman -S lld  /  dnf install lld',
      };
    }
    return null;
  }

  if (platform === 'darwin') {
    // Apple's linker in recent Xcode is already parallel and is the safest
    // default on macOS; only take lld when it is actually installed.
    if (onPath('ld64.lld')) {
      return {
        name: 'ld64.lld',
        env: { RUSTFLAGS: '-C link-arg=-fuse-ld=lld' },
        install: 'brew install llvm',
      };
    }
    return null;
  }

  return null;
}

function parseDebugLevel(argv: readonly string[]): DebugLevel {
  const index = argv.indexOf('--debug');
  if (index < 0) return DEFAULT_DEBUG_LEVEL;

  const requested = argv[index + 1];
  if (requested !== undefined && (DEBUG_LEVELS as readonly string[]).includes(requested)) {
    return requested as DebugLevel;
  }

  console.error(
    `${YELLOW}--debug expects one of: ${DEBUG_LEVELS.join(', ')} — using ${DEFAULT_DEBUG_LEVEL}.${RESET}`
  );
  return DEFAULT_DEBUG_LEVEL;
}

function main(): void {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    console.log(`
${BOLD}dev:fast${RESET} — tauri dev with the fastest link configuration this machine offers

  bun run dev:fast                 detect a fast linker, then run tauri dev
  bun run dev:fast --check         report the detected configuration and exit
  bun run dev:fast --debug <level> ${DEBUG_LEVELS.join(' | ')}  (default: ${DEFAULT_DEBUG_LEVEL})

Settings are applied as environment variables for this process only — no file
on disk is modified. See .cargo/config.toml for the measurements behind them.
`);
    return;
  }

  const debugLevel = parseDebugLevel(argv);
  const linker = detectLinker();

  const env: Record<string, string> = {
    ...process.env,
    CARGO_PROFILE_DEV_DEBUG: debugLevel,
    // Spreading `undefined` is a no-op, so no fallback object is needed.
    ...linker?.env,
  };

  console.log(`\n${BOLD}Fast dev configuration${RESET}`);
  if (linker) {
    console.log(`  ${GREEN}✓${RESET} linker            ${linker.name}`);
  } else {
    console.log(
      `  ${YELLOW}—${RESET} linker            ${DIM}platform default (no fast linker found)${RESET}`
    );
  }
  console.log(`  ${GREEN}✓${RESET} dev debuginfo     ${debugLevel}`);
  console.log(
    `  ${GREEN}✓${RESET} dependency debug  ${DIM}off (profile.dev.package."*" in src-tauri/Cargo.toml)${RESET}`
  );

  if (!linker) {
    const hints: Record<string, string> = {
      win32: 'winget install LLVM.LLVM',
      linux: 'apt install mold   (or lld)',
      darwin: 'brew install llvm',
    };
    const hint = hints[platform] ?? 'install LLVM for your platform';
    console.log(
      `\n${YELLOW}No fast linker on PATH.${RESET} Install one for a substantially quicker`
    );
    console.log(`edit→relaunch loop:  ${BOLD}${hint}${RESET}`);
  }

  if (argv.includes('--check')) {
    console.log(`\n${DIM}--check: not launching.${RESET}\n`);
    return;
  }

  console.log(`\n${CYAN}▸${RESET} bun run tauri dev\n`);

  try {
    // `stdio: inherit` hands the terminal to Tauri so its dev server output,
    // colours and Ctrl-C all behave exactly as they do for a plain dev run.
    execFileSync('bun', ['run', 'tauri', 'dev'], { stdio: 'inherit', env });
  } catch {
    // A non-zero exit here is Tauri's own (a build failure, or Ctrl-C). It has
    // already printed whatever the user needs to see; re-throwing would only
    // bury it under a stack trace from this wrapper.
    process.exitCode = 1;
  }
}

main();
