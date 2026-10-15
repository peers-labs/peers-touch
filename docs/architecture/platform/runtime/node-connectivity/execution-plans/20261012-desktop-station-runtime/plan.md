# Desktop App-Scoped Station Runtime

> **Plan ID**: DESKTOP-STATION-RUNTIME-20261012
> **Created**: 2026-10-12T15:54:38.000Z
> **Owner**: Client Platform Team

The owner accepted the target architecture on 2026-10-12. This Plan persists
the execution model only; it creates no ExecutionRun, current Task, runtime
resource authorization, commit, push or pull request authority.

## Plan

```json
{
  "kind": "peers-touch-plan",
  "planId": "DESKTOP-STATION-RUNTIME-20261012",
  "createdAt": "2026-10-12T15:54:38.000Z",
  "northStar": {
    "objective": "Replace Desktop process-global Station transport and localhost proxy with one AppState-owned StationRuntime, typed Direct/Circuit requests and resource projections, endpoint-scoped persistent transport identity, bounded route sessions and deterministic shutdown while preserving Station Access and canonical business behavior.",
    "successCriteria": [
      {
        "id": "DSR-NS01",
        "statement": "Tauri owns exactly one Desktop StationRuntime from setup through bounded drain and joined shutdown; no getter or request builder creates runtime resources.",
        "sourceRefs": ["NCP-D12", "NCP-D16", "docs/client/desktop/lifecycle.md"]
      },
      {
        "id": "DSR-NS02",
        "statement": "Station Access is the sole binding mutation owner and publishes generation/revision-fenced RouteLease values; transport never mutates registry truth.",
        "sourceRefs": ["SAL-D08", "SAL-D14", "NCP-D17"]
      },
      {
        "id": "DSR-NS03",
        "statement": "All Desktop Station traffic and Station-owned resources use injected typed ports with explicit deadline, traffic class, replay policy, streaming cancellation and bounded overload behavior; localhost proxy and raw HTTP1 framing are deleted.",
        "sourceRefs": ["NCP-D03", "NCP-D08", "NCP-D09", "NCP-D10", "NCP-D17", "NCP-D18", "SAL-D15"]
      },
      {
        "id": "DSR-NS04",
        "statement": "Native Direct/Circuit Access, private restart, Chat receipts, SSE and 32 MiB attachment behavior remain exact-source proven with no leaked transport workers or blind mutation replay.",
        "sourceRefs": ["SAL-D06", "NCP-G03", "NCP-G07", "NCP-G08", "DSR-G01", "DSR-G02", "DSR-G03"]
      }
    ]
  },
  "northStarApproval": null,
  "criterionCoverage": [
    {
      "criterionId": "DSR-NS01",
      "taskIds": ["DSR-01", "DSR-04", "DSR-05"],
      "closureIds": ["dsr-transport-kernel", "dsr-runtime-cut", "dsr-lifecycle"],
      "gateIds": ["DSR-G01", "DSR-G02", "NCP-G07"]
    },
    {
      "criterionId": "DSR-NS02",
      "taskIds": ["DSR-04", "DSR-05"],
      "closureIds": ["dsr-runtime-cut", "dsr-lifecycle"],
      "gateIds": ["DSR-G01", "DSR-G02", "NCP-G07"]
    },
    {
      "criterionId": "DSR-NS03",
      "taskIds": ["DSR-02", "DSR-03", "DSR-04", "DSR-05"],
      "closureIds": ["dsr-client-injection", "dsr-resource-injection", "dsr-runtime-cut", "dsr-lifecycle"],
      "gateIds": ["DSR-G01", "DSR-G02", "DSR-G03", "NCP-G07"]
    },
    {
      "criterionId": "DSR-NS04",
      "taskIds": ["DSR-03", "DSR-05", "DSR-06"],
      "closureIds": ["dsr-resource-injection", "dsr-lifecycle", "dsr-final-proof"],
      "gateIds": ["DSR-G01", "DSR-G02", "DSR-G03", "NCP-G03", "NCP-G07", "NCP-G08"]
    }
  ],
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/global/architecture.md",
      "docs/architecture/platform/client/desktop/runtime.md",
      "docs/architecture/platform/runtime/node-connectivity/README.md",
      "docs/architecture/platform/runtime/node-connectivity/design.md",
      "docs/architecture/platform/runtime/node-connectivity/decisions.md",
      "docs/architecture/platform/runtime/node-connectivity/data-model.md",
      "docs/architecture/platform/runtime/node-connectivity/module-layout.md",
      "docs/architecture/platform/runtime/node-connectivity/integration.md",
      "docs/architecture/platform/station/access/README.md",
      "docs/architecture/platform/station/access/design.md",
      "docs/architecture/platform/station/access/decisions.md",
      "docs/architecture/platform/station/access/data-model.md",
      "docs/architecture/platform/station/access/module-layout.md",
      "docs/architecture/platform/station/access/integration.md",
      "docs/client/desktop/lifecycle.md"
    ],
    "decisions": [
      "NCP-D03",
      "NCP-D08",
      "NCP-D09",
      "NCP-D10",
      "NCP-D12",
      "NCP-D16",
      "NCP-D17",
      "NCP-D18",
      "SAL-D06",
      "SAL-D08",
      "SAL-D14",
      "SAL-D15"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "packages/station-libp2p-http", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/frame", "mode": "shared-read"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts/node-connectivity-journey.py", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/platform/runtime/node-connectivity", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/platform/station/access", "mode": "exclusive-write"},
      {"pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json", "mode": "exclusive-write"},
      {"pathPrefix": "docs/client/desktop/lifecycle.md", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Change Station or Relay wire semantics, enrollment, ACL, canonical business APIs or protobuf contracts",
      "Change Mobile transport implementation or claim Mobile native parity",
      "Change product UI, Session class policy, Actor identity or Station business truth",
      "Introduce a compatibility data plane, runtime feature flag, custom connector protocol or second Station client owner",
      "Claim latency superiority without a separately accepted measured threshold",
      "Create or restart external runtime profiles, reset shared data, rotate user Station identity, commit, push or open a pull request"
    ]
  },
  "tasks": [
    {
      "id": "DSR-01",
      "workstreamId": "DSR-TRANSPORT",
      "path": "tasks/DSR-01.md",
      "dependsOn": []
    },
    {
      "id": "DSR-02",
      "workstreamId": "DSR-CLIENT-INJECTION",
      "path": "tasks/DSR-02.md",
      "dependsOn": ["DSR-01"]
    },
    {
      "id": "DSR-03",
      "workstreamId": "DSR-RESOURCE-INJECTION",
      "path": "tasks/DSR-03.md",
      "dependsOn": ["DSR-02"]
    },
    {
      "id": "DSR-04",
      "workstreamId": "DSR-RUNTIME-CUT",
      "path": "tasks/DSR-04.md",
      "dependsOn": ["DSR-03"]
    },
    {
      "id": "DSR-05",
      "workstreamId": "DSR-LIFECYCLE",
      "path": "tasks/DSR-05.md",
      "dependsOn": ["DSR-04"]
    },
    {
      "id": "DSR-06",
      "workstreamId": "DSR-PROOF",
      "path": "tasks/DSR-06.md",
      "dependsOn": ["DSR-05"]
    }
  ],
  "authorization": {
    "checkpoint": {"localCommit": "denied"},
    "delivery": {"push": "denied", "pullRequest": "denied"},
    "runtime": {"deployProfiles": [], "destructiveResetScopes": []},
    "history": {"rewrite": "denied"}
  },
  "amendments": []
}
```

## Acceptance Execution

```json
{
  "closures": {
    "dsr-transport-kernel": [],
    "dsr-client-injection": [],
    "dsr-resource-injection": ["DSR-G03"],
    "dsr-runtime-cut": ["DSR-G01"],
    "dsr-lifecycle": ["DSR-G02", "NCP-G07"],
    "dsr-final-proof": ["DSR-G01", "DSR-G02", "DSR-G03", "NCP-G03", "NCP-G07", "NCP-G08"]
  },
  "completion": ["DSR-G01", "DSR-G02", "DSR-G03", "NCP-G03", "NCP-G07", "NCP-G08"],
  "full": ["DSR-G01", "DSR-G02", "DSR-G03", "NCP-G03", "NCP-G07", "NCP-G08"]
}
```

## Execution Contract

DSR-01 changes the reusable Rust transport boundary only. DSR-02 migrates unary
JSON/protobuf callers to an injected request port while the current proxy remains
the sole transport adapter. DSR-03 migrates streaming, media, OSS cache and
applet resources to typed stream/resource ports, still without registering a
second data plane.

DSR-04 is the indivisible production cut: application composition creates the
AppState-owned runtime, swaps the single injected adapter to Direct/Circuit,
then deletes globals, localhost proxy, raw HTTP/1 framing and side-effecting
origin getters. DSR-05 proves scoped identity, route fencing, replay, overload
and deterministic shutdown. DSR-06 repeats product and removal proof.

Rollback is source/deployment revert of the whole Desktop cut. It does not keep
a dormant old runtime, compatibility flag or alternate request path.

## Review Contract

Plan review must verify preparatory injection closures retain exactly one proxy
adapter, DSR-04 remains the only atomic data-plane swap, Station Access remains
the sole binding mutation owner, resource references never embed route origin,
transport identities are endpoint-scoped, and every Gate has a binary oracle.
Reject any process-global runtime bridge, hidden listener startup, unbounded
channel, blind write replay, cross-Relay global PeerID, partial proxy retention
or Mobile readiness claim.
