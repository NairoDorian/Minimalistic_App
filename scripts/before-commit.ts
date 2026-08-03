import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { APP_VERSION } from "./version";

/**
 * before-commit.ts — Application version synchronization & validation script.
 *
 * Enforces the single global version (`scripts/version.ts` → `APP_VERSION`)
 * across every file that mirrors it, preventing the hardcoded-value drift this
 * template suffered from (package.json / Cargo.toml / tauri.conf.json silently
 * diverging). Run it before committing, via `bun run before-commit`.
 *
 * Modes:
 *   (no args)          Sync APP_VERSION into all mirrors, printing a report.
 *   --check            Read-only validation; exits 1 on any drift (CI / hooks).
 *   --bump <major|minor|patch>
 *                      Increment APP_VERSION in version.ts, then sync everything.
 *   --install-hook     Install `.git/hooks/pre-commit` running `bun run
 *                      before-commit --check`.
 *   --help             Show this usage summary.
 *
 * Synchronized mirrors:
 *   - package.json              (version field)
 *   - src-tauri/Cargo.toml      (package version)
 *   - src-tauri/tauri.conf.json (version field — drives the bundled artifact
 *                                and the auto-updater's latest.json feed)
 *   - src-tauri/Cargo.lock      (root crate entry, refreshed via `cargo generate-lockfile`)
 *
 * The frontend version (`__APP_VERSION__`, Vite `define`) derives from
 * `scripts/version.ts` directly and needs no syncing.
 */

const ROOT = process.cwd();
const VERSION_SOURCE = path.join(ROOT, "scripts", "version.ts");
const CARGO_MANIFEST_DIR = path.join(ROOT, "src-tauri");
const CARGO_CRATE_NAME = "minimalistic-app";

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
    label: "package.json",
    file: path.join(ROOT, "package.json"),
    pattern: /"version"\s*:\s*"([^"]+)"/,
    render: (v) => `"version": "${v}"`,
  },
  {
    label: "src-tauri/Cargo.toml",
    file: path.join(ROOT, "src-tauri", "Cargo.toml"),
    pattern: /^version\s*=\s*"([^"]+)"/m,
    render: (v) => `version = "${v}"`,
  },
  {
    label: "src-tauri/tauri.conf.json",
    file: path.join(ROOT, "src-tauri", "tauri.conf.json"),
    pattern: /"version"\s*:\s*"([^"]+)"/,
    render: (v) => `"version": "${v}"`,
  },
];

/** Exits with a descriptive error when a precondition fails. */
function fail(message: string): never {
  console.error(`❌ ${message}`);
  process.exit(1);
}

/** Reads the current value of a mirror, or null when the pattern is absent. */
function readMirrorValue(mirror: VersionMirror): string | null {
  const content = fs.readFileSync(mirror.file, "utf8");
  return content.match(mirror.pattern)?.[1] ?? null;
}

/** Returns the root crate version recorded in Cargo.lock, or null. */
function readLockfileVersion(): string | null {
  const lockPath = path.join(CARGO_MANIFEST_DIR, "Cargo.lock");
  if (!fs.existsSync(lockPath)) return null;
  const content = fs.readFileSync(lockPath, "utf8");
  // The root package entry is the one matching the crate name (its version
  // line sits directly beneath the `name = ...` line inside the [[package]] block).
  return (
    content.match(
      new RegExp(`name = "${CARGO_CRATE_NAME}"\\nversion = "([^"]+)"`, "m")
    )?.[1] ?? null
  );
}

/** Refreshes the Cargo.lock root entry after a Cargo.toml version change. */
function refreshLockfileVersion(): boolean {
  const result = spawnSync("cargo", ["generate-lockfile"], {
    cwd: CARGO_MANIFEST_DIR,
    stdio: "inherit",
  });
  return result.status === 0;
}

/** Semver increment — returns the next version string. */
function bumpVersion(current: string, part: string): string {
  const segments = current.split(".").map(Number);
  if (segments.length !== 3 || segments.some((n) => Number.isNaN(n))) {
    fail(`Cannot bump malformed version "${current}" — expected semver like "0.8.0".`);
  }
  // `noUncheckedIndexedAccess` makes these `number | undefined`; the length
  // check above guarantees all three exist, so the non-null assertions are safe.
  const [major, minor, patch] = segments as [number, number, number];
  switch (part) {
    case "major":
      return `${major + 1}.0.0`;
    case "minor":
      return `${major}.${minor + 1}.0`;
    case "patch":
      return `${major}.${minor}.${patch + 1}`;
    default:
      fail(`Unknown bump part "${part}" — use major, minor, or patch.`);
  }
}

/** Rewrites `export const APP_VERSION` inside scripts/version.ts. */
function writeVersionSource(next: string): void {
  const content = fs.readFileSync(VERSION_SOURCE, "utf8");
  const updated = content.replace(
    /(export const APP_VERSION\s*=\s*")([^"]+)(")/,
    `$1${next}$3`
  );
  if (!updated.includes(`APP_VERSION = "${next}"`)) {
    fail(`Could not locate the APP_VERSION constant in ${VERSION_SOURCE}.`);
  }
  fs.writeFileSync(VERSION_SOURCE, updated, "utf8");
}

/** Warns (non-fatal) when the changelog lacks a header for the current version. */
function validateChangelog(version: string): void {
  const changelogPath = path.join(ROOT, "CHANGELOG.md");
  if (!fs.existsSync(changelogPath)) return;
  const hasHeader = fs.readFileSync(changelogPath, "utf8").includes(`## [${version}]`);
  if (!hasHeader) {
    console.log(
      ` ⚠️  CHANGELOG.md has no "## [${version}]" entry yet — add one for this release.`
    );
  }
}

/** Installs a `.git/hooks/pre-commit` that runs the script in `--check` mode. */
function installHook(): void {
  const hooksDir = path.join(ROOT, ".git", "hooks");
  if (!fs.existsSync(hooksDir)) {
    fail("Not a git repository — .git/hooks not found.");
  }
  const hookPath = path.join(hooksDir, "pre-commit");
  if (fs.existsSync(hookPath)) {
    fail(
      `A pre-commit hook already exists at ${hookPath} — chain the command\n` +
        `   bun run before-commit --check\n` +
        `manually, or move the existing hook aside and re-run --install-hook.`
    );
  }
  fs.writeFileSync(
    hookPath,
    "#!/bin/sh\n" +
      "# Auto-generated by scripts/before-commit.ts (`bun run before-commit --install-hook`)\n" +
      "# Blocks commits whose version mirrors drifted from scripts/version.ts.\n" +
      "bun run before-commit --check\n",
    { mode: 0o755 }
  );
  console.log("✅ Installed .git/hooks/pre-commit (runs `bun run before-commit --check`).");
}

/** Runs the full sync/validation and returns whether everything is consistent. */
function run(): void {
  const args = process.argv.slice(2);
  const isCheck = args.includes("--check");
  const isInstallHook = args.includes("--install-hook");
  const bumpIndex = args.indexOf("--bump");
  const bumpPart = bumpIndex >= 0 ? args[bumpIndex + 1] : undefined;

  if (args.includes("--help")) {
    console.log(`Usage:
  bun run before-commit                Sync APP_VERSION into all mirrors
  bun run before-commit --check        Validate only; exit 1 on drift (CI/hooks)
  bun run before-commit --bump <part>  Bump version (major|minor|patch) then sync
  bun run before-commit --install-hook Install a git pre-commit hook running --check`);
    return;
  }
  if (isInstallHook) {
    installHook();
    return;
  }
  if (bumpIndex >= 0 && !bumpPart) {
    fail('--bump requires one of: major, minor, patch.');
  }

  // Sanity check: must run from the repository root (all mirrors are relative).
  if (!fs.existsSync(path.join(ROOT, "package.json"))) {
    fail("package.json not found — run this script from the repository root.");
  }

  // Resolve the effective version (optionally bumping the source first).
  const version = bumpPart ? bumpVersion(APP_VERSION, bumpPart) : APP_VERSION;
  if (bumpPart) {
    if (isCheck) fail("--check and --bump cannot be combined.");
    writeVersionSource(version);
    console.log(`🔢 Bumped scripts/version.ts: ${APP_VERSION} → ${version}\n`);
  }

  console.log("=================================================================");
  console.log(`🔢 VERSION SYNC — APP_VERSION = ${version} (scripts/version.ts)`);
  console.log("=================================================================");

  let hasDrift = false;

  // 1. JSON / TOML mirrors.
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
      console.log(` ❌ ${mirror.label.padEnd(28)} ${current ?? "(absent)"}  →  expected ${version}`);
      continue;
    }
    const content = fs.readFileSync(mirror.file, "utf8");
    fs.writeFileSync(mirror.file, content.replace(mirror.pattern, () => mirror.render(version)), "utf8");
    console.log(` 🔧 ${mirror.label.padEnd(28)} ${current ?? "(absent)"}  →  ${version}  (fixed)`);
  }

  // 2. Cargo.lock root entry (generated file — refreshed via cargo, not edited).
  if (lockfileWasOutdated) {
    if (isCheck) {
      console.log(` ❌ src-tauri/Cargo.lock              (root crate)  ${currentLockVersion ?? "(absent)"}  →  expected ${version}`);
      hasDrift = true;
    } else {
      console.log(" 🔧 src-tauri/Cargo.lock  refreshing root crate entry (cargo generate-lockfile)...");
      if (refreshLockfileVersion() && readLockfileVersion() === version) {
        console.log(` ✅ src-tauri/Cargo.lock              ${version}  (refreshed)`);
      } else {
        console.log(
          " ⚠️  Cargo.lock not refreshed automatically — run `cargo check` in src-tauri/."
        );
      }
    }
  }

  // 3. Changelog header sanity check (advisory only).
  validateChangelog(version);

  console.log("=================================================================");
  if (isCheck) {
    if (hasDrift) fail("Version mirrors are out of sync — run `bun run before-commit` to fix.");
    console.log(`✅ All version mirrors in sync at ${version}.`);
    return;
  }
  if (hasDrift) {
    console.log(`✅ Version synced to ${version} across all mirrors.`);
  } else {
    console.log(`✅ All version mirrors already in sync at ${version}.`);
  }
}

run();
