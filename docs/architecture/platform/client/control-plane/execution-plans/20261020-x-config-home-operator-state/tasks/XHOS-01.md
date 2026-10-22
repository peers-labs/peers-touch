# Home-local operator authentication state

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "x-config-home-operator-state-20261020",
  "taskId": "XHOS-01",
  "workstreamId": "XHOS",
  "title": "Cut X Config operator state from GitHub to Home SQLite",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "XHOS-operator-state",
  "journeyId": "CCP-J01",
  "runtimeClass": "service",
  "writeSet": [
    "apps/x-config",
    "docs/architecture/platform/client/control-plane",
    "docs/architecture/engineering/architecture-governance/architecture-modules.json",
    "tooling/acceptance/features/x-config-operator-login.yaml",
    "tooling/acceptance/gates.yaml"
  ],
  "readSet": [
    "apps/oauth2-client",
    "packages/github-repository"
  ],
  "budgets": {
    "focusedCheckSeconds": 600,
    "functionalRunSeconds": 900,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "x-config-operator-state-source",
      "command": "go test ./apps/x-config/internal/application/operatorauth ./apps/x-config/internal/infrastructure/operatorstore ./apps/x-config/internal/interfaces/http -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-operator-state-governance",
      "command": "node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "x-config-operator-state-functional",
      "command": "go test ./apps/x-config/internal/integration -run TestHomeOperatorLoginLifecycle -count=1",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "x-config-operator-state-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-operator-login-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "CatalogRepository and OperatorStore have independent explicit production drivers.",
    "Production operator state uses database/sql with the mature pure-Go modernc.org/sqlite driver and has no custom file format, memory fallback, or GitHub fallback.",
    "Login completion atomically consumes the attempt and assertion and creates the session after successful Broker redemption.",
    "Session readback, CSRF validation, expiry and revocation use only the local operator database.",
    "The receiver verifier remains encrypted and browser cookies remain opaque and secret-free.",
    "Restart, replay, concurrent callback, lock exhaustion, corrupt record and empty-database behavior are covered."
  ],
  "failureBehavior": [
    "Missing database path, migration failure, unsafe permissions, missing key or corrupt state prevents API readiness.",
    "Broker redemption failure creates no session and leaves no partially consumed local completion.",
    "Concurrent or replayed attempt and assertion completion has one winner and no duplicate session.",
    "SQLite busy timeout returns operator_store_unavailable without falling back to GitHub or memory.",
    "Catalog and publication paths, sequence allocation and exact signed bytes remain unchanged."
  ],
  "updatedAt": "2026-10-20T14:05:27.000Z"
}
```

## Current Snapshot

`X_CONFIG_STORAGE_DRIVER` currently selects one adapter family for both
catalog/publication and operator authentication. Production uses GitHub for
attempt creation, attempt consumption, assertion consumption, session
creation, session readback, and revocation. Login completion consumes the
attempt before Broker redemption and writes the session in a later repository
transaction. No Home-local operator database adapter or split storage
configuration exists.
