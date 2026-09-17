# Local Dev Control Plane - Module Layout

> **Status**: active
> **Version**: v1.0
> **Created**: 2026-09-17 | **Updated**: 2026-09-17
> **Owner**: Platform Team
> **Module**: `apps/dev/`, `tooling/scripts/local-dev/`

---

## 1. Directory Tree

```text
apps/dev/
├── README.md
├── package.json
├── server/
│   ├── index.mjs
│   ├── index.test.mjs
│   ├── status.mjs
│   └── status.test.mjs
└── web/
    ├── index.html
    ├── app.js
    └── styles.css

tooling/scripts/local-dev/
├── machine-dev-registry.mjs
├── machine-dev-lease.py
├── machine-dev.mjs
├── dev-work-schema.mjs
├── dev-work-ledger.mjs
└── dev-work.mjs
```

## 2. File Responsibilities

| Path | Responsibility |
|---|---|
| `apps/dev/server/index.mjs` | Fixed-endpoint HTTP server, Peers Dev identity probe and single-instance startup |
| `apps/dev/server/status.mjs` | Read-only redacted join over topology, registrations, declarations and leases |
| `apps/dev/server/status-worker.mjs` | Off-main-thread snapshot construction so identity probes remain responsive |
| `apps/dev/server/index.test.mjs` | Concurrent-start, compatible-reuse, foreign-listener and HTTP contract regressions |
| `apps/dev/server/status.test.mjs` | Projection, redaction, source-state and declaration-only regressions |
| `apps/dev/web/index.html` | Peers Dev document structure |
| `apps/dev/web/app.js` | Browser-side projection rendering and refresh |
| `apps/dev/web/styles.css` | Responsive operational UI styling |
| `tooling/scripts/local-dev/machine-dev-registry.mjs` | Machine registry, profile validation and live lease projection authority |
| `tooling/scripts/local-dev/dev-work-ledger.mjs` | Machine-wide Development intent authority |
| `tooling/make/local-dev.mk` | Thin `make dev-ui` and `make dev-ui-snapshot` entry points |

## 3. Dependency Direction

```text
apps/dev/web
  -> apps/dev/server HTTP API

apps/dev/server/index.mjs
  -> apps/dev/server/status.mjs

apps/dev/server/status.mjs
  -> tooling/scripts/local-dev machine and work read APIs
  -> env/peers-touch profile definitions

tooling Local Dev owners
  -> ~/.peers-touch/dev machine state
```

Forbidden dependencies:

- environment repository -> Peers Dev UI or server source;
- Peers Dev web UI -> registry, ledger, lease or profile files;
- Peers Dev server -> raw credential-bearing profile projection;
- Peers Dev startup -> PID-file ownership or dynamic fallback ports;
- future Peers Dev mutation -> direct state-file writes that bypass `devctl`.
