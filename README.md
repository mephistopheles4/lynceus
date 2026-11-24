# lynceus

**Zero-dependency GitHub App & `[bot]` activity graph CLI and Lynceus Builder UI.**

[Open the Lynceus live demo](https://mephistopheles4.github.io/lynceus/) (runs in pure static demo mode with synthetic data).

GitHub does not render contribution graphs for GitHub Apps or `[bot]` accounts, and bot activity never appears on a user's human contribution heatmap. `lynceus` discovers `[bot]` accounts across any user or organization's repositories, collects strictly anonymous daily integer activity totals, and renders zero-JavaScript GitHub Light/Dark SVGs and `<picture>` Markdown embeds for profile READMEs (`<owner>/<owner>` or `<owner>/.github`).

---

## Privacy & Security Model

- **Anonymous daily integer totals only (`counts.json`):** `counts.json` (schema v1) stores only UTC calendar dates (`days`), non-negative integer `totals`, `streaks`, `scope.mode` (`"public"` or `"public+private"`), and agent display metadata (`slug`, `label`, `ramp`). It **never** stores or emits repository names, issue/PR titles, URLs, commit SHAs, email addresses, or GraphQL node IDs.
- **Zero-JS GitHub Camo-safe SVGs:** Generated SVGs contain no `<script>`, no external URLs (other than the single root `xmlns="http://www.w3.org/2000/svg"`), no inline `style=` attributes, and no event handlers. Light and Dark variants pair automatically in GitHub READMEs via `<picture>` and `prefers-color-scheme`.
- **Tokens stay server-side / in-process:** GitHub tokens are never written to disk, embedded in SVGs, exposed to browser storage, or passed to static demo bundles. Error messages and non-fatal warnings are scrubbed before output.
- **SVGs-only orphan pushes:** `lynceus schedule` generates refresh scripts that push **only** `*.svg` files to a single replaced orphan commit on a dedicated branch (default: `generated`; `main`, `master`, `HEAD`, and `refs/*` are rejected) using `--force-with-lease` and UTC noreply git metadata. `counts.json` is never staged or pushed.

---

## Prerequisites

- **Node.js `>= 24.0.0`** (ESM, zero runtime or dev dependencies).
- **GitHub authentication** (required for `collect`, `build`, and live discovery in `init`):
  1. `GITHUB_TOKEN` environment variable, or
  2. `GH_TOKEN` environment variable, or
  3. GitHub CLI authenticated via `gh auth login` (`gh` resolved strictly from absolute `PATH` directories).

---

## Quickstart

You can run `lynceus` globally after installing (`npm install -g lynceus`), via `npx lynceus`, or directly from a local checkout with `node bin/lynceus.mjs`:

```sh
# Check version and full CLI help
lynceus --version
lynceus --help

# Or from a local checkout:
node bin/lynceus.mjs --version
node bin/lynceus.mjs --help
```

### 1. Interactive Setup (`init`)

Launch the local read-only **Lynceus** Builder UI (`127.0.0.1:4173` by default, falling back to an ephemeral port if `4173` is busy) to discover `[bot]` accounts, customize labels and color ramps, preview Light/Dark READMEs, and download `lynceus.json`, SVGs, or refresh scripts:

```sh
lynceus init
# Or specify config, port, or headless mode:
lynceus init --config ./lynceus.json --port 4173 --no-open
```

> **Note:** When `init` auto-loads an existing `lynceus.json`, `includePrivate` is reset to `false` in memory unless you explicitly pass `--include-private` on the CLI (or opt in inside the UI).

### 2. Collect Counts & Render SVGs (`collect`, `render`, `build`)

Run collection and rendering in one step with `build` (writes SVGs to `--out-dir` and prints `<picture>` Markdown to `stdout`, writing `counts.json` only if `--counts-out` is passed):

```sh
lynceus build --config ./lynceus.json --out-dir ./agent-activity
```

Or run the two stages separately:

```sh
# 1. Collect anonymous daily counts into ./counts.json
lynceus collect --config ./lynceus.json --out ./counts.json

# 2. Render Light/Dark SVGs from ./counts.json and print <picture> Markdown
lynceus render --counts ./counts.json --config ./lynceus.json --out-dir ./agent-activity
```

`render` also works standalone without `lynceus.json` by supplying explicit layout/owner flags:

```sh
lynceus render --counts ./counts.json --owner your-username --scope-type user \
  --layout separate --detail breakdown --mark-style squares --label-mode friendly \
  --branch generated --subpath agent-activity --markdown-base raw --out-dir ./agent-activity
```

### 3. Schedule Automated Refreshes (`schedule`)

Generate a hardened refresh script and registration instructions for your platform (`lynceus.json` must already exist):

```sh
# Windows Task Scheduler (.ps1 saved outside your git repo)
lynceus schedule --config ./lynceus.json --target task-scheduler --task-name LynceusProfileRefresh

# POSIX cron (.sh saved outside your git repo with chmod 600)
lynceus schedule --config ./lynceus.json --target cron

# GitHub Actions workflow (.github/workflows/lynceus.yml — always --public-only)
lynceus schedule --config ./lynceus.json --target actions --tool-ref <40-hex-commit-sha>
# Or post-publish with an unscoped package pin:
lynceus schedule --config ./lynceus.json --target actions --package-pin lynceus@0.1.0
```

---

## Private Repository Activity (`--include-private`) Warning

> **WARNING — Public Git History Visibility:**
> While `lynceus` **never** stores or emits private repository names, PR/issue titles, commit SHAs, or URLs, passing `--include-private` adds private-repository activity into the daily integer totals rendered into your SVG files. **Once those SVGs are pushed to a public repository (such as `<owner>/<owner>`), the combined daily activity totals remain visible in public repository git history and cannot be retracted.**

Safety rules enforced by the CLI:

- **Public-only by default:** All commands default to public repositories (`is:public`).
- **Explicit CLI confirmation required:** If your `lynceus.json` sets `"includePrivate": true`, `collect`, `build`, and local `schedule` (`task-scheduler` / `cron`) require you to pass `--include-private` explicitly on the command line (or override with `--public-only`).
- **Mutual exclusion:** `--include-private` and `--public-only` cannot be combined (`exit 2`).
- **GitHub Actions restriction:** `--target actions` always enforces `--public-only` and rejects `--include-private` or private configs without `--public-only`.
- **Keep private configs and scripts out of public repos:** When using `--include-private`, store `lynceus.json` and your generated `.ps1`/`.sh` refresh script in a user-private directory outside your public profile repository.

---

## Configuration (`lynceus.json`)

`lynceus.json` uses a closed schema (`schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "owner": "your-username",
  "scopeType": "user",
  "includePrivate": false,
  "windowWeeks": 52,
  "layout": "unified",
  "detail": "breakdown",
  "markStyle": "squares",
  "labelMode": "friendly",
  "branch": "generated",
  "subpath": "agent-activity",
  "markdownBase": "raw",
  "metrics": {
    "prsOpened": true,
    "prsMerged": true,
    "commits": true,
    "reviews": true,
    "comments": true,
    "issues": true
  },
  "agents": [
    {
      "slug": "your-app[bot]",
      "label": "Your Agent",
      "ramp": "emerald"
    }
  ]
}
```

- `scopeType`: `"user"` (profile repo `<owner>/<owner>`) or `"org"` (profile repo `<owner>/.github`).
- `windowWeeks`: `52` or `26`.
- `layout`: `"unified"` (single combined card) or `"separate"` (one Light/Dark SVG pair per bot).
- `detail`: `"breakdown"` (metric totals and streaks) or `"minimal"` (compact count and heatmap).
- `markStyle`: `"squares"` or `"magnitude"`.
- `labelMode`: `"friendly"` (display `label` + `[bot]` slug) or `"raw"` (`[bot]` slug only).
- `ramp`: `"emerald"`, `"cobalt"`, `"amber"`, `"violet"`, `"rose"`, or `"teal"`.
- `agents`: `1` to `12` unique `[bot]` slugs; `metrics`: all 6 booleans present with at least one `true`.

---

## CLI Reference

| Command | Flags |
| --- | --- |
| `lynceus` | `--help` (`-h`), `--version` (`-v`) |
| `lynceus [init]` | `[--config <path>]` `[--port <port>]` `[--no-open]` `[--include-private]` |
| `lynceus collect` | `[--config <path>]` `[--out <counts.json>]` `[--include-private]` `[--public-only]` `[--date <YYYY-MM-DD>]` `[--quiet]` |
| `lynceus render` | `[--counts <counts.json>]` `[--config <path>]` `[--out-dir <dir>]` `[--owner <slug>]` `[--scope-type <user\|org>]` `[--layout <unified\|separate>]` `[--detail <breakdown\|minimal>]` `[--mark-style <squares\|magnitude>]` `[--label-mode <friendly\|raw>]` `[--branch <name>]` `[--subpath <path>]` `[--markdown-base <raw\|relative>]` `[--quiet]` |
| `lynceus build` | `[--config <path>]` `[--out-dir <dir>]` `[--counts-out <path>]` `[--include-private]` `[--public-only]` `[--date <YYYY-MM-DD>]` `[--quiet]` |
| `lynceus schedule` | `[--config <path>]` `[--out-dir <dir>]` `[--script-path <path>]` `[--target <task-scheduler\|cron\|actions>]` `[--repo-dir <path>]` `[--owner <slug>]` `[--branch <name>]` `[--subpath <path>]` `[--include-private]` `[--public-only]` `[--tool-ref <40-hex-sha>]` `[--package-pin <spec>]` `[--git-name <name>]` `[--git-email <email>]` `[--task-name <name>]` |

### Defaults & Exit Codes

- **Defaults:** `--config ./lynceus.json`, `collect --out ./counts.json`, `render --counts ./counts.json`, `--out-dir ./agent-activity`, `init --port 4173`, `schedule --repo-dir . --task-name LynceusProfileRefresh`.
- **Exit codes:**
  - `0` — Success
  - `2` — Usage, config validation, Camo safety, or `--include-private` gate error
  - `3` — Missing or rejected GitHub authentication
  - `4` — GitHub API, timeout, or rate-limit error
  - `5` — Filesystem confinement, symlink, or server port-bind error

---

## Development

```sh
npm run check        # Verify zero-deps/hygiene contract, lint, tests, and Pages bundle
npm run lint         # Syntax-check all .mjs and .js files
npm test             # Run the Node test suite (node --test)
npm run build:pages  # Build static Lynceus demo bundle into dist-pages/
```

## Contributing & Security

- Read [`CONTRIBUTING.md`](CONTRIBUTING.md) before opening a pull request.
- Report security issues privately under [`SECURITY.md`](SECURITY.md) (do not open a public issue).
- Participation is governed by the [Code of Conduct](CODE_OF_CONDUCT.md).

Licensed under the [MIT License](LICENSE).
