import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { APP_VERSION } from './version';

/**
 * before-commit.ts — Professional Developer Pre-Commit Pipeline & Version Sync.
 *
 * Enforces the single global version (`scripts/version.ts` → `APP_VERSION`)
 * across every file that mirrors it and provides a unified, professional
 * pre-commit verification suite for TypeScript, Vite, Cargo, and Git.
 *
 * Modes:
 *   (no args)                 Sync APP_VERSION into all mirrors, printing a report.
 *   --check                   Read-only validation; exits 1 on any drift (CI / hooks).
 *   --bump <major|minor|patch>
 *                             Increment APP_VERSION in version.ts, then sync everything.
 *   --set <semver>            Set APP_VERSION to an exact semver string and sync.
 *   --full / --all            Run the complete professional pre-commit test suite:
 *                             1. Version mirror drift check
 *                             2. TypeScript static type checking (tsc -b)
 *                             3. Vite production bundle validation
 *                             4. Rust Cargo compilation check (cargo check)
 *                             5. Architecture map freshness validation (arch)
 *   --stage                   Automatically stage synced mirror files with `git add`.
 *   --install-hook            Install `.git/hooks/pre-commit` running version check & typecheck.
 *   --uninstall-hook          Remove the installed `.git/hooks/pre-commit`.
 *   --help                    Show this comprehensive usage summary.
 *
 * Synchronized mirrors:
 *   - package.json              (version field)
 *   - src-tauri/Cargo.toml      (package version)
 *   - src-tauri/tauri.conf.json (version field — drives the bundled artifact
 *                                and the auto-updater's latest.json feed)
 *   - src-tauri/Cargo.lock      (root crate entry, refreshed via `cargo generate-lockfile`)
 *
 * The frontend version (`__APP_VERSION__`, Vite `define`) derives from
 * `scripts/version.ts` directly at build time.
 */

const ROOT = process.cwd();
const VERSION_SOURCE = path.join(ROOT, 'scripts', 'version.ts');
const CARGO_MANIFEST_DIR = path.join(ROOT, 'src-tauri');
const CARGO_CRATE_NAME = 'minimalistic-app';

interface VersionMirror {
  /** Human-readable label for the report. */
  label: string;
  /** Absolute path to the mirror file. */
  file: string;
  /** Regex with exactly one capture group matching the current version value. */
  pattern: RegExp;
  /** Renders the full replacement for the matched substring. */
  render: (version: string) => string;
}

const mirrors: VersionMirror[] = [
  {
    label: 'package.json',
    file: path.join(ROOT, 'package.json'),
    pattern: /"version"\s*:\s*"([^"]+)"/,
    render: (v) => `"version": "${v}"`,
  },
  {
    label: 'src-tauri/Cargo.toml',
    file: path.join(ROOT, 'src-tauri', 'Cargo.toml'),
    pattern: /^version\s*=\s*"([^"]+)"/m,
    render: (v) => `version = "${v}"`,
  },
  {
    label: 'src-tauri/tauri.conf.json',
    file: path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
    pattern: /"version"\s*:\s*"([^"]+)"/,
    render: (v) => `"version": "${v}"`,
  },
];

/** Exits with a descriptive error when a precondition fails. */
function fail(message: string): never {
  console.error(`\n❌ Error: ${message}\n`);
  process.exit(1);
}

/** Executes a shell command synchronously and returns timing and success status. */
function runCommand(
  label: string,
  command: string,
  args: string[],
  cwd: string = ROOT
): { success: boolean; durationMs: number } {
  const start = Date.now();
  console.log(`⏳ ${label} (${command} ${args.join(' ')})...`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell: true });
  const durationMs = Date.now() - start;
  return { success: result.status === 0, durationMs };
}

/** Reads the current value of a mirror, or null when the pattern is absent. */
function readMirrorValue(mirror: VersionMirror): string | null {
  const content = fs.readFileSync(mirror.file, 'utf8');
  return content.match(mirror.pattern)?.[1] ?? null;
}

/** Returns the root crate version recorded in Cargo.lock, or null. */
function readLockfileVersion(): string | null {
  const lockPath = path.join(CARGO_MANIFEST_DIR, 'Cargo.lock');
  if (!fs.existsSync(lockPath)) return null;
  const content = fs.readFileSync(lockPath, 'utf8');
  return (
    content.match(new RegExp(`name = "${CARGO_CRATE_NAME}"\\r?\\nversion = "([^"]+)"`, 'm'))?.[1] ??
    null
  );
}

/** Refreshes the Cargo.lock root entry after a Cargo.toml version change. */
function refreshLockfileVersion(): boolean {
  const result = spawnSync('cargo', ['generate-lockfile'], {
    cwd: CARGO_MANIFEST_DIR,
    stdio: 'inherit',
    shell: true,
  });
  return result.status === 0;
}

/** Validates SemVer format (e.g. 1.0.0 or 1.0.0-rc.1). */
function isValidSemver(v: string): boolean {
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?(\+[0-9A-Za-z.-]+)?$/.test(v);
}

/** Semver increment — returns the next version string. */
function bumpVersion(current: string, part: string): string {
  const segments = current.split('-')[0]?.split('.').map(Number);
  if (!segments || segments.length !== 3 || segments.some((n) => Number.isNaN(n))) {
    fail(`Cannot bump malformed version "${current}" — expected semver like "0.11.0".`);
  }
  const [major, minor, patch] = segments as [number, number, number];
  switch (part) {
    case 'major':
      return `${major + 1}.0.0`;
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'patch':
      return `${major}.${minor}.${patch + 1}`;
    default:
      fail(`Unknown bump part "${part}" — use major, minor, or patch.`);
  }
}

/** Rewrites `export const APP_VERSION` inside scripts/version.ts. */
function writeVersionSource(next: string): void {
  const content = fs.readFileSync(VERSION_SOURCE, 'utf8');
  const updated = content.replace(/(export const APP_VERSION\s*=\s*")([^"]+)(")/, `$1${next}$3`);
  if (!updated.includes(`APP_VERSION = "${next}"`)) {
    fail(`Could not locate the APP_VERSION constant in ${VERSION_SOURCE}.`);
  }
  fs.writeFileSync(VERSION_SOURCE, updated, 'utf8');
}

/** Warns (non-fatal) when the changelog lacks a header for the current version. */
function validateChangelog(version: string): void {
  const changelogPath = path.join(ROOT, 'CHANGELOG.md');
  if (!fs.existsSync(changelogPath)) return;
  const hasHeader = fs.readFileSync(changelogPath, 'utf8').includes(`## [${version}]`);
  if (!hasHeader) {
    console.log(` ⚠️  CHANGELOG.md has no "## [${version}]" entry yet — add one for this release.`);
  }
}

/** Automatically stages modified mirror files with git add. */
function stageMirrors(): void {
  const filesToStage = [
    'scripts/version.ts',
    'package.json',
    'src-tauri/Cargo.toml',
    'src-tauri/tauri.conf.json',
    'src-tauri/Cargo.lock',
  ].filter((f) => fs.existsSync(path.join(ROOT, f)));

  const result = spawnSync('git', ['add', ...filesToStage], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  if (result.status === 0) {
    console.log(' ✅ Staged updated version mirror files (`git add`).');
  } else {
    console.warn(' ⚠️  Could not auto-stage mirror files with git.');
  }
}

/** Installs `.git/hooks/pre-commit` running version check & typecheck. */
function installHook(): void {
  const hooksDir = path.join(ROOT, '.git', 'hooks');
  if (!fs.existsSync(hooksDir)) {
    fail('Not a git repository — .git/hooks directory not found.');
  }
  const hookPath = path.join(hooksDir, 'pre-commit');
  if (fs.existsSync(hookPath)) {
    fail(
      `A pre-commit hook already exists at ${hookPath}.\n` +
        `   To replace it, run --uninstall-hook first, or chain manually:\n` +
        `   bun run before-commit --check && bun run typecheck`
    );
  }
  const hookScript = `#!/bin/sh
# Auto-generated by scripts/before-commit.ts (\`bun run before-commit --install-hook\`)
# Blocks commits if version mirrors drifted or TypeScript type checks fail.

echo "🔍 Running pre-commit quality gates..."

bun run before-commit --check || exit 1
bun run typecheck || exit 1

echo "✅ Pre-commit verification passed."
`;
  fs.writeFileSync(hookPath, hookScript, { mode: 0o755 });
  console.log('✅ Installed `.git/hooks/pre-commit` (runs `before-commit --check` + `typecheck`).');
}

/** Removes installed `.git/hooks/pre-commit`. */
function uninstallHook(): void {
  const hookPath = path.join(ROOT, '.git', 'hooks', 'pre-commit');
  if (!fs.existsSync(hookPath)) {
    console.log('ℹ️ No pre-commit hook found at `.git/hooks/pre-commit`.');
    return;
  }
  fs.unlinkSync(hookPath);
  console.log('✅ Removed `.git/hooks/pre-commit`.');
}

/** Runs the full professional developer verification suite. */
function runFullPipeline(version: string): void {
  console.log('=================================================================');
  console.log(`🛡️  PROFESSIONAL PRE-COMMIT VERIFICATION SUITE — v${version}`);
  console.log('=================================================================\n');

  const steps: { name: string; cmd: string; args: string[]; cwd?: string }[] = [
    {
      name: 'Step 1/5: Version Mirror Drift Check',
      cmd: 'bun',
      args: ['scripts/before-commit.ts', '--check'],
    },
    {
      name: 'Step 2/5: TypeScript Static Type Validation (tsc -b)',
      cmd: 'bun',
      args: ['x', 'tsc', '-b'],
    },
    {
      name: 'Step 3/5: Production Frontend Bundle Build (vite build)',
      cmd: 'bun',
      args: ['run', 'vite:build'],
    },
    {
      name: 'Step 4/5: Native Rust Cargo Compilation Check (cargo check)',
      cmd: 'cargo',
      args: ['check', '--manifest-path', 'src-tauri/Cargo.toml'],
    },
    {
      name: 'Step 5/5: Architecture Map Freshness (generate-arch)',
      cmd: 'bun',
      args: ['scripts/generate-arch.ts'],
    },
  ];

  let totalMs = 0;
  for (const step of steps) {
    const { success, durationMs } = runCommand(step.name, step.cmd, step.args, step.cwd);
    totalMs += durationMs;
    if (!success) {
      fail(`Pre-commit verification failed at: ${step.name}`);
    }
    console.log(`   └─ ✅ Completed in ${durationMs}ms\n`);
  }

  console.log('=================================================================');
  console.log(`🎉 ALL PRE-COMMIT GATES PASSED in ${(totalMs / 1000).toFixed(2)}s!`);
  console.log(`Ready to commit: rtk git commit -m "feat(v${version}): <summary>"`);
  console.log('=================================================================');
}

/** Main execution function. */
function run(): void {
  const args = process.argv.slice(2);
  const isCheck = args.includes('--check');
  const isFull = args.includes('--full') || args.includes('--all') || args.includes('-f');
  const isInstallHook = args.includes('--install-hook');
  const isUninstallHook = args.includes('--uninstall-hook');
  const shouldStage = args.includes('--stage');
  const bumpIndex = args.indexOf('--bump');
  const bumpPart = bumpIndex >= 0 ? args[bumpIndex + 1] : undefined;
  const setIndex = args.indexOf('--set');
  const setVersion = setIndex >= 0 ? args[setIndex + 1] : undefined;

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`
Professional Developer Pre-Commit Pipeline & Version Sync
Usage:
  bun run before-commit                  Sync APP_VERSION into all mirror files
  bun run before-commit --check          Validate version mirrors (exit 1 on drift)
  bun run before-commit --full           Run full verification: sync check + tsc + vite + cargo + arch
  bun run before-commit --bump <part>    Increment semver (major | minor | patch) and sync
  bun run before-commit --set <version>  Set exact semver string and sync
  bun run before-commit --stage          Auto-stage touched mirror files with git add
  bun run before-commit --install-hook   Install git pre-commit hook (runs check + typecheck)
  bun run before-commit --uninstall-hook Remove git pre-commit hook
  bun run before-commit --help           Show this help summary
`);
    return;
  }

  if (isInstallHook) {
    installHook();
    return;
  }

  if (isUninstallHook) {
    uninstallHook();
    return;
  }

  if (bumpIndex >= 0 && !bumpPart) {
    fail('--bump requires one of: major, minor, patch.');
  }

  if (setIndex >= 0 && (!setVersion || !isValidSemver(setVersion))) {
    fail(`--set requires a valid semver string (e.g. 1.0.0 or 0.11.0), got: "${setVersion}".`);
  }

  if (!fs.existsSync(path.join(ROOT, 'package.json'))) {
    fail('package.json not found — run this script from the repository root.');
  }

  // Handle Full Validation Suite
  if (isFull) {
    runFullPipeline(APP_VERSION);
    return;
  }

  // Resolve target version
  let version = APP_VERSION;
  if (bumpPart) {
    if (isCheck) fail('--check and --bump cannot be combined.');
    version = bumpVersion(APP_VERSION, bumpPart);
    writeVersionSource(version);
    console.log(`🔢 Bumped scripts/version.ts: ${APP_VERSION} → ${version}\n`);
  } else if (setVersion) {
    if (isCheck) fail('--check and --set cannot be combined.');
    version = setVersion;
    writeVersionSource(version);
    console.log(`🔢 Set scripts/version.ts: ${APP_VERSION} → ${version}\n`);
  }

  console.log('=================================================================');
  console.log(`🔢 VERSION SYNC — APP_VERSION = ${version} (scripts/version.ts)`);
  console.log('=================================================================');

  let hasDrift = false;

  // 1. Check & write mirrors
  const currentLockVersion = readLockfileVersion();
  const lockfileWasOutdated = currentLockVersion !== version;

  for (const mirror of mirrors) {
    if (!fs.existsSync(mirror.file)) {
      fail(`Mirror file missing: ${mirror.file}`);
    }
    const current = readMirrorValue(mirror);
    if (current === version) {
      console.log(` ✅ ${mirror.label.padEnd(28)} ${current}  (in sync)`);
      continue;
    }
    hasDrift = true;
    if (isCheck) {
      console.log(
        ` ❌ ${mirror.label.padEnd(28)} ${current ?? '(absent)'}  →  expected ${version}`
      );
      continue;
    }
    const content = fs.readFileSync(mirror.file, 'utf8');
    fs.writeFileSync(
      mirror.file,
      content.replace(mirror.pattern, () => mirror.render(version)),
      'utf8'
    );
    console.log(` 🔧 ${mirror.label.padEnd(28)} ${current ?? '(absent)'}  →  ${version}  (fixed)`);
  }

  // 2. Refresh Cargo.lock if needed
  if (lockfileWasOutdated) {
    if (isCheck) {
      console.log(
        ` ❌ src-tauri/Cargo.lock              (root crate)  ${currentLockVersion ?? '(absent)'}  →  expected ${version}`
      );
      hasDrift = true;
    } else {
      console.log(
        ' 🔧 src-tauri/Cargo.lock  refreshing root crate entry (cargo generate-lockfile)...'
      );
      if (refreshLockfileVersion() && readLockfileVersion() === version) {
        console.log(` ✅ src-tauri/Cargo.lock              ${version}  (refreshed)`);
      } else {
        console.log(
          ' ⚠️  Cargo.lock not refreshed automatically — run `cargo check` in src-tauri/.'
        );
      }
    }
  }

  // 3. Advisory changelog header check
  validateChangelog(version);

  console.log('=================================================================');
  if (isCheck) {
    if (hasDrift) fail('Version mirrors are out of sync — run `bun run before-commit` to fix.');
    console.log(`✅ All version mirrors in sync at ${version}.`);
    return;
  }

  if (shouldStage) {
    stageMirrors();
  }

  if (hasDrift) {
    console.log(`✅ Version synced to ${version} across all mirrors.`);
  } else {
    console.log(`✅ All version mirrors already in sync at ${version}.`);
  }
}

run();
