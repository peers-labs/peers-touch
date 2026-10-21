# CCP-08-HOME-CORPSTABLE - Relay, Station, Nginx And Attachment

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-08-HOME-CORPSTABLE",
  "workstreamId": "CCP-DEPLOYMENT",
  "title": "Deploy the Home Relay and corpstable Station, reuse shared Nginx, and prove attachment through private APIs",
  "workClass": "infrastructure",
  "completionClass": "functional",
  "executionMode": "fix",
  "closureId": "ccp-home-corpstable",
  "journeyId": "NCP-HOME-CORPSTABLE-API",
  "runtimeClass": "service",
  "writeSet": [
    "apps/station",
    "tooling/scripts",
    "tooling/acceptance",
    "docs/architecture/platform/runtime/node-connectivity",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "model/domain/peer",
    "packages/station-trust"
  ],
  "budgets": {
    "focusedCheckSeconds": 2400,
    "functionalRunSeconds": 5400,
    "cleanupSeconds": 600
  },
  "checks": [
    {
      "id": "ccp-home-corpstable-source",
      "command": "go test ./apps/station/frame/core/plugin/native/relay/... ./apps/station/frame/core/plugin/native/subserver/relay/... -count=1 && node tooling/scripts/architecture/module-governance.mjs validate",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-home-corpstable-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-home-corpstable-api-e2e --station-profile corpstable",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-home-corpstable-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-home-corpstable-api-e2e --station-profile corpstable",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-home-corpstable-functional",
    "scenarioIds": [
      "home-relay-exact-source-readiness",
      "corpstable-private-attachment",
      "attachment-restart-protobuf-roundtrip"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "Sibling env source defines a secret-free reviewed Home Relay profile and corpstable Station topology while preserving unrelated dirty changes",
    "Tracked example files contain no live credential literals; any exposed credential is revoked and replaced by a secret reference before stable deploy",
    "corpstable PostgreSQL exits recovery and Station reports healthy without resetting or replacing existing stable data",
    "Home Relay runs exact source with persistent identity, database, role allowlist, quotas, reviewed public origin, and shared host Nginx certificate composition",
    "Relay Console static navigation is device-mTLS protected while sensitive operator APIs additionally require the dedicated operator JWT",
    "corpstable reaches the selected Home Relay control and Circuit endpoints, imports a one-time invitation, persists desired attachment, and publishes a signed route",
    "A real protobuf API request succeeds through Circuit before and after owned service restart with identity, enrollment generation, and attachment preserved"
  ],
  "failureBehavior": [
    "Never reset corpstable, delete unrelated containers or volumes, or replace Station/Relay identities to obtain a green check",
    "Never use bare HTTP for credential, grant, Session, or business traffic",
    "Never edit router state, duplicate the shared certificate owner, or introduce an ad-hoc tunnel without a new explicit authorization",
    "Keep native Desktop and Mobile journeys unproven"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Close the selected deployment and attachment lifecycle independently from the
Client Control hosting path.

## Current Snapshot

- `corpstable` Station responds 503 because PostgreSQL is in recovery.
- The old corpstable Relay endpoint is offline.
- Home Relay responds, but advertises a private address and runs stale
  composition.
- The env repository is dirty outside the selected Home/corpstable paths and a
  tracked example contains a credential-like literal that must not be reused.

## External Source Set

The execution owner may change only the existing sibling repository paths
`peers-touch/home/**` and `peers-touch/corpstable/**`. Those files are not
represented as source claims in this repository-local Plan. Stable reset,
router mutation, and unrelated env cleanup are not authorized.
