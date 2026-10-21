# XCFG-01-CANONICAL-CUT - Atomic X Config Source Cutover

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "XCFG-CUTOVER-20261019",
  "taskId": "XCFG-01-CANONICAL-CUT",
  "workstreamId": "XCFG-SOURCE",
  "title": "Replace every active Client Control identifier with the canonical X Config identity",
  "workClass": "refactor",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "x-config-canonical-cut",
  "journeyId": "XCFG-NAMING-CUTOVER",
  "runtimeClass": "source-only",
  "writeSet": [
    "apps/client-control",
    "apps/desktop",
    "apps/mobile",
    "apps/oauth2-client",
    "apps/station/frame/touch/model",
    "model/domain/client_control",
    "packages/client-control-core",
    "packages/prototypes/control/client-control",
    "tooling/acceptance",
    "tooling/skills/pt-client-control-2-vercel",
    "docs/architecture",
    "docs/client",
    "AGENTS.md",
    "go.work",
    "pnpm-workspace.yaml",
    "pnpm-lock.yaml"
  ],
  "readSet": [
    "docs/global",
    "docs/knowledge",
    "packages/github-repository",
    "packages/locales"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 3600,
    "cleanupSeconds": 300
  },
  "checks": [
    {
      "id": "x-config-removal-search",
      "command": "test -z \"$(git grep -l -E '(client-control|client_control|ClientControl|CLIENT_CONTROL|Client Control)' -- ':!docs/architecture/platform/client/control-plane/execution-plans/**')\"",
      "verificationClass": "STRUCTURAL_CHECK"
    },
    {
      "id": "x-config-source-contracts",
      "command": "./model/build.sh && go test ./apps/x-config/... ./apps/oauth2-client/... -count=1 && CARGO_TARGET_DIR=${TMPDIR:-/tmp}/peers-x-config-core-target cargo test --manifest-path packages/x-config-core/Cargo.toml --locked",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "x-config-functional-contract",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate x-config-snapshot-core-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "x-config-canonical-cut-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate x-config-domain-validation --gate x-config-snapshot-core-contract --gate x-config-operator-login-contract --gate x-config-admin-api-contract --gate x-config-desktop-adapter-contract --gate x-config-mobile-adapter-contract --gate x-config-vercel-publication-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "doneWhen": [
    "X Config is the only active human and machine identity outside frozen historical Plans",
    "Proto package, exported messages, signature domain, cache paths and environment prefixes use X Config forms with unchanged field numbers and semantics",
    "Go app, Rust core, Desktop, Mobile, prototype, Skill, Acceptance and architecture registry all resolve through the new paths",
    "Generated files come only from the canonical model generator and no old generated directory remains",
    "No compatibility alias, re-export, dual-read cache, fallback environment key or parallel Acceptance identifier remains"
  ],
  "failureBehavior": [
    "Do not leave a compiling partial cut with both names active",
    "Do not hand-edit generated protobuf outputs",
    "Revert the atomic cut if all consumers cannot be migrated and verified together"
  ],
  "updatedAt": "2026-10-19T07:07:32.000Z"
}
```

## Claim Boundary

This Task proves current-source naming and contract consistency. It does not
prove live OAuth consent, Vercel deployment, Production publication or native
UI behavior.

## Current Snapshot

- The active implementation uses Client Control identifiers across 168 tracked
  files and 1,459 tracked references.
- The branch is clean at checkpoint `27d6b39e0` before this Plan package.
- No released client compatibility requirement for the old signature or cache
  identifiers has been established.
