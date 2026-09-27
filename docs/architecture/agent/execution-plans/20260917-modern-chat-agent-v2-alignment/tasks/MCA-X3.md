# MCA-X3 - Trusted Package Discovery

## Task Slice

```json
{
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
  "updatedAt": "2026-09-17T17:02:41Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:d3c8e7c5e799481c066ccee8a3e656fecb566fc4;tree:e7223c766cc97d0eb7959274245b8f9999411afb;station-agent:pass;catalog-generator:pass;proto:7/7;rust:20-pass;python:14-pass;typescript:pass;eslint:pass;station-api-ownership:pass;agent-contracts:39-valid;dev-control-plane:75-pass"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:6a756ebd6d0a12d8a42b5fdceedcd71b949df426;tree:1033eb909e3f9b1bbfad9d60a45127840642de1a;station-agent:pass;catalog-generator:pass;proto:7/7;rust:20-pass;python:14-pass;typescript:pass;eslint:pass;station-api-ownership:pass;agent-contracts:39-valid"
    },
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "git:e49b8bdf7d4d51efa115e3f2f041d15a9ae0ae9d;tree:631fec514047ba64dbb51bd7ce8d161b19a306ee;rust:14-pass;python:8-pass;typescript:pass;eslint:pass;agent-contracts:39-valid"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "BLOCKED",
      "ref": "profile:two;error:PROFILE_UNAVAILABLE;source:e49b8bdf7d4d51efa115e3f2f041d15a9ae0ae9d;diagnostic:/Users/developer/Documents/Projects/peers-touch/env/peers-touch/two/profile.env.example"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "git:aa7902cc186b271c4d0600ebb28c39e04e42c4b3;tree:0e5f9903804dc42f1a61b5bafcc88ecc6d2d0151;profile:two;station:aa7902cc186b;gate:agent-marketplace-catalog-e2e;run:20260917T165555566010Z-e4a5da38abe9151b58afc422b60b3eca;report-sha256:5f908ffad3dde9cda38bf9d78b1d284781ef09e2afc782349041e6d45534f80c;runtime-manifest-sha256:dd01b6cfcae5a0c3a31da7c49be93d8ae4bb81f68db86c2af86f2b9af5fab7b8;cleanup-sha256:3d2f757b9b5aa01e88e9af07e0bc56af329dde527050c2001eb5b563dda1d2b7"
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
- Catalog discovery trust remains separate from Station Skill install
  authority; Marketplace Skill imports enter Station as `community` and are
  independently scanned before policy admission.
- Exact source `aa7902cc186b271c4d0600ebb28c39e04e42c4b3` is deployed to
  managed Profile `two`, and the Station attestation reports the same commit.
- Native Gate `agent-marketplace-catalog-e2e` passed with default-source sync,
  pagination, browse/detail, Agent/Skill/MCP install authority readback,
  revocation, uninstall, and clean runtime teardown.
- Functional run:
  `20260917T165555566010Z-e4a5da38abe9151b58afc422b60b3eca`.
- Formal range Acceptance remains `UNPROVEN`: `proto-build`,
  `station-agent-unit`, and `agent-marketplace-catalog-e2e` pass, while
  `desktop-check` still reports 12 pre-existing Mobile
  `social-runtime-boundaries` violations outside the MCA-X3 write set.
