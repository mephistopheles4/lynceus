# Contributing

`lynceus` is a zero-dependency Node 24 ESM CLI and local Lynceus Builder UI.
Everything shipped here executes in a developer's terminal, against their GitHub
authentication, or inside scheduled workflows — keep patches tight, verifiable,
and free of third-party packages.

## The short version

```sh
npm run check
```

Or run the script directly with Node 24 or later:

```sh
node scripts/check.mjs
```

That single command is the contract CI runs (`check` on Linux and
`check-windows` on Windows). It verifies:

1. `package.json` holds zero `dependencies`, zero `devDependencies`, and zero
   install lifecycle scripts (`preinstall`, `install`, `postinstall`, `prepare`).
2. No lockfile (`package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, etc.),
   `.npmrc`, `.yarnrc.yml`, or `binding.gyp` exists in the tree.
3. No `.mjs` or `.js` file imports a non-builtin / non-relative module specifier.
4. Root and governance Markdown files tag every fenced code block with a
   language (`text` for plain blocks).
5. `scripts/lint.mjs` (`node --check` on every `.mjs`/`.js` file) passes.
6. `scripts/test.mjs` (`node --test`) passes.
7. `scripts/build-pages.mjs` builds `dist-pages/` cleanly and passes every
   static leak and hygiene check.

GitHub Actions also runs [`.github/workflows/zizmor.yml`](.github/workflows/zizmor.yml)
over `.github/workflows/` (failing on any workflow security finding) and
CodeQL default setup over JavaScript and Actions. See
[`docs/security/scanners.md`](docs/security/scanners.md) for details.

## Environment

- **Node.js `>= 24.0.0`** and nothing else. There is no `npm install` step and
  no `node_modules` directory.
- Worktrees work out of the box with zero setup.

## Tests

The test suite uses Node's built-in test runner (`node --test`).

- **Zero live network calls in `tests/`:** Mock GitHub GraphQL/REST responses
  via [`tests/fixtures/github-mocks.mjs`](tests/fixtures/github-mocks.mjs) and
  clear `GITHUB_TOKEN` / `GH_TOKEN` in CLI tests unless testing explicit env
  resolution.
- **Privacy canaries stay mandatory:** Never weaken canary assertions verifying
  that private repo names, titles, URLs, commit SHAs, SSO headers, or tokens
  cannot appear in `counts.json`, SVGs, `stderr`, API responses, or `dist-pages/`.
- **Cross-platform notes:** Some filesystem-mode and POSIX `/bin/sh` execution
  checks are skipped automatically on Windows (`win32`), while Windows Task
  Scheduler `.ps1` tests execute against PowerShell on Windows. CI runs both
  `ubuntu-latest` (`check`) and `windows-latest` (`check-windows`) so every
  platform-specific test executes before merge.

To run individual test files while iterating:

```sh
node scripts/test.mjs tests/cli/snippets.test.mjs
```

Always finish with the full contract check before opening a pull request:

```sh
node scripts/check.mjs
```

## What a good patch looks like

- **One change, one reason.** Keep pull requests focused rather than mixing
  unrelated refactors with bug fixes or features.
- **Behaviour changes carry a failing-first test.** Prove the fix or feature
  with a `node --test` case that backs an acceptance claim or threat boundary.
- **Do not add dependencies.** All runtime, test, and build scripts use Node
  built-ins and browser standards only. `src/renderer/*` additionally imports
  zero `node:*` modules so the exact same code runs in the static Browser UI and
  GitHub Pages bundle.
- **Keep `src/builder-ui/public/*` static-safe.** Use system font stacks only
  (zero third-party fonts), relative asset URLs (so GitHub Pages `/<repo>/`
  subpaths work), DOM APIs without `innerHTML`, and zero `localStorage` or
  `sessionStorage`.
- **Give every fenced code block a language.** Use `text` for plain terminal
  output or untyped snippets.

## Reporting a security problem

Do not open a public issue. See [`SECURITY.md`](SECURITY.md).

## Conduct

By taking part you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).
