# Spec: Lynceus — GitHub Bot Activity Graph (V1 · Revision 5)

> **Status:** Revision 5 for `Design further read` Verification (`MEPH-6`) · **Repository:** `mephistopheles4/lynceus` (public, cloned at `H:\src\lynceus`) · **Tier:** Thorough + Sensitive route

---

## S1. Objective, Scope, Business Driver & Trade-off Points

GitHub does not render contribution graphs for GitHub Apps or `[bot]` accounts, and bot activity never appears on a user's human contribution heatmap. **Lynceus** is a zero-runtime-dependency Node 24 ESM CLI (`lynceus`) and unified read-only Builder UI that discovers `[bot]` accounts across any user's or organization's repositories, collects strictly anonymous daily integer activity counts, and renders zero-JavaScript GitHub Light/Dark SVGs + `<picture>` Markdown for profile READMEs.

### Owner Ask & Approved Direction (`confirmed`)

* **Initial ask (**`MEPH-6`**):** *"I want to show how much AI development my agents get done: on my GitHub profile README, next to my feature repositories..."*
* **Universal direction (**`2026-11-23`**):** *"I feel like going with a local scheduled job."* / *"I feel like building something a little bit more universal that anyone could use. I'm thinking it could provide them with the ability to choose which GitHub apps it wants to scan and go from there."*
* **Locked box (**`2026-11-24`**):** `"Yes, I confirmed the options. Let's lock the box."`
* **Design Phase 0 (**`2026-11-24`**):** `"i agree with your picks for phase 0"`
* **Design Round 1 resolutions (**`2026-11-24`**):** `"I agree with your picks. I think we could proceed with them and go for round two, what do you think?"`
* **Design Round 2 & repo clone (**`2026-11-24`**):** `"Go ahead and proceed as recommended. Are we able to start building it right after? I approve building. Can you use a swarm? Should I create the repository first?"` + `"repo is here ... you can clone it locally at H:\src\"`.

### Business Driver (`confirmed`)

> **Driver:** User trust and reversibility — zero-credential-leak privacy (`counts.json` integers boundary, server-side-only tokens, non-PII public pushes) and zero-JS portable SVG output take precedence over one-click local disk writes, convenience unpinned updates, or exhaustive per-commit tree walks.

### Trade-off Points

| Qualities in tension | Side taken | Rationale under driver |
| -- | -- | -- |
| **Security** vs. **Interaction capability** | Read-only localhost HTTP server (`Browser download only`); CLI `build` handles disk output; all `/api/*` routes use `POST` | Eliminates arbitrary HTTP file-write & cross-origin `GET` issues while working cleanly in Chrome/Firefox/Safari |
| **Security / Privacy** vs. **Functional richness** | Public-only default (`init` resets auto-loaded private flag unless `--include-private`); explicit `--include-private` CLI opt-in emits anonymous totals only (`counts.json`); `generated` pushes SVGs only to 1 replaced orphan commit in UTC | Prevents exposure of private repo names/titles, daily metric reconstruction, and workstation email/timezone PII |
| **Performance efficiency** vs. **Historical completeness** | Hybrid GraphQL `search` + REST `/search/commits` (default branch only, `IssueComment` comments) with adaptive date bisection | Stays within GraphQL (`5,000` pts/hr) and REST (`30` req/min) limits with exact timestamps; inline diff comments & branchless commits deferred |
| **Security / Flexibility** vs. **Convenience** | PowerShell `&`-invoked single-quoted pinned local binary & SHA-pinned `mephistopheles4/lynceus` CI checkout (`--package-pin` locked to `lynceus` after publish); npm publish gated to post-Test Deploy | Prevents unattended supply-chain package squatting, PowerShell/Unicode-quote/`cron` `%` breakout, and prompt hangs |

---

## S2. Capability Map, Packaging & Project Structure

### Approved V1 Capability Map

| Module id | Responsibility | Depends on |
| -- | -- | -- |
| `collector` | Token resolution (`GITHUB_TOKEN` / `GH_TOKEN` / `PATH`-safe `gh`), `normalizeConfig()` closed `lynceus.json` validation (`src/collector/config.mjs`), `discoverBots`, `validateBotSlug`, GraphQL + REST `/search/commits` collector with `$after` + `node(id)` pagination & date bisection, strict `counts.json` privacy gate & `redactSecrets()` | — |
| `renderer` | Browser-and-Node-shared ESM modules (`src/renderer/*.mjs`, zero `node:*` imports): palettes, zero-JS GitHub Light/Dark SVG generator, `<picture>` Markdown emitter (user & `org/.github`), XML/camo sanitizer | — |
| `cli` | `lynceus` CLI (`init`, `collect`, `render`, `build`, `schedule`), `lynceus.json` & `counts.json` bounded reads, trusted-anchor segment-checked atomic `fs-safe.mjs`, Task Scheduler/cron/Actions snippet generators | `collector`, `renderer` |
| `builder-ui` | Unified **Agent Atlas** UI: `127.0.0.1` read-only HTTP server (global `Host` guard, exact `GET` + all-`POST` `/api/*`, zero disk writes) + static `dist-pages/` demo bundle sharing `src/renderer/*.mjs` | `collector`, `renderer`, `cli` |
| `profile-integration` | Wiring `mephistopheles4/mephistopheles4` (`separate`, `52w`, `breakdown`, `squares`, `friendly`, SVGs-only single replaced orphan `generated` commit, Task Scheduler daily job `LynceusProfileRefresh`, README `<picture>` embeds) | `cli` |

**Build order:** `collector`, `renderer` (parallel) → `cli` → `builder-ui`, `profile-integration` (parallel).

### `package.json` Contract & Cross-OS Runners

* Required `package.json` fields:
  * `"name": "lynceus"`, `"version": "0.1.0"`, `"type": "module"`, `"license": "MIT"` (matching existing repository `LICENSE`)
  * `"bin": { "lynceus": "./bin/lynceus.mjs" }`
  * `"files": ["bin/", "src/", "scripts/", "README.md", "LICENSE"]`
  * `"engines": { "node": ">=24.0.0" }`
  * `"dependencies": {}`, `"devDependencies": {}`
  * `"scripts": { "lint": "node scripts/lint.mjs", "test": "node scripts/test.mjs", "build:pages": "node scripts/build-pages.mjs" }`
* `scripts/lint.mjs`: recursively walks `bin/`, `src/`, `scripts/`, and `tests/`, collecting every `.mjs` and `.js` file and running `execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' })` per file; exits non-zero on first syntax error (works identically on Windows PowerShell/cmd, macOS, Linux).
* `scripts/test.mjs`: recursively discovers `tests/**/*.test.mjs` inside Node and invokes `node --test` on the resolved list (accepting optional `<filter>` path/pattern args).
* Startup guard & off-CWD asset resolution: `bin/lynceus.mjs` checks `Number(process.versions.node.split('.')[0]) >= 24` upfront (before dynamically importing `../src/cli/commands.mjs` via `await import(...)`) so Node `<24` prints a clear single-line Node 24+ requirement and exits `2` without hitting static-import parse failures. `bin/lynceus.mjs` and `src/builder-ui/server.mjs` resolve UI and renderer files strictly via `import.meta.url`, never `process.cwd()`, so global/local invocations work from any directory.
* Universal `README.md` user-quickstart & caveat checklist: `README.md` (included in `package.json` `"files"`) documents runtime prerequisites (Node `>= 24`, `GITHUB_TOKEN`/`GH_TOKEN` or `gh auth login`), quickstart commands (`lynceus init`, `collect`, `render`, `build`, `schedule`), and the public-history warning for `--include-private`.

### Repository Layout (`mephistopheles4/lynceus`)

```text
bin/
  lynceus.mjs                 # Executable CLI entrypoint (#!/usr/bin/env node, Node >=24 guard before dynamic import)
src/
  collector/
    auth.mjs                  # Canonical resolveToken() & PATH-only win32 gh resolution
    config.mjs                # Dependency-free normalizeConfig() & closed lynceus.json schema validation
    discover.mjs              # GraphQL Bot actor scan & GET /users/<slug> validation
    github-client.mjs         # Fetch wrapper, pacing, Retry-After/backoff, X-GitHub-SSO/body scrub
    collect.mjs               # Hybrid GraphQL ($after + node() pagination) + REST collector
    privacy-gate.mjs          # assertStrictCountsOnly(), assertValidDiscoverResult(), redactSecrets()
  renderer/                   # Pure browser/Node ESM (ZERO node:* imports; shared by UI & dist-pages)
    palettes.mjs              # Isolated GitHub Light/Dark palettes & all 6 COLOR_RAMPS hex tables
    sanitize.mjs              # stripControlChars, escapeXml (&apos;), root-xmlns & prefix assertCamoSafeSvg()
    svg.mjs                   # Unified & Separate zero-JS SVG generation
    markdown.mjs              # <picture> README snippet builder (user & org/.github, escaped attrs)
  cli/
    args.mjs                  # Subcommand/flag parser (--help, --version, conflict & range checks)
    config.mjs                # Thin CLI wrapper loading lynceus.json via fs-safe & re-exporting collector/config.mjs
    fs-safe.mjs               # Trusted-anchor segment lstat, readBoundedJsonFile, O_EXCL atomic writes
    snippets.mjs              # & 'node' Task Scheduler (.ps1), %-safe POSIX cron (.sh), SHA-pinned Actions YAML
    commands.mjs              # init / collect / render / build / schedule orchestrators
  builder-ui/
    server.mjs                # Read-only 127.0.0.1 HTTP server (global Host guard, 405 methods, POST /api/*)
    security.mjs              # Host, Origin, Sec-Fetch-Site, Bearer SHA-256, CSP, no-store, MIME headers
    public/
      index.html              # Agent Atlas shell (relative ./ URLs, ./favicon.ico, <!-- LYNCEUS_BOOTSTRAP -->)
      favicon.ico             # Static favicon asset served identically by localhost & dist-pages/
      styles.css              # Agent Atlas instrument chrome + isolated 838px README specimen
      app.js                  # Pure DOM UI (zero innerHTML, blob: SVGs, bootstrap handoff, warnings/privacyNotice)
      demo-data.js            # Strict counts.json v1 synthetic 52w & 26w presets (scope.mode: "public")
scripts/
  lint.mjs                    # Cross-OS recursive node --check runner across .mjs and .js files
  test.mjs                    # Cross-OS recursive node --test discovery runner
  build-pages.mjs             # Copies public/* + src/renderer/*.mjs -> dist-pages/ & scans for leaks
tests/
  collector/                  # Discovery, $after/node() pagination, bisection, 403 SSO, canary tests
  renderer/                   # Snapshot determinism, label/subpath/apos escaping, root xmlns & prefix fuzz
  cli/                        # Auth/browser PATH-hijack, private gate, macOS tmpdir fs-safe, PS parse & git tests
  builder-ui/                 # Global Host, MIME, favicon, bootstrap strip, 52w/26w cache, errors & Pages tests
  fixtures/                   # Recorded sanitized GraphQL/REST mock fixtures
docs/
  SPEC.md                     # Approved V1 specification
  THREAT-MODEL.md             # Approved V1 threat model
  DESIGN.md                   # Agent Atlas visual specification
  decisions/                  # Architectural decision records
LICENSE                       # Existing MIT license in repository
README.md
package.json
```

---

## S3. Stable Data Contracts

### Validation Rules & Enums

* `botSlug`: `/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?\[bot\]$/`
* `owner`: `/^[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,37}[a-zA-Z0-9])?$/`
* `scopeType`: `"user" | "org"`
* `label`: trimmed string, `1..40` Unicode code points (`[...trimmed].length` in `1..40`), rejecting C0/C1 control chars (`\u0000-\u001F`, `\u007F-\u009F`), directional overrides/marks (`\u200E`, `\u200F`, `\u061C`, `\u202A-\u202E`, `\u2066-\u2069`), and unpaired UTF-16 surrogates strictly via Node 24 `!label.isWellFormed()` (never matching valid non-BMP surrogate pairs such as emoji).
* `ramp`: `"emerald" | "cobalt" | "amber" | "violet" | "rose" | "teal"`
* `windowWeeks`: `26 | 52`
* `layout`: `"unified" | "separate"`
* `detail`: `"breakdown" | "minimal"`
* `markStyle`: `"squares" | "magnitude"`
* `labelMode`: `"friendly" | "raw"`
* `branch`: `/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/` rejecting `main`, `master`, `HEAD`, and ref-namespace prefixes `refs/`, `heads/`, `tags/`, `remotes/` (all case-insensitive), `..`, `//`, any segment starting with `.`, trailing `.`, trailing `/`, or ending in `.lock`. Default: `"generated"`.
* `subpath`: `""` (branch/folder root) OR `/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,63}$/` rejecting `..`, `//`, leading/trailing `/`, any segment starting with `.` (e.g., `a/.git`, `a/.`), `:`, quotes, angle brackets, or whitespace. Default: `"agent-activity"`.
* `markdownBase`: `"raw" | "relative"`. Default: `"raw"`.

### Contract 1: `lynceus.json` (Schema v1)

Closed schema (`additionalProperties: false` at all levels):

```json
{
  "schemaVersion": 1,
  "owner": "mephistopheles4",
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
      "slug": "mephistos-homunculus[bot]",
      "label": "Homunculus",
      "ramp": "emerald"
    }
  ]
}
```

Constraints:

* `branch`, `subpath`, and `markdownBase` are optional in input JSON and normalized to defaults (`"generated"`, `"agent-activity"`, `"raw"`).
* `agents`: `1..12` entries, unique by case-insensitive `slug`.
* `metrics`: all 6 booleans present; at least one `true`. Disabled metrics (`false`) are skipped during collection (recorded as `0` in `totals`); standalone `render` renders directly from the aggregate `days` and `totals` present in `counts.json`.

### Contract 2: `counts.json` (Schema v1 — Strict Privacy Boundary)

Closed schema (`additionalProperties: false` on root, `window`, `scope`, each `agents[]` item, `totals`, `streaks`, and `days`). Any unexpected key or invalid field value throws `PrivacyGateError` in `assertStrictCountsOnly()`.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-11-24T00:00:00Z",
  "window": {
    "weeks": 52,
    "startDate": "2025-11-30",
    "endDate": "2026-11-24"
  },
  "scope": {
    "mode": "public"
  },
  "agents": [
    {
      "slug": "mephistos-homunculus[bot]",
      "label": "Homunculus",
      "ramp": "emerald",
      "source": "github",
      "totals": {
        "prsOpened": 29,
        "prsMerged": 21,
        "commits": 21,
        "reviews": 14,
        "comments": 12,
        "issues": 0,
        "total": 97
      },
      "streaks": {
        "current": 2,
        "best": 6
      },
      "days": {
        "2025-11-30": 0,
        "2026-11-24": 3
      }
    }
  ]
}
```

Invariants validated strictly by `assertStrictCountsOnly()`:

* `schemaVersion === 1`.
* `generatedAt`: strict UTC ISO-8601 regex (`/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/`). Deterministic `${endDate}T00:00:00Z` when `--date` is specified.
* `window`: `weeks` in `{26, 52}`; `startDate` and `endDate` valid UTC `YYYY-MM-DD` calendar dates where `startDate` is a Sunday and `startDate < endDate` spans exact Sunday-aligned `(weeks - 1) * 7 + endDow + 1` days.
* `scope.mode` strictly `"public"` or `"public+private"`.
* `agents`: array of `1..12` objects (unique by case-insensitive `slug`), `slug` matches `botSlug`, `label` passes `S3` label validation, `ramp` in allowed 6-value set, `source === "github"`. (`renderer` standalone mode also supports synthetic `0`-agent empty preview rendering via an explicit flag without weakening `counts.json` CLI file persistence).
* `totals`: non-negative safe integers (`Number.isSafeInteger(v) && v >= 0`) for all 7 fields, with `totals.total` matching the sum of `days` values.
* `streaks`: non-negative safe integers `{ current, best }` with `current <= best`.
  * **Streak algorithm (**`UTC` **calendar order over** `[startDate, endDate]`**):** `best` is the maximum run of consecutive dates having `days[d] > 0`. `current` is the contiguous run of `days[d] > 0` ending at `endDate` if `days[endDate] > 0`, otherwise ending at `endDate - 1d` if `days[endDate - 1d] > 0`, otherwise `0` (so an incomplete current UTC day does not wipe an active streak through yesterday).
* `days`: exact UTC calendar date keys matching `[window.startDate, window.endDate]` with zero missing or extra dates, mapped strictly to non-negative safe integers.
* Zero repository names, titles, URLs, commit SHAs, email addresses, or GraphQL node IDs anywhere in `counts.json`.

---

## S4. Module `collector`

### Token Resolution (`src/collector/auth.mjs`)

* Canonical `resolveToken({ env = process.env, execFileSyncFn = execFileSync } = {})` used exclusively by `cli` and `builder-ui` (exported along with `resolveSafeExecutable(names, env)` reused by `S6` POSIX/macOS browser launch):
  1. Check `env.GITHUB_TOKEN`, then `env.GH_TOKEN` (trimmed). Reject with `AuthError` (`exit 3`) if a non-empty env value contains `\r`, `\n`, or ASCII control chars. Return `{ token, sourceLabel: 'env' }`.
  2. Otherwise resolve `gh` (`gh.exe` on `win32`, `gh` on POSIX) via `resolveSafeExecutable` iterating strictly non-empty **absolute** `path.isAbsolute(dir)` entries of `env.PATH` (explicitly skipping `""`, `.`, and any relative path entry so Node/`libuv` on Windows NEVER searches `process.cwd()` first). Verify `statSync(candidate).isFile()` and (on POSIX) execute bit. If none found, return `null`.
  3. Execute `execFileSyncFn(resolvedGhPath, ['auth', 'token'], { shell: false, cwd: os.tmpdir(), stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000, encoding: 'utf8' })`.
  4. On non-zero exit/timeout, catch error, discard/delete `.stdout`, `.stderr`, and `.output` properties immediately, and return `null` (so missing auth returns clean `AUTH_REQUIRED` without leaking subprocess buffers). Validate trimmed stdout contains no `\r`/`\n`/control chars, and return `{ token, sourceLabel: 'gh' }`.

### Transport, Headers, Rate Limits & Error Scrubbing (`src/collector/github-client.mjs` & `privacy-gate.mjs`)

* Every outgoing request targets strictly:
  * `https://api.github.com/graphql`
  * `https://api.github.com/search/commits` (query built solely via `URLSearchParams`)
  * `https://api.github.com/users/<encodeURIComponent(slug)>`
* Mandatory request options: `redirect: 'error'`, `signal: AbortSignal.timeout(15_000)`, headers:
  * `User-Agent: lynceus/1.0`
  * `Accept: application/vnd.github+json`
  * `X-GitHub-Api-Version: 2022-11-28`
  * `Authorization: Bearer <token>`
* **Error mapping & raw-body scrubbing:**
  * HTTP `401` → throws `AuthError` (`AUTH_REQUIRED`, CLI exit `3`).
  * GraphQL HTTP `200` with non-empty `errors[]` → if any error type is `UNAUTHORIZED` / auth failure, throw `AuthError` (`exit 3`); otherwise throw `ApiError` (`GRAPHQL_ERROR`, exit `4`).
  * HTTP `403` / `429` / `502` / `503`:
    * If `Retry-After` present: wait `min(parseInt(Retry-After, 10) * 1000, 60_000)` if `<= 60 s`; abort `API_RATE_LIMIT` (`exit 4`) if `> 60 s`.
    * Else if `x-ratelimit-remaining === "0"` and `x-ratelimit-reset` present: wait until reset epoch if `<= 60 s`; abort `API_RATE_LIMIT` (`exit 4`) if `> 60 s`.
    * Else if HTTP `403` and `res.headers.has('x-github-sso')`: **fail immediately (**`0` **retries)** with `ApiError` (`AUTH_FORBIDDEN`, `exit 4`) without reading or copying the `X-GitHub-SSO` header value (which contains org SSO slugs/URLs).
    * Else (`403` without `X-GitHub-SSO` / reset headers, `429`, `502`, `503`): bounded backoff `[2000, 4000, 8000]` ms across max `3` retries; on retry exhaustion, throw `ApiError` (`API_FORBIDDEN` for `403`, else `API_ERROR`, `exit 4`).
  * **Strict No-Leak Error Rule +** `redactSecrets(text, activeToken)`**:**
    * `github-client.mjs` MUST NOT read or embed raw `4xx`/`5xx` HTTP response bodies, raw `X-GitHub-SSO` header values, GraphQL `errors[].message` / `errors[].path`, or `undici` internal `err.cause` into thrown `Error` objects. Record ONLY HTTP status code, typed reason code (`AUTH_REQUIRED`, `API_RATE_LIMIT`, `AUTH_FORBIDDEN`, `API_FORBIDDEN`, `API_NOT_FOUND`, `API_TIMEOUT`, `API_ERROR`), and retry metadata.
    * Central `redactSecrets(text, activeToken)` replaces `activeToken` (if length `>= 6`), `Bearer <non-space>`, and known GitHub token prefixes (`gh[pousr]_[A-Za-z0-9_]+`, `github_pat_[A-Za-z0-9_]+`) with `[REDACTED]` before any CLI stderr or HTTP response write.

### Boundary Input Validation & Discovery (`src/collector/discover.mjs`)

* Entrypoints `discoverBots` and `validateBotSlug` validate `owner` regex (`S3`), `scopeType` (`"user" | "org"`, throwing `ValidationError` on invalid input — no silent `"user:"` fallback), strict boolean `typeof includePrivate === 'boolean'` (`ValidationError` on non-boolean; strictly `includePrivate === true` omits `is:public`), `windowWeeks` (`26|52`), `limit` (`1..50`), and `botSlug` regex (`S3`).
* `discoverBots({ owner, scopeType, includePrivate = false, windowWeeks = 52, endDate, limit = 20 })`:
  * Requires valid token (`AUTH_REQUIRED` if missing).
  * Builds search query `const q = "${scopeType}:${owner} updated:>=${windowStart}${includePrivate === true ? '' : ' is:public'} sort:updated-desc";` and binds it strictly via GraphQL variable `$q: String!`.
  * Executes up to `3` pages (`first: 100`, `$after: String`) using explicit inline fragments & null guards:

    ```graphql
    query DiscoverBots($q: String!, $after: String) {
      search(query: $q, type: ISSUE, first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          __typename
          ... on Issue {
            author { __typename login }
            comments(last: 20) { nodes { author { __typename login } } }
          }
          ... on PullRequest {
            author { __typename login }
            reviews(last: 20) { nodes { author { __typename login } } }
            comments(last: 20) { nodes { author { __typename login } } }
          }
        }
      }
    }
    ```
  * Collects actors where `actor?.__typename === "Bot"` and maps `login` to canonical `${login.endsWith('[bot]') ? login : `${login}\[bot\]`}` filtered against `S3` `botSlug` regex.
  * Aggregates integer `eventEstimate`, sorts descending by `eventEstimate` then ascending `slug`, truncates to `limit`, and enforces `assertValidDiscoverResult(items)` (closed keys `{ slug, eventEstimate }`, regex-checked `slug`, safe positive integer `eventEstimate`, rejecting any unexpected field from `B1`).
* `validateBotSlug(slug)`:
  * Validates `slug` against `S3` `botSlug` regex first (`{ valid: false, slug }` if malformed — never makes a network call on invalid strings).
  * Calls `GET https://api.github.com/users/${encodeURIComponent(slug)}`: `404` → `{ valid: false, slug }`; `200` → `{ valid: data?.type === 'Bot', slug: typeof data?.login === 'string' && botSlugRe.test(data.login) ? data.login : slug }`; `401` → throws `AuthError`. (UI input helper appends `[bot]` before validation if user types a bare slug without brackets.)

### Hybrid Collection & Completeness (`src/collector/collect.mjs`)

* Validates `config` via `normalizeConfig()` (`src/collector/config.mjs`, zero `src/cli/` imports) at entry (`typeof config.includePrivate === 'boolean'` checked strictly; `--include-private` override requires boolean); computes UTC Sunday-aligned `[startDate, endDate]`.
* Returns `{ counts, warnings }` (running `assertStrictCountsOnly(counts)` before returning; `warnings` is a clean array of `{ code, agent, metric, detail }` using zero repo names, titles, URLs, or node IDs).
* Checks `X-OAuth-Scopes` header (when returned) on `includePrivate === true` runs; if header is present and omits `repo`, emits `{ code: 'SCOPE_CAVEAT', detail: 'Token may lack repo scope; fine-grained PATs omit scope headers' }` **at most once per** `collectActivity` **call** (deduplicated across paginated/multi-agent requests).
* **Metric Queries** (`scope = "${config.scopeType}:${config.owner}"`, `pub = includePrivate === true ? '' : ' is:public'`, `base = slug.replace(/\[bot\]$/i, '').toLowerCase()`; skip any metric whose boolean flag in `config.metrics` is `false`):
  * **GraphQL** `search` **pagination rule:** All 5 GraphQL `search` queries accept `$q: String!, $after: String`, select `issueCount`, `pageInfo { hasNextPage endCursor }`, and `nodes`, and iterate `while (pageInfo.hasNextPage)` up to `1,000` items per non-bisected window (`incomplete_results` is NEVER selected in GraphQL queries).
  1. `prsOpened`: GraphQL `search(query: $q, type: ISSUE, first: 100, after: $after)` with `q = "is:pr author:app/${base} ${scope}${pub} created:${s0}..${s1}"` → buckets `createdAt.slice(0, 10)` clamped strictly to `[startDate, endDate]`.
  2. `prsMerged`: GraphQL `search` (`$q`, `$after`) with `q = "is:pr is:merged author:app/${base} ${scope}${pub} merged:${s0}..${s1}"` → buckets `mergedAt.slice(0, 10)` clamped strictly to `[startDate, endDate]`.
  3. `issues`: GraphQL `search` (`$q`, `$after`) with `q = "is:issue author:app/${base} ${scope}${pub} created:${s0}..${s1}"` → buckets `createdAt.slice(0, 10)` clamped strictly to `[startDate, endDate]`.
  4. `reviews` & `comments` (`IssueComment` only; inline diff comments excluded in V1):
     * Search query uses `q = "is:pr reviewed-by:app/${base} ${scope}${pub} updated:>=${s0}"` (and `"commenter:app/${base} ${scope}${pub} updated:>=${s0}"` on initial window `[startDate, bisectUpperBound]` where `bisectUpperBound = max(utcToday, endDate)`, bisecting upper half cleanly up to `bisectUpperBound` when `issueCount > 1000` so `--date <pastDate>` or future-dated fixture runs never hit inverted bounds or drop PRs/issues edited later by humans).
     * Search nodes select `id` + initial `reviews(first: 100)` / `comments(first: 100)` (`pageInfo { hasNextPage endCursor }`, `nodes { id createdAt author { __typename login } }`).
     * Whenever `pageInfo.hasNextPage === true` on a returned `Issue`/`PullRequest`, executes follow-up GraphQL `node(id: $nodeId)` cursor pagination until all reviews/comments for that item are collected.
     * Filters strictly on `node.author?.__typename === 'Bot'` AND `(login === base || login === slugLower)` (case-insensitive) AND UTC `createdAt.slice(0, 10)` within `[startDate, endDate]`.
  5. `commits`: REST `GET /search/commits` (`URLSearchParams({ q: "author:${slug} ${scope}${pub} author-date:${s0}..${s1}", per_page: '100', page: String(page) })`, default branch only) through serialized queue enforcing `>= 2,100 ms` between REST search calls → normalizes `commit.author.date` via `new Date(...).toISOString().slice(0, 10)` clamped strictly to `[startDate, endDate]`.
     * REST pagination stops when `items.length < 100`, `page * 100 >= Math.min(total_count, 1000)`, or `Link` response header lacks `rel="next"`.
* **In-memory deduplication:** Per-metric `Set` of node IDs / commit SHAs lives solely inside `collectActivity` stack frame and is never persisted or returned.
* **Adaptive Date Bisection &** `incomplete_results` **(protocol-scoped):**
  * GraphQL triggers bisection solely on `issueCount > 1000`; REST `/search/commits` triggers bisection on `total_count > 1000 || incomplete_results === true`.
  * When triggered and `s0 < s1`: split `[s0, s1]` at UTC day midpoint and recurse.
  * When `s0 === s1`: if REST `incomplete_results === true`, retry up to `3` times with backoff then emit `{ code: 'INCOMPLETE_RESULTS', agent: slug, metric, date: s0 }`; if `> 1,000` results, cap at `1,000` and emit `{ code: 'TRUNCATED_1000', agent: slug, metric, date: s0 }`.

---

## S5. Module `renderer` (Pure Browser + Node ESM)

Zero `node:*` imports so the exact same code runs in CLI, local `builder-ui`, and static `dist-pages/`.

### Embedded Color Tables & Palettes (`src/renderer/palettes.mjs`)

All color lookups use frozen objects + `Object.hasOwn` / `Map.get()` (falling back safely to `emerald` only on internal defaults after strict schema validation rejects unknown keys):

* `GITHUB_THEME`**:**
  * `light`: `{ bg: '#ffffff', border: '#d1d9e0', divider: '#eaeef2', ink: '#1f2328', muted: '#59636e', badgeBg: '#f6f8fa', badgeText: '#59636e', empty: '#eff2f5' }`
  * `dark`: `{ bg: '#0d1117', border: '#30363d', divider: '#21262d', ink: '#e6edf3', muted: '#8d96a0', badgeBg: '#161b22', badgeText: '#8d96a0', empty: '#161b22' }`
* `COLOR_RAMPS` **(**`[level0, level1, level2, level3, level4]`**):**
  * `emerald` (`Emerald`): `light: ['#eff2f5', '#9be9a8', '#40c463', '#30a14e', '#216e39']`, `dark: ['#161b22', '#0e4429', '#006d32', '#26a641', '#39d353']`
  * `cobalt` (`Cobalt`): `light: ['#eff2f5', '#b6e3ff', '#54aeff', '#0969da', '#0550ae']`, `dark: ['#161b22', '#0c2d6b', '#1158c7', '#388bfd', '#79c0ff']`
  * `amber` (`Star Amber`): `light: ['#eff2f5', '#ffd8b5', '#fb8f44', '#d44d2e', '#9a2f15']`, `dark: ['#161b22', '#4a2010', '#8f3918', '#d44d2e', '#ff8b66']`
  * `violet` (`Violet`): `light: ['#eff2f5', '#e2c5ff', '#a371f7', '#8250df', '#5a32a3']`, `dark: ['#161b22', '#271052', '#553098', '#8957e5', '#c297ff']`
  * `rose` (`Crimson`): `light: ['#eff2f5', '#ffcecb', '#ff8182', '#cf222e', '#82071e']`, `dark: ['#161b22', '#4c1118', '#8e1519', '#da3633', '#ff7b72']`
  * `teal` (`Teal`): `light: ['#eff2f5', '#a5f3fc', '#22d3ee', '#0e7490', '#164e63']`, `dark: ['#161b22', '#0c3b45', '#155e75', '#0891b2', '#67e8f9']`
* `NEUTRAL_LEGEND_RAMP` (for multi-agent unified card legend):
  * `light: ['#eff2f5', '#c8d1da', '#9aa6b2', '#68737f', '#3b434b']`
  * `dark: ['#161b22', '#30363d', '#545d68', '#8b949e', '#c9d1d9']`

### Geometry & Variants (`src/renderer/svg.mjs`)

* Supports explicit render options `{ owner, scopeType, layout, detail, markStyle, labelMode, branch, subpath, markdownBase, allowEmpty }` (reading grid dimensions cleanly from `counts.window.weeks`):
  * `52w`: `width: 820`, `gridX: 52`, `cellSize: 11`, `cellGap: 3`, `step: 14`, `rx: 2`, `dotRadii: [1.3, 2.5, 3.5, 4.5, 5.4]`.
  * `26w`: `width: 580`, `gridX: 52`, `cellSize: 15`, `cellGap: 4`, `step: 19`, `rx: 3`, `dotRadii: [1.6, 3.2, 4.6, 6.0, 7.2]`.
  * Legend dots: `[1.4, 2.4, 3.4, 4.3, 5.1]`, squares `10x10` `rx="2"`.
  * Quantization `quantizeLevel(count, maxCount)`: `<= 0` → `0`; `maxCount <= 1` → `2`; `<= 0.25` → `1`; `<= 0.52` → `2`; `<= 0.78` → `3`; else `4`.
  * `detail`: `'breakdown'` renders totals + streaks; `'minimal'` renders compact counts + heatmap grid only.
  * `labelMode`: `'friendly'` renders `agent.label` + monospace `agent.slug`; `'raw'` renders `agent.slug` primary.
  * `allowEmpty: true` (used in `builder-ui` 0-agent preview): renders empty state `unified-<weeks>w-<theme>.svg` (`height: 140`) cleanly without breaking `counts.json` file persistence (`1..12` agents).
  * Separate filenames derive strictly via `slug.replace(/\[bot\]$/i, '').toLowerCase() + '-' + weeks + 'w-' + theme + '.svg'`.

### Sanitization, Camo Checks & Markdown (`src/renderer/sanitize.mjs` & `markdown.mjs`)

* System font stacks only (`-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif` and `ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace`).
* `stripControlChars(s)` removes C0/C1, `\u200E`, `\u200F`, `\u061C`, `\u202A-\u202E`, `\u2066-\u2069`, and unpaired UTF-16 surrogates (`toWellFormed` / lookaround).
* `escapeXml(s)` maps strictly the 5 named XML entities `&` → `&amp;`, `<` → `&lt;`, `>` → `&gt;`, `"` → `&quot;`, `'` → `&apos;` (**never** numeric `&#39;` / `&#x27;`). All interpolated SVG/Markdown values run through `escapeXml(stripControlChars(v))`.
* `assertCamoSafeSvg(svg)`:
  * Checks non-empty UTF-8 `svg.isWellFormed()` string with zero unpaired surrogates, verifying `<svg` opening tag declares a single exact `xmlns="http://www.w3.org/2000/svg"` attribute and closes with `</svg>`.
  * Rejects ANY secondary namespace declaration (`/\bxmlns:/i`, preventing `<s:script>` bypasses) and rejects active elements, including namespace-prefixed element tags, scripts, URLs, and numeric entities: `/<!DOCTYPE\b/i`, `/<!ENTITY\b/i`, `/<(?:[a-z0-9_-]+:)?(?:script|foreignObject|style|use|image|animate[a-z]*|set|discard|feImage|iframe|embed|object|a)\b/i`, `/\b(?:xlink:)?href\s*=/i`, `/javascript:/i`, `/vbscript:/i`, `/data:/i`, `/@import\b/i`, `/url\(/i`, `/&#(?:x[0-9a-f]+|\d+)/i` (semicolon optional!).
  * Creates a temporary check copy stripping **ONLY** the verified single root `<svg ...>` tag's exact `xmlns="http://www.w3.org/2000/svg"` attribute substring, and rejects ANY remaining `/https?:\/\//i` match anywhere in the document!
  * Walks every `<...>` tag using a **quote-aware scanner** (respecting `'...'` and `"..."` attribute delimiters so `>` inside attributes like `<rect id=">" onload=...>` cannot break attribute scanning) and rejects any tag containing `/\bon[a-z]+\s*=/i` or `/\bstyle\s*=/i` (while preserving harmless `<text>` content such as `"button=1"`!).
* `renderMarkdownSnippet({ owner, scopeType = 'user', branch = 'generated', subpath = 'agent-activity', markdownBase = 'raw', layout, windowWeeks, agents })`:
  * If `agents.length === 0` (`allowEmpty` UI preview), returns `""` cleanly for both `unified` and `separate`.
  * Resolves profile repo slug cleanly: `scopeType === 'org' ? `${owner}/.github`:`${owner}/${owner}\`\`.
  * Validates `owner`, `branch`, `subpath`, `markdownBase`; normalizes base path (`raw` → `https://raw.githubusercontent.com/${repoSlug}/${branch}${subpath ? `/${subpath}` : ''}`, or `relative` → `./${subpath ? `${subpath}/` : ''}` trimmed).
  * Applies `escapeXml()` to EVERY attribute (`alt`, `src`, `srcset`).

---

## S6. Module `cli`

### Commands, Flags & Defaults

```text
lynceus --help | --version
lynceus [init]     [--config <path>] [--port <port>] [--no-open] [--include-private]
lynceus collect    [--config <path>] [--out <counts.json>] [--include-private] [--public-only] [--date <YYYY-MM-DD>] [--quiet]
lynceus render     [--counts <counts.json>] [--config <path>] [--out-dir <dir>]
                   [--owner <slug>] [--scope-type <user|org>] [--layout <unified|separate>]
                   [--detail <breakdown|minimal>] [--mark-style <squares|magnitude>]
                   [--label-mode <friendly|raw>] [--branch <name>] [--subpath <path>]
                   [--markdown-base <raw|relative>] [--quiet]
lynceus build      [--config <path>] [--out-dir <dir>] [--counts-out <path>] [--include-private] [--public-only] [--date <YYYY-MM-DD>] [--quiet]
lynceus schedule   [--config <path>] [--out-dir <dir>] [--script-path <path>] [--target <task-scheduler|cron|actions>]
                   [--repo-dir <path>] [--owner <slug>] [--branch <name>] [--subpath <path>]
                   [--include-private] [--public-only] [--tool-ref <40-hex-sha>] [--package-pin <spec>]
                   [--git-name <name>] [--git-email <email>] [--task-name <name>]
```

Rules:

* Default subcommand: `init`.
* Default `init` `--port`: `4173`; if `--port` is omitted and `4173` hits `EADDRINUSE`, falls back to ephemeral port `0`; an explicit `--port <N>` (`N > 0`) exits `5` if bind fails (`EADDRINUSE` / `EACCES`); explicit `--port 0` binds an ephemeral port.
* `lynceus init` auto-load safety: when `lynceus init` loads `./lynceus.json` (or `--config`), reset `config.includePrivate` to `false` inside server RAM unless explicit `--include-private` is passed on CLI (the user can still explicitly check `Opt-in Private Counts` in the UI `Configure` tab).
* Default `--config`: `./lynceus.json`. For `render`: defaults `--counts` to `./counts.json` (read & validated via `readBoundedJsonFile` + `assertStrictCountsOnly`, `exit 2` on invalid schema/counts); if `--config` is omitted and `./lynceus.json` absent, explicit CLI flags override defaults (`layout: "unified"`, `detail: "breakdown"`, `markStyle: "squares"`, `labelMode: "friendly"`, `branch: "generated"`, `subpath: "agent-activity"`, `markdownBase: "raw"`, requiring `--owner` when `markdownBase === "raw"` else `exit 2`).
* Default `collect --out`: `./counts.json`; default `render`/`build` `--out-dir`: `./agent-activity`.
* `build`: writes SVGs to `--out-dir`, prints the `<picture>` Markdown snippet to `stdout` (unless `--quiet`), and writes `counts.json` **ONLY** when `--counts-out <path>` is specified. (`render` also prints `<picture>` to `stdout` unless `--quiet`.)
* `collect` & `build` print scrubbed non-fatal `warnings` (each sanitized through `redactSecrets()`) to `stderr` unless `--quiet`.
* `lynceus schedule`: requires an existing valid `--config` read via `readBoundedJsonFile` (`exit 2` if missing so config schema and private gating always evaluate cleanly); `--owner <slug>` overrides `config.owner` (which also derives the default noreply commit email `${owner}@users.noreply.github.com` when `--git-email` is omitted). Defaults: `--target` = `task-scheduler` on `win32` else `cron`; `--repo-dir .`; `--out-dir` defaults to a private subdir inside the snippet's `0o700` ephemeral temp workspace; `--task-name LynceusProfileRefresh`; prints snippet & instructions to `stdout`. Passing `--script-path` with `--target actions`, or passing BOTH `--tool-ref` and `--package-pin` simultaneously, fails immediately (`exit 2` CLI / `400` API).
* Validation errors (`--port` outside `0..65535`, malformed `--date`, unknown flag, invalid `lynceus.json`) exit `2`. `--help`/`--version` exit `0`.
* **Explicit** `--include-private` **Safety Gate & Conflict Rejection:**
  * Passing BOTH `--include-private` and `--public-only` on `collect`, `build`, or `schedule` fails immediately (`exit 2`).
  * When `config.includePrivate === true` and `--public-only` is NOT passed, `collect`, `build`, AND local `schedule` (`task-scheduler` / `cron`) ALL require explicit `--include-private` on the CLI (else `exit 2` explaining how to pass `--include-private` or `--public-only`).
  * `--target actions` ALWAYS enforces `--public-only`: passing `--include-private`, or loading `config.includePrivate: true` without `--public-only`, exits `2`.
  * `--help` text carries an explicit caveat that pushed `--include-private` SVGs persist visible daily totals in public repository history.
* **Browser launch (**`lynceus init`**):** Unless `--no-open`:
  * `win32`: resolves `rundll32.exe` strictly via `path.join(systemRoot, 'System32', 'rundll32.exe')` after verifying `process.env.SystemRoot` is non-empty, `path.isAbsolute(systemRoot)`, and `statSync(candidate).isFile()`; spawns `[ 'url.dll,FileProtocolHandler', url ]`.
  * `darwin` / `linux`: resolves `open` / `xdg-open` strictly via `resolveSafeExecutable()` (`S4`, non-empty absolute `PATH` segments only, verifying file + execute bit).
  * Spawns with `{ shell: false, cwd: os.tmpdir(), stdio: 'ignore' }`. Missing binary or spawn error logs the localhost URL to terminal and keeps the server running cleanly (`exit 0` normal startup).
* `lynceus init --config <path>`**:** Validates `lynceus.json` via `readBoundedJsonFile` + `config.mjs` at startup, enforces the auto-load `includePrivate: false` reset rule above, and serves it strictly through authenticated `POST /api/config` (never HTML-interpolated).

### Exit Codes

* `0`: Success · `2`: Usage / config / flag / validation / private-gate error · `3`: Auth missing or rejected · `4`: GitHub API / timeout / rate-limit error · `5`: Filesystem / path-confinement / symlink / port-bind error.

### Filesystem Confinement & Atomic Writes (`src/cli/fs-safe.mjs`)

* **Trusted Anchor Rule (**`resolveTrustedAnchor`**):** When checking `targetPath = path.resolve(p)`:
  1. If `targetPath` is lexically inside `process.cwd()`, start component walk from `anchorReal = realpathSync(process.cwd())`.
  2. Else if `targetPath` is lexically inside `os.tmpdir()`, start component walk from `anchorReal = realpathSync(os.tmpdir())` (safely handling macOS `/var` → `/private/var` and `/tmp` → `/private/tmp` OS root symlinks without weakening child-directory confinement!).
  3. Else start from filesystem root/drive anchor (on `darwin` skipping ONLY exact root OS alias `/var` → `/private/var` and `/tmp` → `/private/tmp` when normalizing targets under them).
  * From that trusted anchor down through every existing component to `targetPath` itself, call `lstatSync()` and reject `isSymbolicLink()` (`exit 5`) BEFORE `mkdirSync` / reads.
* **Explicit File Entrypoints:**
  1. `writeSvgArtifact(outDir, filename, content)` (`exit 5`):
     * Validates `filename` matches `/^(?:unified|[a-z0-9-]+)-(?:26|52)w-(?:light|dark)\.svg$/`.
     * Walks segments from trusted anchor via `lstatSync` rejecting symlinks before `mkdirSync(..., { recursive: true })`, verifies post-`mkdirSync` `realpathSync(resolvedDir)` confinement against anchor, and checks target file `lstatSync` (`isSymbolicLink()` rejected).
     * Writes sibling temp `${target}.tmp-${process.pid}-${randomBytes(8).toString('hex')}` with `{ flag: 'wx', mode: 0o644 }` and atomically `renameSync`s over `target`.
  2. `writeVerifiedJson(filePath, countsObj)` (`exit 5` FS / `PrivacyGateError`):
     * Creates missing parent directories via `mkdirSync(path.dirname(target), { recursive: true })` under the exact same pre- and post-`mkdirSync` trusted-anchor `lstatSync`/`realpathSync` confinement and target `lstatSync` check as `writeSvgArtifact`.
     * Runs `assertStrictCountsOnly(countsObj)` right before write, writes atomic temp with `{ flag: 'wx', mode: countsObj.scope.mode === 'public+private' ? 0o600 : 0o644 }`, and atomically `renameSync`s over `filePath`.
  3. `readBoundedJsonFile(filePath, maxBytes)` (`exit 5` FS/symlink, `exit 2` oversize/invalid JSON):
     * Enforces trusted-anchor `lstatSync` symlink rejection on ancestors AND target (`!stat.isFile()` rejected `exit 5`), verifies `stat.size <= maxBytes` (`65_536` for `lynceus.json`, `1_048_576` for `counts.json`), reads UTF-8, and catches `JSON.parse` errors to throw an opaque `ValidationError` containing **zero raw file content excerpts**.

### Safe Refresh Snippets (`src/cli/snippets.mjs`)

Reused by `lynceus schedule` and `builder-ui`'s `Schedule` tab (`POST /api/schedule`):

* **Default private non-repo script path (**`task-scheduler`**,** `cron`**):** When `--script-path` / `scriptPath` is omitted on local targets, resolve `resolvedConfig` (`path.resolve(configPath)`) and `resolvedRepo` (`path.resolve(repoDir)`); if `resolvedConfig` lies strictly outside `resolvedRepo` (case-insensitive on `win32`) and outside shared temp dirs (`os.tmpdir()`, `realpathSync(os.tmpdir())`, `/tmp`, `/var/tmp`), default `<abs-script-path>` to sibling `path.join(path.dirname(resolvedConfig), target === 'task-scheduler' ? 'lynceus-refresh.ps1' : 'lynceus-refresh.sh')`; otherwise default to the user-private local state dir (`%LOCALAPPDATA%\lynceus\lynceus-refresh.ps1`, fallback `path.join(os.homedir(), 'AppData', 'Local', 'lynceus', 'lynceus-refresh.ps1')` on `win32`; `${XDG_STATE_HOME:-$HOME/.local/state}/lynceus/lynceus-refresh.sh` on POSIX). Reject (`exit 2` CLI / `400` API) any computed OR explicit resolved `<abs-script-path>` inside `resolvedRepo` or inside `os.tmpdir()`, `realpathSync(os.tmpdir())`, `/tmp`, or `/var/tmp`.
* **Local vs CI path normalization & Post-**`path.resolve()` **validation:** Reject leading `-` on raw `--config`, `--repo-dir`, `--out-dir`, and `--script-path` across ALL targets before resolution/normalization. For local targets (`task-scheduler`, `cron`), resolve `--repo-dir`, `--config`, explicit `--out-dir` (when supplied), `--script-path` (or computed default), and `<resolved-bin-path>` via `path.resolve()` **BEFORE** running the strict character/metacharacter validator so unattended runs under `System32` / `$HOME` locate explicit relative paths cleanly AND cloned CWD/binary/wrapper paths are checked post-resolution. For `actions`, strip a single leading `./` from default `./lynceus.json` if present, then enforce closed repo-relative POSIX validation `/^(?!-)[a-zA-Z0-9._-]+(?:\/[a-zA-Z0-9._-]+)*$/` (rejecting leading `-`, leading `/`, `\`, any `.` or `..` segment, and any `.git` segment) on BOTH `--config` and explicit `--out-dir` (plus zero workstation paths).
* **Strict closed-pattern validation:** Reject `--tool-ref` + `--package-pin` supplied together (`exit 2` / `400`). After local `path.resolve()` / `actions` normalization, reject `\r`, `\n`, `\u0000`–`\u001F`, `\u007F`–`\u009F` (including C1 `\u0085`), `\u2028`, `\u2029` (YAML 1.1 line separators), PowerShell Unicode quote equivalents (`\u2018`–`\u201B`, `\u201C`–`\u201E`), and shell metacharacters (`"`, `$`, `` ` ``, `;`, `|`, `<`, `>`, `&`) across ALL parameters and ALL resolved/derived paths (`owner`, `scopeType`, `branch`, `subpath`, `--config`, `--repo-dir`, `--out-dir`, `--script-path`, `<abs-ps1-path>`, `<abs-sh-path>`, `<resolved-bin-path>`, `--tool-ref` `/^[0-9a-f]{40}$/i`, `--package-pin` locked strictly to `/^lynceus@[0-9]+\.[0-9]+\.[0-9]+(?:-[a-zA-Z0-9.-]+)?$/` matching `S2` `"name": "lynceus"`, `--git-name` `/^[a-zA-Z0-9 ._-]{1,64}$/`, `--git-email` `/^[a-zA-Z0-9._+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/` \[no `%`\], `--task-name` `/^[a-zA-Z0-9_-]{1,64}$/`). For `task-scheduler`, additionally reject trailing `\` on `<abs-ps1-path>` (Win32 `CommandLineToArgvW` `\"` escape hazard). For `cron`, additionally reject `%` on ALL post-resolve local paths (`resolvedRepo`, `resolvedConfig`, explicit `--out-dir`, `<abs-sh-path>`, `<resolved-bin-path>`) and `--git-email` so Vixie/POSIX `crontab` never splits commands on `%`.
* **Safe Quoting & Invocation:**
  * **Windows Task Scheduler (**`--target task-scheduler`**):** Generates a standalone `.ps1` script + pinned registration command `New-ScheduledTaskAction -Execute 'powershell.exe' -Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<abs-ps1-path>"'` (doubling any `'` inside `<abs-ps1-path>` as `''` inside the outer PowerShell single-quoted `-Argument` string while double-quoting `-File "..."` for Win32 `CommandLineToArgvW`; zero inline double-quoted command payloads inside `-Argument`). Generated `instructions` mandate saving `.ps1` in a user-private folder with user-only ACLs outside `--repo-dir`, and `.ps1` cleanup removes ONLY the script-created ephemeral temp dir (never deleting an explicit user-supplied `--out-dir`). Inside `.ps1`, **every** quoted command invocation MUST prefix the PowerShell call operator `&`: `& 'node' '<resolved-bin-path>' 'build' ...`, `& 'git' ...`, `& 'lynceus' ...` (ASCII `'...'` with `'` doubled `''`).
  * **POSIX** `cron` **(**`--target cron`**):** Generates a standalone POSIX `.sh` wrapper script (single-quoted `'node' '<resolved-bin-path>' 'build' ...` without `&`, escaping `'` as `'\''`, placing `--` before path operands such as `mkdir -p --`, `cp --`, `rm -rf --`, and cleaning up ONLY the script-created `mktemp -d` temp dir) invoked from a single `%`-free `crontab` line (`0 6 * * * /bin/sh '<abs-sh-path>'`), with generated `instructions` mandating `chmod 600 '<abs-sh-path>'` in a user-private folder outside `--repo-dir`.
  * **GitHub Actions (**`--target actions`**):** Binds inputs in `env:` with YAML single quotes (`'...'` doubling `'`), places `--` before path operands in `run:`, and uses zero `${{ }}` inside `run:`; restricts triggers strictly to `on: { schedule: [...], workflow_dispatch: {} }` (never `pull_request` / `pull_request_target`).
* **Default-branch check & ref-pinned push:**
  * Validate `targetBranch` against `S3` `branch` rule (rejects `main`, `master`, `HEAD`, and `refs/`/`heads/`/`tags/`/`remotes/`).
  * Inspect remote default branch at runtime using `git ls-remote --symref origin HEAD`, extracting `ref: refs/heads/<default>` (failing non-zero if `origin` fails, `--symref` yields no head ref, or `<default>` equals `targetBranch` case-insensitively).
  * Resolve current remote branch SHA via `git ls-remote --heads origin "refs/heads/${targetBranch}"`; push strictly to `refs/heads/${targetBranch}` using `--force-with-lease=refs/heads/${targetBranch}:${oldSha}` when `<oldSha>` is non-empty, else initial `git push origin HEAD:refs/heads/${targetBranch}`.
* **Four Strict Security Invariants:**
  1. **Pinned execution & pre-publish Actions source:**
     * Local Task Scheduler & POSIX `cron`: invoke pinned resolved local `node` + `bin/lynceus.mjs` (using `& 'node'` in PowerShell; `'lynceus'` only with explicit `--package-pin`; NEVER unpinned `npx`).
     * GitHub Actions (`--target actions`): exports named 40-hex commit SHA constants `PINNED_ACTIONS_CHECKOUT` (`actions/checkout` v4 40-hex SHA) and `PINNED_ACTIONS_SETUP_NODE` (`actions/setup-node` v4 40-hex SHA with `node-version: '24'`) and `DEFAULT_TOOL_REF` (either `null` before `v0.1.0` commit exists, updated to the pinned 40-hex release commit SHA at `S13` Deploy). `generateScheduleSnippet(options)` accepts an internal optional `defaultToolRef = DEFAULT_TOOL_REF` override (not exposed on CLI flags or HTTP payloads) so `C11` tests pre-publish `null` rejection and 40-hex resolution deterministically across releases. Pre-publish (no `--package-pin`), requires a resolved 40-hex `--tool-ref` (from `toolRef` / `--tool-ref` or non-null `defaultToolRef`, failing cleanly `exit 2` CLI / `400` API if unset — never falling back to mutable branch names or unrunnable placeholders), checks out `mephistopheles4/lynceus` via `actions/checkout@<sha>` with `repository: 'mephistopheles4/lynceus'`, `ref: '<40-hex-sha>'`, `path: '.lynceus-tool'`, `persist-credentials: false`, and runs `node .lynceus-tool/bin/lynceus.mjs build --public-only ...`. Only emits `npm install -g '<package-pin>' --ignore-scripts` if explicit validated `--package-pin` (strictly unscoped `lynceus@...`) is supplied post-publish (and fails `exit 2`/`400` if supplied alongside `--tool-ref`). Sets `permissions: { contents: write }`, always enforces `--public-only`, and documents `GITHUB_TOKEN` single-repo search behavior.
  2. **SVGs only (**`counts.json` **never pushed publicly):** Stages ONLY generated `*.svg` under `${subpath ? subpath : '.'}` (`./*.svg` when `subpath === ""`, never `/*.svg`) — NEVER commits or pushes `counts.json`.
  3. **Single-commit replaced orphan** `generated` **branch + no-op skip:** Fetches `origin refs/heads/${targetBranch}` (if `<oldSha>` exists) to compare the existing SVG tree hash; skips push on identical trees; otherwise builds a single parentless orphan commit inside a private `0o700` temp workspace (`mktemp -d` on POSIX, per-user `$env:TEMP\lynceus-<guid>` on Windows, cleaned unconditionally in `trap` / `try..finally`), aborts on non-zero `build` exit, and updates strictly `refs/heads/${targetBranch}`.
  4. **Non-PII UTC unsigned git identity:** Commits with explicit `-c user.name="lynceus-bot" -c user.email="${owner}@users.noreply.github.com" -c commit.gpgsign=false -c tag.gpgsign=false` (plus `--no-gpg-sign` / unsigned `git commit-tree`, overridable via `--git-name`/`--git-email`) and UTC (`+0000`) dates. Documents `cron` `PATH` setup and Task Scheduler OS user-context.

---

## S7. Module `builder-ui`

### Unified Single-Page Architecture (`index.html`, `styles.css`, `app.js`)

Adheres strictly to **Agent Atlas** (`DESIGN.md`):

* Observatory shell (`#0A1021` Night Sky, `#111B33` Indigo Plate, `#090E1C` Deep Well, `#B9381D` Star Amber CTAs, `#E8A878` Glow Amber, `#4ADE80` Ephemeris Green, `#FCA5A5` Alert Coral) with isolated `838px` GitHub Light/Dark README preview specimen.
* **Zero** `innerHTML` **& Zero inline** `style=`**:** Uses `document.createElement` + `textContent`; renders SVGs via `URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))` inside `<img src="blob:...">`; renders non-fatal scrubbed `warnings` from `POST /api/preview`, fatal `POST /api/*` error banners (scoped so `POST /api/preview` / `POST /api/discover` errors clear stale SVG previews while `POST /api/schedule` errors clear ONLY stale schedule output, keeping valid Workbench SVG previews intact), and any non-empty `privacyNotice` in the `Schedule` tab strictly via `textContent`.
* **Relative paths, favicon & leak-free shared copy:** `public/index.html` links `./styles.css`, `./app.js`, static `./favicon.ico` (`S2`), `./demo-data.js`, and imports `./renderer/*.mjs` via relative `./` URLs so `dist-pages/` runs identically under GitHub Pages `/<repo>/` subpaths with zero `404`s. Shared `public/*` text avoids banned static-scan strings (`127.0.0.1`, `api.github.com`, `GITHUB_TOKEN`).
* **One-time Bootstrap Handoff (**`server.mjs` **->** `app.js`**):** `public/index.html` contains only a static comment marker `<!-- LYNCEUS_BOOTSTRAP -->` before `<script type="module" src="./app.js"></script>`. Localhost `GET /` replaces `<!-- LYNCEUS_BOOTSTRAP -->` in RAM with `<script nonce="<perRequest16B>">window.__LYNCEUS_BOOTSTRAP__={token:<json>,mode:"local"};document.currentScript.remove();</script>`, and `app.js` captures & immediately deletes `window.__LYNCEUS_BOOTSTRAP__` into module closure. Static `dist-pages/index.html` keeps the HTML comment intact (`window.__LYNCEUS_BOOTSTRAP__ === undefined`), booting purely in Pages `SYNTHETIC DEMO DATA` mode with **zero** HTTP `/api/*` calls (showing static CLI guidance for `lynceus schedule` in the `Schedule` tab).
* **Single-page unified layout:**
  * Top bar: Wordmark + switcher (`Configure` | `Workbench`) + privacy seal (`COUNTS ONLY · 0 REPO NAMES · 0 TITLES`) + permanent `SYNTHETIC DEMO DATA` pill in Pages mode.
  * `Configure` **view:** Owner & user/org selector, Bot discovery roster + validated `[bot]` add form, Labels & 6 Color Ramp swatches, Metric toggles, **Opt-in Private Counts** toggle carrying *"Daily total counts pushed to a public repo stay visible in public git history"*, `branch`/`subpath`/`markdownBase` inputs.
  * `Workbench` **view:** Layout (`Unified` / `Separate`), Window (`52w` / `26w`), Detail (`Breakdown` / `Minimal`), Marks (`Squares` / `Magnitude`), Labels (`Friendly` / `Raw`), Preview mode (`Side-by-Side` / `Single`), embedded `838px` Light/Dark README preview, Browser `Blob` exports (`lynceus.json`, `.svg` files), and tabs (`lynceus.json`, `<picture>` Markdown, `counts.json` Privacy Audit, `Schedule` tab).
  * `Schedule` **tab edge states:** When `agents.length === 0`, renders inline guidance prompting the user to add at least `1` agent before generating a schedule instead of calling `POST /api/schedule`; exposes optional `scriptPath` (local targets), `toolRef` (40-hex SHA) and optional `packagePin` (for `actions`), and shows clear inline pre-publish guidance when `DEFAULT_TOOL_REF === null` and private-mode guidance when `includePrivate: true`. In live mode with `>= 1` agent, renders a `Download script` (`Blob`) button for `filename` alongside `snippet`, `scriptPath`, `instructions` (`chmod 600` / user-private non-repo folder), and any non-empty `privacyNotice` in a `textContent` banner.
* **Decoupled render cache (**`52w` **/** `26w` **reconciled):** Browser caches `counts` keyed by `(owner, scopeType, includePrivate, windowWeeks, metrics, agents)` and calls `src/renderer/*.mjs` directly in-browser for instant (`< 25 ms`) re-renders ONLY on visual options `(layout, detail, markStyle, labelMode, ramp, theme)`. Toggling `52w` ↔ `26w` fetches `POST /api/preview` in live mode and swaps pre-built `52w`/`26w` `demo-data.js` counts presets in synthetic/Pages mode **while preserving** the user's current `Configure` edits (`owner`, `scopeType`, agent labels/ramps, `metrics`, `layout`, `detail`, `markStyle`, `labelMode`). Zero `localStorage`/`sessionStorage` in localhost mode.

### Localhost Read-Only HTTP Server (`server.mjs` & `security.mjs`)

* Listens strictly on `127.0.0.1` (`server.listen(port, '127.0.0.1')`). Zero disk-write endpoints.
* **Pre-route Guards (EVERY incoming HTTP request before static or API dispatch):**
  1. `Host` header MUST equal exact `127.0.0.1:<actualPort>` → `400` (`GET /`, static `GET` routes, AND `POST /api/*`).
  2. Method check: only exact `GET` (for the static allowlist below) and exact `POST` (for `/api/*`); all other methods (`OPTIONS`, `PUT`, `DELETE`, `HEAD`, etc.) return `405` with zero CORS headers.
* **Exact static GET allowlist (explicit MIME** `Content-Type` **for** `nosniff`**, unknown GET →** `404`**):**
  * `GET /` (`text/html; charset=utf-8`), `GET /styles.css` (`text/css; charset=utf-8`), `GET /app.js` (`text/javascript; charset=utf-8`), `GET /demo-data.js` (`text/javascript; charset=utf-8`), `GET /favicon.ico` (`image/x-icon`), `GET /renderer/palettes.mjs`, `GET /renderer/sanitize.mjs`, `GET /renderer/svg.mjs`, `GET /renderer/markdown.mjs` (`text/javascript; charset=utf-8`).
  * Zero third-party fonts (`font-family` system stacks).
* **All API endpoints are** `POST` (`POST /api/status`, `POST /api/config`, `POST /api/discover`, `POST /api/validate-bot`, `POST /api/preview`, `POST /api/schedule`):
  1. `Host` (`400`, checked pre-route).
  2. `Origin` header MUST equal exact `http://127.0.0.1:<actualPort>` → `403`.
  3. `Sec-Fetch-Site` header (when present) MUST equal `'same-origin'` → `403`.
  4. `Authorization: Bearer <sessionToken>` matched via SHA-256 `timingSafeEqual` → `401`.
  5. `Content-Type` header media type MUST equal `'application/json'` → `415`; body `<= 32 KB` → `413`; valid JSON required → `400`.
  6. Zero CORS headers emitted.
* **Response Security Headers (ALL responses, including** `400`**/**`404`**/**`405`**/errors):**
  * `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Content-Security-Policy: frame-ancestors 'none'`.
  * `GET /` strengthens CSP to: `default-src 'self'; script-src 'self' 'nonce-<perRequest16B>'; style-src 'self'; img-src 'self' data: blob:; connect-src 'self'; form-action 'none'; frame-ancestors 'none'; base-uri 'none'` (`<perRequest16B>` via `randomBytes(16).toString('base64url')`).
* **API Payload Contracts & Opaque Errors:**
  * `POST /api/status` → `{ authPresent, authSource }` (`"env"|"gh"|null`).
  * `POST /api/config` → `{ hasConfig: boolean, config: <normalized lynceus.json> | null }` (with `includePrivate` forced `false` unless `init` received explicit `--include-private`).
  * `POST /api/discover` body `{ owner, scopeType, includePrivate }` (requires `typeof includePrivate === 'boolean'`) → `{ agents: [{ slug, eventEstimate }] }`.
  * `POST /api/validate-bot` body `{ slug }` → `{ valid, slug }` (`200`).
  * `POST /api/preview` body `{ config, live }` (requires `typeof live === 'boolean'`) → `{ counts, svgs: [{ filename, theme, svg }], markdownSnippet, isSynthetic, warnings }`. Supports `0`-agent empty config preview cleanly (`allowEmpty: true` on synthetic preview; live mode requires `1..12` agents).
  * `POST /api/schedule` body `{ target, config, outDir?, repoDir?, scriptPath?, owner?, branch?, subpath?, toolRef?, packagePin?, gitName?, gitEmail?, taskName? }` → validates `1..12` agents (`400` if empty), rejects `scriptPath` when `target === "actions"` (`400`), rejects simultaneous `toolRef` + `packagePin` (`400`), rejects `target === "actions"` when `config.includePrivate === true` or when pre-publish `toolRef` & `DEFAULT_TOOL_REF` are unset without `packagePin` (`400`), and returns `{ snippet, filename, scriptPath, instructions, privacyNotice }` via `snippets.mjs`.
  * All HTTP error responses return strictly `{ error: <safeCode>, message: <fixedSafeString> }` (zero `err.stack`, local paths, tokens, or GitHub error bodies).

### Static GitHub Pages Demo Bundle (`scripts/build-pages.mjs`)

* Copies `src/builder-ui/public/*` (including `favicon.ico`) + `src/renderer/*.mjs` to `dist-pages/` (`dist-pages/renderer/*.mjs`).
* `demo-data.js` exports matched synthetic `52w` and `26w` `counts.json` v1 presets (`scope.mode: "public"`).
* Self-check at end of `build-pages.mjs` fails non-zero if any emitted file in `dist-pages/` contains `127.0.0.1`, `api.github.com`, `GITHUB_TOKEN`, `lynceus.json` real owner overrides, `counts.json` real data, or local workstation path prefixes.

---

## S8. Module `profile-integration` (`mephistopheles4/mephistopheles4`)

* Locked configuration (`includePrivate: true` stored strictly in local `<private-config-path>` outside `mephistopheles4/lynceus`): `owner: "mephistopheles4"`, `scopeType: "user"`, `includePrivate: true`, `layout: "separate"`, `windowWeeks: 52`, `detail: "breakdown"`, `markStyle: "squares"`, `labelMode: "friendly"`, `branch: "generated"`, `subpath: "agent-activity"`, `markdownBase: "raw"`, all `6` `metrics: true`, `agents`:
  * `mephistos-homunculus[bot]` (`Homunculus`, `emerald`)
  * `mephistos-euphorion[bot]` (`Euphorion`, `cobalt`)
  * `mephistos-wagner[bot]` (`Wagner`, `amber`)
* Runs daily via Windows Task Scheduler (`-TaskName LynceusProfileRefresh`, `StartWhenAvailable`) executing a standalone `.ps1` using PowerShell's `&` call operator (`& 'node' '<resolved-bin-path>' 'build' '--config' '<private-config-path>' '--include-private' '--out-dir' '<private-temp-dir>'`), generated via `lynceus schedule --target task-scheduler --include-private`.
* Updates ONLY a single force-replaced orphan commit on `mephistopheles4/mephistopheles4` `refs/heads/generated` containing ONLY the 6 `.svg` files (never `counts.json`, never touching `main`), unsigned (`-c commit.gpgsign=false`) and authored in UTC (`lynceus-bot`, `mephistopheles4@users.noreply.github.com`).
* `mephistopheles4/mephistopheles4/README.md` embeds 3 `<picture>` blocks (gated on Deploy owner sign-off).

---

## S9. Tech Stack, Commands & Code Style

* **Runtime:** Node.js `>= 24.0.0`, ESM, zero npm dependencies.
* **Commands:**
  * `npm run lint` → `node scripts/lint.mjs` (syntax-checks every `.mjs` & `.js` across `bin/`, `src/`, `scripts/`, `tests/`)
  * `npm test` → `node scripts/test.mjs`
  * `npm run build:pages` → `node scripts/build-pages.mjs`
  * `node bin/lynceus.mjs init --port 4173` → start local Builder UI
* **Code Style:** Small cohesive functions, shallow nesting, early returns, explicit error classes stripped of secrets and internal stacks.

---

## S10. Testing Strategy, Qualities, Environments & Acceptance Claims (`C1`–`C12`)

### Quality Budgets

| Quality | Concrete Target |
| -- | -- |
| **Functional suitability** | Acceptance claims `C1`–`C12` pass deterministically after final build |
| **Performance efficiency** | `renderSvgs` <= `50 ms` for 3 agents / 52w (`~12 ms/band`); mocked CLI `build` <= `500 ms`; rendered unified 52w SVG <= `42 KB` per agent band (`<= 125 KB` at 3 agents; separate SVGs <= `45 KB` each); peak Node RSS <= `128 MB` on mocked 12-agent/52w build; serialized REST commit queue enforces `>= 2,100 ms` gap; UI visual-only toggle re-render `< 25 ms` (`52w` ↔ `26w` fetches `POST /api/preview` in live mode and swaps `demo-data.js` presets while preserving `Configure` overrides in demo mode) |
| **Reliability** | `15 s` timeout; `Retry-After`/reset/`403 X-GitHub-SSO` (`0`-retry immediate fail) & transient backoff (`<= 60 s`, max 3 tries); REST `incomplete_results` bisected/retried; `SCOPE_CAVEAT`/`warnings` surfaced once to CLI stderr & UI banner; fatal `POST /api/preview` / `discover` errors clear stale SVG previews while `POST /api/schedule` errors clear only schedule output (`textContent`); failures leave prior SVGs intact via atomic rename |
| **Compatibility** | Closed `lynceus.json` v1, `counts.json` v1, CLI flags/exit codes (`0/2/3/4/5`), all-`POST` `/api/*` + explicit JS MIME + `favicon.ico`, PowerShell `& 'node'` `.ps1` + Win32 `-Argument -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "..."`, POSIX `.sh` `cron` (`--` operands, `%`-free), GitHub Light/Dark camo SVGs, and `README` `<picture>` (`user` & `org/.github`) |
| **Interaction capability** | New user completes setup via `README.md` quickstart, UI, or CLI: validates `[bot]`, previews Light/Dark README, downloads config/SVGs/schedule script (`Blob`), gets runnable PowerShell/cron/Actions refresh snippet via `lynceus schedule` / `Schedule` tab (`>= 1` agent & pre-publish `toolRef` guidance, `chmod 600` / non-repo path, `privacyNotice`) |
| **Security (ASVS 5.0)** | `PATH`-only win32 `gh` + `System32\rundll32.exe` + `os.tmpdir()` `cwd`; trusted-anchor segment symlink + `readBoundedJsonFile` + `O_EXCL` + `0o600` private `counts.json`; `& 'node'` PS `.ps1`, pinned Win32 `-Argument -File "..."` + trailing-`\` ban, post-resolve validation + private non-repo `--script-path` + `chmod 600`, leading-`-` / `--` operand / closed POSIX `actions` `--config` & `--out-dir` guards, Unicode-quote / YAML line-break / `cron` `%` rejection, single-quoted YAML `env:`, `refs/`/`main`/`HEAD` ban + `ls-remote --symref` + `--force-with-lease` + `-c commit.gpgsign=false` + SVGs-only UTC orphan + `--tool-ref` / `persist-credentials: false` / `schedule`+`workflow_dispatch` Actions + strictly unscoped `lynceus@...` `--package-pin` + conflict rejection; `--include-private` gate (`collect`/`build`/`schedule` + `init` auto-load reset); scrubbed errors & `redactSecrets`; global `Host` + `POST` guards + zero `innerHTML` + root `xmlns` / `xmlns:` / prefix `assertCamoSafeSvg`; canary zero-leak boundary (`C4`) |
| **Maintainability** | Modular `collector`/`renderer`/`cli`/`builder-ui` acyclic graph, shared browser/Node `renderer`, `<= ~150` lines per cohesive module |
| **Flexibility** | Cross-platform Windows 11 PowerShell/cmd, macOS (`/var`/`/tmp` trusted anchor), Linux; Node `>=24` pre-import guard + `Actions node-version: '24'`; `import.meta.url` off-CWD asset lookup; headless browser-launch fallback |
| **Safety** | Explicit `--include-private` gate (`collect`/`build`/`schedule` + `init` reset + `Schedule` `privacyNotice`) + `refs/`/default-branch orphan checks + atomic writes |

### Target Environments & End-to-End Verification

* **Dev/Test (mocked):** Node `>=24` on local Windows/Linux/macOS with mocked HTTP `fetch` transport & bare local git remotes (`npm run lint && npm test && npm run build:pages` + mocked `build` + headless browser check on `127.0.0.1` and static `dist-pages/` served under `/<repo>/` subpath checking `0` HTTP 404/console errors and `0` horizontal overflow at `1440×900` & `390×844`).
* **Live target differences:** Real `api.github.com` enforces live `30` req/min REST commit limits, SSO/SAML `403`, and real GitHub App `[bot]` search indexing; Task Scheduler runs `.ps1` under Windows user session context (`-TaskName LynceusProfileRefresh`); GitHub Pages serves `dist-pages/` under `/<repo>/` subpath. Live end-to-end profile integration (`C12`) is verified at Deploy under owner sign-off.
* **Mandatory Test-stage Security Review (Sensitive route):** Before accepting Test completion, run `adversarial-lens` and `data-lens` (alongside `behaviour-lens` + `integrity-lens`) against the implemented git diff and `THREAT-MODEL.md`.

### Acceptance Claims (`C1`–`C12`)

* **C1 (**`collector` **Discovery & Validation):** `discoverBots` uses `... on Issue`/`PullRequest` inline fragments, GraphQL `$q: String!` + `$after` cursor pagination, `is:public` by default (`typeof includePrivate === 'boolean'` checked strictly), `Bot` type checks, and `assertValidDiscoverResult`; `validateBotSlug` rejects malformed slugs pre-network, maps `404` -> `{ valid: false, slug }`, and rejects non-`Bot` accounts.
* **C2 (**`collector` **Hybrid Collection, Bisection, Clamping, Streaks & Pacing):** `collectActivity` paginates `$after` across all 5 GraphQL search queries (never selecting REST-only `incomplete_results` in GraphQL) and `node(id)` past 100 items, filters `author?.__typename === 'Bot'`, bisects `updated:>=<s0>` up to `max(utcToday, endDate)`, clamps all 6 metrics (skipping `false` metrics as `0`, normalizing commit TZ to UTC) to `[startDate, endDate]`, emits `SCOPE_CAVEAT` at most once per call when `X-OAuth-Scopes` lacks `repo`, retries/warns REST `incomplete_results`, computes exact `streaks` + deterministic `--date` `generatedAt`, meets `>= 2,100 ms` REST pacing & `<= 500 ms` / `<= 128 MB` budgets, and returns `{ counts, warnings }`.
* **C3 (**`collector` **Rate Limits, Timeouts & Scrubbed Errors):** Honors `AbortSignal.timeout(15_000)`, fails immediately (`0` retries) on `403` with `X-GitHub-SSO` (`AUTH_FORBIDDEN`, exit `4`), retries transient `403`/`429`/`502`/`503` up to 3 tries (`<= 60 s`), maps `401` / GraphQL `UNAUTHORIZED` to exit `3`, maps other GraphQL `errors[]` to exit `4`, strips raw `4xx`/`5xx`/GraphQL bodies + `X-GitHub-SSO` values + `gh` buffers, and runs `redactSecrets()`.
* **C4 (**`collector` **Private-Repo Canary Boundary):** Mocked responses carrying canary private repo names, PR titles, URLs, and `403 X-GitHub-SSO` org slugs result in ZERO canary strings across `counts.json`, rendered SVGs, `warnings`, `err.message`/`err.cause`, and CLI stderr; `assertStrictCountsOnly` validates all keys, dates, enums, and integers strictly.
* **C5 (**`renderer` **Exact Specimens & Performance):** Identical `counts.json` + options emit byte-identical Light/Dark SVGs for unified & separate, `52w`/`26w`, `breakdown`/`minimal`, `squares`/`magnitude`, `friendly`/`raw`, `0`-agent empty preview returns `""` Markdown safely, matching `S5` palettes (`Object.hasOwn`), `<= 42 KB/band` size target, `<= 50 ms` render time (3 agents/52w), and `markdown.mjs` `user` + `org/.github` `<picture>` URLs.
* **C6 (**`renderer` **Camo Safety & XML/URL Escaping):** Passes valid root `xmlns="http://www.w3.org/2000/svg"`, valid non-BMP Unicode + apostrophe labels (`"Example's Bot 🚀"` -> `&apos;`), and harmless `"button=1"`; strips BiDi/unpaired surrogates (`!isWellFormed()`); rejects additional `https://`/`http://` URLs, secondary `xmlns:` prefixes, `<s:script>`/`<script>`, `<!DOCTYPE`, `<use>`, `<animateTransform>`, `<animateMotion>`, `<discard>`, `<feImage>`, `href=`, `>`-in-quotes event breakouts (`<rect id=">" onload=...>`), inline `style="fill:\75rl(#x)"`, semicolon-less `&#60`, and attribute breakouts in `subpath`/`alt`/`srcset`.
* **C7 (**`cli` **Auth, Subcommands, Off-CWD, Browser Fallback & Private Gate):** `resolveToken()` checks `GITHUB_TOKEN`/`GH_TOKEN` then absolute `PATH` only (`shell: false`, `cwd: tmpdir()`; planted `./gh.exe` ignored); Node `<24` exits `2` cleanly before dynamic import; `tests/collector/` imports zero `src/cli/` modules (`normalizeConfig()` lives in `src/collector/config.mjs`); `lynceus init` defaults `--port 4173` (busy fallback `0`, explicit `--port <N>` bind failure exits `5`), resets auto-loaded `./lynceus.json` AND explicit `--config <path>` `includePrivate` to `false` while preserving `includePrivate: true` when CLI `--include-private` is passed, resolves `System32\rundll32.exe` / `PATH`-only opener with `cwd: tmpdir()` (planted `./rundll32.exe` ignored), and logs URL safely on spawn failure; off-CWD invocation finds assets via `import.meta.url`; `collect`/`build`/`schedule` reject `config.includePrivate: true` without explicit `--include-private` (unless `--public-only`), reject `--include-private --public-only` conflict (`exit 2`), reject missing `--config` on `schedule` (`exit 2`), reject Actions private config (`exit 2`), print public-history caveat in `--help` and scrubbed `warnings` to stderr, enforce `render --counts` default & `assertStrictCountsOnly` + `build --counts-out`-only rule, and keep prior SVGs intact on failed runs.
* **C8 (**`cli` **Trusted-Anchor Symlink Confinement, Bounded Reads,** `O_EXCL` **& Permissions):** `fs-safe.mjs` succeeds inside real `os.tmpdir()` on macOS (`/var` -> `/private/var`), Linux, and Windows; `writeVerifiedJson` creates missing parent directories safely under trusted-anchor confinement while rejecting child/out-dir/target symlinks with `exit 5`; `readBoundedJsonFile` rejects symlinks (`exit 5`) and wraps malformed JSON without raw file excerpts (`exit 2`); `writeVerifiedJson` writes `O_EXCL` (`wx`) with `0o600` when `scope.mode === 'public+private'`.
* **C9 (**`builder-ui` **Localhost Security Boundary):** Pre-route `Host` guard (`400`) covers ALL requests (`GET /`, static `GET` routes, and `POST /api/*`); unsupported HTTP methods return `405` zero CORS; static JS/MJS responses emit `text/javascript; charset=utf-8` and `/favicon.ico` returns `200` `image/x-icon`; `POST /api/*` enforces `Origin` (`403`), `Sec-Fetch-Site` (`403`), Bearer SHA-256 (`401`), `Content-Type` (`415`), `<= 32 KB` (`413`), strict booleans (`400`), `no-store`/`nosniff`/`Referrer-Policy`/`frame-ancestors 'none'` on every response, per-request CSP `nonce` + `form-action 'none'`, zero disk writes, opaque error JSON, and `POST /api/config` delivery.
* **C10 (**`builder-ui` **Zero-**`innerHTML`**, Visual Parity, Browser Run & Pages Leak Scan):** Static `app.js` check passes zero `innerHTML`/zero `localStorage`/zero inline `style=`; localhost run captures & deletes `window.__LYNCEUS_BOOTSTRAP__`, passes `POST /api/*`, renders UI private-history caveat, non-fatal `warnings` banner, fatal `POST /api/preview`/`discover` error banners clearing stale SVGs while `POST /api/schedule` errors preserve valid Workbench SVG previews, `Schedule` tab `0`-agent guidance + `toolRef`/pre-publish guidance + `Download script` (`Blob`) + `privacyNotice` banner; switches `52w` ↔ `26w` via `POST /api/preview` cleanly while keeping visual-only toggles `< 25 ms`; `dist-pages/` served under `/<repo>/` subpath boots purely from `<!-- LYNCEUS_BOOTSTRAP -->` demo mode (fetching `./favicon.ico` cleanly `200`, switching `52w`/`26w` while preserving `Configure` edits, opening offline `Schedule` tab with `0` `/api/*` requests & `0` console/404 errors, zero horizontal overflow at `1440×900` & `390×844`) and passes `build-pages.mjs` leak scan; `README.md` satisfies the `S2` quickstart/prerequisites/caveat checklist.
* **C11 (**`cli` **Refresh Snippets & Orphan Force-Replace):** `lynceus schedule` and `POST /api/schedule` enforce `--include-private` gating and `--target actions` private rejection (`exit 2` / `400`), apply all defaults & flags (`--task-name LynceusProfileRefresh`, `--owner` noreply override, default private non-repo `--script-path` vs sibling to non-repo `--config`, rejection of `--script-path` inside `--repo-dir` / `os.tmpdir()` / `/tmp` / `/var/tmp` or on `--target actions`, `path.resolve()` normalization for all local paths including explicit relative `--out-dir` vs normalized closed relative POSIX `--config`/`--out-dir` for `actions`), run character/metacharacter validation **after** `path.resolve()` across all parameters plus resolved `cwd`, `<resolved-bin-path>`, `<abs-ps1-path>`, and `<abs-sh-path>`, reject leading `-` on path inputs, PowerShell Unicode quotes (`\u2018`–`\u201E`), YAML line breaks (`\u0085`/`\u2028`/`\u2029`), `cron` `%` across resolved local paths/`--git-email`, trailing `\` on `<abs-ps1-path>`, dot-segment/leading-`-`/`.git` `subpath`/`config`/`out-dir`, `--script-path` on `actions`, `--tool-ref` + `--package-pin` conflict (`exit 2`/`400`), and `refs/`/`main`/`master`/`HEAD` branch values, generate syntactically valid PowerShell `& 'node'` `.ps1` (preserving explicit `--out-dir` during cleanup) + exact Win32 registration `-Argument '-NoProfile -NonInteractive -ExecutionPolicy Bypass -File "..."'` (checked by PowerShell AST/parser or cross-OS validator + regex checks) and `%`-free POSIX `.sh` + `crontab` line + `chmod 600` instruction + `--` operands, verify injectable `defaultToolRef` + `PINNED_ACTIONS_CHECKOUT` + `PINNED_ACTIONS_SETUP_NODE` use valid 40-hex SHAs with `node-version: '24'`, `persist-credentials: false`, `on: [schedule, workflow_dispatch]`, YAML single-quoted `env:`, pre-publish failure when `--tool-ref` omitted while `defaultToolRef === null`, and strictly unscoped `/^lynceus@.../` `--package-pin` (rejecting `@scope/lynceus@...`), include `-c commit.gpgsign=false` + UTC noreply author + `0o700` temp cleanup, and pass local bare-remote tests verifying `git ls-remote --symref origin HEAD` non-`main` default-branch rejection, `--force-with-lease=refs/heads/...`, `main` untouched, and empty-diff skip.
* **C12 (**`profile-integration` **Dry-Run Readiness):** Validates `mephistos-homunculus[bot]`, `mephistos-euphorion[bot]`, `mephistos-wagner[bot]` (`includePrivate: true`, `separate`, `52w`, `breakdown`, `squares`, `friendly`, `generated`, `agent-activity`, `raw`) against mocked `build` + `-TaskName LynceusProfileRefresh` `& 'node'` `.ps1` snippet cleanly before Deploy live execution.

---

## S11. Boundaries

* **Always:** Enforce `assertStrictCountsOnly`, `assertValidDiscoverResult`, `assertCamoSafeSvg`, `redactSecrets`, trusted-anchor segment `lstatSync` + `readBoundedJsonFile` + `O_EXCL`; use absolute-path `System32` / `PATH`-only binaries (`shell: false`, `cwd: os.tmpdir()`); enforce global loopback `Host`; require explicit CLI `--include-private` (`collect`/`build`/`schedule` + `init` auto-load reset); keep `dependencies: {}`.
* **Ask first:** Changing `lynceus.json` / `counts.json` v1 schemas post-release; adding any npm runtime dependency; changing read-only browser download behavior; storing any secret in CI workflows.
* **Never:** Store/transmit GitHub tokens to browser UI or static pages; push `counts.json`, private standalone `.ps1`/`.sh` schedule scripts, or personal `user.email`/signing key/timezone onto public history; emit repo names/titles/URLs/node IDs; push to `main`/`master`/`HEAD`/default branch or `refs/` namespaces; invoke unpinned `npx` or scoped/arbitrary npm packages via `--package-pin` inside automated schedules/CI.

---

## S12. Out of Scope (V2 Deferred) & Open Questions

### Out of Scope (Deferred to V2)

1. **Linear agent activity collector** (`Famulus`, `Homunculus`): deferred behind `counts.json` `source` seam until GitHub V1 ships and Linear read-only OAuth scoping/filters are spike-verified.
2. **Non-default-branch commits, inline PR diff review comments, & lines-changed metrics**: excluded in V1 due to API fan-out cost vs REST limits.
3. **Public GitHub App page badge/description integration**: deferred until README profile SVGs are live.

### Open Questions

None — Revision 5 resolves all `Design round 2, final` items cleanly for scoped `Design further read` verification and Phase 2 swarm task breakdown.

---

## S13. Needs a Human, Rollback & Stop Conditions

### Needs a Human (Decisions & Gated Actions)

| Item | Timing / Phase | Nature | Acceptance / Done Check |
| -- | -- | -- | -- |
| Approve `Design` closeout & start Build swarm in `H:\src\lynceus` | End of Design | Gate before Build execution | `Design further read` clears cleanly and fresh Antigravity session opens in `H:\src\lynceus` |
| Install local Windows Task Scheduler daily job | Deploy (after `C1`–`C12` + Test lenses pass) | Owner workstation setup | `.ps1` saved in user-private non-repo folder with `chmod 600`/user ACLs; scheduled run exits `0` updating only `generated` |
| Set `DEFAULT_TOOL_REF` in `snippets.mjs` to `v0.1.0` commit SHA | Deploy (after `v0.1.0` lands on `mephistopheles4/lynceus`) | Pre-publish CI release pin | Default `lynceus schedule --target actions` runs without manual `--tool-ref` override and `npm run lint && npm test && npm run build:pages` re-passes on the updated commit (tagging `v0.1.1` if `v0.1.0` shipped `null`) |
| First live push to `mephistopheles4/mephistopheles4` `generated` (`--include-private`) | Deploy | **Hard-to-reverse / public history** | Verify on GitHub: single orphan commit, UTC noreply author, `6` SVGs only, `0` `counts.json`, `0` private names |
| Merge `README.md` `<picture>` edits onto `mephistopheles4/mephistopheles4` `main` | Deploy | **Public profile visibility** | Profile README renders Light & Dark SVGs for all 3 bots via GitHub camo with zero broken images |
| Enable GitHub Pages (`dist-pages/`) | Deploy (optional) | Public static hosting | Live Pages URL loads demo UI with `SYNTHETIC DEMO DATA` badge and `0` console/network errors under subpath |
| Publish package to npm (`npm publish`) | Deploy (optional) | **Irreversible public package release** | Published `lynceus` version matches reviewed release tag (`--package-pin` opt-in enabled post-publish only) |

### Rollback Plan

* `generated` **branch incident or unwanted public count push:** Immediately push an empty commitless orphan or delete `generated` (`git push origin --delete generated`) from `mephistopheles4/mephistopheles4`, then verify README fallback/cleanup and rewrite/purge cached references if needed (note: external mirrors/caches during public exposure window cannot be un-scraped).
* **Profile** `README.md` **breakage:** `git revert` the README commit on `mephistopheles4/mephistopheles4` `main`.
* **Windows Task Scheduler issue:** Disable/unregister scheduled task via Task Scheduler (`Unregister-ScheduledTask -TaskName LynceusProfileRefresh`).
* **npm package issue (if published):** Publish a patched version + `npm deprecate` on the affected version (`npm unpublish` within registry policy window only).

### Stop Conditions (Halt & Escalate to Owner Immediately)

1. Live test reveals GitHub Search `is:public` returns private repository data, or any canary leak test fails in collector, errors, stderr, SVGs, or `generated` staging.
2. Test-stage `adversarial-lens` or `data-lens` raises a `high` security finding on the implementation diff.
3. Git automation check (`git ls-remote --symref origin HEAD`) resolves `targetBranch` equal to `main`, `master`, `HEAD`, or the repository default branch, or fails to resolve `HEAD`.
4. `npm run lint`, `npm test`, or `npm run build:pages` fails on target OS environment prior to Deploy.

Signed: mephistos-euphorion