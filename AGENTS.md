# AGENTS.md

Before you patch anything, read [`CONTRIBUTING.md`](CONTRIBUTING.md) and run:

```sh
node scripts/check.mjs
```

Key architectural and security references in this repository:

- [`CONTRIBUTING.md`](CONTRIBUTING.md) — zero-dependency contract, test expectations, and static UI hygiene rules
- [`SECURITY.md`](SECURITY.md) — security scope, platform guarantees, and private vulnerability reporting
- [`docs/SPEC.md`](docs/SPEC.md) — Lynceus V1 specification (`C1`–`C12`, CLI flags, Builder UI & Pages contracts)
- [`docs/THREAT-MODEL.md`](docs/THREAT-MODEL.md) — threat boundaries (`B1`–`B5`) and accepted threat classes; hand this to security reviews
- [`docs/DESIGN.md`](docs/DESIGN.md) — Lynceus visual design specification
- [`docs/security/scanners.md`](docs/security/scanners.md) — CI scanners (`CodeQL`, `zizmor`) and SHA-pinning policy

## Constraints

- **Zero dependencies:** Keep `package.json` free of runtime and dev dependencies; import only `node:` built-ins (and zero `node:*` imports in `src/renderer/`).
- **Privacy & Camo invariants:** Never weaken canary checks (`counts.json`, SVGs, `stderr`, `/api/*`, or `dist-pages/`).
- **Local vs public history:** Never commit `lynceus.json`, `counts.json`, or live tokens.
