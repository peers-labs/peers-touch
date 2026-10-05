# OAuth2 Client Vercel Publishing Skill

> **Status**: completed
> **Branch**: work/station-access-lifecycle
> **Workspace ID**: 95620934d3348d95
> **Initial HEAD**: 6e7c29b4ed1eead79856921ab9069f3140494662

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "OLB-VERCEL-SKILL-20261002",
  "status": "completed",
  "binding": {
    "branch": "work/station-access-lifecycle",
    "workspaceId": "95620934d3348d95",
    "initialHead": "6e7c29b4ed1eead79856921ab9069f3140494662"
  },
  "workClass": "infrastructure",
  "architecture": {
    "sources": [
      "AGENTS.md",
      "docs/architecture/oauth-login-broker/README.md",
      "docs/architecture/oauth-login-broker/design.md",
      "docs/architecture/oauth-login-broker/decisions.md",
      "docs/architecture/oauth-login-broker/integration.md",
      "docs/architecture/oauth-login-broker/acceptance-matrix.md"
    ],
    "decisions": [
      "OLB-D01",
      "OLB-D08",
      "OLB-D09"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": ".gitignore",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "AGENTS.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/oauth2-client",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/oauth-login-broker",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/knowledge",
        "mode": "shared-read"
      },
      {
        "pathPrefix": "tooling/acceptance/capabilities/oauth-login-broker.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/domains/oauth-login-broker.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/features/oauth2-client-vercel-publication.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/gates.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/registry.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-oauth2-client-2-vercel",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/skills/pt-github-review/FRESHNESS.md",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Create or mutate a Vercel Project during Skill authoring",
      "Run Preview or Production deployment during Skill authoring",
      "Write to the sibling environment repository",
      "Create or rotate provider credentials",
      "Replace api function entrypoints with cmd/server",
      "Push, open a pull request, merge, release, or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "OLB-VERCEL-SKILL-01",
      "workstreamId": "OLB-VERCEL-SKILL",
      "path": "tasks/OLB-VERCEL-SKILL-01.md",
      "dependsOn": [],
      "status": "done",
      "blocker": null
    }
  ],
  "exhaustion": null,
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed",
      "amend": "allowed"
    },
    "delivery": {
      "push": "denied",
      "pullRequest": "denied"
    },
    "runtime": {
      "deployProfiles": [],
      "destructiveResetScopes": []
    },
    "history": {
      "rewrite": "denied"
    }
  }
}
```

## Acceptance Execution

```json
{
  "closures": {
    "olb-vercel-skill": [
      "oauth2-client-vercel-publication"
    ]
  },
  "completion": [
    "oauth2-client-vercel-publication"
  ],
  "full": [
    "acceptance-infra-validation",
    "acceptance-plan-self",
    "acceptance-runtime-provisioning-self",
    "acceptance-workflow-contract",
    "development-workflow-control-plane",
    "oauth-login-broker-architecture",
    "oauth-login-broker-contract",
    "oauth-login-broker-durable-login",
    "oauth-login-broker-handoff-contract",
    "oauth-login-broker-key-rotation",
    "oauth-login-broker-operator",
    "oauth-login-broker-provider-identity",
    "oauth-login-broker-refresh-idempotency",
    "oauth2-client-live-api-repository",
    "oauth2-client-vercel-publication",
    "peers-dev-product"
  ]
}
```

## Goal

Provide one maintainable project Skill that discovers the OAuth2 broker
contract, safely prepares Vercel environment state from the sibling env
repository, deploys Preview before Production, and verifies HTTP, real-provider,
and encrypted GitHub persistence evidence without leaking secrets.

## Dependency DAG

```text
OLB-VERCEL-SKILL-01
```

## Atomic Cutovers

- Root `.vercel/` link metadata is ignored before the first repository-root
  `vercel link --repo`, so publication cannot dirty tracked source.
- `tooling/skills/pt-oauth2-client-2-vercel` becomes the sole Skill source and
  is registered in `AGENTS.md`; no host-private copy is tracked.
- Provider discovery is compared with the version-controlled provider catalog;
  unknown, incompletely wired, or omitted enabled providers block publishing.
- Vercel environment values are read in memory from the sibling env repository
  and sent to the CLI over stdin; no env file enters this repository.
- Preview verification precedes Production promotion or deployment.
- Preview is explicitly targeted, and the new Production deployment created by
  promotion is independently identified and reverified.
- Production preflight fixes the base URL, callback URIs, return destinations,
  and GitHub storage driver; memory storage is rejected.
- Live OAuth is blocked unless the configured GitHub persistence repository is
  private, and stored envelopes have the exact canonical encrypted shape.

## Completion

- The Skill, provider catalog, scripts, fixtures, and tests are committed.
- `vercel.json` includes schema, function file bundling, and bounded duration
  while preserving the existing function routes.
- OAuth2 and architecture READMEs provide reciprocal publishing entry points.
- Go tests, script tests, Skill registration checks, Plan validation, and
  `git diff --check` pass.
- No Vercel Project, Preview, Production deployment, or sibling env file is
  created or mutated by this Plan Run.

## Non-Claims

- The Skill implementation does not prove a live Vercel account, project link,
  stable domain, Preview protection policy, provider callback registration, or
  production deployment.
- Live OAuth consent and GitHub persistence are first-invocation obligations.
- Key rotation remains an independent maintenance command.
