import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Vendors the upstream documentation for EVERY layer of this app's tech stack
 * into `.docs/`, so architecture questions are answered from the primary
 * sources on disk instead of from memory or a web search.
 *
 *   bun run docs:sync              # clone missing sources, fast-forward existing ones
 *   bun run docs:check             # report what is present / pinned, no network writes
 *   bun run docs:find "<query>"    # ripgrep-style search across every mirror
 *
 * Flags:
 *   --check          Print the status table (branch, commit, date, size) and exit.
 *   --find <query>   Search all mirrors for <query>; locale translations are excluded.
 *   --only <id>      Restrict sync/status to one source id (see DOC_SOURCES).
 *   --help, -h       Show usage.
 *
 * `.docs/` is gitignored on purpose: these are ~200 MB of third-party
 * repositories under their own licenses. The MANIFEST below — not the checkout
 * — is the committed source of truth, so `bun run docs:sync` reproduces the
 * exact same set of mirrors on any machine. See DOCUMENTATION.md.
 */

interface DocSource {
  /** Stable id used by `--only` and printed in status output. */
  id: string;
  /** Human title shown in generated indexes. */
  title: string;
  /** `owner/repo` on GitHub. */
  repo: string;
  /** Branch to track. Documentation repos version by branch, not by tag. */
  branch: string;
  /** Directory name under `.docs/` that holds the clone. */
  dir: string;
  /**
   * Sparse-checkout paths. When present the clone is a partial (`blob:none`)
   * clone and only these paths are materialized — used for repositories where
   * we want a few directories out of a very large tree.
   */
  sparse?: readonly string[];
  /** Directory inside the mirror where the prose actually lives. */
  entry: string;
  /** Why this mirror exists — surfaced in `.docs/README.md`. */
  why: string;
}

/**
 * The stack manifest. One entry per layer we can be asked an architecture
 * question about. Adding a layer to the app means adding its docs here.
 */
const DOC_SOURCES: readonly DocSource[] = [
  {
    id: 'tauri',
    title: 'Tauri 2 — desktop shell, IPC, capabilities, updater, bundling',
    repo: 'tauri-apps/tauri-docs',
    branch: 'v2',
    dir: 'tauri-docs',
    entry: 'src/content/docs',
    why: 'Backend/runtime authority: permissions & capabilities, plugin APIs, tray, updater, CSP, distribution.',
  },
  {
    id: 'solid',
    title: 'SolidJS 2 — reactivity, async graph, JSX boundaries',
    repo: 'solidjs/solid-docs',
    branch: 'v2-rebuild',
    dir: 'solid-docs',
    entry: 'src/routes',
    why: 'The v2-rebuild branch is the ONLY correct reference for Solid 2.0 (createMemo async, isPending, onSettled, Loading/Errored). Solid 1.x docs describe a different runtime.',
  },
  {
    id: 'bun',
    title: 'Bun — runtime, package manager, test runner, bundler',
    repo: 'RiskyMH/bun-docs',
    branch: 'main',
    dir: 'bun-docs',
    entry: 'content/docs',
    why: 'Bun is the only package manager and test runner in this repo (see the Bun Rule in README.md).',
  },
  {
    id: 'typescript',
    title: 'TypeScript — handbook, tsconfig reference, release notes',
    repo: 'microsoft/TypeScript-Website',
    branch: 'v2',
    dir: 'typescript-website',
    sparse: ['packages/documentation/copy/en', 'packages/tsconfig-reference/copy/en'],
    entry: 'packages/documentation/copy/en',
    why: 'Language + every tsconfig flag, straight from the source that renders typescriptlang.org/docs.',
  },
  {
    id: 'typescript-go',
    title: 'TypeScript 7 (native port) — CHANGES.md, migration notes',
    repo: 'microsoft/typescript-go',
    branch: 'main',
    dir: 'typescript-go',
    sparse: ['docs', 'CHANGES.md', 'README.md'],
    entry: '.',
    why: 'This repo pins a TypeScript 7 dev build. CHANGES.md is the authoritative list of TS7 behavioural differences — see TYPESCRIPT-7.md.',
  },
] as const;

/** Directory names inside mirrors that hold translations, not new content. */
const LOCALE_DIRS = new Set([
  'de',
  'es',
  'fr',
  'it',
  'ja',
  'ko',
  'pt',
  'pt-br',
  'ru',
  'tr',
  'zh',
  'zh-cn',
  'zh-tw',
]);

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const DOCS_DIR = join(ROOT, '.docs');

const RESET = '\x1b[0m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const GREEN = '\x1b[32m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const CYAN = '\x1b[36m';

function log(msg: string) {
  console.log(msg);
}

/** Runs git in `cwd`, returning trimmed stdout. Throws on non-zero exit. */
function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    .toString()
    .trim();
}

/** Runs git, returning null instead of throwing — for probing optional state. */
function gitOrNull(cwd: string, ...args: string[]): string | null {
  try {
    return git(cwd, ...args);
  } catch {
    return null;
  }
}

function dirOf(source: DocSource): string {
  return join(DOCS_DIR, source.dir);
}

interface SourceStatus {
  source: DocSource;
  present: boolean;
  branch: string | null;
  commit: string | null;
  date: string | null;
  files: number;
  bytes: number;
}

/** Recursively counts markdown files and total bytes, skipping `.git`. */
function measure(dir: string): { files: number; bytes: number } {
  let files = 0;
  let bytes = 0;
  const walk = (current: string) => {
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === '.git') continue;
      const full = join(current, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        continue;
      }
      if (info.isDirectory()) {
        walk(full);
      } else {
        bytes += info.size;
        if (name.endsWith('.md') || name.endsWith('.mdx')) files += 1;
      }
    }
  };
  walk(dir);
  return { files, bytes };
}

function statusOf(source: DocSource): SourceStatus {
  const dir = dirOf(source);
  if (!existsSync(join(dir, '.git'))) {
    return { source, present: false, branch: null, commit: null, date: null, files: 0, bytes: 0 };
  }
  const { files, bytes } = measure(dir);
  return {
    source,
    present: true,
    branch: gitOrNull(dir, 'rev-parse', '--abbrev-ref', 'HEAD'),
    commit: gitOrNull(dir, 'rev-parse', '--short', 'HEAD'),
    date: gitOrNull(dir, 'log', '-1', '--format=%cs'),
    files,
    bytes,
  };
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Clones a missing mirror, or fast-forwards an existing one to the tracked branch tip. */
function syncSource(source: DocSource): SourceStatus {
  const dir = dirOf(source);
  const url = `https://github.com/${source.repo}.git`;

  if (!existsSync(join(dir, '.git'))) {
    log(`${CYAN}▸${RESET} cloning ${BOLD}${source.repo}${RESET} @ ${source.branch} …`);
    const args = ['clone', '--depth', '1', '--single-branch', '--branch', source.branch];
    if (source.sparse) args.push('--filter=blob:none', '--sparse');
    args.push(url, dir);
    execFileSync('git', args, { cwd: DOCS_DIR, stdio: 'inherit' });
    if (source.sparse) {
      execFileSync('git', ['sparse-checkout', 'set', ...source.sparse], {
        cwd: dir,
        stdio: 'inherit',
      });
    }
  } else {
    const before = gitOrNull(dir, 'rev-parse', 'HEAD');
    log(`${CYAN}▸${RESET} updating ${BOLD}${source.repo}${RESET} @ ${source.branch} …`);
    execFileSync('git', ['fetch', '--depth', '1', 'origin', source.branch], {
      cwd: dir,
      stdio: 'inherit',
    });
    // Documentation mirrors are read-only: a hard reset is the correct update
    // strategy — there is never local work to preserve, and shallow clones
    // cannot merge across a force-push upstream.
    execFileSync('git', ['reset', '--hard', `origin/${source.branch}`], {
      cwd: dir,
      stdio: 'inherit',
    });
    execFileSync('git', ['clean', '-fdq'], { cwd: dir, stdio: 'inherit' });
    const after = gitOrNull(dir, 'rev-parse', 'HEAD');
    if (before === after) log(`  ${DIM}already at ${after?.slice(0, 7)}${RESET}`);
  }

  return statusOf(source);
}

/** Renders the human-facing index that lives beside the mirrors. */
function writeMirrorReadme(statuses: readonly SourceStatus[]) {
  const rows = statuses
    .map((s) => {
      const dir = relative(ROOT, dirOf(s.source)).replaceAll('\\', '/');
      return [
        `### ${s.source.title}`,
        '',
        `- **Local path:** \`${dir}/${s.source.entry === '.' ? '' : `${s.source.entry}/`}\``,
        `- **Upstream:** https://github.com/${s.source.repo}/tree/${s.source.branch}`,
        `- **Tracking:** \`${s.source.branch}\`${s.commit ? ` @ \`${s.commit}\` (${s.date})` : ' — not cloned'}`,
        `- **Why:** ${s.source.why}`,
        '',
      ].join('\n');
    })
    .join('\n');

  const body = [
    '# Local documentation mirrors',
    '',
    '> Generated by `bun run docs:sync` (`scripts/sync-docs.ts`). Do not edit by hand.',
    '',
    'This directory is **gitignored**. Each subdirectory is a shallow, read-only',
    'clone of a third-party documentation repository, kept under its own upstream',
    'license. Run `bun run docs:sync` to recreate or refresh them, and see',
    '`DOCUMENTATION.md` at the repo root for how to use them.',
    '',
    rows,
    '## Searching',
    '',
    '```bash',
    'bun run docs:find "capabilities"      # all mirrors, translations excluded',
    'bun run docs:check                    # what is present and how fresh it is',
    '```',
    '',
  ].join('\n');

  writeFileSync(join(DOCS_DIR, 'README.md'), body, 'utf8');
}

/**
 * Case-insensitive substring search across every mirror's markdown, skipping
 * `.git` and translation directories so a query does not return the same page
 * five times in five languages.
 */
function findInDocs(query: string, sources: readonly DocSource[]) {
  const needle = query.toLowerCase();
  let totalHits = 0;
  let totalFiles = 0;

  for (const source of sources) {
    const dir = dirOf(source);
    if (!existsSync(dir)) continue;

    const hits: { file: string; line: number; text: string }[] = [];

    const walk = (current: string) => {
      let entries: string[];
      try {
        entries = readdirSync(current);
      } catch {
        return;
      }
      for (const name of entries) {
        if (name === '.git' || name === 'node_modules') continue;
        const full = join(current, name);
        let info;
        try {
          info = statSync(full);
        } catch {
          continue;
        }
        if (info.isDirectory()) {
          if (LOCALE_DIRS.has(name.toLowerCase())) continue;
          walk(full);
          continue;
        }
        if (!name.endsWith('.md') && !name.endsWith('.mdx')) continue;

        const contents = readFileSync(full, 'utf8');
        if (!contents.toLowerCase().includes(needle)) continue;

        const lines = contents.split('\n');
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? '';
          if (line.toLowerCase().includes(needle)) {
            hits.push({ file: full, line: i + 1, text: line.trim().slice(0, 160) });
          }
        }
      }
    };
    walk(dir);

    if (hits.length === 0) continue;

    const byFile = new Map<string, typeof hits>();
    for (const hit of hits) {
      const list = byFile.get(hit.file) ?? [];
      list.push(hit);
      byFile.set(hit.file, list);
    }

    log(
      `\n${BOLD}${CYAN}${source.id}${RESET} ${DIM}— ${byFile.size} file(s), ${hits.length} match(es)${RESET}`
    );
    for (const [file, fileHits] of byFile) {
      const rel = relative(ROOT, file).replaceAll('\\', '/');
      log(`  ${GREEN}${rel}${RESET}`);
      for (const hit of fileHits.slice(0, 3)) {
        log(`    ${DIM}${hit.line}:${RESET} ${hit.text}`);
      }
      if (fileHits.length > 3) log(`    ${DIM}… +${fileHits.length - 3} more in this file${RESET}`);
    }
    totalHits += hits.length;
    totalFiles += byFile.size;
  }

  if (totalHits === 0) {
    log(
      `${YELLOW}No matches for "${query}".${RESET} Run ${BOLD}bun run docs:check${RESET} to confirm the mirrors are present.`
    );
    return;
  }
  log(`\n${BOLD}${totalHits}${RESET} match(es) across ${BOLD}${totalFiles}${RESET} file(s).`);
}

function printStatus(statuses: readonly SourceStatus[]) {
  log(`\n${BOLD}Documentation mirrors${RESET} ${DIM}(.docs/ — gitignored)${RESET}\n`);
  const idWidth = Math.max(...DOC_SOURCES.map((s) => s.id.length));
  for (const s of statuses) {
    const id = s.source.id.padEnd(idWidth);
    if (!s.present) {
      log(`  ${RED}✗${RESET} ${id}  ${DIM}missing — run bun run docs:sync${RESET}`);
      continue;
    }
    log(
      `  ${GREEN}✓${RESET} ${id}  ${s.branch}@${s.commit}  ${DIM}${s.date}  ${String(s.files).padStart(4)} md  ${formatBytes(s.bytes).padStart(6)}${RESET}`
    );
  }
  const missing = statuses.filter((s) => !s.present).length;
  log('');
  if (missing > 0) {
    log(`${YELLOW}${missing} source(s) missing.${RESET} Run ${BOLD}bun run docs:sync${RESET}.`);
  } else {
    log(
      `All ${statuses.length} sources present. See ${BOLD}DOCUMENTATION.md${RESET} for the reading map.`
    );
  }
}

function usage() {
  log(`
${BOLD}sync-docs${RESET} — vendor the upstream docs for every layer of the stack into .docs/

  bun run docs:sync              clone missing mirrors, fast-forward existing ones
  bun run docs:check             status table only (no network)
  bun run docs:find "<query>"    search every mirror (translations excluded)

  --only <id>    restrict to one source: ${DOC_SOURCES.map((s) => s.id).join(', ')}
  --help, -h     this message
`);
}

function main() {
  const argv = process.argv.slice(2);

  if (argv.includes('--help') || argv.includes('-h')) {
    usage();
    return;
  }

  const onlyIndex = argv.indexOf('--only');
  const onlyId = onlyIndex >= 0 ? argv[onlyIndex + 1] : undefined;
  if (onlyIndex >= 0 && !DOC_SOURCES.some((s) => s.id === onlyId)) {
    console.error(
      `${RED}Unknown source id "${onlyId ?? ''}".${RESET} Known: ${DOC_SOURCES.map((s) => s.id).join(', ')}`
    );
    process.exit(1);
  }
  const selected = onlyId ? DOC_SOURCES.filter((s) => s.id === onlyId) : DOC_SOURCES;

  const findIndex = argv.indexOf('--find');
  if (findIndex >= 0) {
    const query = argv
      .slice(findIndex + 1)
      .filter((a) => !a.startsWith('--') && a !== onlyId)
      .join(' ');
    if (!query) {
      console.error(`${RED}--find needs a query.${RESET}  e.g. bun run docs:find "capabilities"`);
      process.exit(1);
    }
    findInDocs(query, selected);
    return;
  }

  if (argv.includes('--check')) {
    printStatus(selected.map(statusOf));
    return;
  }

  mkdirSync(DOCS_DIR, { recursive: true });
  const statuses = selected.map(syncSource);
  // The generated index must describe every source, not just the --only subset.
  writeMirrorReadme(onlyId ? DOC_SOURCES.map(statusOf) : statuses);
  printStatus(statuses);
}

main();
