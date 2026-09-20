# LDCP-P3: Unified Worktree Development Dashboard

## Task Slice

```json
{
  "schemaVersion": 1,
  "kind": "peers-touch-task-slice",
  "planId": "DWF-PROGRESS-20260917",
  "taskId": "LDCP-P3",
  "workstreamId": "LDCP-DASHBOARD",
  "title": "Unified worktree development dashboard",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ldcp-development-dashboard",
  "journeyId": "LDCP-J03-worktree-resource-overview",
  "runtimeClass": "browser",
  "writeSet": [
    "Makefile",
    "docs/architecture/development-workflow",
    "docs/architecture/local-dev-control-plane",
    "tooling/make/local-dev.mk",
    "tooling/scripts/README.md",
    "tooling/scripts/local-dev",
    "tooling/scripts/review",
    "tooling/skills/pt-github-review/FRESHNESS.md"
  ],
  "readSet": [],
  "budgets": {
    "focusedCheckSeconds": 120,
    "functionalRunSeconds": 1200,
    "cleanupSeconds": 30
  },
  "checks": [
    {
      "id": "ldcp-worktree-dashboard-syntax",
      "command": "node --check tooling/scripts/local-dev/environment-dashboard.mjs",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ldcp-worktree-dashboard-tests",
      "command": "node --test tooling/scripts/local-dev/environment-dashboard.test.mjs tooling/scripts/local-dev/dev-work.test.mjs",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ldcp-worktree-dashboard-visual",
      "command": "browser screenshot at desktop and mobile viewport",
      "verificationClass": "UX_REVIEW"
    }
  ],
  "doneWhen": [
    "one primary worktree view joins registrations, active requirements and Journeys",
    "each worktree row exposes profile, slot, Station, Relay, database and other declared runtime resources",
    "profile occupancy remains available as a secondary capacity view",
    "unregistered declaration owners and blocked source state remain explicit",
    "the snapshot and UI expose no canonical roots, credentials, raw profiles or mutation controls"
  ],
  "failureBehavior": [
    "never infer worktree identity from basename when workspaceId is unavailable",
    "never treat declared intent as a held lease or observed runtime",
    "never create Relay or database lease authority while adding intent visibility",
    "surface incomplete joins as typed unregistered or blocked state"
  ],
  "updatedAt": "2026-09-17T04:44:00.000Z",
  "durableEvidence": [
    {
      "verificationClass": "SOURCE_CHECK",
      "result": "PASS",
      "ref": "node --check dashboard adapter, work schema and browser app"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "Local Dev Node suites (50/50), profile resolution (12/12), Plan suite (105/105)"
    },
    {
      "verificationClass": "FUNCTIONAL_CHECK",
      "result": "PASS",
      "ref": "live /api/status joins 7 worktrees and 6 requirements including CHAT-02-onboarding"
    },
    {
      "verificationClass": "UX_REVIEW",
      "result": "PASS",
      "ref": "Chromium renders at 1680x1050 and 390x844 without overlap"
    },
    {
      "verificationClass": "STRUCTURAL_CHECK",
      "result": "PASS",
      "ref": "bash tooling/scripts/review/skill-check.sh"
    }
  ]
}
```

## Objective

Merge delivery progress and environment occupancy into one read-only
Development Control Plane dashboard organized by worktree.

## Concurrency Decision

- Mode: serial.
- The snapshot contract is the producer for the browser UI, so those changes
  are dependency-ordered rather than independent lanes.
- Plan lifecycle, shared schema, dashboard adapter, review freshness, sibling
  environment assets, final verification and release remain integrator-owned.
- Parallel coordination would cost more than the bounded implementation and
  would risk contract drift across the two repositories.

## Current Snapshot

- DWF-P1, LDCP-P1, LDCP-P2 and LDCP-P3 implementation are complete.
- The dashboard is worktree-first and joins active requirements/Journeys with
  declared and held runtime resources.
- Relay and database claims add visibility without adding lease authority.
- Profile occupancy remains a secondary capacity view.
- Focused, full Local Dev, Skill, API and responsive visual checks pass.
