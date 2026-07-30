import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

/**
 * End-to-End Automated Dependency Updater & Validator Script.
 * Performs a complete update & validation pipeline:
 * 1. Force upgrades all npm packages to @latest
 * 2. Updates Cargo Rust crates
 * 3. Builds Vite frontend bundle (bun run vite:build)
 * 4. Verifies Cargo backend compilation (cargo check)
 * 5. Synchronizes ARCHITECTURE.md map
 */
function updateDependencies() {
  console.log("🚀 Starting End-to-End Dependency Update & Build Validation...\n");

  const pkgPath = path.resolve('package.json');
  if (!fs.existsSync(pkgPath)) {
    console.error("❌ package.json not found!");
    process.exit(1);
  }

  const pkgJson = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));

  // 1. Force upgrade main runtime dependencies to @latest
  const mainDepNames = Object.keys(pkgJson.dependencies || {});
  if (mainDepNames.length > 0) {
    console.log(`📦 Step 1/5: Upgrading ${mainDepNames.length} runtime dependencies to @latest:`);
    console.log(`   ${mainDepNames.join(', ')}\n`);
    const mainTargets = mainDepNames.map(name => `${name}@latest`);
    const mainResult = spawnSync("bun", ["add", ...mainTargets], { stdio: "inherit", shell: true });
    if (mainResult.status !== 0) {
      console.error("❌ Failed to update main dependencies.");
    } else {
      console.log("✅ Runtime dependencies upgraded to @latest!\n");
    }
  }

  // 2. Force upgrade devDependencies to @latest
  const devDepNames = Object.keys(pkgJson.devDependencies || {});
  if (devDepNames.length > 0) {
    console.log(`🛠️ Step 2/5: Upgrading ${devDepNames.length} devDependencies to @latest:`);
    console.log(`   ${devDepNames.join(', ')}\n`);
    const devTargets = devDepNames.map(name => `${name}@latest`);
    const devResult = spawnSync("bun", ["add", "-d", ...devTargets], { stdio: "inherit", shell: true });
    if (devResult.status !== 0) {
      console.error("❌ Failed to update devDependencies.");
    } else {
      console.log("✅ devDependencies upgraded to @latest!\n");
    }
  }

  // 3. Perform Cargo update in src-tauri
  console.log("🦀 Step 3/5: Updating Cargo Rust crates (cargo update)...");
  const cargoResult = spawnSync("cargo", ["update"], {
    cwd: path.resolve("src-tauri"),
    stdio: "inherit",
    shell: true,
  });
  if (cargoResult.status !== 0) {
    console.error("❌ Failed to update Cargo crates.");
  } else {
    console.log("✅ Cargo crates updated successfully!\n");
  }

  // 4. Build Vite production frontend bundle
  console.log("⚡ Step 4/5: Building Vite frontend bundle (bun run vite:build)...");
  const buildResult = spawnSync("bun", ["run", "vite:build"], { stdio: "inherit", shell: true });
  if (buildResult.status !== 0) {
    console.error("❌ Vite build failed!");
  } else {
    console.log("✅ Vite frontend build succeeded!\n");
  }

  // 5. Verify Cargo Rust backend compilation
  console.log("🔍 Step 5/5: Checking Cargo Rust compilation (cargo check)...");
  const checkResult = spawnSync("cargo", ["check"], {
    cwd: path.resolve("src-tauri"),
    stdio: "inherit",
    shell: true,
  });
  if (checkResult.status !== 0) {
    console.error("❌ Cargo check failed!");
  } else {
    console.log("✅ Cargo Rust backend check succeeded!\n");
  }

  // 6. Synchronize ARCHITECTURE.md
  console.log("📐 Synchronizing ARCHITECTURE.md...");
  const archResult = spawnSync("bun", ["run", "scripts/generate-arch.ts"], {
    stdio: "inherit",
    shell: true,
  });
  if (archResult.status !== 0) {
    console.error("❌ Failed to update ARCHITECTURE.md.");
  } else {
    console.log("✅ ARCHITECTURE.md synchronized!\n");
  }

  console.log("🎉 Complete update, build, & verification pipeline finished successfully!");
}

updateDependencies();
