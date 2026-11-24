# Build Plan & Swarm Task Breakdown: Lynceus V1 (`mephistopheles4/lynceus`, `MEPH-6`)

> **Phase:** Phase 2 Build Plan · **Target Workspace:** `H:\src\lynceus` (`base commit 4c820a4`) · **Tier:** Thorough + Sensitive route · **Runtime:** Node `>= 24.0.0`, ESM, `dependencies: {}`, `devDependencies: {}`
> **Source Docs:** `docs/SPEC.md` (`V1 · Revision 5`), `docs/THREAT-MODEL.md` (`Revision 5`), `docs/DESIGN.md` (**Agent Atlas**), `MEPH-6`

---

## Dependency Graph & Swarm Wave Schedule

Every parallel swarm wave enforces **disjoint file ownership** with `workspace: "share"` so concurrent workers never collide on the same files:

```text
Wave 0 (Coordinator) ── Task 0: package.json, scripts/lint+test, docs/, fixtures
   │
   ├── Wave 1a (Worker: collector, share) ── Task 1: src/collector/* + tests/collector/* (C1-C4)
   └── Wave 1b (Worker: renderer,  share) ── Task 2: src/renderer/*  + tests/renderer/*  (C5-C6)
         │
         ▼  [Checkpoint 1: Coordinator merges Wave 1, runs lint + test]
Wave 2a (Worker: cli-core) ─────────────── Task 3: src/cli/{args,config,fs-safe}.mjs + tests (C8)
   │
   ▼
Wave 2b (Worker: cli-runtime) ──────────── Task 4: src/cli/{snippets,commands}.mjs, bin/lynceus.mjs + tests (C7, C11)
         │
         ▼  [Checkpoint 2: Coordinator merges Wave 2, runs lint + test]
   ├── Wave 3a (Worker: builder-ui, share) ─ Task 5: src/builder-ui/*, scripts/build-pages.mjs + tests (C9-C10)
   └── Wave 3b (Worker: profile-docs, share) Task 6: README.md + tests/cli/profile-integration.test.mjs (C12)
         │
         ▼  [Checkpoint 3: Coordinator merges Wave 3, runs lint + test + build:pages + browser checks]
Wave 4 (Coordinator / Test Review) ─────── Task 7: 4-lens Test diff review (QA + mandatory Security pair) -> Deploy gates
```

---

## Carried-Forward Security & UX Constraints from `Design further read` (`MEPH-6`)

Spec & Threat Model Revision 5 closed all `Design round 2, final` high and medium findings (`Finding 8`, `Finding 9`, `R4-D1` all `absent`; `data-lens` `clear`). Two `low` security hardenings raised on Revision 5 (`Finding 11`, `Finding 12`) plus one UX note carry directly into Wave 0 / Task 4 / Task 5 under the `Work that won't converge` checkpoint pick:

1. `Adversarial Finding 11` **(**`S6`**,** `C11`**,** `B5` **· 🟡** `low` **·** `security`**):** In `src/cli/snippets.mjs`, add `realpathSync('/tmp')` and `realpathSync('/var/tmp')` (when present) to the shared-temp exclusion set alongside `os.tmpdir()`, `realpathSync(os.tmpdir())`, `/tmp`, and `/var/tmp`, AND resolve symlinks on the deepest existing ancestor directory (`realpathSync`) for `resolvedRepo`, `resolvedConfig`, and `<abs-script-path>` before checking whether a script path sits inside `resolvedRepo` or a shared temp dir. Add `C11` test coverage for macOS `/private/tmp` and symlinked ancestor rejection.
2. `Adversarial Finding 12` **(**`S6`**,** `C11`**,** `B5` **· 🟡** `low` **·** `security`**):** In `src/cli/snippets.mjs`, apply shell single-quote `'\''` escaping to `<abs-sh-path>` wherever emitted in the POSIX `cron` `crontab` line (`0 6 * * * /bin/sh ...`) and `chmod 600 ...` instruction line (matching the `.sh` wrapper script's quoting helper). Add a `'`-containing `<abs-sh-path>` test to `C11`.
3. **Blank** `scriptPath` **& download separation (**`S6`**,** `S7`**):** Normalize whitespace-only/empty `scriptPath` (`typeof scriptPath === 'string' && scriptPath.trim() === ''`) as omitted (`undefined`) before `path.resolve()` so blank UI inputs never resolve to `cwd`, and keep the downloaded standalone `.ps1`/`.sh` script `Blob` (`filename`) cleanly separated from registration/`chmod 600` `instructions`.

---

## Ordered Tasks (Vertical, Verifiable Slices)

### Wave 0 — Foundation & Approved Docs

#### Task 0: Package Manifest, Cross-OS Runners, Docs & Fixtures

* **Owner:** Coordinator (single session before spawning Wave 1 workers)
* **Files:**
  * `package.json`
  * `scripts/lint.mjs`
  * `scripts/test.mjs`
  * `tests/fixtures/` (sanitized GraphQL/REST mock fixtures scaffold)
  * `docs/SPEC.md`, `docs/THREAT-MODEL.md`, `docs/DESIGN.md`, `docs/TASKS.md`
* **Description:** Initialize the Node 24 zero-dependency ESM package (`"name": "lynceus"`, `"version": "0.1.0"`, `"type": "module"`, `"license": "MIT"` matching existing `LICENSE`, `"bin": { "lynceus": "./bin/lynceus.mjs" }`, `"files": ["bin/", "src/", "scripts/", "README.md", "LICENSE"]`, `"engines": { "node": ">=24.0.0" }`, empty `"dependencies"` and `"devDependencies"`, scripts `"lint"`, `"test"`, `"build:pages"`), cross-OS Node runners (`scripts/lint.mjs` checking every `.mjs`/`.js` under existing `bin/`, `src/`, `scripts/`, `tests/`; `scripts/test.mjs` recursively discovering `tests/**/*.test.mjs`), sanitized fixture stubs, and approved docs in `docs/` (including `Finding 11` and `Finding 12` refinements noted in `docs/TASKS.md`).
* **Acceptance criteria:**
  - [ ] `package.json` matches `S2`/`S9` contract with `"license": "MIT"` and zero dependencies.
  - [ ] `scripts/lint.mjs` and `scripts/test.mjs` handle absent subdirectories cleanly during Wave 0 and support optional test filters.
  - [ ] `docs/SPEC.md`, `docs/THREAT-MODEL.md`, `docs/DESIGN.md`, and `docs/TASKS.md` exist cleanly in `H:\src\lynceus\docs/`.
* **Verification:**
  - [ ] `npm run lint && npm test` exits `0`.
* **Dependencies:** None
* **Estimated scope:** Small (`S`: 4–6 files + docs)

---

### Wave 1 — Core Collector & Renderer (`parallel`, `workspace: "share"`)

#### Task 1: Module `collector` (`C1`–`C4`)

* **Owner:** Swarm Worker `collector` (`workspace: "share"`)
* **Owned files (strict disjoint scope):**
  * `src/collector/config.mjs`
  * `src/collector/auth.mjs`
  * `src/collector/privacy-gate.mjs`
  * `src/collector/github-client.mjs`
  * `src/collector/discover.mjs`
  * `src/collector/collect.mjs`
  * `tests/collector/*.test.mjs`
* **Description:** Implement the dependency-free GitHub bot discovery and privacy-gated daily counts collector with **zero imports from** `src/cli/` (`normalizeConfig()` lives in `src/collector/config.mjs`). Cover `GITHUB_TOKEN`/`GH_TOKEN`/absolute-`PATH` `gh auth token` resolution (`shell: false`, `cwd: os.tmpdir()`, buffer scrub), `api.github.com` TLS transport (`redirect: 'error'`, `15 s` timeout, `0`-retry `403 X-GitHub-SSO`, `[2000, 4000, 8000]` backoff, `Retry-After`/`reset <= 60 s`), `redactSecrets()`, closed `assertValidDiscoverResult` & `assertStrictCountsOnly` (`C1`–`C4`), `$q`/`$after`/`node(id)` GraphQL pagination, `bisectUpperBound = max(utcToday, endDate)`, `>= 2,100 ms` serialized REST `/search/commits` queue, adaptive date bisection, deduplicated `SCOPE_CAVEAT`, and UTC calendar streaks.
* **Acceptance criteria:**
  - [ ] `normalizeConfig()` validates closed `lynceus.json` v1 with zero `src/cli/` imports (`C7`).
  - [ ] `discoverBots` and `validateBotSlug` pass all `C1` checks (`... on Issue`/`PullRequest`, `is:public` default, pre-network `botSlug` validation, `404`/`401` handling).
  - [ ] `collectActivity`, transport/error handling, and canary boundary pass all `C2`, `C3`, and `C4` assertions (`<= 500 ms`, `<= 128 MB`, zero leaked private repo names/PR titles/URLs/SHAs/`X-GitHub-SSO`/tokens).
* **Verification:**
  - [ ] `node scripts/test.mjs tests/collector` passes 100% (`npm run lint` passes).
* **Dependencies:** Task 0
* **Estimated scope:** Medium (`M`: module slice + tests)

#### Task 2: Module `renderer` (`C5`–`C6`)

* **Owner:** Swarm Worker `renderer` (`workspace: "share"`)
* **Owned files (strict disjoint scope):**
  * `src/renderer/palettes.mjs`
  * `src/renderer/sanitize.mjs`
  * `src/renderer/svg.mjs`
  * `src/renderer/markdown.mjs`
  * `tests/renderer/*.test.mjs`
* **Description:** Implement pure browser-and-Node ESM rendering modules with **zero** `node:*` **imports** so CLI, localhost UI, and GitHub Pages `dist-pages/` run identical code. Cover frozen `GITHUB_THEME`/`COLOR_RAMPS`/`NEUTRAL_LEGEND_RAMP` (`Object.hasOwn`), `52w`/`26w` + `unified`/`separate` + `breakdown`/`minimal` + `squares`/`magnitude` + `friendly`/`raw` + `allowEmpty` zero-JS SVG generation, `stripControlChars` (preserving non-BMP emoji via `!s.isWellFormed()`), strict 5-entity `escapeXml` (`&apos;`), hardened `assertCamoSafeSvg` (single root `xmlns`, `/\bxmlns:/i`, prefix tag ban, root-`xmlns`-stripped `/https?:\/\//i` scan, quote-aware `on*=`/`style=` scanner preserving harmless `<text>` like `"button=1"`), and `user` + `org/.github` `<picture>` Markdown generation (`""` on `0`-agent preview).
* **Acceptance criteria:**
  - [ ] Deterministic Light/Dark SVG snapshots match `S5` palettes/geometry, stay `<= 42 KB/band` (`52w` unified) / `<= 45 KB` (separate), and render 3 agents/52w in `<= 50 ms` (`C5`).
  - [ ] Zero `node:*` imports anywhere in `src/renderer/*.mjs`.
  - [ ] All XSS, XML-prefix, `>`-in-quotes, secondary `xmlns`, `&#`, BiDi/surrogate, and Markdown attribute breakout tests pass (`C6`).
* **Verification:**
  - [ ] `node scripts/test.mjs tests/renderer` passes 100% (`npm run lint` passes).
* **Dependencies:** Task 0
* **Estimated scope:** Medium (`M`: module slice + tests)

#### Checkpoint 1 (Coordinator — After Wave 1)

- [ ] Merge `collector` and `renderer` worker shares cleanly into working copy.
- [ ] Run `npm run lint && npm test` — all `C1`–`C6` tests pass with zero skips.

---

### Wave 2 — CLI Core & Runtime (`cli-core` -> `cli-runtime`)

#### Task 3: CLI Argument Parser, Config Loader Wrapper & `fs-safe.mjs` (`C8` + `C7` Parsing)

* **Owner:** Swarm Worker `cli-core`
* **Owned files (strict disjoint scope):**
  * `src/cli/args.mjs`
  * `src/cli/config.mjs`
  * `src/cli/fs-safe.mjs`
  * `tests/cli/args-config.test.mjs`
  * `tests/cli/fs-safe.test.mjs`
* **Description:** Implement subcommand/flag parsing (`init`, `collect`, `render`, `build`, `schedule`, `--help` public-history caveat, `--version`, exit code mappings `0/2/3/4/5`), thin `src/cli/config.mjs` reading `lynceus.json` via `readBoundedJsonFile` and re-exporting `normalizeConfig` from `../collector/config.mjs`, and `fs-safe.mjs` (`resolveTrustedAnchor` supporting macOS `/var`->`/private/var` and `/tmp`->`/private/tmp`, pre- and post-`mkdirSync` `lstatSync`/`realpathSync` confinement for both `writeSvgArtifact` and `writeVerifiedJson`, opaque `JSON.parse` error wrapping, `O_EXCL` atomic writes with `0o600` when `scope.mode === 'public+private'`).
* **Acceptance criteria:**
  - [ ] `fs-safe.mjs` passes real `os.tmpdir()` tests, nested `mkdirSync` symlink confinement, symlink read rejection (`exit 5`), oversize/malformed JSON opaque errors (`exit 2`), and `0o600` private `O_EXCL` writes (`C8`).
  - [ ] `args.mjs` + `config.mjs` enforce `--include-private`/`--public-only` conflict (`exit 2`), `--port` validation (`0..65535`), and thin re-export of `collector/config.mjs`.
* **Verification:**
  - [ ] `node scripts/test.mjs tests/cli/args-config.test.mjs tests/cli/fs-safe.test.mjs` passes 100%.
* **Dependencies:** Checkpoint 1 (Task 1, Task 2)
* **Estimated scope:** Medium (`M`: 3 source modules + 2 test suites)

#### Task 4: Refresh Snippets, CLI Entrypoint & Command Orchestrators (`C7` Runtime + `C11`)

* **Owner:** Swarm Worker `cli-runtime`
* **Owned files (strict disjoint scope):**
  * `src/cli/snippets.mjs`
  * `src/cli/commands.mjs`
  * `bin/lynceus.mjs`
  * `tests/cli/snippets.test.mjs`
  * `tests/cli/commands.test.mjs`
* **Description:** Implement `bin/lynceus.mjs` (Node `>= 24` pre-dynamic-import guard `exit 2`, `import.meta.url` off-CWD asset lookup), `commands.mjs` (`init` port `4173`/fallback `0`/explicit `--port <N>` bind fail `exit 5`, `./lynceus.json` & explicit `--config <path>` `includePrivate: false` reset unless `--include-private`, safe `SystemRoot\System32\rundll32.exe` / `PATH`-only opener with `cwd: os.tmpdir()`, `--counts-out`-only `counts.json` persistence, scrubbed `warnings` on `stderr`, atomic prior-SVG preservation), and `snippets.mjs` implementing every Revision 5 control plus `Finding 11`, `Finding 12`, and blank `scriptPath` trimming:
  * Non-repo & non-temp default/`--script-path` resolution + rejections (`resolvedRepo`, `os.tmpdir()`, `realpathSync(os.tmpdir())`, `/tmp`, `realpathSync('/tmp')`, `/var/tmp`, `realpathSync('/var/tmp')`, and **deepest existing ancestor** `realpathSync()` per `Finding 11`), rejecting `--script-path` on `actions`.
  * Pre-resolve leading-`-` ban, post-`path.resolve()` strict character/metacharacter/Unicode-quote/YAML-line-break validator across all parameters + `cwd` + `<resolved-bin-path>` + `<abs-ps1-path>` + `<abs-sh-path>` + explicit `--out-dir`, trailing-`\` ban on `<abs-ps1-path>`, `cron` `%` ban across all post-resolve paths & email.
  * Windows Task Scheduler `& 'node'` standalone `.ps1` (preserving explicit `--out-dir` on cleanup) + pinned `New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<abs-ps1-path>"'`; POSIX `.sh` + `crontab` line + `chmod 600` using `'\''` escaping on `<abs-sh-path>` in both `crontab` **and** `chmod 600` lines (`Finding 12`) + `--` operands; closed POSIX relative regex on `actions` `--config` (after `./` strip on default) & `--out-dir`; strictly unscoped `/^lynceus@[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/` `--package-pin`; `--tool-ref` + `--package-pin` conflict rejection; `PINNED_ACTIONS_CHECKOUT`/`PINNED_ACTIONS_SETUP_NODE` (`node-version: '24'`, `persist-credentials: false`, `on: [schedule, workflow_dispatch]`) + injectable `defaultToolRef` seam (`null` pre-publish).
* **Acceptance criteria:**
  - [ ] All `C7` checks pass (Node `<24`, off-CWD, explicit `--port` `exit 5`, `--config <path>` private reset & CLI `--include-private` preservation, `rundll32.exe` hijack test, private gates).
  - [ ] All `C11` checks pass, explicitly including PowerShell AST/parser or cross-OS validator checks, `Finding 11` (`/private/tmp` + symlinked parent rejection), `Finding 12` (`'` in `<abs-sh-path>` on `crontab`/`chmod 600`), blank `scriptPath`, unscoped `--package-pin`, injectable `defaultToolRef`, and local bare-remote orphan git push tests (`ls-remote --symref`, `--force-with-lease`, `main` untouched, empty-diff skip).
* **Verification:**
  - [ ] `node scripts/test.mjs tests/cli && npm run lint` passes 100%.
* **Dependencies:** Task 3
* **Estimated scope:** Medium (`M`: 3 source modules + 2 test suites)

#### Checkpoint 2 (Coordinator — After Wave 2)

- [ ] Merge Wave 2 changes, verify `npm run lint && npm test` (`C1`–`C8`, `C11` green).

---

### Wave 3 — Builder UI, Pages Bundle & Profile Integration (`parallel`, `workspace: "share"`)

#### Task 5: Module `builder-ui` & Static Pages Build (`C9`–`C10`)

* **Owner:** Swarm Worker `builder-ui` (`workspace: "share"`)
* **Owned files (strict disjoint scope):**
  * `src/builder-ui/security.mjs`
  * `src/builder-ui/server.mjs`
  * `src/builder-ui/public/index.html`
  * `src/builder-ui/public/favicon.ico`
  * `src/builder-ui/public/styles.css`
  * `src/builder-ui/public/app.js`
  * `src/builder-ui/public/demo-data.js`
  * `scripts/build-pages.mjs`
  * `tests/builder-ui/*.test.mjs`
* **Description:** Build the unified **Agent Atlas** (`docs/DESIGN.md`) localhost server (`127.0.0.1`), single-page UI, and GitHub Pages build/leak scanner. Enforce global `Host === 127.0.0.1:<port>` (`400`), `405` zero CORS, static `GET` MIME types including `/favicon.ico` (`image/x-icon`), `POST /api/*` pipeline (`Origin`, `Sec-Fetch-Site`, SHA-256 `Bearer`, `Content-Type`, `<= 32 KB`, opaque `{ error, message }`), `no-store`/`nosniff`/`Referrer-Policy`/`frame-ancestors 'none'`, per-request CSP `nonce`, `<!-- LYNCEUS_BOOTSTRAP -->` one-time handoff, zero `innerHTML`/inline `style=`/`localStorage`/third-party fonts, scoped fatal error banners (`POST /api/preview`/`discover` clear SVGs while `POST /api/schedule` clears ONLY schedule output), `Schedule` tab (`0`-agent guidance, optional `scriptPath` treating blank `""` as omitted, `toolRef` + `packagePin` inputs + pre-publish & private-mode guidance, `Download script` `Blob` for standalone script separate from instructions, `privacyNotice` `textContent`), decoupled `52w`/`26w` cache preserving `Configure` edits, and `build-pages.mjs` leak scan.
* **Acceptance criteria:**
  - [ ] All `C9` security-boundary HTTP tests pass (including global `Host` on static `GET`, `405`, `favicon.ico` `200`, `POST /api/schedule` `400` validation).
  - [ ] All `C10` UI/Pages tests pass (`zero` `innerHTML`, scoped error preservation, `52w`/`26w` edit retention, `dist-pages/` clean under `/<repo>/` subpath with `0` 404s and `build-pages.mjs` leak scan green).
  - [ ] Visual craft matches `docs/DESIGN.md` (**Agent Atlas** `#0A1021`/`#111B33`/`#090E1C`/`#B9381D`/`#E8A878` chrome quarantined from `#ffffff`/`#0d1117` `838px` specimen) and passes `impeccable` `audit` checks.
* **Verification:**
  - [ ] `node scripts/test.mjs tests/builder-ui && npm run lint && npm run build:pages` passes 100%.
* **Dependencies:** Checkpoint 2
* **Estimated scope:** Medium (`M`: server/security + 5 public assets + build script + tests)

#### Task 6: Universal `README.md` & Profile Integration Readiness (`C12`)

* **Owner:** Swarm Worker `profile-docs` (`workspace: "share"`)
* **Owned files (strict disjoint scope):**
  * `README.md`
  * `tests/cli/profile-integration.test.mjs`
* **Description:** Author universal `README.md` satisfying the `S2`/`S9`/`C10` checklist (runtime prerequisites Node `>= 24`, `GITHUB_TOKEN`/`GH_TOKEN` or `gh auth login`, CLI `init`/`collect`/`render`/`build`/`schedule` quickstart, and explicit `--include-private` public-history caveat), and implement `C12` mocked dry-run readiness tests validating the locked `mephistopheles4/mephistopheles4` config (`mephistos-homunculus[bot]`, `mephistos-euphorion[bot]`, `mephistos-wagner[bot]`, `includePrivate: true`, `separate`, `52w`, `breakdown`, `squares`, `friendly`, `generated`, `agent-activity`, `raw`) + `LynceusProfileRefresh` `& 'node'` `.ps1` snippet.
* **Acceptance criteria:**
  - [ ] `README.md` includes prerequisites, quickstart commands, and private-count public-history caveat (`C10`).
  - [ ] `C12` mocked dry-run passes (`6` Light/Dark SVGs, non-repo `.ps1` `& 'node'` snippet, zero `counts.json` staging).
* **Verification:**
  - [ ] `node scripts/test.mjs tests/cli/profile-integration.test.mjs && npm run lint` passes 100%.
* **Dependencies:** Checkpoint 2
* **Estimated scope:** Small (`S`: 2 files)

#### Checkpoint 3 (Coordinator — After Wave 3)

- [ ] Merge Wave 3 changes and run full suite: `npm run lint && npm test && npm run build:pages`.
- [ ] Run real browser end-to-end verification (`browser` / Chrome DevTools) against live `node bin/lynceus.mjs init --port 0 --no-open` AND static `dist-pages/` served under `/<repo>/` subpath at `1440×900` and `390×844` verifying: `0` 404s, `0` console errors, `./favicon.ico` `200`, `0` horizontal overflow, `52w` ↔ `26w` toggle behavior, `Schedule` download & error scoping, and `impeccable` `critique` + `audit`.

---

### Wave 4 — Test-Stage Lens Reviews & Deploy Gates

#### Task 7: Test-Stage 4-Lens Review & Deploy Sign-Off Prep (`S10`, `S13`)

* **Owner:** Coordinator (fresh lens subagents against base commit `4c820a4`)
* **Description:** Before any Deploy human action (`v0.1.0` tag, live push to `mephistopheles4/mephistopheles4` `generated`/`main`, GitHub Pages, or npm publish):
  1. Generate full git diff from base `4c820a4` and run **QA pair** (`behaviour-lens` + `integrity-lens`) + **mandatory Sensitive route Security pair** (`adversarial-lens` + `data-lens` — explicitly verifying `Finding 11` and `Finding 12` fixed in code) + offer **Standards pair** (`conventions-lens` + `reader-lens`) per `AGENTS.md` Cost limits.
  2. Post Test review + `status-6` update on Linear `MEPH-6`.
  3. Present `S13` **Needs a Human** Deploy checkpoints for explicit owner sign-off (note post-tag `DEFAULT_TOOL_REF` commit in `snippets.mjs` MUST re-run `npm run lint && npm test && npm run build:pages` and tag `v0.1.1` if `v0.1.0` shipped `null`).
* **Acceptance criteria:**
  - [ ] Full `npm run lint && npm test && npm run build:pages` + browser check pass after final edit.
  - [ ] `Test` review posted cleanly on `MEPH-6` with zero open high findings or unresolved security findings.
* **Verification:**
  - [ ] Owner reviews Test comment + `S13` Deploy gates before live pushes.
* **Dependencies:** Checkpoint 3
* **Estimated scope:** Small (`S`: verification & review)

---

## Copy-Paste Swarm Kickoff Prompt (for Fresh Antigravity Session in `H:\src\lynceus`)

Open `H:\src\lynceus` in a new Antigravity session and paste:

> Implement **Lynceus V1** (`mephistopheles4/lynceus`, Linear `MEPH-6`) from the approved Design artifacts and Build Task Breakdown using the native `swarm` orchestrator.
>
> **Authoritative sources to load first:**
>
> * Linear `MEPH-6` documents (`linear-euphorion`): **Lynceus V1 Specification (SPEC.md)** (Revision 5), **Lynceus V1 Threat Model (THREAT-MODEL.md)** (Revision 5), **Lynceus V1 Visual Design (DESIGN.md)**, and **Lynceus V1 Build Task Breakdown (TASKS.md)**.
> * Local base repository at `H:\src\lynceus` (base commit `4c820a4`: `LICENSE` + `README.md`).
>
> **Mandatory execution rules:**
>
> 1. Load the `swarm_pane` skill and inspect `swarm` (`models`) before spawning workers. Follow **Waves 0–4** in `TASKS.md` strictly with **disjoint file ownership** per worker (`workspace: "share"` for Wave 1 `collector || renderer` and Wave 3 `builder-ui || profile-docs`).
> 2. Enforce TDD per claim (`C1`–`C12`), `impeccable` UI fidelity (`DESIGN.md` Agent Atlas, system font stacks only — no third-party network fonts), and include the two Revision 5 low-security hardenings + UX hygiene note pinned in `TASKS.md` (`Finding 11` `realpathSync('/tmp'|'/var/tmp')` + deepest existing ancestor `realpathSync` on script-path exclusions; `Finding 12` `'\''` quoting on `<abs-sh-path>` in `crontab`/`chmod 600`; blank `scriptPath` trimmed as omitted + standalone script `Blob` separate from instructions).
> 3. Run `npm run lint && npm test && npm run build:pages` plus real browser verification (`127.0.0.1` + `dist-pages/` under `/<repo>/` subpath at `1440×900` & `390×844`) after Wave 3 merges.
> 4. At **Test**, run fresh `behaviour-lens` + `integrity-lens` and the **mandatory Sensitive-route** `adversarial-lens` **+** `data-lens` diff review against `4c820a4` (and offer Standards pair per Cost limits), posting results to `MEPH-6` before stopping at the `S13` Deploy human checkpoints (never push `mephistopheles4/mephistopheles4` or publish to npm without explicit owner approval).

Signed: mephistos-euphorion