# Client Control Complete Delivery

> **Plan ID**: CCP-COMPLETE-20261018
> **Version ID**: CCP-COMPLETE-20261018-v1
> **Created**: 2026-10-18T13:54:42.000Z

## Plan Version

```json
{
  "kind": "peers-touch-plan-version",
  "planId": "CCP-COMPLETE-20261018",
  "versionId": "CCP-COMPLETE-20261018-v1",
  "createdAt": "2026-10-18T13:54:42.000Z",
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/platform/client/control-plane/README.md",
      "docs/architecture/platform/client/control-plane/product-definition.md",
      "docs/architecture/platform/client/control-plane/experience-contract.md",
      "docs/architecture/platform/client/control-plane/product-state-model.md",
      "docs/architecture/platform/client/control-plane/acceptance-matrix.md",
      "docs/architecture/platform/client/control-plane/design.md",
      "docs/architecture/platform/client/control-plane/decisions.md",
      "docs/architecture/platform/client/control-plane/data-model.md",
      "docs/architecture/platform/client/control-plane/module-layout.md",
      "docs/architecture/platform/client/control-plane/integration.md",
      "docs/architecture/platform/client/control-plane/prototype/README.md",
      "docs/architecture/platform/runtime/node-connectivity/bootstrap-connection-material.md",
      "docs/architecture/platform/runtime/node-connectivity/relay-attachment/home-corpstable-integration.md",
      "docs/architecture/platform/runtime/node-connectivity/decisions.md",
      "docs/architecture/platform/station/access/design.md",
      "docs/architecture/platform/station/access/decisions.md",
      "docs/architecture/domains/identity/oauth-login-broker/operator-login.md",
      "docs/architecture/domains/identity/oauth-login-broker/decisions.md"
    ],
    "decisions": [
      "CCP-D01",
      "CCP-D02",
      "CCP-D03",
      "CCP-D04",
      "CCP-D05",
      "CCP-D06",
      "CCP-D09",
      "CCP-D10",
      "CCP-D11",
      "CCP-D12",
      "CCP-D13",
      "NCP-D20",
      "NCP-D21",
      "SAL-D07",
      "SAL-D08",
      "OLB-D18"
    ]
  },
  "scope": {
    "sourceClaims": [
      {"pathPrefix":"apps/client-control","mode":"exclusive-write"},
      {"pathPrefix":"apps/oauth2-client","mode":"exclusive-write"},
      {"pathPrefix":"apps/desktop","mode":"exclusive-write"},
      {"pathPrefix":"apps/mobile","mode":"exclusive-write"},
      {"pathPrefix":"apps/station","mode":"exclusive-write"},
      {"pathPrefix":"model","mode":"exclusive-write"},
      {"pathPrefix":"packages/client-control-core","mode":"exclusive-write"},
      {"pathPrefix":"packages/github-repository","mode":"exclusive-write"},
      {"pathPrefix":"packages/locales","mode":"exclusive-write"},
      {"pathPrefix":"packages/station-trust","mode":"exclusive-write"},
      {"pathPrefix":"packages/prototypes/control/client-control","mode":"shared-read"},
      {"pathPrefix":"tooling/acceptance","mode":"exclusive-write"},
      {"pathPrefix":"tooling/scripts","mode":"exclusive-write"},
      {"pathPrefix":"tooling/skills/pt-client-control-2-vercel","mode":"exclusive-write"},
      {"pathPrefix":"docs","mode":"exclusive-write"},
      {"pathPrefix":"go.work","mode":"exclusive-write"},
      {"pathPrefix":"package.json","mode":"exclusive-write"},
      {"pathPrefix":"pnpm-lock.yaml","mode":"exclusive-write"}
    ],
    "nonGoals": [
      "Make Client Control a Station, Relay, Session, Federation, certificate, router, or update-installation authority",
      "Permit public endpoint self-registration, arbitrary feature maps, commands, scripts, secrets, grants, or credentials in snapshots",
      "Persist cloud suggestions as verified Stations or silently change the active Station",
      "Use Vercel admin credentials to approve, sign, write the signer ledger, or deploy distribution",
      "Claim Desktop or Mobile native UI Acceptance from source and API evidence",
      "Reset stable data, delete unrelated containers or volumes, rotate existing identities, or rewrite Git history",
      "Push, open a pull request, merge, or purchase a paid hosting plan without separate authorization"
    ]
  },
  "tasks": [
    {"id":"CCP-01-CONNECTION-MATERIAL","workstreamId":"CCP-TRUST","path":"tasks/CCP-01-CONNECTION-MATERIAL.md","dependsOn":[]},
    {"id":"CCP-02-OPERATOR-LOGIN","workstreamId":"CCP-IDENTITY","path":"tasks/CCP-02-OPERATOR-LOGIN.md","dependsOn":[]},
    {"id":"CCP-03-SIGNED-SNAPSHOT","workstreamId":"CCP-PUBLICATION","path":"tasks/CCP-03-SIGNED-SNAPSHOT.md","dependsOn":["CCP-01-CONNECTION-MATERIAL"]},
    {"id":"CCP-03B-TRUSTED-PUBLISHER","workstreamId":"CCP-PUBLICATION","path":"tasks/CCP-03B-TRUSTED-PUBLISHER.md","dependsOn":["CCP-02-OPERATOR-LOGIN","CCP-03-SIGNED-SNAPSHOT"]},
    {"id":"CCP-04-CONSOLE-ADMIN","workstreamId":"CCP-CONSOLE","path":"tasks/CCP-04-CONSOLE-ADMIN.md","dependsOn":["CCP-02-OPERATOR-LOGIN","CCP-03-SIGNED-SNAPSHOT"]},
    {"id":"CCP-04B-CONSOLE-WORKFLOW","workstreamId":"CCP-CONSOLE","path":"tasks/CCP-04B-CONSOLE-WORKFLOW.md","dependsOn":["CCP-03B-TRUSTED-PUBLISHER","CCP-04-CONSOLE-ADMIN"]},
    {"id":"CCP-05-VERCEL-PUBLICATION","workstreamId":"CCP-PUBLICATION","path":"tasks/CCP-05-VERCEL-PUBLICATION.md","dependsOn":["CCP-04B-CONSOLE-WORKFLOW"]},
    {"id":"CCP-06-DESKTOP-SUGGESTIONS","workstreamId":"CCP-CLIENTS","path":"tasks/CCP-06-DESKTOP-SUGGESTIONS.md","dependsOn":["CCP-01-CONNECTION-MATERIAL","CCP-03-SIGNED-SNAPSHOT"]},
    {"id":"CCP-07-MOBILE-SUGGESTIONS","workstreamId":"CCP-CLIENTS","path":"tasks/CCP-07-MOBILE-SUGGESTIONS.md","dependsOn":["CCP-01-CONNECTION-MATERIAL","CCP-03-SIGNED-SNAPSHOT"]},
    {"id":"CCP-08-HOME-CORPSTABLE","workstreamId":"CCP-DEPLOYMENT","path":"tasks/CCP-08-HOME-CORPSTABLE.md","dependsOn":["CCP-01-CONNECTION-MATERIAL"]},
    {"id":"CCP-09-PRODUCTION-CATALOG","workstreamId":"CCP-DEPLOYMENT","path":"tasks/CCP-09-PRODUCTION-CATALOG.md","dependsOn":["CCP-05-VERCEL-PUBLICATION","CCP-08-HOME-CORPSTABLE"]},
    {"id":"CCP-10-API-CLOSURE","workstreamId":"CCP-PROOF","path":"tasks/CCP-10-API-CLOSURE.md","dependsOn":["CCP-06-DESKTOP-SUGGESTIONS","CCP-07-MOBILE-SUGGESTIONS","CCP-09-PRODUCTION-CATALOG"]}
  ],
  "authorization": {
    "checkpoint": {"localCommit":"allowed","amend":"denied"},
    "delivery": {"push":"denied","pullRequest":"denied"},
    "runtime": {"deployProfiles":["home","corpstable"],"destructiveResetScopes":[]},
    "history": {"rewrite":"denied"}
  }
}
```

## Acceptance Execution

```json
{
  "closures": {
    "ccp-connection-material": [],
    "ccp-operator-login": ["client-control-operator-login-contract"],
    "ccp-signed-snapshot": ["client-control-snapshot-core-contract"],
    "ccp-trusted-publisher": ["client-control-snapshot-publication-contract"],
    "ccp-console-admin": ["client-control-admin-api-contract"],
    "ccp-console-workflow": ["client-control-console-admin-e2e"],
    "ccp-vercel-publication": ["client-control-vercel-publication-e2e"],
    "ccp-desktop-suggestions": [],
    "ccp-mobile-suggestions": [],
    "ccp-home-corpstable": ["client-control-home-corpstable-api-e2e"],
    "ccp-production-catalog": ["client-control-production-catalog-e2e"],
    "ccp-api-closure": ["client-control-api-aggregate-e2e"]
  },
  "completion": [
    "client-control-operator-login-contract",
    "client-control-snapshot-core-contract",
    "client-control-snapshot-publication-contract",
    "client-control-admin-api-contract",
    "client-control-console-admin-e2e",
    "client-control-vercel-publication-e2e",
    "client-control-home-corpstable-api-e2e",
    "client-control-production-catalog-e2e",
    "client-control-api-aggregate-e2e"
  ],
  "full": [
    "architecture-module-governance",
    "proto-build",
    "oauth-login-broker-contract",
    "station-access-capability-contract",
    "relay-role-security-contract",
    "desktop-check",
    "mobile-native-build",
    "client-control-operator-login-contract",
    "client-control-snapshot-core-contract",
    "client-control-snapshot-publication-contract",
    "client-control-admin-api-contract",
    "client-control-console-admin-e2e",
    "client-control-vercel-publication-e2e",
    "client-control-home-corpstable-api-e2e",
    "client-control-production-catalog-e2e",
    "client-control-api-aggregate-e2e"
  ]
}
```

## Goal

Deliver an audited Client Control product that publishes optional signed Relay,
public Station, and release suggestions; integrate those suggestions into both
client kernels without bypassing Station Access; and prove the selected Home
Relay plus corpstable Station through API-only deployment evidence.

## Execution DAG

```text
CCP-01 -> CCP-03
CCP-02 + CCP-03 -> CCP-03B
CCP-02 + CCP-03 -> CCP-04
CCP-03B + CCP-04 -> CCP-04B -> CCP-05
CCP-03 -> CCP-06
CCP-03 -> CCP-07
CCP-01 -> CCP-08
CCP-05 + CCP-08 -> CCP-09
CCP-06 + CCP-07 + CCP-09 -> CCP-10
```

## Atomic Cutovers

- Neutral Git mechanics move from the OAuth `internal` adapter to one shared Go
  package; OAuth and Client Control switch in the same checkpoint and no copied
  Git client remains.
- Client Control suggestions remain a separate projection. Desktop and Mobile
  verified Station registries are never migrated, mirrored, or dual-written.
- Production publication changes only after exact source/digest approval,
  preview byte verification, promotion, and production readback. Rollback is a
  deployment/source revert or a higher-sequence restore-as-new publication.
- Home/corpstable environment source remains in the sibling `env` repository.
  This Plan records coordination but does not misrepresent cross-repository
  files as Peers-Touch source claims.

## External Resource Contract

- Existing Vercel account is authenticated and currently has four projects.
  Creation of the two Client Control projects proceeds only after fresh
  Hobby/policy/quota readback; no paid upgrade is authorized.
- The dedicated data repository, GitHub App installation, trusted approval
  entry, signer secrets/ledger, and Vercel projects are independent resources.
  Browser/admin credentials never gain code, signer-ledger, approval, or
  distribution-write authority.
- `home` and `corpstable` deploy/restart are explicitly selected; stable reset
  and unrelated container/volume deletion remain forbidden.
- The environment repository is already dirty outside the selected paths.
  Only `peers-touch/home/**` and `peers-touch/corpstable/**` may be changed, and
  existing unrelated changes must remain untouched.

## Claim Boundary

Completion proves source contracts, focused console browser behavior, public
artifact identity, operator login, publication isolation, Desktop/Mobile
kernel adapters, and Relay/Station API/restart behavior. It does not prove
native selector rendering, commercial Vercel scale, paid features, router
administration, or client update installation.
