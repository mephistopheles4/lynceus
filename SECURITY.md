# Security

## Reporting a vulnerability

Use GitHub's **private vulnerability reporting**: the "Report a vulnerability"
button under this repository's Security tab. It reaches the maintainer and
nobody else.

Do not open a public issue for a security problem. That includes anything that
could leak private repository metadata or tokens, inject scripts or external
requests into generated SVGs or the Builder UI, break filesystem containment, or
weaken scheduled command quoting.

This is a personal project with one maintainer. There is no SLA and no bounty.
You will get an honest answer and, if the finding is real, a fix.

## Scope

**In scope:** everything in this repository — the CLI (`bin/`, `src/cli/`), the
collector and privacy gate (`src/collector/`), the SVG/Markdown renderer
(`src/renderer/`), the read-only Builder UI server and public assets
(`src/builder-ui/`), the check and Pages build scripts (`scripts/`), and the CI
workflows (`.github/workflows/`).

**Out of scope:** GitHub itself (`api.github.com`, Camo, GitHub Pages hosting),
your own `lynceus.json` files and scheduled host environment, and repositories
where you explicitly choose `--include-private`.

## Threat model and trust boundaries

Lynceus is built around five explicit trust boundaries documented in
[`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md):

- **`B1` Inbound GitHub API:** Untrusted GitHub GraphQL/REST payloads, actor types
  (rejecting missing authors and non-`Bot` actors), `X-GitHub-SSO` headers, and
  error bodies are stripped in-memory to anonymous UTC daily integer counts only.
- **`B2` Localhost `127.0.0.1` UI:** Global `Host` validation, strict method
  allowlists, zero CORS, per-request CSP nonces, `Origin`/`Sec-Fetch-Site` +
  timing-safe `Bearer` token verification, and `32 KiB` JSON body caps protect
  all `/api/*` routes.
- **`B3` Public `generated` branch & SVGs:** Generated SVGs contain zero script,
  zero external URLs beyond `xmlns="http://www.w3.org/2000/svg"`, and zero inline
  `style=`. Scheduled scripts push `*.svg` only (never `counts.json`) to a
  dedicated non-default orphan branch using UTC noreply metadata. The static
  GitHub Pages demo bundle (`scripts/build-pages.mjs`) enforces a closed
  9-asset allowlist and scans output files to reject localhost URLs, tokens, or
  workstation paths.
- **`B4` Outbound GitHub Auth:** Tokens (`GITHUB_TOKEN`, `GH_TOKEN`, or `gh auth
  token` via absolute `PATH` lookup) stay in process memory and are scrubbed from
  stderr and error messages.
- **`B5` Local configs, CWD & paths:** Pre- and post-`path.resolve()` validation,
  symlink-refusing atomic writes (`0o600` when private counts are enabled),
  deepest-existing-ancestor `realpathSync()` confinement outside the repo and
  shared temporary folders, Win32 trailing-`\` protection on `scriptPath`, and
  POSIX `'\''` / `cron` `%` escaping protect scheduled runs.
- **Zero dependencies:** `package.json` ships `dependencies: {}` and
  `devDependencies: {}`, imports Node.js built-ins only, and `scripts/check.mjs`
  fails on any lockfile, `.npmrc`, `.yarnrc.yml`, `binding.gyp`, or non-builtin
  package import.

## Scanners in CI

- **CodeQL** runs in GitHub's default setup over JavaScript across `bin/`, `src/`,
  `scripts/`, `tests/`, and `.github/workflows/` (`actions`).
- **zizmor** audits `.github/workflows/` on every push and pull request and fails
  on any finding at the default persona (`--strict-collection`, no baseline or
  suppressions).
- **Every GitHub Action is pinned to a commit SHA** with a version comment,
  verified online by zizmor (`ref-version-mismatch`) and updated weekly by
  [`.github/dependabot.yml`](.github/dependabot.yml).

Details of what each scanner checks and covers live in
[`docs/security/scanners.md`](docs/security/scanners.md).

## What the platform is relied on for

Part of this project's defence lives in repository settings, not files inside the
tree. A clone cannot verify them, so check the repository's live settings if
you rely on them:

| Setting | What it provides |
| --- | --- |
| Dependabot alerts | Vulnerability notifications if any transitive or toolchain risk arises |
| Dependabot security updates | Automated security PRs paired with weekly `github-actions` updates |
| Secret scanning & push protection | Blocks accidental credential pushes |
| CodeQL (default setup) | Static security analysis for JavaScript and GitHub Actions |
| Private vulnerability reporting | Confidential reporting channel described at the top of this file |
| Branch protection / ruleset on `main` | Require pull requests and green `check`, `check-windows`, and `audit` checks before merge |
| GitHub Pages built from Actions | Workflow-only deployment (`pages.yml`) of the static demo bundle (`dist-pages/`) |

## What is deliberately not defended against

Consistent with [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md):

- **Daily-count correlation under opt-in `--include-private`:** Pushing
  combined public+private integer counts reveals aggregate daily bot activity
  totals without exposing repository names, titles, or URLs.
- **Same-UID local OS compromise:** Code running under your own OS user account
  can already inspect your `gh` credentials, environment variables, or local
  workstation files.
- **GitHub search indexing and default-branch limits:** GitHub's commit search
  covers default branches and single-day search caps truncate at `1,000` results
  with a privacy-safe warning.
- **User-chosen GitHub Actions token scope:** Supplying your own repository
  secret in `--target actions` delegates credential scoping to that secret.
- **A compromised maintainer account:** Branch rulesets raise the cost of an
  unreviewed commit, not a hijacked admin credential.
