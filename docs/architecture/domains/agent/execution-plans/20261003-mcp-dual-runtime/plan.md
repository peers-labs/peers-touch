# MCP Dual Runtime - Plan Package

> **Plan ID**: agent-mcp-dual-runtime-20261003
> **Created**: 2026-10-03T02:30:00.000Z

## Plan

```json
{
  "kind": "peers-touch-plan",
  "planId": "agent-mcp-dual-runtime-20261003",
  "createdAt": "2026-10-03T02:30:00.000Z",
  "northStar": {
    "objective": "Make MCP execution location explicit and trustworthy across Station-owned and Desktop-local runtimes.",
    "successCriteria": [
      {
        "id": "MCP-NS-01",
        "statement": "Station owns MCP configuration, manifests, bindings, readiness, ToolCalls, results, and audit.",
        "sourceRefs": [
          "MCA-D15",
          "MCA-D16A"
        ]
      },
      {
        "id": "MCP-NS-02",
        "statement": "Station-local and Desktop-local MCP execution preserve one fenced capability contract without a generic local_mcp fallback.",
        "sourceRefs": [
          "MCA-D16A",
          "MCA-D23"
        ]
      }
    ]
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/domains/agent/design.md",
      "docs/architecture/domains/agent/data-model.md",
      "docs/architecture/domains/agent/module-layout.md",
      "docs/architecture/domains/agent/integration.md",
      "docs/architecture/domains/agent/modern-chat-agent/design.md",
      "docs/architecture/domains/agent/modern-chat-agent/data-model.md",
      "docs/architecture/domains/agent/modern-chat-agent/module-layout.md",
      "docs/architecture/domains/agent/modern-chat-agent/integration.md",
      "docs/architecture/domains/agent/modern-chat-agent/decisions.md",
      "docs/architecture/engineering/development-workflow/design.md"
    ],
    "decisions": [
      "MCA-D15",
      "MCA-D16A",
      "MCA-D23",
      "DWF-D42"
    ]
  },
  "scope": {
    "sourceClaims": [
      {
        "pathPrefix": "apps/desktop",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "apps/station/app/subserver/agent",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/domains/agent",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/architecture/engineering/architecture-governance/architecture-modules.json",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "docs/README.md",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "model/domain/agent",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/gates/agent",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/gates.yaml",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance/registry.yaml",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Move Desktop files, credentials, or device-only MCP processes to Station",
      "Add a third MCP-specific ToolCall dispatch protocol",
      "Infer execution owner from stdio, HTTP, or SSE transport",
      "Retain the generic local_mcp manifest or Desktop MCP catalog as compatibility paths",
      "Complete Mobile MCP execution",
      "Push, open a pull request, deploy a remote Station, reset data, or rewrite history"
    ]
  },
  "tasks": [
    {
      "id": "MCP-01-STATION-RUNTIME",
      "workstreamId": "MCP-DUAL-RUNTIME",
      "path": "tasks/MCP-01-STATION-RUNTIME.md",
      "dependsOn": []
    },
    {
      "id": "MCP-02-DESKTOP-RUNTIME",
      "workstreamId": "MCP-DUAL-RUNTIME",
      "path": "tasks/MCP-02-DESKTOP-RUNTIME.md",
      "dependsOn": [
        "MCP-01-STATION-RUNTIME"
      ]
    },
    {
      "id": "MCP-03-HARD-CUT-PROOF",
      "workstreamId": "MCP-DUAL-RUNTIME",
      "path": "tasks/MCP-03-HARD-CUT-PROOF.md",
      "dependsOn": [
        "MCP-02-DESKTOP-RUNTIME"
      ]
    }
  ],
  "authorization": {
    "checkpoint": {
      "localCommit": "allowed"
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
  },
  "amendments": [],
  "northStarApproval": {
    "northStarDigest": "ad307c81fc2d8b78ef18379bb401f2bf7b47eb8d50343f6a07ac5c0421456d11",
    "approvedBy": "user",
    "approvedAt": "2026-10-06T18:18:40.000Z",
    "decisionRef": "USER-DECISION-20261007-NORTH-STAR"
  },
  "criterionCoverage": [
    {
      "criterionId": "MCP-NS-01",
      "taskIds": [
        "MCP-01-STATION-RUNTIME",
        "MCP-03-HARD-CUT-PROOF"
      ],
      "closureIds": [
        "MCP-station-runtime",
        "MCP-dual-runtime-proof"
      ],
      "gateIds": [
        "station-agent-unit",
        "agent-mcp-dual-runtime-source"
      ]
    },
    {
      "criterionId": "MCP-NS-02",
      "taskIds": [
        "MCP-01-STATION-RUNTIME",
        "MCP-02-DESKTOP-RUNTIME",
        "MCP-03-HARD-CUT-PROOF"
      ],
      "closureIds": [
        "MCP-station-runtime",
        "MCP-desktop-runtime",
        "MCP-dual-runtime-proof"
      ],
      "gateIds": [
        "station-agent-unit",
        "desktop-check",
        "agent-mcp-dual-runtime-source"
      ]
    }
  ]
}
```

## Acceptance Execution

```json
{"closures":{"MCP-station-runtime":["station-agent-unit"],"MCP-desktop-runtime":["desktop-check"],"MCP-dual-runtime-proof":["agent-mcp-dual-runtime-source"]},"completion":["station-agent-unit","desktop-check","agent-mcp-dual-runtime-source"],"full":["station-agent-unit","desktop-check","agent-mcp-dual-runtime-source"]}
```

## Goal

Make MCP execution location explicit and trustworthy. Station owns MCP
configuration, Tool manifests, bindings, readiness, ToolCalls, results, and
audit. Station-local MCP executes beside the Agent runtime; Desktop-local MCP
executes in Rust through the existing fenced capability session.

## Atomic Cutover

- Publish per-Server/Tool manifests with a concrete execution owner.
- Cut all config reads and mutations to the Station MCP service.
- Preserve only owner-local secret material and process state outside Station.
- Delete generic `local_mcp`, Desktop Turn tool injection, and Desktop catalog
  authority in the same Plan.
- Rollback is source rollback before deployment; no compatibility runtime is
  retained.
