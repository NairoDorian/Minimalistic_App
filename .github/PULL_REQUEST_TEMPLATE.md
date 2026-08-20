## What this changes

<!--
Two or three sentences in your own words: the problem you hit, and why this is
the right fix for it.

Write this part yourself even if a tool wrote the code. The diff already says
what changed; this section is the only place that can say *why*, and that is
the part reviewers cannot reconstruct.
-->

Fixes #

## Why this belongs in a minimal template

<!--
Skip for a bug fix. For anything additive, make the case: this project is a
starting point, so every line is weight that every downstream app inherits.
-->

## Documentation-driven?

<!--
If this touches framework behaviour — a lifecycle primitive, a boundary, a Tauri
capability, a tsconfig flag — cite the local mirror you read:

  bun run docs:find "<query>"

e.g. "per .docs/solid-docs/src/routes/(2)concepts/(4)boundaries.mdx, a loading
boundary belongs around the smallest coherent region".

Version-specific reasoning matters here: SolidJS 1.x and 2.0 are different
runtimes, and TypeScript 7 changed defaults older material assumes.
-->

## Checklist

- [ ] `bun run validate` passes all gates (version sync, types, lint, Bun tests, Vite build, cargo fmt/check/clippy, Rust tests, arch map)
- [ ] New behaviour has a test, or I have said why it is not testable
- [ ] `bun run arch` re-run if files were added, removed, or renamed
- [ ] `CHANGELOG.md` has an entry under the version this ships in
- [ ] Any new dependency is justified above, and added to `THIRD_PARTY_LICENSES.md`
- [ ] Comments explain _why_, not _what_ — matching the density of the surrounding code

## How you tested it

<!--
Automated gates are necessary but not sufficient for UI work. Say whether you
actually ran `bun run tauri dev` (or `bun run dev:fast`) and exercised the
change, and on which OS. "Gates pass, not manually verified" is an honest and
acceptable answer — an unstated one is not.
-->

- Automated: `bun run validate`
- Manual: <!-- OS + what you clicked, or "not manually verified" -->
