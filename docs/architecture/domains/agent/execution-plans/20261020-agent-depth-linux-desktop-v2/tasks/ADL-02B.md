# Prompt and Skill authority

## Task Slice

```json
{
  "kind": "peers-touch-task-slice",
  "planId": "agent-depth-linux-desktop-20261020",
  "taskId": "ADL-02B",
  "workstreamId": "ADL",
  "title": "Typed Prompt consumption and Skill binding single truth",
  "workClass": "product-behavior",
  "completionClass": "functional",
  "executionMode": "build",
  "closureId": "ADL-prompt-authority",
  "journeyId": "agent-prompt-skill-authority",
  "runtimeClass": "native-desktop",
  "writeSet": [
    "model/domain/agent",
    "apps/station/app/subserver/agent",
    "apps/desktop/src",
    "docs/architecture/domains/agent",
    "docs/client/desktop"
  ],
  "readSet": [
    "packages/prototypes/desktop",
    "tooling/acceptance"
  ],
  "budgets": {
    "focusedCheckSeconds": 480,
    "functionalRunSeconds": 1500,
    "cleanupSeconds": 180
  },
  "checks": [
    {
      "id": "prompt-station",
      "command": "cd apps/station/app && go test ./subserver/agent/service",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "prompt-desktop",
      "command": "pnpm --dir apps/desktop run check",
      "verificationClass": "SOURCE_CHECK"
    },
    {
      "id": "prompt-functional",
      "command": "make desktop",
      "verificationClass": "FUNCTIONAL_CHECK"
    },
    {
      "id": "prompt-proof",
      "command": "python3 tooling/scripts/acceptance-run.py --gate agent-chat-profile-native",
      "verificationClass": "ACCEPTANCE_PROOF"
    }
  ],
  "runtimeReuse": {
    "scope": "suite",
    "entryCheckId": "prompt-functional",
    "scenarioIds": [
      "profile-create",
      "profile-documents",
      "profile-prompt-consumption",
      "profile-skill-consumption",
      "profile-restart"
    ],
    "maxProvisioningRuns": 1,
    "maxClientLaunches": 2,
    "minWarmReuseRate": 0.8,
    "requireAttachOnlyScenarios": true,
    "requireReceiverVisibleProof": true,
    "allowClientReplacement": true
  },
  "doneWhen": [
    "Prompt assembly reads only typed AgentDefinition fields and pins source refs in ContextLedger.",
    "AgentCapabilityBinding is the sole Skill enablement and policy authority.",
    "First invocation injects only the authorized Skill index; skill_view loads and records the exact body version.",
    "Provider execution blocks on invalid AgentDefinition or capability snapshot.",
    "Legacy Skill.enabled and prompt alias consumers are deleted."
  ],
  "failureBehavior": [
    "Readiness or revision mismatch rejects before Provider execution.",
    "A retired or incompatible Skill cannot appear ready or enter the Prompt.",
    "Display metadata never enters Provider identity or instruction layers."
  ],
  "updatedAt": "2026-10-20T04:10:00.000Z"
}
```

## Current Snapshot

Turn admission now resolves only the actor-owned typed AgentDefinition and pins
its version in ContextLedger source refs. Display metadata and caller-supplied
prompt fields no longer enter Provider identity or instruction layers.

`AgentCapabilityBinding` now exclusively owns Skill enablement and policy.
Prompt assembly receives only its authorized versioned Skill set; the first
Provider request receives the pinned index, `skill_view` loads that exact body
version, and the redacted ContextLedger records the versioned source ref.
Focused service tests and Desktop TypeScript pass.

`agent-chat-profile-native` now declares a reusable Skill-consumption Scenario
in addition to document Provider consumption and restart. The Native runtime
Gate has not executed and remains `UNPROVEN`.
