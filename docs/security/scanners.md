# CI Scanners and Pinning Policy

Two security scanners inspect this repository in GitHub Actions: **CodeQL**
reads JavaScript and workflow definitions, and **zizmor** audits
`.github/workflows/`. Neither is silently suppressed, and a broken audit fails
loudly instead of passing as clean. [`SECURITY.md`](../../SECURITY.md) gives the
repository-wide summary.

## CodeQL

CodeQL runs via GitHub's **default setup** over `javascript-typescript` and
`actions` (covering `bin/`, `src/`, `scripts/`, `tests/`, and `.github/workflows/`).

Because `src/renderer/*.mjs` runs directly inside the static GitHub Pages bundle
(`dist-pages/`) alongside `src/builder-ui/public/app.js`, CodeQL inspects both
server/CLI modules and browser DOM code under the same query suite.

## Action pins & Dependabot

**Every external action in `.github/workflows/` is pinned to a 40-hex commit
SHA** with its matching release tag beside it as a comment, for example:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
  with:
    persist-credentials: false
```

[`.github/dependabot.yml`](../../.github/dependabot.yml) watches
`github-actions` weekly and updates each SHA and version comment together as a
single grouped PR. Dependabot cannot verify that a manually edited SHA matches
its comment; `zizmor` catches comment/SHA drift online via
`ref-version-mismatch`.

Because `lynceus` has zero npm dependencies (`dependencies: {}`,
`devDependencies: {}`) and refuses lockfiles, Dependabot configures no npm
ecosystem entries.

## zizmor: GitHub Actions audit

[`.github/workflows/zizmor.yml`](../../.github/workflows/zizmor.yml) audits
`.github/workflows/` on every pull request and every push to `main`:

- **Pinned version:** `zizmor==1.30.1` installed on `ubuntu-24.04` via `pipx`
  and verified with `zizmor --version` before auditing (Dependabot does not
  watch `pipx` commands inside `run:`, so bumps are reviewed PRs).
- **Why not `zizmorcore/zizmor-action`:** The upstream action defaults to
  `version: latest`, attempts SARIF uploads on fork PRs where `GITHUB_TOKEN` is
  read-only, and hides the version inside a `with:` input Dependabot ignores.
- **No suppressions:** There is no `.github/zizmor.yml` and no `# zizmor: ignore`
  comment. Findings are fixed at the source — for example, `persist-credentials:
  false` on every `actions/checkout` (`artipacked`) and splitting `pages: write` /
  `id-token: write` strictly onto `pages.yml`'s `deploy` job
  (`excessive-permissions`).
- **Fail closed (`--strict-collection`):** Passing `--strict-collection` fails
  on unparseable workflow YAML or empty targets instead of warning and exiting `0`.
- **SARIF upload on `push` only:** Pushes to `main` upload SARIF (`category:
  zizmor`) to the repository Security tab; pull requests still run the full
  failing gate without requiring `security-events: write`.
- **Scoped to `.github/workflows/`:** Avoids `dependabot-cooldown` noise on
  `.github/dependabot.yml`.

## What is deliberately not installed

- **Third-party linters or test frameworks:** `npm run check` (`scripts/check.mjs`)
  enforces zero dependencies, import hygiene, fenced Markdown language tags,
  `node --check`, `node --test`, and static Pages leak verification using Node
  built-ins only.
- **Static build leak gate (`scripts/build-pages.mjs`):** Before uploading
  `dist-pages/` to GitHub Pages, `build-pages.mjs` verifies a closed 9-asset
  allowlist and rejects loopback URLs, API origins, token prefixes, workstation
  paths, and third-party font URLs.
