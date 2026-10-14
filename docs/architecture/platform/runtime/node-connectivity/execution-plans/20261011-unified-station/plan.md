# Unified Station Identity, Transport And Cluster Readiness

> **Plan ID**: NCP-UNIFIED-STATION-20261011
> **Created**: 2026-10-11T00:00:00.000Z
> **Owner**: Architecture Team

North Star approved by the user. Runtime, checkpoint and delivery authority
remain limited to the explicit authorization block in this Plan.

## Plan

```json
{
  "kind": "peers-touch-plan",
  "planId": "NCP-UNIFIED-STATION-20261011",
  "createdAt": "2026-10-11T00:00:00.000Z",
  "northStar": {
    "objective": "Deliver one logical Station that runs as one node or multiple private-team nodes, with standard libp2p Direct/Circuit v2 transport into the existing canonical HTTP/protobuf API and no extra Gateway service.",
    "successCriteria": [
      {"id": "NCP-NS01", "statement": "Independent authorized Node PeerIDs preserve one logical Station scope and reject substituted identities before credentials.", "sourceRefs": ["NCP-D05", "NCP-D06", "NCP-D07"]},
      {"id": "NCP-NS02", "statement": "One Host per process and one canonical API serve real native login, Chat receipts, SSE and attachments through standard transport; the custom production data plane is fully removed.", "sourceRefs": ["NCP-D02", "NCP-D03", "NCP-D08", "NCP-D10", "NCP-D12"]},
      {"id": "NCP-NS03", "statement": "Two nodes share Session, ordered device-safe events and object truth; failover resumes committed results without changing logical Station identity.", "sourceRefs": ["NCP-D13", "NCP-D14"]},
      {"id": "NCP-NS04", "statement": "Domain fencing prevents healthy foreign-task recovery and stale-owner effects; renewal, revocation and overload have bounded, source-backed outcomes.", "sourceRefs": ["NCP-D08", "NCP-D15"]}
    ]
  },
  "northStarApproval": {
    "northStarDigest": "95998533b40ffcaa532d02d059ede6ef308c6a02b3e797197ccbd4a551827ecb",
    "approvedBy": "user",
    "approvedAt": "2026-10-11T00:00:00.000Z",
    "decisionRef": "USER-DECISION-20261011-IMPLEMENT-UNIFIED-STATION"
  },
  "criterionCoverage": [
    {"criterionId": "NCP-NS01", "taskIds": ["NCP-01", "NCP-02", "NCP-08"], "closureIds": ["ncp-identity", "ncp-standard-stream", "ncp-cluster-journey"], "gateIds": ["NCP-G01", "NCP-G02", "NCP-G04", "NCP-G05", "NCP-G06"]},
    {"criterionId": "NCP-NS02", "taskIds": ["NCP-02", "NCP-03", "NCP-09"], "closureIds": ["ncp-standard-stream", "ncp-native-cut", "ncp-final-proof"], "gateIds": ["NCP-G01", "NCP-G02", "NCP-G03", "NCP-G07", "NCP-G08", "NCP-G04", "NCP-G05", "NCP-G06", "NCP-G06-AGENT", "NCP-G06-OSS"]},
    {"criterionId": "NCP-NS03", "taskIds": ["NCP-04", "NCP-05", "NCP-07", "NCP-08"], "closureIds": ["ncp-durable-events", "ncp-shared-access", "ncp-shared-objects", "ncp-cluster-journey"], "gateIds": ["NCP-G04", "NCP-G05", "NCP-G06-OSS", "NCP-G06"]},
    {"criterionId": "NCP-NS04", "taskIds": ["NCP-03", "NCP-06", "NCP-07", "NCP-08"], "closureIds": ["ncp-native-cut", "ncp-agent-fencing", "ncp-shared-objects", "ncp-cluster-journey"], "gateIds": ["NCP-G03", "NCP-G07", "NCP-G08", "NCP-G06-AGENT", "NCP-G06-OSS", "NCP-G04", "NCP-G05", "NCP-G06"]}
  ],
  "workClass": "refactor",
  "architecture": {
    "sources": [
      "docs/global/architecture.md",
      "docs/architecture/platform/runtime/node-connectivity/README.md",
      "docs/architecture/platform/runtime/node-connectivity/design.md",
      "docs/architecture/platform/runtime/node-connectivity/decisions.md",
      "docs/architecture/platform/runtime/node-connectivity/data-model.md",
      "docs/architecture/platform/runtime/node-connectivity/module-layout.md",
      "docs/architecture/platform/runtime/node-connectivity/integration.md",
      "docs/architecture/platform/runtime/service-coordination.md",
      "docs/architecture/platform/station/access/design.md",
      "docs/architecture/platform/station/access/decisions.md",
      "docs/architecture/shared/communication/event-stream.md",
      "docs/architecture/platform/station/object-storage.md"
    ],
    "decisions": ["NCP-D01", "NCP-D02", "NCP-D03", "NCP-D04", "NCP-D05", "NCP-D06", "NCP-D07", "NCP-D08", "NCP-D09", "NCP-D10", "NCP-D11", "NCP-D12", "NCP-D13", "NCP-D14", "NCP-D15", "SAL-D03", "SAL-D08", "SAL-D12"]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix": "apps/station/frame", "mode": "exclusive-write"},
      {"pathPrefix": "apps/station/app", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src-tauri", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/src-tauri", "mode": "exclusive-write"},
      {"pathPrefix": "apps/mobile/src/services", "mode": "exclusive-write"},
      {"pathPrefix": "apps/desktop/src/services", "mode": "exclusive-write"},
      {"pathPrefix": "model", "mode": "exclusive-write"},
      {"pathPrefix": "packages", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/acceptance", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/scripts", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/docker", "mode": "exclusive-write"},
      {"pathPrefix": "tooling/make", "mode": "exclusive-write"},
      {"pathPrefix": "docs", "mode": "exclusive-write"}
    ],
    "nonGoals": [
      "Create Gateway, scheduler, broker, alternate business API or another Station identity for a cluster replica",
      "Change product UI, E2EE or canonical business capability ownership",
      "Modify the existing unrelated StationPicker change",
      "Claim Mobile native runtime parity from Desktop or compile evidence",
      "Provide public client peer mesh, DCUtR guarantee or cross-region database replication",
      "Create profiles/environments, reset shared data, restart shared services or reload IDE",
      "Automatically migrate local user storage or rotate a logical Station root",
      "Push or open a PR"
    ]
  },
  "tasks": [
    {"id": "NCP-01", "workstreamId": "NCP-IDENTITY", "path": "tasks/NCP-01.md", "dependsOn": []},
    {"id": "NCP-02", "workstreamId": "NCP-TRANSPORT", "path": "tasks/NCP-02.md", "dependsOn": ["NCP-01"]},
    {"id": "NCP-03", "workstreamId": "NCP-TRANSPORT", "path": "tasks/NCP-03.md", "dependsOn": ["NCP-02"]},
    {"id": "NCP-04", "workstreamId": "NCP-SHARED-TRUTH", "path": "tasks/NCP-04.md", "dependsOn": ["NCP-03"]},
    {"id": "NCP-05", "workstreamId": "NCP-SHARED-TRUTH", "path": "tasks/NCP-05.md", "dependsOn": ["NCP-03"]},
    {"id": "NCP-06", "workstreamId": "NCP-FENCING", "path": "tasks/NCP-06.md", "dependsOn": ["NCP-03"]},
    {"id": "NCP-07", "workstreamId": "NCP-FENCING", "path": "tasks/NCP-07.md", "dependsOn": ["NCP-03"]},
    {"id": "NCP-08", "workstreamId": "NCP-CLUSTER", "path": "tasks/NCP-08.md", "dependsOn": ["NCP-04", "NCP-05", "NCP-06", "NCP-07"]},
    {"id": "NCP-09", "workstreamId": "NCP-PROOF", "path": "tasks/NCP-09.md", "dependsOn": ["NCP-08"]}
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
    "ncp-identity": [],
    "ncp-standard-stream": ["NCP-G01", "NCP-G02"],
    "ncp-native-cut": ["NCP-G03", "NCP-G07", "NCP-G08"],
    "ncp-durable-events": ["NCP-G04"],
    "ncp-shared-access": ["NCP-G05"],
    "ncp-agent-fencing": ["NCP-G06-AGENT"],
    "ncp-shared-objects": ["NCP-G06-OSS"],
    "ncp-cluster-journey": ["NCP-G04", "NCP-G05", "NCP-G06"],
    "ncp-final-proof": ["NCP-G01", "NCP-G02", "NCP-G03", "NCP-G04", "NCP-G05", "NCP-G06", "NCP-G06-AGENT", "NCP-G06-OSS", "NCP-G07", "NCP-G08"]
  },
  "completion": ["NCP-G01", "NCP-G02", "NCP-G03", "NCP-G04", "NCP-G05", "NCP-G06", "NCP-G06-AGENT", "NCP-G06-OSS", "NCP-G07", "NCP-G08"],
  "full": ["NCP-G01", "NCP-G02", "NCP-G03", "NCP-G04", "NCP-G05", "NCP-G06", "NCP-G06-AGENT", "NCP-G06-OSS", "NCP-G07", "NCP-G08"]
}
```

## Execution Contract

NCP-01 closes the logical-identity contract and verifier, without changing active
transport. NCP-02 proves a standard stream/server library unit with real secure
connections and registered handlers; it adds no alternate production listener.
NCP-03 is the atomic consumer cut and native product boundary. It must not report
completion while any production consumer retains the custom data plane.

NCP-04..07 close independent shared-domain boundaries using actual two-process
service tests. They do not claim cluster readiness. NCP-08 alone combines them
with node admission and native failover. NCP-G06-AGENT/OSS are bounded subcontracts
of NCP-G06; the integrated Gate checks their coexistence.

The Gate IDs in this Plan are registered Acceptance owners. Registration alone
does not prove a Gate: completion still requires durable exact-source evidence
from the declared runtime cell. `node-connectivity-journey.py` owns the bounded
process-level closures; Native product proof remains in the environment-backed
Tauri Gates.

One Suite owns exact-source services, DB/object backing, accounts, two native
clients, namespaces and cleanup. DOM events drive login/send/upload and receiver
render assertions; harness controls failure/revoke and authoritative readback.
Functional evidence precedes formal Gates. Initial source work runs focused
checks; no old iOS or blanket cross-platform matrix is selected.

No runtime profile or shared-service restart is authorized by this Plan.
Runtime owner must resolve existing isolated authorized cells; missing cells
remain a specific external-resource boundary. No environment is manufactured.
Local checkpoints needed for source-bound runtime proof require their own grant.

## Review Contract

Architecture review passed in `integration.md`. Plan-model review must verify
the atomic consumer cut, source-backed domain dependencies, per-step execution
channels, shared resource reuse, Gate injection, claim boundary and Task size.
NCP-03 is the indivisible transport cut; if inventory cannot fit a bounded
implementation continuation, amend preparatory library closures before beginning
the cut, preserving one final atomic switch and the North Star.

The recorded North Star approval covers the objective and four criteria. This
package does not fabricate ExecutionRun, Session or OWNER state; exact
runtime/storage permissions remain separate and must be resolved at execution.
