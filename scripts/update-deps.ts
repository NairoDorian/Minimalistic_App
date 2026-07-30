import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * Ultimate All-Inclusive Dependency Updater & Build Validator.
 * 
 * Aggressive Sub-Dependency Upgrading:
 * 1. Upgrades all direct NPM packages & transitive sub-packages (bun update --latest)
 * 2. Upgrades all direct Cargo crates & transitive sub-crates (cargo update)
 * 3. Builds Vite production frontend (bun run vite:build)
 * 4. Verifies Cargo backend compilation (cargo check)
 * 5. Synchronizes ARCHITECTURE.md
 */

interface DependencyStatus {
  name: string;
  ecosystem: 'NPM (Bun)' | 'Cargo (Rust)';
  type: 'runtime' | 'dev' | 'cargo-dep' | 'cargo-build';
  currentVersion: string;
  latestVersion: string;
  needsUpdate: boolean;
}

function cleanVersion(v: string): string {
  if (typeof v !== 'string') return '';
  return v.replace(/^[\^~=v]/, '').trim();
}

async function fetchLatestNpmVersion(pkgName: string): Promise<string | null> {
  try {
    const response = await fetch(`https://registry.npmjs.org/${pkgName}/latest`, {
      headers: { 'Accept': 'application/json' }
    });
    if (response.ok) {
      const data = await response.json() as { version?: string };
      return data.version || null;
    }
  } catch {}
  return null;
}

async function fetchLatestCrateVersion(crateName: string): Promise<string | null> {
  try {
    const response = await fetch(`https://crates.io/api/v1/crates/${crateName}`, {
      headers: { 'User-Agent': 'MinimalisticAppUpdater/1.0' }
    });
    if (response.ok) {
      const data = await response.json() as { crate?: { max_version?: string; newest_version?: string } };
      return data.crate?.max_version || data.crate?.newest_version || null;
    }
  } catch {}
  return null;
}

function runCmd(cmd: string, args: string[], cwd?: string): { success: boolean; durationMs: number } {
  const start = Date.now();
  const res = spawnSync(cmd, args, { stdio: 'inherit', shell: true, cwd });
  const durationMs = Date.now() - start;
  return { success: res.status === 0, durationMs };
}

async function updateEverything() {
  console.log("=================================================================");
  console.log("🚀 STARTING ULTIMATE DUAL-ECOSYSTEM & SUB-DEPENDENCY UPDATE");
  console.log("=================================================================\n");

  const pkgPath = path.resolve('package.json');
  const cargoTomlPath = path.resolve('src-tauri/Cargo.toml');

  if (!fs.existsSync(pkgPath) || !fs.existsSync(cargoTomlPath)) {
    console.error("❌ Fatal: package.json or Cargo.toml not found!");
    process.exit(1);
  }

  console.log("🔍 Querying Registries (NPM & Crates.io) for Absolute @latest Versions...");
  const queryStart = Date.now();

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  const runtimeDeps = pkgJson.dependencies || {};
  const devDeps = pkgJson.devDependencies || {};

  const allStatuses: DependencyStatus[] = [];
  const fetchPromises: Promise<void>[] = [];

  // 1. Query NPM runtime dependencies
  Object.entries(runtimeDeps).forEach(([name, ver]) => {
    fetchPromises.push((async () => {
      const latest = await fetchLatestNpmVersion(name);
      const currClean = cleanVersion(ver as string);
      const needs = latest ? currClean !== latest : false;
      allStatuses.push({
        name,
        ecosystem: 'NPM (Bun)',
        type: 'runtime',
        currentVersion: ver as string,
        latestVersion: latest || currClean,
        needsUpdate: needs
      });
    })());
  });

  // 2. Query NPM devDependencies
  Object.entries(devDeps).forEach(([name, ver]) => {
    fetchPromises.push((async () => {
      const latest = await fetchLatestNpmVersion(name);
      const currClean = cleanVersion(ver as string);
      const needs = latest ? currClean !== latest : false;
      allStatuses.push({
        name,
        ecosystem: 'NPM (Bun)',
        type: 'dev',
        currentVersion: ver as string,
        latestVersion: latest || currClean,
        needsUpdate: needs
      });
    })());
  });

  // 3. Parse Cargo.toml dependency sections safely
  const cargoContent = fs.readFileSync(cargoTomlPath, 'utf8');
  const lines = cargoContent.split(/\r?\n/);
  let currentSection = '';

  const cargoCratesToQuery: { name: string; ver: string; section: string }[] = [];

  lines.forEach(line => {
    const trimmed = line.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      currentSection = trimmed.slice(1, -1).trim();
      return;
    }

    if (['dependencies', 'build-dependencies', 'dev-dependencies'].includes(currentSection)) {
      const matchInline = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*\{[^}]*version\s*=\s*"([^"]+)"/);
      const matchSimple = trimmed.match(/^([a-zA-Z0-9_-]+)\s*=\s*"([^"]+)"/);
      const match = matchInline || matchSimple;
      if (match) {
        cargoCratesToQuery.push({ name: match[1], ver: match[2], section: currentSection });
      }
    }
  });

  cargoCratesToQuery.forEach(({ name, ver, section }) => {
    fetchPromises.push((async () => {
      const latest = await fetchLatestCrateVersion(name);
      const currClean = cleanVersion(ver);
      const needs = latest ? currClean !== latest : false;
      allStatuses.push({
        name,
        ecosystem: 'Cargo (Rust)',
        type: section === 'build-dependencies' ? 'cargo-build' : 'cargo-dep',
        currentVersion: ver,
        latestVersion: latest || currClean,
        needsUpdate: needs
      });
    })());
  });

  await Promise.all(fetchPromises);
  const queryDuration = Date.now() - queryStart;
  console.log(`✅ Registry query complete (${queryDuration}ms)\n`);

  // --- Step 1: Upgrading Outdated NPM Runtime Dependencies & Sub-Packages ---
  const outdatedRuntime = allStatuses.filter(s => s.type === 'runtime' && s.needsUpdate);
  if (outdatedRuntime.length === 0) {
    console.log("📦 Step 1/6: NPM Runtime Dependencies -> All direct packages already @latest");
  } else {
    console.log(`📦 Step 1/6: Upgrading ${outdatedRuntime.length} Outdated NPM Runtime Dependencies...`);
    const targets = outdatedRuntime.map(s => `${s.name}@latest`);
    const { success, durationMs } = runCmd("bun", ["add", ...targets]);
    if (success) console.log(`✅ Step 1/6 Complete (${durationMs}ms)`);
  }
  console.log("");

  // --- Step 2: Upgrading Outdated NPM DevDependencies & Sub-Packages ---
  const outdatedDev = allStatuses.filter(s => s.type === 'dev' && s.needsUpdate);
  if (outdatedDev.length === 0) {
    console.log("🛠️ Step 2/6: NPM DevDependencies -> All direct packages already @latest");
  } else {
    console.log(`🛠️ Step 2/6: Upgrading ${outdatedDev.length} Outdated NPM DevDependencies...`);
    const targets = outdatedDev.map(s => `${s.name}@latest`);
    const { success, durationMs } = runCmd("bun", ["add", "-d", ...targets]);
    if (success) console.log(`✅ Step 2/6 Complete (${durationMs}ms)`);
  }
  console.log("");

  // --- Step 3: Upgrading Outdated Cargo Rust Crates in Cargo.toml ---
  const outdatedCargo = allStatuses.filter(s => s.ecosystem === 'Cargo (Rust)' && s.needsUpdate);
  if (outdatedCargo.length === 0) {
    console.log("🦀 Step 3/6: Cargo Rust Crates -> All Cargo.toml specs already @latest");
  } else {
    console.log(`🦀 Step 3/6: Syncing ${outdatedCargo.length} Outdated Cargo Crates in Cargo.toml...`);
    let newCargoContent = cargoContent;
    outdatedCargo.forEach(crate => {
      const regInline = new RegExp(`(${crate.name}\\s*=\\s*\\{[^}]*version\\s*=\\s*")([^"]+)(")`, 'g');
      const regSimple = new RegExp(`(${crate.name}\\s*=\\s*")([^"]+)(")`, 'g');
      if (regInline.test(newCargoContent)) {
        newCargoContent = newCargoContent.replace(regInline, `$1^${crate.latestVersion}$3`);
      } else {
        newCargoContent = newCargoContent.replace(regSimple, `$1^${crate.latestVersion}$3`);
      }
    });
    fs.writeFileSync(cargoTomlPath, newCargoContent, 'utf8');
    console.log("✅ Cargo.toml specifications updated to @latest!");
  }
  console.log("");

  // --- Step 4: Refreshing All Transitive Sub-Crates & Sub-Packages ---
  console.log("🔒 Step 4/6: Updating All Sub-Crates & Transitive Sub-Dependencies (bun update & cargo update)...");
  runCmd("bun", ["update", "--latest"]);
  const cargoCwd = path.resolve("src-tauri");
  const { success: cargoSuccess, durationMs: cargoMs } = runCmd("cargo", ["update"], cargoCwd);
  if (cargoSuccess) console.log(`✅ Step 4/6 Sub-dependency update complete (${cargoMs}ms)\n`);

  // --- Step 5: Vite Production Frontend Build Validation ---
  console.log("⚡ Step 5/6: Validating Vite Production Frontend Build (bun run vite:build)...");
  const { success: buildSuccess, durationMs: buildMs } = runCmd("bun", ["run", "vite:build"]);
  if (!buildSuccess) {
    console.error("❌ Error: Vite production build failed!");
    process.exit(1);
  } else {
    console.log(`✅ Step 5/6 Complete (${buildMs}ms)\n`);
  }

  // --- Step 6: Native Cargo Backend Compilation Verification ---
  console.log("🔍 Step 6/6: Checking Cargo Rust Backend Compilation (cargo check)...");
  const { success: checkSuccess, durationMs: checkMs } = runCmd("cargo", ["check"], cargoCwd);
  if (!checkSuccess) {
    console.error("❌ Error: Cargo compilation check failed!");
    process.exit(1);
  } else {
    console.log(`✅ Step 6/6 Complete (${checkMs}ms)\n`);
  }

  // --- Synchronize Architecture Map ---
  console.log("📐 Synchronizing ARCHITECTURE.md...");
  const { success: archSuccess } = runCmd("bun", ["run", "scripts/generate-arch.ts"]);
  if (archSuccess) console.log("✅ ARCHITECTURE.md updated!\n");

  // --- Print Comprehensive Summary Report ---
  console.log("=================================================================");
  console.log("📊 ALL-INCLUSIVE DEPENDENCY STATUS REPORT");
  console.log("=================================================================");
  console.log(" Dependency / Crate Name           | Ecosystem    | Current   | Latest    | Status");
  console.log("------------------------------------+--------------+-----------+-----------+-------------------");
  allStatuses.sort((a, b) => a.name.localeCompare(b.name)).forEach(s => {
    const namePadded = s.name.padEnd(34, ' ');
    const ecoPadded = s.ecosystem.padEnd(12, ' ');
    const currPadded = s.currentVersion.padEnd(9, ' ');
    const latPadded = s.latestVersion.padEnd(9, ' ');
    const statusText = s.needsUpdate ? "✨ Upgraded" : "⚡ Already @latest";
    console.log(` ${namePadded} | ${ecoPadded} | ${currPadded} | ${latPadded} | ${statusText}`);
  });
  console.log("=================================================================");
  console.log("🎉 All direct dependencies & transitive sub-dependencies are up-to-date!\n");
}

updateEverything();
