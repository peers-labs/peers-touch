# MCA-X3 - Trusted Package Discovery

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "modern-chat-agent-v2-alignment-20260917",
  "taskId": "MCA-X3",
  "workstreamId": "MCA-X3",
  "title": "Trusted package catalog and install functional closure",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "X3-functional",
  "journeyId": "X3-P4-3",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "apps/desktop",
    "apps/station/app/subserver/agent",
    "model/domain/agent",
    "packages/agent-catalog",
    "packages/locales",
    "tooling/acceptance",
    "tooling/scripts/check-agent-v2-proto-coverage.py",
    "docs/client",
    "docs/architecture/agent"
  ],
  "readSet": [
    "docs/architecture/agent/agent-lobehub-blueprint.md",
    "docs/architecture/agent/lobehub-parity-mindmap.source.md"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 2400,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "marketplace-focused",
      "command": "(cd apps/station/app && go test ./subserver/agent/... && go run ./subserver/agent/catalog/generate -check) && python3 tooling/scripts/check-agent-v2-proto-coverage.py && (cd apps/desktop/src-tauri && cargo test --bin peers-touch-desktop application::skills_market -- --test-threads=1) && python3 -m unittest tooling.acceptance.gates.agent.marketplace_catalog_development_test tooling.acceptance.gates.agent.marketplace_catalog_fault_proxy_test && pnpm --dir apps/desktop exec tsc --noEmit -p tsconfig.json && (cd apps/desktop && ESLINT_USE_FLAT_CONFIG=false pnpm exec eslint src/pages/MarketplacePage.tsx src/pages/marketplace/PackageCard.tsx --report-unused-disable-directives --max-warnings 0) && python3 tooling/scripts/acceptance-run.py --gate station-api-ownership && make acceptance-validate DOMAIN=agent",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "marketplace-native-journey",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --work-item mca-x3 --gate agent-marketplace-catalog-e2e",
      "verificationClass": "FUNCTIONAL_CHECK"
    }
  ],
  "doneWhen": [
    "A new profile has at least one governed and revocable catalog source with real Agent, Skill, and MCP entries",
    "The source contract uses a stable catalog API or real repository/branch semantics rather than treating an arbitrary repository URL as JSON",
    "Publisher identity, source signature, scan result, trust, risk, version, and installation policy are verifiable",
    "A native Journey proves default source, sync, pagination, browse, detail, install, target-authority readback, uninstall, revocation, and cleanup"
  ],
  "failureBehavior": [
    "Return DESIGN_AMENDMENT_REQUIRED if catalog truth, signing, review, revocation, or federation ownership is still undefined",
    "Do not copy LobeHub hosted commercial marketplace or Community behavior",
    "Do not accept source-provided trust labels without verification"
  ],
  "updatedAt": "2026-09-17T13:29:06Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:e49b8bdf7d4d51efa115e3f2f041d15a9ae0ae9d;tree:631fec514047ba64dbb51bd7ce8d161b19a306ee;rust:14-pass;python:8-pass;typescript:pass;eslint:pass;agent-contracts:39-valid"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "BLOCKED",
      "ref": "profile:two;error:PROFILE_UNAVAILABLE;source:e49b8bdf7d4d51efa115e3f2f041d15a9ae0ae9d;diagnostic:/Users/bytedance/Documents/Projects/peers-touch/env/peers-touch/two/profile.env.example"
    }
  ]
}
```

## Objective

Close the accepted P4-3/X3 discovery and install experience without expanding
the product into a hosted commercial marketplace.

## Current Snapshot

- MCA-D20 now defines publisher-signed, key-pinned catalog snapshots,
  derived scan/risk/install policy, explicit revocation, and target-authority
  readback.
- `packages/agent-catalog` is now the sole maintained official envelope;
  Desktop bootstraps it directly and Station serves a generated exact-byte
  projection through the authenticated proto endpoint.
- Desktop Rust now separates `official_station` from
  `user_pinned_github`, rejects transport digest/signature/rollback failures,
  and retains the last verified snapshot as stale.
- Cursor pagination, repository/branch resolution, Agent/Skill/MCP install
  dispatch, authority readback, high-risk confirmation, and revocation UI are
  implemented.
- Focused X3 checks pass. The broader Desktop wrapper remains red only on 12
  pre-existing Mobile social-runtime-boundary violations outside this Task
  write set.
- Source checkpoint:
  `e49b8bdf7d4d51efa115e3f2f041d15a9ae0ae9d`.
- The exact-source native Journey is `BLOCKED/UNPROVEN`: Profile `two` cannot
  authorize deployment while its canonical env definition is dirty.
- The X3 Journey now carries a transparent four-step Station proxy contract:
  exact response, tampered digest, old-Station 404, and successful recovery.
