# Minimum Usable Agent Chat - Plan Package

> **Status**: active
> **Branch**: feat/p0-streaming-runtime-message-actions
> **Workspace ID**: 65e7b6da4dc9be85
> **Initial HEAD**: 41f4198fb3878e2b791a0ca1442d9a15549bb967

## Plan Package

```json
{
  "kind": "peers-touch-plan-package",
  "planId": "minimum-usable-agent-chat-20261001",
  "status": "active",
  "binding": {
    "branch": "feat/p0-streaming-runtime-message-actions",
    "workspaceId": "65e7b6da4dc9be85",
    "initialHead": "41f4198fb3878e2b791a0ca1442d9a15549bb967"
  },
  "workClass": "product-behavior",
  "architecture": {
    "sources": [
      "docs/architecture/agent/modern-chat-agent/product-definition.md",
      "docs/architecture/agent/modern-chat-agent/experience-contract.md",
      "docs/architecture/agent/modern-chat-agent/product-state-model.md",
      "docs/architecture/agent/modern-chat-agent/design.md",
      "docs/architecture/agent/modern-chat-agent/decisions.md",
      "docs/architecture/agent/agent-lobehub-blueprint.md"
    ],
    "decisions": [
      "MCA-D14",
      "MCA-D15",
      "MCA-D16",
      "MCA-D17",
      "MCA-D18",
      "MCA-D20",
      "MCA-D22",
      "MCA-D23"
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
        "pathPrefix": "docs/architecture/agent",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "model/domain/agent",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/agent-catalog",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "packages/locales",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/acceptance",
        "mode": "exclusive-write"
      },
      {
        "pathPrefix": "tooling/scripts/local-dev",
        "mode": "exclusive-write"
      }
    ],
    "nonGoals": [
      "Require the 419-cell Foundation matrix for this release",
      "Require or modify the external CLI Agent runtime",
      "Complete Marketplace governance or hosted catalog parity",
      "Complete Evaluation Lab, Artifacts, Multi-Agent, Mobile Agent UI, server-side TTS, image generation, or video generation",
      "Claim current LobeHub full parity",
      "Create fallback, mock, dual-write, compatibility, or test-only product paths"
    ]
  },
  "tasks": [
    {
      "id": "AMU-01",
      "workstreamId": "AMU",
      "path": "tasks/AMU-01.md",
      "dependsOn": [],
      "status": "in_progress",
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
      "deployProfiles": [
        "two"
      ],
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
{"closures":{"AMU-functional":["agent-minimum-usable-chat-native-e2e"]},"completion":["agent-minimum-usable-chat-native-e2e"],"full":["acceptance-infra-validation","acceptance-plan-self","acceptance-runtime-provisioning-self","acceptance-workflow-contract","agent-attachment-e2e","agent-cli-provider-primary-native-e2e","agent-core-lifecycle-native-e2e","agent-marketplace-catalog-e2e","agent-minimum-usable-chat-native-e2e","agent-provider-credential-e2e","agent-stream-resilience-e2e","agent-v2-capability-binding-e2e","agent-v2-external-runtime-e2e","agent-v2-governed-tool-loop-e2e","agent-v2-kernel-foundation-e2e","agent-v2-mcp-lifecycle-e2e","chat-lifecycle-tree-zero-reference-e2e","desktop-check","development-workflow-control-plane","machine-dev-registry-self","proto-build","station-agent-unit"]}
```

## Goal

Deliver one usable Direct Model Agent Chat loop on Desktop Native: configure
and select an Agent, bind a ready MCP capability, send a message, execute the
capability through Station governance, receive a final assistant response, and
recover the same conversation and response after a native restart.

Browser remains explicitly `UNPROVEN` and does not block this minimum Native
release cut.

## Release Cut

- One Task, one user Journey, and one dedicated Native product Gate.
- Fix every observed gap at its owning production layer.
- Stop when the minimum Journey passes; all broader parity work is descoped.
