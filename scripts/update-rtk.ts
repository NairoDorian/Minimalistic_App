import { execSync } from 'node:child_process';

/**
 * Reinstalls the `rtk` CLI (Command Code's runner) at the LATEST GitHub release tag.
 *
 * `cargo install` cannot reliably target a specific release unless `--tag` is
 * supplied, and crates.io usually lags behind the GitHub releases. So this
 * script queries the GitHub tags API for the most recent tag and reinstalls
 * with `cargo install --git <repo> --tag <tag> --force`.
 *
 *   bun run update:rtk [--tag <tag>] [--check]
 *
 * Flags:
 *   --tag <tag>   Pin an exact tag instead of fetching the latest (mostly for debugging).
 *   --check       Resolve and print the latest tag, then exit without installing.
 *   --help, -h    Show usage.
 */
const REPO = 'rtk-ai/rtk';
const TAGS_URL = `https://api.github.com/repos/${REPO}/tags`;
const GIT_URL = 'https://github.com/rtk-ai/rtk';

/** Resolves the latest tag name from the GitHub tags API (newest first). */
async function fetchLatestTag(): Promise<string> {
  const res = await fetch(TAGS_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'minimalistic-app-rtk-updater',
    },
  });

  if (!res.ok) {
    throw new Error(
      `GitHub API request for ${REPO} tags failed with ${res.status} ${res.statusText}.`
    );
  }

  const tags = (await res.json()) as Array<{ name: string }>;
  const latest = tags.at(0)?.name;
  if (!latest) {
    throw new Error(`No tags found for ${REPO}.`);
  }
  return latest;
}

interface Flags {
  tag?: string;
  check?: boolean;
  help?: boolean;
}

/** Minimal flag parser. */
function parseFlags(args: string[]): Flags {
  const out: Flags = {};
  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--help':
      case '-h':
        out.help = true;
        return out;
      case '--check':
        out.check = true;
        break;
      case '--tag': {
        const value = args[i + 1];
        if (!value) {
          throw new Error('--tag requires a value, e.g. --tag v0.45.0');
        }
        out.tag = value;
        i++;
        break;
      }
    }
  }
  return out;
}

const HELP_TEXT = `
Usage: bun run update:rtk [--tag <tag>] [--check]

Reinstalls RTK at the latest GitHub release tag:
  cargo install --git ${GIT_URL} --tag <tag> --force

Flags:
  --tag <tag>   Pin an exact tag instead of fetching the latest.
  --check       Resolve and print the latest tag, then exit without installing.
  --help, -h    Show this usage.
`;

const flags = parseFlags(process.argv.slice(2));

if (flags.help) {
  console.log(HELP_TEXT);
  process.exit(0);
}

const run = async (): Promise<void> => {
  const tag = flags.tag ?? (await fetchLatestTag());

  if (!/^[\w.-]+$/.test(tag)) {
    throw new Error(`Invalid tag "${tag}" — expected a value like v0.43.0.`);
  }

  if (flags.check) {
    console.log(`Latest RTK tag: ${tag}`);
    return;
  }

  console.log(`Reinstalling RTK at tag ${tag}...`);
  execSync(`cargo install --git ${GIT_URL} --tag ${tag} --force`, {
    stdio: 'inherit',
  });
  console.log(`\nRTK updated to ${tag}.`);
};

run().catch((err: unknown) => {
  console.error('Failed to update RTK:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
