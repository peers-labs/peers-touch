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
    "packages/locales",
    "tooling/acceptance",
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
      "command": "(cd apps/desktop/src-tauri && cargo test application::skills_market --lib) && pnpm --dir apps/desktop run check",
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
  "updatedAt": "2026-09-16T16:36:26Z",
  "durableEvidence": []
}
```

## Objective

Close the accepted P4-3/X3 discovery and install experience without expanding
the product into a hosted commercial marketplace.

## Current Snapshot

- Desktop can register and sync JSON index sources, classify Agent/Skill/MCP
  packages, show details, and dispatch install/uninstall.
- The default catalog, stable source protocol, publisher trust, signature
  verification, pagination, first-run data, and real Acceptance Journey remain.
