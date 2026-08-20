import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * rename-project.ts — 1-Command Project Customizer & Rebranding Tool.
 *
 * Usage:
 *   bun scripts/rename-project.ts --name "My Cool App" --identifier "com.example.mycoolapp" --author "Your Name" --github "yourname/my-cool-app"
 *   bun scripts/rename-project.ts --help
 */

const ROOT = process.cwd();

interface RenameOptions {
  name?: string;
  identifier?: string;
  author?: string;
  github?: string;
  description?: string;
}

function parseArgs(): RenameOptions {
  const args = process.argv.slice(2);
  const options: RenameOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--help' || arg === '-h') {
      console.log(`
🚀 1-Command Desktop Starter Kit Customizer & Renamer

Usage:
  bun scripts/rename-project.ts [options]

Options:
  --name <title>        Human-readable application title (e.g. "Orbit Desktop")
  --identifier <id>     Bundle reverse-DNS identifier (e.g. "com.orbit.desktop")
  --author <author>     Author name or organization (e.g. "Acme Corp")
  --github <repo>       GitHub repo slug (e.g. "acme/orbit-desktop")
  --desc <description>  Short project description
  --help, -h            Show this help message
`);
      process.exit(0);
    }
    const nextVal = args[i + 1];
    if (arg === '--name' && nextVal !== undefined) {
      options.name = nextVal;
      i++;
    } else if (arg === '--identifier' && nextVal !== undefined) {
      options.identifier = nextVal;
      i++;
    } else if (arg === '--author' && nextVal !== undefined) {
      options.author = nextVal;
      i++;
    } else if (arg === '--github' && nextVal !== undefined) {
      options.github = nextVal;
      i++;
    } else if (arg === '--desc' && nextVal !== undefined) {
      options.description = nextVal;
      i++;
    }
  }

  return options;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function snakeify(text: string): string {
  return slugify(text).replace(/-/g, '_');
}

/**
 * Applies one rewrite, reporting loudly when the pattern matched nothing.
 *
 * A rename tool that silently no-ops is worse than one that fails: the project
 * looks renamed while a stale identifier is left behind, so an out-of-date
 * pattern has to be visible.
 */
function replaceInFile(filePath: string, findPattern: RegExp | string, replacement: string) {
  const relative = path.relative(ROOT, filePath);
  if (!fs.existsSync(filePath)) {
    console.warn(`  ⚠️  Skipped ${relative} — file not found`);
    return;
  }

  const content = fs.readFileSync(filePath, 'utf8');
  const next =
    typeof findPattern === 'string'
      ? content.replaceAll(findPattern, replacement)
      : content.replace(findPattern, replacement);

  if (next === content) {
    console.warn(`  ⚠️  No match in ${relative} for ${String(findPattern)} — left unchanged`);
    return;
  }

  fs.writeFileSync(filePath, next, 'utf8');
  console.log(`  ✓ Updated ${relative}`);
}

async function main() {
  const opts = parseArgs();

  if (!opts.name && !opts.identifier && !opts.author && !opts.github) {
    console.error(
      '❌ Please provide at least one option to rename (e.g. --name "My App"). Run with --help for details.'
    );
    process.exit(1);
  }

  console.log('\n=================================================================');
  console.log('✨ CUSTOMIZING PROJECT CONFIGURATION & IDENTIFIERS');
  console.log('=================================================================\n');

  const appName = opts.name;
  // Kebab-case everywhere a slug is used (npm package, Cargo package, exported
  // file names); snake_case only for the Rust *library path* Cargo derives from
  // the package name, which `main.rs` has to spell out.
  const pkgSlug = appName ? slugify(appName) : undefined;
  const crateName = pkgSlug;
  const crateLibPath = appName ? snakeify(appName) : undefined;
  const identifier = opts.identifier;
  const author = opts.author;
  const github = opts.github;

  // 1. package.json — name plus the `kill` script, whose process name is the
  //    Cargo binary produced for `tauri dev`.
  if (pkgSlug) {
    replaceInFile(path.join(ROOT, 'package.json'), /"name":\s*"[^"]+"/, `"name": "${pkgSlug}"`);
    replaceInFile(
      path.join(ROOT, 'package.json'),
      /"kill":\s*"taskkill \/F \/IM [^"]+?\.exe/,
      `"kill": "taskkill /F /IM ${crateName}.exe`
    );
  }

  // 2. src-tauri/Cargo.toml
  if (crateName) {
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'Cargo.toml'),
      /name\s*=\s*"[^"]+"/,
      `name = "${crateName}"`
    );
  }
  if (author) {
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'Cargo.toml'),
      /authors\s*=\s*\[[^\]]*\]/,
      `authors = ["${author}"]`
    );
  }
  if (opts.description) {
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'Cargo.toml'),
      /description\s*=\s*"[^"]+"/,
      `description = "${opts.description}"`
    );
  }

  // 2b. src-tauri/src/main.rs — update the crate path reference so a renamed
  //     crate still compiles. Rust exposes hyphenated crate names as
  //     snake_case paths (e.g. `minimalistic-app` -> `minimalistic_app::run`).
  if (crateLibPath) {
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'src', 'main.rs'),
      /[a-zA-Z0-9_]+::run\(\)/,
      `${crateLibPath}::run()`
    );
  }

  // 3. src-tauri/tauri.conf.json
  if (appName) {
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
      /"productName":\s*"[^"]+"/,
      `"productName": "${appName}"`
    );
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
      /"title":\s*"[^"]+"/,
      `"title": "${appName}"`
    );
  }
  if (identifier) {
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
      /"identifier":\s*"[^"]+"/,
      `"identifier": "${identifier}"`
    );
  }
  if (github) {
    replaceInFile(
      path.join(ROOT, 'src-tauri', 'tauri.conf.json'),
      /https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/latest\/download\/latest\.json/,
      `https://github.com/${github}/releases/latest/download/latest.json`
    );
  }

  // 4. index.html
  if (appName) {
    replaceInFile(
      path.join(ROOT, 'index.html'),
      /<title>[^<]+<\/title>/,
      `<title>${appName}</title>`
    );
  }

  // 5. src/lib/appMeta.ts — the frontend's single source of product identity.
  //    Every user-visible name, exported file-name prefix, and localStorage key
  //    derives from these two constants, so this one edit rebrands the whole UI.
  if (appName && pkgSlug) {
    const appMetaPath = path.join(ROOT, 'src', 'lib', 'appMeta.ts');
    replaceInFile(
      appMetaPath,
      /export const APP_NAME = '[^']*';/,
      `export const APP_NAME = '${appName.replaceAll("'", "\\'")}';`
    );
    replaceInFile(
      appMetaPath,
      /export const APP_SLUG = '[^']*';/,
      `export const APP_SLUG = '${pkgSlug}';`
    );
  }

  console.log('\n🔄 Refreshing Cargo.lock...');
  spawnSync('cargo', ['generate-lockfile'], {
    cwd: path.join(ROOT, 'src-tauri'),
    stdio: 'inherit',
    shell: true,
  });

  console.log('\n🔄 Synchronizing version mirrors...');
  spawnSync('bun', ['scripts/before-commit.ts'], { cwd: ROOT, stdio: 'inherit', shell: true });

  console.log('\n=================================================================');
  console.log('🎉 PROJECT REBRANDING COMPLETED SUCCESSFULLY!');
  console.log('=================================================================\n');
}

main();
