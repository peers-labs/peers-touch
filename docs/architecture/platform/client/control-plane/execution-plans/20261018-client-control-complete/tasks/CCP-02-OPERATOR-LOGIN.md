# CCP-02-OPERATOR-LOGIN - Operator Identity And Shared Git CAS

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "CCP-COMPLETE-20261018",
  "taskId": "CCP-02-OPERATOR-LOGIN",
  "workstreamId": "CCP-IDENTITY",
  "title": "Deliver audience-bound operator login and one neutral Git App CAS package",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ccp-operator-login",
  "journeyId": "CCP-J01",
  "runtimeClass": "service",
  "writeSet": [
    "packages/github-repository",
    "go.work",
    "apps/oauth2-client",
    "model/domain/oauth",
    "apps/client-control",
    "tooling/acceptance",
    "docs/architecture/domains/identity/oauth-login-broker",
    "docs/architecture/platform/client/control-plane"
  ],
  "readSet": [
    "packages/prototypes/control/client-control"
  ],
  "budgets": {
    "focusedCheckSeconds": 1200,
    "functionalRunSeconds": 1800,
    "cleanupSeconds": 120
  },
  "checks": [
    {
      "id": "ccp-operator-login-source",
      "command": "./model/build.sh && go test ./packages/github-repository/... ./apps/oauth2-client/... ./apps/client-control/... -count=1",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "ccp-operator-login-functional",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy development --gate client-control-operator-login-contract",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "ccp-operator-login-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --execution-policy acceptance --gate client-control-operator-login-contract",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "ccp-operator-login-functional",
    "scenarioIds": [
      "operator-login-success",
      "operator-login-cross-audience-replay",
      "operator-session-csrf-revoke"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 1,
    "minWarmReuseRate": 0.66,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": false
  },
  "doneWhen": [
    "OAuth emits a generated short-lived operator_login assertion bound to exact service audience, receiver challenge, provider subject, purpose, and assertion ID",
    "Client Control redeems a one-use handoff server-to-server and creates a short-lived HTTP-only session with CSRF and durable revocation",
    "The reviewed provider-subject allowlist denies authenticated but unauthorized identities",
    "Neutral Git App authentication, immutable snapshot read, and bounded non-force CAS live in one shared Go package",
    "OAuth and Client Control consume the shared Git package without importing each other's domain types",
    "Existing account-login and connector-link contracts pass regression checks"
  ],
  "failureBehavior": [
    "Never place assertions, receiver secrets, provider credentials, or session material in URLs or logs",
    "Never reuse Station bridge secrets or purposes for Client Control",
    "Never let Client Control login authorize signing, distribution deployment, Relay administration, or Station Access"
  ],
  "updatedAt": "2026-10-18T13:54:42.000Z"
}
```

## Objective

Provide one authenticated operator boundary while removing duplicated Git
mechanics and preserving OAuth domain ownership.

## Current Snapshot

- OAuth has durable provider state, PKCE, encrypted Git records, and purpose-bound
  Station assertions.
- Git App and CAS mechanics live under the OAuth application's `internal` tree.
- Client Control has no operator assertion, admin session, or source repository
  adapter.
