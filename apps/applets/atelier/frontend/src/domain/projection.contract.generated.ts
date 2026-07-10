// Generated from apps/applets/atelier/contracts/atelier-projection.contract.json.
// Do not edit by hand. Run `pnpm run atelier:projection-codegen`.

export const ATELIER_PROJECTION_CONTRACT = {
  "version": "atelier-projection/v0",
  "eventTopic": "atelier.projection.event",
  "eventSubscription": {
    "agentIdSourcePriority": [
      "agentId",
      "agentIds[0]"
    ],
    "taskIdSourcePriority": [
      "certificationCreatedSelectedTaskId",
      "explicitTaskId",
      "controllerSelectedTaskId",
      "snapshotSelectedTaskId",
      "snapshotFirstTaskId"
    ],
    "defaultCursorSource": "workspace.replay[taskId].nextEventSeq",
    "zeroCursorPolicy": "omit"
  },
  "subscriptionMethod": "atelier.events.subscribe",
  "methods": [
    "atelier.workspace.load",
    "atelier.project.createFromGoal",
    "atelier.message.send",
    "atelier.escalation.resolve",
    "atelier.task.setStatus",
    "atelier.task.purge",
    "atelier.provider.capabilities",
    "atelier.feedback.submit",
    "atelier.memory.confirmCandidate",
    "atelier.feedback.confirmRerun",
    "atelier.workspace.open",
    "atelier.artifact.body.fetch",
    "atelier.artifact.preview.open",
    "atelier.events.subscribe"
  ],
  "runtimeMethods": [
    "atelier.workspace.load",
    "atelier.project.createFromGoal",
    "atelier.message.send",
    "atelier.escalation.resolve",
    "atelier.task.setStatus",
    "atelier.task.purge",
    "atelier.provider.capabilities",
    "atelier.feedback.submit",
    "atelier.memory.confirmCandidate",
    "atelier.feedback.confirmRerun",
    "atelier.workspace.open",
    "atelier.artifact.body.fetch",
    "atelier.artifact.preview.open"
  ],
  "methodIntents": {
    "atelier.workspace.load": {
      "intentOwner": "station",
      "intentKind": "projection_read",
      "sideEffectClass": "none",
      "executionForbidden": true
    },
    "atelier.project.createFromGoal": {
      "intentOwner": "station",
      "intentKind": "project_create_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.message.send": {
      "intentOwner": "station",
      "intentKind": "message_append_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.escalation.resolve": {
      "intentOwner": "station",
      "intentKind": "human_decision_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.task.setStatus": {
      "intentOwner": "station",
      "intentKind": "task_lifecycle_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.task.purge": {
      "intentOwner": "station",
      "intentKind": "task_purge_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.provider.capabilities": {
      "intentOwner": "station",
      "intentKind": "provider_discovery_read",
      "sideEffectClass": "none",
      "executionForbidden": true
    },
    "atelier.feedback.submit": {
      "intentOwner": "station",
      "intentKind": "feedback_record_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.memory.confirmCandidate": {
      "intentOwner": "station",
      "intentKind": "memory_confirmation_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.feedback.confirmRerun": {
      "intentOwner": "station",
      "intentKind": "rerun_confirmation_intent",
      "sideEffectClass": "station_transaction",
      "executionForbidden": true
    },
    "atelier.workspace.open": {
      "intentOwner": "desktop_host",
      "intentKind": "workspace_open_host_intent",
      "sideEffectClass": "host_ui",
      "executionForbidden": true
    },
    "atelier.artifact.body.fetch": {
      "intentOwner": "station",
      "intentKind": "artifact_body_safe_text_read",
      "sideEffectClass": "none",
      "executionForbidden": true
    },
    "atelier.artifact.preview.open": {
      "intentOwner": "desktop_host",
      "intentKind": "artifact_preview_host_intent",
      "sideEffectClass": "host_ui",
      "executionForbidden": true
    },
    "atelier.events.subscribe": {
      "intentOwner": "station",
      "intentKind": "projection_event_subscription",
      "sideEffectClass": "none",
      "executionForbidden": true
    }
  },
  "methodPayloads": {
    "atelier.project.createFromGoal": {
      "requiredFields": [
        "goal",
        "agentIds"
      ],
      "optionalFields": [
        "intentPreset",
        "run.kind",
        "run.flowId",
        "run.model"
      ],
      "allowedIntentPresets": [
        "work",
        "code",
        "design"
      ],
      "intentPresetMapping": {
        "work": {
          "providerStrategyPreset": "station_generalist_research",
          "gatePlanPreset": "plan_review_evidence"
        },
        "code": {
          "providerStrategyPreset": "coding_provider_preferred",
          "gatePlanPreset": "lint_typecheck_build"
        },
        "design": {
          "providerStrategyPreset": "design_review_preferred",
          "gatePlanPreset": "prototype_visual_review"
        }
      },
      "allowedRunKinds": [
        "agents",
        "model"
      ],
      "defaultRunKind": "agents",
      "allowedDirectRunModels": [
        "openrouter-3o",
        "claude-sonnet",
        "gpt-5",
        "gemini-pro"
      ],
      "defaultDirectRunModel": "openrouter-3o",
      "allowedAgentFlowIds": [
        "expert-hierarchy",
        "roundtable",
        "debate-judge",
        "expert-mesh",
        "swarm",
        "hierarchy"
      ],
      "defaultAgentFlowId": "expert-hierarchy",
      "agentFlowDescriptors": [
        {
          "id": "expert-hierarchy",
          "label": "Expert Hierarchy（默认）",
          "description": "长流程 + 能力互补 · 终裁签字 + 无未决反对",
          "batch": 1
        },
        {
          "id": "roundtable",
          "label": "Roundtable 圆桌",
          "description": "方案发散 / 头脑风暴 · 主持人收敛",
          "batch": 1
        },
        {
          "id": "debate-judge",
          "label": "Debate Judge 辩论裁决",
          "description": "多方案冲突 · Judge 裁决达成共识",
          "batch": 1
        },
        {
          "id": "expert-mesh",
          "label": "Expert Mesh 专家网",
          "description": "能力互补并行 · 聚合器合并",
          "batch": 2
        },
        {
          "id": "swarm",
          "label": "Swarm 蜂群",
          "description": "海量同构并行 · 结果归约 + 多数",
          "batch": 2
        },
        {
          "id": "hierarchy",
          "label": "Hierarchy 层级（edict）",
          "description": "长流程强秩序 · 上级签字下令",
          "batch": 2
        }
      ],
      "directRunIntent": {
        "kind": "model",
        "requiredFields": [
          "run.model"
        ],
        "forbiddenFields": [
          "run.flowId",
          "run.agentIds"
        ],
        "stationSource": "atelier.direct_run.intent",
        "forbiddenActions": [
          "invoke",
          "execute",
          "run",
          "shell",
          "file"
        ]
      }
    },
    "atelier.message.send": {
      "requiredFields": [
        "taskId",
        "text"
      ]
    },
    "atelier.escalation.resolve": {
      "requiredFields": [
        "taskId",
        "blockId",
        "choice"
      ]
    },
    "atelier.task.setStatus": {
      "requiredFields": [
        "taskId",
        "status"
      ],
      "allowedStatus": [
        "active",
        "archived",
        "deleted"
      ]
    },
    "atelier.task.purge": {
      "requiredFields": [
        "taskId"
      ],
      "requiresStatus": "deleted"
    },
    "atelier.provider.capabilities": {
      "optionalFields": [
        "taskId"
      ],
      "responseFields": [
        "capabilities",
        "source"
      ],
      "allowedCapabilityScopes": [
        "station-provider"
      ],
      "capabilityScope": "station-provider",
      "capabilityReadOnly": true,
      "forbiddenActions": [
        "invoke",
        "execute",
        "run",
        "action.execute",
        "action.run",
        "policy.override",
        "rollback.execute"
      ]
    },
    "atelier.feedback.submit": {
      "requiredFields": [
        "taskId",
        "blockId",
        "signal"
      ],
      "optionalFields": [
        "comment"
      ],
      "responseFields": [
        "accepted",
        "feedbackId",
        "memoryCandidate",
        "memoryCandidate.status",
        "memoryCandidate.reason",
        "memoryCandidate.feeds",
        "memoryCandidate.requiresConfirmation",
        "memoryCandidate.confirmationMode",
        "rerunIntent",
        "rerunIntent.status",
        "rerunIntent.reason",
        "rerunIntent.feeds",
        "rerunIntent.requiresConfirmation",
        "rerunIntent.confirmationMode"
      ],
      "allowedSignals": [
        "positive",
        "negative",
        "copy",
        "regenerate"
      ],
      "forbiddenActions": [
        "memory.write",
        "rerun",
        "invoke",
        "execute",
        "run"
      ]
    },
    "atelier.memory.confirmCandidate": {
      "requiredFields": [
        "taskId",
        "feedbackId"
      ],
      "responseFields": [
        "accepted",
        "feedbackId",
        "memoryId",
        "status",
        "source",
        "alreadyDone"
      ],
      "allowedConfirmationMode": "station_memory_review",
      "forbiddenActions": [
        "memory.write",
        "invoke",
        "execute",
        "run"
      ]
    },
    "atelier.feedback.confirmRerun": {
      "requiredFields": [
        "taskId",
        "feedbackId"
      ],
      "responseFields": [
        "accepted",
        "feedbackId",
        "taskId",
        "rerunTaskId",
        "status",
        "source",
        "alreadyDone",
        "started"
      ],
      "allowedConfirmationMode": "station_rerun_review",
      "forbiddenActions": [
        "rerun",
        "invoke",
        "execute",
        "run"
      ]
    },
    "atelier.workspace.open": {
      "requiredFields": [
        "taskId",
        "workspaceUri"
      ],
      "optionalFields": [
        "ideHint"
      ],
      "responseFields": [
        "accepted",
        "opened",
        "workspaceUri",
        "mode",
        "reason"
      ],
      "allowedUriSchemes": [
        "pt-workspace"
      ],
      "uriShape": {
        "scheme": "pt-workspace",
        "host": "task",
        "taskPathSegments": 1,
        "workspaceQueryKey": "workspace"
      },
      "forbiddenActions": [
        "file",
        "shell",
        "spawn",
        "execute",
        "run",
        "openExternalUrl"
      ]
    },
    "atelier.artifact.body.fetch": {
      "requiredFields": [
        "taskId",
        "artifactId",
        "bodyRef"
      ],
      "optionalFields": [
        "expectedHash",
        "maxBytes"
      ],
      "responseFields": [
        "taskId",
        "artifactId",
        "bodyRef",
        "bodyKind",
        "bodyHash",
        "bodySize",
        "text",
        "truncated",
        "retentionStatus"
      ],
      "allowedBodyKinds": [
        "markdown",
        "diff",
        "text",
        "json"
      ],
      "forbiddenActions": [
        "file",
        "path",
        "url",
        "iframe",
        "image",
        "html",
        "execute",
        "run",
        "openExternalUrl"
      ]
    },
    "atelier.artifact.preview.open": {
      "requiredFields": [
        "taskId",
        "artifactId",
        "sandboxRef",
        "bodyRef"
      ],
      "optionalFields": [
        "kind",
        "mode"
      ],
      "responseFields": [
        "accepted",
        "opened",
        "prepared",
        "taskId",
        "artifactId",
        "sandboxRef",
        "bodyRef",
        "kind",
        "mode",
        "rendererSessionId",
        "rendererOwner",
        "rendererMode",
        "rendererStatus",
        "rendererCapabilities",
        "reason"
      ],
      "allowedModes": [
        "sandbox_manifest"
      ],
      "defaultMode": "sandbox_manifest",
      "allowedSandboxRefSchemes": [
        "atelier-sandbox"
      ],
      "allowedRendererOwner": [
        "desktop_host"
      ],
      "allowedRendererMode": [
        "host_sandbox_manifest"
      ],
      "allowedRendererStatus": [
        "prepared_not_opened",
        "rendered"
      ],
      "requiredRendererCapabilities": [
        "host_visual_renderer_surface"
      ],
      "hostSideEffects": [
        "ui.openAtelierArtifactPreview"
      ],
      "forbiddenActions": [
        "file",
        "path",
        "url",
        "iframe",
        "image",
        "html",
        "execute",
        "run",
        "openExternalUrl"
      ]
    }
  },
  "taskLifecycle": {
    "field": "status",
    "domain": "workbench_lifecycle",
    "orthogonalTo": "execution_state",
    "states": [
      "active",
      "archived",
      "deleted"
    ],
    "transitions": [
      {
        "from": "active",
        "to": "archived",
        "reversible": true
      },
      {
        "from": "archived",
        "to": "active",
        "reversible": true
      },
      {
        "from": "active",
        "to": "deleted",
        "reversible": true
      },
      {
        "from": "archived",
        "to": "deleted",
        "reversible": true
      },
      {
        "from": "deleted",
        "to": "active",
        "reversible": true
      }
    ],
    "purgeRequiresStatus": "deleted",
    "forbiddenExecutionStatusValues": [
      "running",
      "succeeded",
      "failed",
      "paused",
      "blocked"
    ]
  },
  "agentRoleAuthority": {
    "roles": [
      "goal_owner",
      "architect",
      "planner",
      "risk",
      "supervisor",
      "executor",
      "verifier",
      "integrator",
      "historian"
    ],
    "terminalSignoffRoles": [
      "goal_owner"
    ],
    "hardVetoRoles": [
      "risk"
    ],
    "acceptanceVetoRoles": [
      "verifier"
    ],
    "progressControlRoles": [
      "supervisor"
    ],
    "judgmentForbiddenRoles": [
      "executor"
    ],
    "mergeRoles": [
      "integrator"
    ],
    "memoryRecordRoles": [
      "historian"
    ],
    "executionOwner": "station",
    "appletMayExecuteAuthority": false
  },
  "negotiationProjection": {
    "voiceStances": [
      "proposal",
      "objection",
      "counter",
      "signoff"
    ],
    "requiredVoiceFields": [
      "role",
      "stance",
      "text"
    ],
    "optionalVoiceFields": [
      "evidenceRef",
      "sessionId",
      "roundId",
      "voiceId",
      "objectionId"
    ],
    "evidenceRequiredStances": [
      "objection"
    ],
    "noEvidenceObjectionDisposition": "concern",
    "consensusOwner": "station",
    "appletMayResolveConsensus": false,
    "forbiddenActions": [
      "agent.invoke",
      "atelier.agent",
      "orchestration.start",
      "negotiation.run",
      "provider.invoke",
      "runtime.invokeProvider",
      "runtime.execute",
      "gate.rerun",
      "taskGraph.diff.apply"
    ]
  },
  "gatewayActions": [
    "workspace.load",
    "project.createFromGoal",
    "message.send",
    "escalation.resolve",
    "task.setStatus",
    "task.purge",
    "provider.capabilities",
    "feedback.submit",
    "memory.confirmCandidate",
    "feedback.confirmRerun",
    "workspace.open",
    "artifact.body.fetch",
    "artifact.preview.open",
    "events.subscribe"
  ],
  "patchKinds": [
    "snapshot",
    "task.upsert",
    "task.status",
    "stream.append",
    "decision.resolved",
    "artifact.upsert",
    "gate.upsert",
    "context.replace",
    "todo.replace"
  ],
  "replayFields": [
    "source",
    "eventCount",
    "replayedEventCount",
    "nextEventSeq",
    "hasMore",
    "checkpointId",
    "checkpointEventSeq"
  ],
  "streamBlocks": {
    "allowedKinds": [
      "user",
      "agent",
      "nego",
      "decision",
      "artifact",
      "diff"
    ],
    "requiredFieldsByKind": {
      "user": [
        "text"
      ],
      "agent": [
        "text"
      ],
      "nego": [
        "summary",
        "agentCount",
        "converged",
        "voices",
        "consensus"
      ],
      "decision": [
        "question",
        "spentSoFar",
        "options",
        "rollbackImpact"
      ],
      "artifact": [
        "name",
        "fileKind",
        "producedBy"
      ],
      "diff": [
        "files",
        "added",
        "removed",
        "paths"
      ]
    },
    "diffSummaryFields": [
      "files",
      "added",
      "removed",
      "paths"
    ]
  },
  "viewSurface": {
    "statuses": [
      "loading",
      "empty",
      "ready",
      "reconciling",
      "degraded",
      "disconnected",
      "auth-denied",
      "error"
    ],
    "eventStreamStates": [
      "idle",
      "subscribing",
      "live",
      "degraded"
    ],
    "typedRecoveryKinds": [
      "auth-denied",
      "disconnected"
    ],
    "statusNoticeKinds": [
      "reconciling",
      "degraded"
    ],
    "emptyCtaStatus": "empty",
    "reconcilingEventStreamState": "subscribing",
    "degradedEventStreamStates": [
      "degraded"
    ],
    "recovery": {
      "kinds": [
        "auth-denied",
        "invalid-projection",
        "agent-ids-required",
        "disconnected",
        "error"
      ],
      "tones": [
        "warning",
        "danger"
      ],
      "toneByKind": {
        "auth-denied": "danger",
        "invalid-projection": "danger",
        "agent-ids-required": "danger",
        "disconnected": "warning",
        "error": "danger"
      },
      "retryableKinds": [
        "disconnected",
        "error"
      ],
      "statusSeverityByStatus": {
        "loading": "info",
        "empty": "info",
        "ready": "success",
        "reconciling": "warning",
        "degraded": "warning",
        "disconnected": "warning",
        "auth-denied": "danger",
        "error": "danger"
      },
      "prototypeSeverityByStatus": {
        "loading": "info",
        "empty": "info",
        "ready": "info",
        "reconciling": "warning",
        "degraded": "warning",
        "disconnected": "warning",
        "auth-denied": "danger",
        "error": "danger"
      },
      "prototypeSymbolByStatus": {
        "loading": "◌",
        "empty": "+",
        "ready": "✓",
        "reconciling": "↻",
        "degraded": "↻",
        "disconnected": "↻",
        "auth-denied": "!",
        "error": "!"
      }
    }
  },
  "projectSurface": {
    "blockerSeverities": [
      "block",
      "warn",
      "info"
    ],
    "blockerStates": [
      "open",
      "resolved",
      "waived"
    ],
    "residualRiskStates": [
      "logged",
      "downgraded",
      "follow_up"
    ],
    "dependencyEdgeTypes": [
      "blocks",
      "informs",
      "produces_input_for"
    ],
    "taskGraphParallelPolicies": [
      "serial_only",
      "independent_only",
      "integrator_required"
    ],
    "projectStates": [
      "draft",
      "contracted",
      "executing",
      "blocked",
      "verifying",
      "awaiting_owner_signoff",
      "accepted",
      "escalated"
    ],
    "milestoneStates": [
      "planned",
      "active",
      "blocked",
      "replanning",
      "accepted",
      "abandoned"
    ],
    "taskGraphNodeStates": [
      "todo",
      "running",
      "done"
    ],
    "memoryCandidateTypes": [
      "success_pattern",
      "failure_cause",
      "project_rule",
      "domain_rule",
      "arch_decision",
      "workflow_improvement"
    ],
    "memoryCandidateScopes": [
      "user",
      "project",
      "domain"
    ],
    "memoryCandidateFeeds": [
      "planner",
      "risk",
      "verifier"
    ],
    "policyRuleScopes": [
      "workspace",
      "command",
      "network",
      "data",
      "action"
    ],
    "defectSources": [
      "gate",
      "verifier",
      "user",
      "supervisor"
    ],
    "defectStates": [
      "proposed",
      "accepted",
      "fixed",
      "rejected"
    ],
    "projectionDisplayLimits": {
      "projectHealthItems": 3,
      "projectHealthMilestones": 4,
      "milestoneRefs": 2,
      "taskGraphNodes": 5,
      "taskGraphRootIds": 3,
      "taskGraphEdges": 4,
      "taskGraphNodeRefs": 2,
      "legacyTodos": 5,
      "providerCapabilities": 5,
      "negotiationVoices": 4,
      "diffPaths": 5,
      "contextFileRefs": 4,
      "contextOtherRefs": 3,
      "sidePanelArtifacts": 4,
      "artifactPaths": 5,
      "safeTextPreviewLines": 80,
      "gateItems": 4,
      "gateChecks": 3,
      "gateArtifactRefs": 4
    }
  },
  "workbenchSurface": {
    "taskIntentPresets": [
      "work",
      "code",
      "design"
    ],
    "defaultTaskIntentPreset": "work",
    "todoStatuses": [
      "done",
      "running",
      "todo"
    ],
    "contextFileGroups": [
      "files",
      "other"
    ],
    "defaultContextFileGroup": "files",
    "taskOrganizerModes": [
      {
        "id": "folders",
        "ready": true
      },
      {
        "id": "flat-list",
        "ready": true
      },
      {
        "id": "kanban",
        "ready": false
      },
      {
        "id": "dag",
        "ready": false
      }
    ],
    "defaultTaskOrganizerMode": "folders",
    "artifactKinds": [
      "markdown",
      "web",
      "image",
      "diff"
    ],
    "artifactBodyKinds": [
      "markdown",
      "diff",
      "text",
      "json"
    ],
    "gateStatuses": [
      "pending",
      "running",
      "passed",
      "failed",
      "blocked"
    ],
    "gateCheckStatuses": [
      "passed",
      "failed",
      "pending"
    ]
  },
  "budgetSurface": {
    "budgetStatuses": [
      "ok",
      "warning",
      "danger",
      "blocked"
    ]
  },
  "artifactPreview": {
    "allowedPreviewHints": [
      "markdown",
      "web",
      "image",
      "diff",
      "metadata",
      "metadata_only"
    ],
    "metadataFields": [
      "previewHint",
      "bodyRef",
      "bodyHash",
      "bodySize",
      "bodyKind",
      "paths",
      "size",
      "previewTarget"
    ],
    "previewTargetFields": [
      "kind",
      "mode",
      "label",
      "sandboxRef",
      "bodyRef"
    ],
    "allowedPreviewTargetModes": [
      "sandbox_manifest"
    ],
    "allowedBodyRefSchemes": [
      "artifact"
    ],
    "allowedSandboxRefSchemes": [
      "atelier-sandbox"
    ],
    "bodyRefShape": {
      "scheme": "artifact",
      "pathSegments": 2,
      "terminalSegment": "body"
    },
    "sandboxRefShape": {
      "scheme": "atelier-sandbox",
      "pathSegments": 2,
      "terminalSegment": "preview"
    },
    "forbiddenBodyFields": [
      "markdown",
      "content",
      "body",
      "html",
      "diff",
      "patch",
      "url",
      "src",
      "iframe"
    ]
  }
} as const;

export type AtelierProjectionVersion = typeof ATELIER_PROJECTION_CONTRACT.version;
export type AtelierProjectionPatchKind = typeof ATELIER_PROJECTION_CONTRACT.patchKinds[number];
export type AtelierArtifactPreviewHint = typeof ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewHints[number];
export type AtelierTaskLifecycleStatus = typeof ATELIER_PROJECTION_CONTRACT.taskLifecycle.states[number];
export type AtelierViewStatus = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.statuses[number];
export type AtelierEventStreamState = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.eventStreamStates[number];
export type AtelierTypedRecoveryKind = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.typedRecoveryKinds[number];
export type AtelierStatusNoticeKind = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.statusNoticeKinds[number];
export type AtelierRecoveryTone = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.tones[number];
export type AtelierPrototypeRecoverySeverity = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSeverityByStatus[AtelierViewStatus];
export type AtelierPrototypeRecoverySymbol = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSymbolByStatus[AtelierViewStatus];
export type AtelierBudgetStatus = typeof ATELIER_PROJECTION_CONTRACT.budgetSurface.budgetStatuses[number];
export type AtelierAgentRole = typeof ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles[number];

export const ATELIER_PROJECTION_EVENT_TOPIC = ATELIER_PROJECTION_CONTRACT.eventTopic;
export const ATELIER_PROJECTION_SUBSCRIPTION_METHOD = ATELIER_PROJECTION_CONTRACT.subscriptionMethod;
export const ATELIER_METHOD_INTENTS = ATELIER_PROJECTION_CONTRACT.methodIntents;
export const ATELIER_TASK_LIFECYCLE = ATELIER_PROJECTION_CONTRACT.taskLifecycle;
export const ATELIER_TASK_LIFECYCLE_STATES = ATELIER_PROJECTION_CONTRACT.taskLifecycle.states;
export const ATELIER_AGENT_ROLE_AUTHORITY = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority;
export const ATELIER_AGENT_ROLES = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles;
export const ATELIER_STREAM_BLOCK_KINDS = ATELIER_PROJECTION_CONTRACT.streamBlocks.allowedKinds;
export const ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND = ATELIER_PROJECTION_CONTRACT.streamBlocks.requiredFieldsByKind;
export const ATELIER_DIFF_STREAM_SUMMARY_FIELDS = ATELIER_PROJECTION_CONTRACT.streamBlocks.diffSummaryFields;
export const ATELIER_VIEW_SURFACE = ATELIER_PROJECTION_CONTRACT.viewSurface;
export const ATELIER_VIEW_STATUSES = ATELIER_PROJECTION_CONTRACT.viewSurface.statuses;
export const ATELIER_EVENT_STREAM_STATES = ATELIER_PROJECTION_CONTRACT.viewSurface.eventStreamStates;
export const ATELIER_TYPED_RECOVERY_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.typedRecoveryKinds;
export const ATELIER_STATUS_NOTICE_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.statusNoticeKinds;
export const ATELIER_EMPTY_CTA_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.emptyCtaStatus;
export const ATELIER_RECONCILING_EVENT_STREAM_STATE = ATELIER_PROJECTION_CONTRACT.viewSurface.reconcilingEventStreamState;
export const ATELIER_DEGRADED_EVENT_STREAM_STATES = ATELIER_PROJECTION_CONTRACT.viewSurface.degradedEventStreamStates;
export const ATELIER_RECOVERY_TONES = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.tones;
export const ATELIER_RECOVERY_TONE_BY_KIND = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.toneByKind;
export const ATELIER_RECOVERY_RETRYABLE_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.retryableKinds;
export const ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSeverityByStatus;
export const ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSymbolByStatus;
export const ATELIER_PROJECT_SURFACE = ATELIER_PROJECTION_CONTRACT.projectSurface;
export const ATELIER_PROJECT_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.projectStates;
export const ATELIER_MILESTONE_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.milestoneStates;
export const ATELIER_TASK_GRAPH_NODE_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.taskGraphNodeStates;
export const ATELIER_TASK_GRAPH_PARALLEL_POLICIES = ATELIER_PROJECTION_CONTRACT.projectSurface.taskGraphParallelPolicies;
export const ATELIER_DEPENDENCY_EDGE_TYPES = ATELIER_PROJECTION_CONTRACT.projectSurface.dependencyEdgeTypes;
export const ATELIER_BLOCKER_SEVERITIES = ATELIER_PROJECTION_CONTRACT.projectSurface.blockerSeverities;
export const ATELIER_BLOCKER_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.blockerStates;
export const ATELIER_RESIDUAL_RISK_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.residualRiskStates;
export const ATELIER_MEMORY_CANDIDATE_TYPES = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateTypes;
export const ATELIER_MEMORY_CANDIDATE_SCOPES = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateScopes;
export const ATELIER_MEMORY_CANDIDATE_FEEDS = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateFeeds;
export type AtelierMemoryCandidateFeed = typeof ATELIER_MEMORY_CANDIDATE_FEEDS[number];
export const ATELIER_POLICY_RULE_SCOPES = ATELIER_PROJECTION_CONTRACT.projectSurface.policyRuleScopes;
export const ATELIER_DEFECT_SOURCES = ATELIER_PROJECTION_CONTRACT.projectSurface.defectSources;
export const ATELIER_DEFECT_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.defectStates;
export const ATELIER_PROJECTION_DISPLAY_LIMITS = ATELIER_PROJECTION_CONTRACT.projectSurface.projectionDisplayLimits;
export const ATELIER_RECOVERY_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.kinds;
export type AtelierRecoveryKind = typeof ATELIER_RECOVERY_KINDS[number];
export const ATELIER_WORKBENCH_SURFACE = ATELIER_PROJECTION_CONTRACT.workbenchSurface;
export const ATELIER_TASK_INTENT_PRESETS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.taskIntentPresets;
export const ATELIER_DEFAULT_TASK_INTENT_PRESET = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultTaskIntentPreset;
export const ATELIER_RUN_TARGET_KINDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedRunKinds;
export type AtelierRunTargetKind = typeof ATELIER_RUN_TARGET_KINDS[number];
export const ATELIER_DEFAULT_RUN_TARGET_KIND = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultRunKind;
export const ATELIER_DIRECT_RUN_MODELS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedDirectRunModels;
export type AtelierDirectRunModel = typeof ATELIER_DIRECT_RUN_MODELS[number];
export const ATELIER_DEFAULT_DIRECT_RUN_MODEL = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultDirectRunModel;
export const ATELIER_AGENT_FLOW_IDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedAgentFlowIds;
export type AtelierAgentFlowId = typeof ATELIER_AGENT_FLOW_IDS[number];
export const ATELIER_DEFAULT_AGENT_FLOW_ID = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultAgentFlowId;
export const ATELIER_AGENT_FLOW_DESCRIPTORS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].agentFlowDescriptors;
export type AtelierAgentFlowDescriptor = typeof ATELIER_AGENT_FLOW_DESCRIPTORS[number];
export const ATELIER_FEEDBACK_SIGNALS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.submit'].allowedSignals;
export type AtelierFeedbackSignal = typeof ATELIER_FEEDBACK_SIGNALS[number];
export const ATELIER_MEMORY_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.memory.confirmCandidate'].allowedConfirmationMode;
export const ATELIER_RERUN_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.confirmRerun'].allowedConfirmationMode;
export const ATELIER_WORKSPACE_OPEN_URI_SCHEMES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].allowedUriSchemes;
export const ATELIER_WORKSPACE_OPEN_URI_SHAPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].uriShape;
export const ATELIER_PROVIDER_CAPABILITY_SCOPES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].allowedCapabilityScopes;
export const ATELIER_PROVIDER_CAPABILITY_READ_ONLY = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityReadOnly;
export const ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].intentPresetMapping;
export const ATELIER_TODO_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.todoStatuses;
export const ATELIER_CONTEXT_FILE_GROUPS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.contextFileGroups;
export const ATELIER_DEFAULT_CONTEXT_FILE_GROUP = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultContextFileGroup;
export const ATELIER_TASK_ORGANIZER_MODES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.taskOrganizerModes;
export type AtelierTaskOrganizerMode = typeof ATELIER_TASK_ORGANIZER_MODES[number]['id'];
export const ATELIER_DEFAULT_TASK_ORGANIZER_MODE = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultTaskOrganizerMode;
export const ATELIER_ARTIFACT_KINDS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.artifactKinds;
export const ATELIER_ARTIFACT_BODY_KINDS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.artifactBodyKinds;
export const ATELIER_GATE_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.gateStatuses;
export const ATELIER_GATE_CHECK_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.gateCheckStatuses;
export const ATELIER_BUDGET_SURFACE = ATELIER_PROJECTION_CONTRACT.budgetSurface;
export const ATELIER_BUDGET_STATUSES = ATELIER_PROJECTION_CONTRACT.budgetSurface.budgetStatuses;
export const ATELIER_PROVIDER_CAPABILITY_SCOPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityScope;
export const ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].defaultMode;
export const ATELIER_ARTIFACT_PREVIEW_HINTS = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewHints;
export const ATELIER_ARTIFACT_METADATA_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.metadataFields;
export const ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.previewTargetFields;
export const ATELIER_ARTIFACT_PREVIEW_TARGET_MODES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewTargetModes;
export const ATELIER_ARTIFACT_BODY_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedBodyRefSchemes;
export const ATELIER_ARTIFACT_PREVIEW_TARGET_SANDBOX_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedSandboxRefSchemes;
export const ATELIER_ARTIFACT_BODY_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.bodyRefShape;
export const ATELIER_ARTIFACT_SANDBOX_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.sandboxRefShape;
export const ATELIER_ARTIFACT_PREVIEW_OPEN_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedModes;
export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererOwner;
export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererMode;
export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererStatus;
export const ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.forbiddenBodyFields;
