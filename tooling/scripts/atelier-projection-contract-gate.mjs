import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();

const expectedIntentPresetMapping = {
  work: {
    providerStrategyPreset: 'station_generalist_research',
    gatePlanPreset: 'plan_review_evidence',
  },
  code: {
    providerStrategyPreset: 'coding_provider_preferred',
    gatePlanPreset: 'lint_typecheck_build',
  },
  design: {
    providerStrategyPreset: 'design_review_preferred',
    gatePlanPreset: 'prototype_visual_review',
  },
};

const files = {
  contract: 'apps/applets/atelier/contracts/atelier-projection.contract.json',
  malformedResponseFixtures: 'apps/applets/atelier/contracts/atelier-malformed-response-fixtures.json',
  contractGenerator: 'tooling/scripts/generate-atelier-projection-contract.mjs',
  masterGoal: 'tmp/atelier-master-goal.md',
  atelierAcceptanceEvidenceReport: 'applet-readiness-evidence/official-applet/atelier-acceptance-evidence-report-2026-07-06.md',
  atelierCompletionAudit: 'applet-readiness-evidence/official-applet/atelier-completion-audit-2026-07-06.md',
  atelierDataModel: 'docs/architecture/atelier/data-model.md',
  atelierDecisions: 'docs/architecture/atelier/decisions.md',
  contractSchemaGenerated: 'apps/applets/atelier/contracts/atelier-projection.schema.generated.json',
  officialFrontendContractGenerated: 'apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts',
  prototypeContractGenerated: 'packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts',
  atelierProjectionProto: 'model/domain/atelier/v1/projection.proto',
  atelierProjectionProtoGo: 'apps/station/app/subserver/agent/model/atelier/projection.pb.go',
  atelierProjectionProtoTs: 'apps/desktop/src/gen/proto/domain/atelier/v1/projection_pb.ts',
  tsProjection: 'packages/prototypes/desktop/applets/atelier/src/projection.ts',
  appletBridge: 'packages/prototypes/desktop/applets/atelier/src/appletBridge.ts',
  runtimeBootstrap: 'packages/prototypes/desktop/applets/atelier/src/runtimeBootstrap.ts',
  bridgeRuntimeGate: 'tooling/scripts/atelier-bridge-runtime-gate.mjs',
  atelierRuntimeLogStreamControlledGate: 'tooling/scripts/atelier-runtime-log-stream-controlled-gate.mjs',
  desktopProductWindowGate: 'tooling/scripts/applet-desktop-product-window-gate.mjs',
  atelierRealProductGate: 'tooling/scripts/applet-atelier-real-product-gate.mjs',
  atelierProductWindowGate: 'tooling/scripts/applet-atelier-product-window-gate.mjs',
  atelierArtifactGateProductWindowGate: 'tooling/scripts/applet-atelier-artifact-gate-product-window-gate.mjs',
  atelierDecisionProductWindowGate: 'tooling/scripts/applet-atelier-decision-product-window-gate.mjs',
  desktopExecutorWorker: 'apps/desktop/src-tauri/src/application/desktop_executor_worker/mod.rs',
  atelierRealProductGateServer: 'apps/station/app/subserver/official_applets/atelier_gate_server/main.go',
  prototypeTypes: 'packages/prototypes/desktop/applets/atelier/src/types.ts',
  prototypePreview: 'packages/prototypes/desktop/applets/atelier/src/preview.tsx',
  prototypePage: 'packages/prototypes/desktop/applets/atelier/src/Page.tsx',
  prototypePlugins: 'packages/prototypes/desktop/applets/atelier/src/plugins.tsx',
  prototypeRecoveryView: 'packages/prototypes/desktop/applets/atelier/src/prototypeRecoveryView.ts',
  prototypeRuntime: 'packages/prototypes/desktop/applets/atelier/src/runtime.ts',
  prototypeBridgeRuntime: 'packages/prototypes/desktop/applets/atelier/src/bridgeRuntime.ts',
  prototypeBlocks: 'packages/prototypes/desktop/applets/atelier/src/blocks.tsx',
  prototypeEngineTrace: 'packages/prototypes/desktop/applets/atelier/src/engineTrace.tsx',
  officialFrontendProjection: 'apps/applets/atelier/frontend/src/domain/projection.ts',
  officialFrontendProjectionReducer: 'apps/applets/atelier/frontend/src/application/projectionReducer.ts',
  officialPageComposition: 'apps/applets/atelier/frontend/src/application/pageComposition.ts',
  officialViewStatus: 'apps/applets/atelier/frontend/src/application/viewStatus.ts',
  officialFrontendPage: 'apps/applets/atelier/frontend/src/presentation/pages/AtelierAppletPage.tsx',
  officialRecoveryView: 'apps/applets/atelier/frontend/src/application/officialRecoveryView.ts',
  officialStatusPillView: 'apps/applets/atelier/frontend/src/application/statusPillView.ts',
  officialFrontendEventStreamRecovery: 'apps/applets/atelier/frontend/src/application/eventStreamRecovery.ts',
  officialFrontendClient: 'apps/applets/atelier/frontend/src/infrastructure/capability/atelierClient.ts',
  officialFrontendController: 'apps/applets/atelier/frontend/src/application/useAtelierController.ts',
  officialFrontendControllerTransitions: 'apps/applets/atelier/frontend/src/application/controllerTransitions.ts',
  officialFrontendEventGuard: 'apps/applets/atelier/frontend/src/application/eventStreamEventGuard.ts',
  appletSdkLynxAdapter: 'packages/applet-sdk/src/adapters/lynx.ts',
  appletSdkIndex: 'packages/applet-sdk/src/index.ts',
  officialFrontendGate: 'tooling/scripts/atelier-official-frontend-gate.mjs',
  officialFrontendEnLocale: 'apps/applets/atelier/frontend/locales/en.json',
  officialFrontendZhLocale: 'apps/applets/atelier/frontend/locales/zh-CN.json',
  goProjection: 'apps/station/app/subserver/agent/service/atelier_projection.go',
  goProjectionHandler: 'apps/station/app/subserver/agent/handler/atelier_projection_handler.go',
  goProjectionTest: 'apps/station/app/subserver/agent/service/atelier_projection_test.go',
  goProviderService: 'apps/station/app/subserver/agent/service/provider_service.go',
  goAgent: 'apps/station/app/subserver/agent/agent.go',
  agentProto: 'model/domain/agent/orchestration.proto',
  agentProtoGo: 'apps/station/app/subserver/agent/model/orchestration.pb.go',
  goOrchestrationHandler: 'apps/station/app/subserver/agent/handler/orchestration_handler.go',
  goOrchestration: 'apps/station/app/subserver/agent/service/orchestration_service.go',
  goOrchestrationTest: 'apps/station/app/subserver/agent/service/orchestration_service_test.go',
  goSchedulerService: 'apps/station/app/subserver/agent/service/scheduler_service.go',
  goTurnService: 'apps/station/app/subserver/agent/service/turn_service.go',
  goBudgetUsageReconciler: 'apps/station/app/subserver/agent/service/budget_usage_reconciler.go',
  goBudgetUsageReconcilerTest: 'apps/station/app/subserver/agent/service/budget_usage_reconciler_test.go',
  goLiveResumeBroker: 'apps/station/app/subserver/agent/service/live_resume_broker.go',
  goLiveResumeBrokerTest: 'apps/station/app/subserver/agent/service/live_resume_broker_test.go',
  goGateRunner: 'apps/station/app/subserver/agent/service/gate_runner.go',
  goGateRunnerTest: 'apps/station/app/subserver/agent/service/gate_runner_test.go',
  goAcceptancePredicateEvaluator: 'apps/station/app/subserver/agent/service/acceptance_predicate_evaluator.go',
  goProjectStateMachine: 'apps/station/app/subserver/agent/service/project_state_machine.go',
  goArtifactPolicy: 'apps/station/app/subserver/agent/service/artifact_policy.go',
  goTaskEventWriter: 'apps/station/app/subserver/agent/service/task_event_writer.go',
  goPersistenceModels: 'apps/station/app/subserver/agent/infrastructure/persistence/models.go',
  goTaskArtifactModel: 'apps/station/app/subserver/agent/infrastructure/persistence/task_artifact.go',
  goTaskArtifactBlobModel: 'apps/station/app/subserver/agent/infrastructure/persistence/task_artifact_blob.go',
  goTaskBudgetUsageModel: 'apps/station/app/subserver/agent/infrastructure/persistence/task_budget_usage.go',
  goTaskProviderPlanModel: 'apps/station/app/subserver/agent/infrastructure/persistence/task_provider_plan.go',
  goTaskGatePlanModel: 'apps/station/app/subserver/agent/infrastructure/persistence/task_gate_plan.go',
  goTaskGateResultModel: 'apps/station/app/subserver/agent/infrastructure/persistence/task_gate_result.go',
  goAcceptancePredicateModel: 'apps/station/app/subserver/agent/infrastructure/persistence/acceptance_predicate.go',
  goProjectStateModel: 'apps/station/app/subserver/agent/infrastructure/persistence/project_state.go',
  goAtelierMilestoneModel: 'apps/station/app/subserver/agent/infrastructure/persistence/atelier_milestone.go',
  goAtelierTaskGraphModel: 'apps/station/app/subserver/agent/infrastructure/persistence/atelier_task_graph.go',
  goAtelierPolicyDefectModel: 'apps/station/app/subserver/agent/infrastructure/persistence/atelier_policy_defect.go',
  goProjectBlockerModel: 'apps/station/app/subserver/agent/infrastructure/persistence/project_blocker.go',
  goProjectResidualRiskModel: 'apps/station/app/subserver/agent/infrastructure/persistence/project_residual_risk.go',
  goDirectRunModel: 'apps/station/app/subserver/agent/infrastructure/persistence/direct_run.go',
  taskArtifactMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/005_task_artifacts.sql',
  taskArtifactBlobMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/008_task_artifact_blobs.sql',
  taskBudgetUsageMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/016_task_budget_usages.sql',
  taskProviderPlanMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/009_task_provider_plans.sql',
  directRunMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/015_direct_runs.sql',
  taskGatePlanMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/006_task_gate_plans.sql',
  taskGateResultMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/007_task_gate_results.sql',
  projectAcceptanceMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/010_project_acceptance_indices.sql',
  projectStateMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/011_project_state_indices.sql',
  acceptancePredicateMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/012_acceptance_predicate_indices.sql',
  atelierTaskGraphMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/013_atelier_task_graph_indices.sql',
  atelierPolicyDefectMigration: 'apps/station/app/subserver/agent/infrastructure/persistence/migrations/014_atelier_policy_defect_indices.sql',
  desktopOrchestration: 'apps/desktop/src-tauri/src/application/agent_orchestration/mod.rs',
  desktopTauriAppletsCommands: 'apps/desktop/src-tauri/src/interface/tauri_commands/applets.rs',
  desktopAppletRuntimePage: 'apps/desktop/src/pages/AppletRuntimePage.tsx',
  desktopIdentityRuntime: 'apps/desktop/src/kernel/identityRuntime.ts',
  desktopHashRouter: 'apps/desktop/src/hooks/useHashRouter.ts',
  desktopBrowserEvents: 'apps/desktop/src/kernel/events/browser.ts',
  rustGateway: 'apps/desktop/src-tauri/src/application/applets/mod.rs',
  atelierReadme: 'docs/architecture/atelier/README.md',
  officialAppletReadme: 'apps/applets/atelier/README.md',
  prototypeReadme: 'docs/architecture/atelier/prototype/README.md',
  functionalModulesPlan: 'docs/architecture/atelier/execution-plans/functional-modules.md',
  uiImplementationMapping: 'docs/architecture/atelier/execution-plans/ui-implementation-mapping.md',
  userViewPlan: 'docs/architecture/atelier/execution-plans/user-view.md',
  multiEngineFeasibility: 'docs/architecture/atelier/execution-plans/multi-engine-feasibility.md',
  featureMatrix: 'docs/architecture/atelier/execution-plans/feature-matrix.md',
  roadmap: 'docs/architecture/atelier/execution-plans/roadmap.md',
  desktopAtelierPreviewHost: 'apps/desktop/src/applet/AtelierArtifactPreviewHost.ts',
  desktopAtelierPreviewHostTest: 'apps/desktop/src/applet/AtelierArtifactPreviewHost.test.ts',
  lynxHostElementTest: 'apps/desktop/src/applet/lynx-host-element.test.ts',
  manifest: 'apps/applets/atelier/applet.manifest.json',
  capability: 'packages/applet-contract/src/capability.ts',
  packageJson: 'package.json',
};

const failures = [];

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

function expectExactStringSet(actual, expected, label) {
  const actualList = Array.isArray(actual) ? [...actual].sort() : [];
  const expectedList = [...expected].sort();
  if (JSON.stringify(actualList) !== JSON.stringify(expectedList)) {
    failures.push(`${files.contract}: ${label} must exactly match ${expected.join(', ')}; got ${actualList.join(', ')}`);
  }
}

function readContract() {
  const contract = JSON.parse(read(files.contract));
  assertString(contract.version, 'version');
  assertString(contract.eventTopic, 'eventTopic');
  assertString(contract.subscriptionMethod, 'subscriptionMethod');
    if (contract.eventSubscription === undefined || typeof contract.eventSubscription !== 'object' || contract.eventSubscription === null || Array.isArray(contract.eventSubscription)) {
      failures.push(`${files.contract}: eventSubscription must be an object`);
    } else {
      expectExactStringSet(contract.eventSubscription.agentIdSourcePriority, ['agentId', 'agentIds[0]'], 'eventSubscription.agentIdSourcePriority');
      if (JSON.stringify(contract.eventSubscription.agentIdSourcePriority) !== JSON.stringify(['agentId', 'agentIds[0]'])) {
        failures.push(`${files.contract}: eventSubscription.agentIdSourcePriority order must be agentId, agentIds[0]`);
      }
      const expectedTaskIdSourcePriority = [
        'certificationCreatedSelectedTaskId',
        'explicitTaskId',
        'controllerSelectedTaskId',
        'snapshotSelectedTaskId',
        'snapshotFirstTaskId',
      ];
      expectExactStringSet(contract.eventSubscription.taskIdSourcePriority, expectedTaskIdSourcePriority, 'eventSubscription.taskIdSourcePriority');
      if (JSON.stringify(contract.eventSubscription.taskIdSourcePriority) !== JSON.stringify(expectedTaskIdSourcePriority)) {
        failures.push(`${files.contract}: eventSubscription.taskIdSourcePriority order must match official projection stream task fallback order`);
      }
      if (contract.eventSubscription.defaultCursorSource !== 'workspace.replay[taskId].nextEventSeq') {
        failures.push(`${files.contract}: eventSubscription.defaultCursorSource must be workspace.replay[taskId].nextEventSeq`);
      }
      if (contract.eventSubscription.zeroCursorPolicy !== 'omit') {
        failures.push(`${files.contract}: eventSubscription.zeroCursorPolicy must be omit`);
      }
    }
  assertStringArray(contract.methods, 'methods');
  assertStringArray(contract.runtimeMethods, 'runtimeMethods');
  assertStringArray(contract.gatewayActions, 'gatewayActions');
  assertStringArray(contract.patchKinds, 'patchKinds');
  assertStringArray(contract.replayFields, 'replayFields');
  if (contract.artifactPreview === undefined || typeof contract.artifactPreview !== 'object' || contract.artifactPreview === null || Array.isArray(contract.artifactPreview)) {
    failures.push(`${files.contract}: artifactPreview must be an object`);
  } else {
    assertStringArray(contract.artifactPreview.allowedPreviewHints, 'artifactPreview.allowedPreviewHints');
    assertStringArray(contract.artifactPreview.metadataFields, 'artifactPreview.metadataFields');
    assertStringArray(contract.artifactPreview.previewTargetFields, 'artifactPreview.previewTargetFields');
    assertStringArray(contract.artifactPreview.allowedPreviewTargetModes, 'artifactPreview.allowedPreviewTargetModes');
    assertStringArray(contract.artifactPreview.allowedBodyRefSchemes, 'artifactPreview.allowedBodyRefSchemes');
    assertStringArray(contract.artifactPreview.allowedSandboxRefSchemes, 'artifactPreview.allowedSandboxRefSchemes');
    if (JSON.stringify(contract.artifactPreview.bodyRefShape) !== JSON.stringify({ scheme: 'artifact', pathSegments: 2, terminalSegment: 'body' })) {
      failures.push(`${files.contract}: artifactPreview.bodyRefShape must describe canonical artifact body refs`);
    }
    if (JSON.stringify(contract.artifactPreview.sandboxRefShape) !== JSON.stringify({ scheme: 'atelier-sandbox', pathSegments: 2, terminalSegment: 'preview' })) {
      failures.push(`${files.contract}: artifactPreview.sandboxRefShape must describe canonical sandbox preview refs`);
    }
    assertStringArray(contract.artifactPreview.forbiddenBodyFields, 'artifactPreview.forbiddenBodyFields');
    for (const requiredHint of ['metadata_only', 'metadata']) {
      if (!contract.artifactPreview.allowedPreviewHints.includes(requiredHint)) {
        failures.push(`${files.contract}: artifactPreview.allowedPreviewHints missing ${requiredHint}`);
      }
    }
    for (const requiredField of ['previewHint', 'bodyRef', 'bodyHash', 'bodySize', 'bodyKind', 'previewTarget']) {
      if (!contract.artifactPreview.metadataFields.includes(requiredField)) {
        failures.push(`${files.contract}: artifactPreview.metadataFields missing ${requiredField}`);
      }
    }
    for (const requiredPreviewTargetField of ['kind', 'mode', 'label', 'sandboxRef', 'bodyRef']) {
      if (!contract.artifactPreview.previewTargetFields.includes(requiredPreviewTargetField)) {
        failures.push(`${files.contract}: artifactPreview.previewTargetFields missing ${requiredPreviewTargetField}`);
      }
    }
    for (const forbiddenField of ['markdown', 'content', 'body', 'html', 'diff', 'patch', 'url', 'src', 'iframe']) {
      if (!contract.artifactPreview.forbiddenBodyFields.includes(forbiddenField)) {
        failures.push(`${files.contract}: artifactPreview.forbiddenBodyFields missing ${forbiddenField}`);
      }
    }
  }
  if (contract.methodPayloads !== undefined && (typeof contract.methodPayloads !== 'object' || contract.methodPayloads === null || Array.isArray(contract.methodPayloads))) {
    failures.push(`${files.contract}: methodPayloads must be an object when present`);
  }
  const payloadlessMethods = ['atelier.workspace.load', contract.subscriptionMethod];
  const expectedMethodPayloadKeys = Array.isArray(contract.methods)
    ? contract.methods.filter((method) => !payloadlessMethods.includes(method))
    : [];
  expectExactStringSet(Object.keys(contract.methodPayloads ?? {}), expectedMethodPayloadKeys, 'methodPayloads keys');
  if (contract.taskLifecycle === undefined || typeof contract.taskLifecycle !== 'object' || contract.taskLifecycle === null || Array.isArray(contract.taskLifecycle)) {
    failures.push(`${files.contract}: taskLifecycle must be an object`);
  } else {
    if (contract.taskLifecycle.field !== 'status') {
      failures.push(`${files.contract}: taskLifecycle.field must be status`);
    }
    if (contract.taskLifecycle.domain !== 'workbench_lifecycle') {
      failures.push(`${files.contract}: taskLifecycle.domain must be workbench_lifecycle`);
    }
    if (contract.taskLifecycle.orthogonalTo !== 'execution_state') {
      failures.push(`${files.contract}: taskLifecycle.orthogonalTo must be execution_state`);
    }
    assertStringArray(contract.taskLifecycle.states, 'taskLifecycle.states');
    if (JSON.stringify(contract.taskLifecycle.states) !== JSON.stringify(['active', 'archived', 'deleted'])) {
      failures.push(`${files.contract}: taskLifecycle.states must be active, archived, deleted`);
    }
    if (!Array.isArray(contract.taskLifecycle.transitions) || contract.taskLifecycle.transitions.length === 0) {
      failures.push(`${files.contract}: taskLifecycle.transitions must be a non-empty array`);
    } else {
      for (const [index, transition] of contract.taskLifecycle.transitions.entries()) {
        if (typeof transition !== 'object' || transition === null || Array.isArray(transition)) {
          failures.push(`${files.contract}: taskLifecycle.transitions.${index} must be an object`);
          continue;
        }
        if (!contract.taskLifecycle.states.includes(transition.from)) {
          failures.push(`${files.contract}: taskLifecycle.transitions.${index}.from must be a lifecycle state`);
        }
        if (!contract.taskLifecycle.states.includes(transition.to)) {
          failures.push(`${files.contract}: taskLifecycle.transitions.${index}.to must be a lifecycle state`);
        }
        if (transition.reversible !== true) {
          failures.push(`${files.contract}: taskLifecycle.transitions.${index}.reversible must be true`);
        }
      }
    }
    if (contract.taskLifecycle.purgeRequiresStatus !== 'deleted') {
      failures.push(`${files.contract}: taskLifecycle.purgeRequiresStatus must be deleted`);
    }
    assertStringArray(contract.taskLifecycle.forbiddenExecutionStatusValues, 'taskLifecycle.forbiddenExecutionStatusValues');
    for (const executionStatus of ['running', 'succeeded', 'failed', 'paused', 'blocked']) {
      if (!contract.taskLifecycle.forbiddenExecutionStatusValues.includes(executionStatus)) {
        failures.push(`${files.contract}: taskLifecycle.forbiddenExecutionStatusValues missing ${executionStatus}`);
      }
    }
  }
  const agentRoleAuthority = contract.agentRoleAuthority;
  if (agentRoleAuthority === undefined || typeof agentRoleAuthority !== 'object' || agentRoleAuthority === null || Array.isArray(agentRoleAuthority)) {
    failures.push(`${files.contract}: agentRoleAuthority must be an object`);
  } else {
    expectExactStringSet(agentRoleAuthority.roles, ['goal_owner', 'architect', 'planner', 'risk', 'supervisor', 'executor', 'verifier', 'integrator', 'historian'], 'agentRoleAuthority.roles');
    expectExactStringSet(agentRoleAuthority.terminalSignoffRoles, ['goal_owner'], 'agentRoleAuthority.terminalSignoffRoles');
    expectExactStringSet(agentRoleAuthority.hardVetoRoles, ['risk'], 'agentRoleAuthority.hardVetoRoles');
    expectExactStringSet(agentRoleAuthority.acceptanceVetoRoles, ['verifier'], 'agentRoleAuthority.acceptanceVetoRoles');
    expectExactStringSet(agentRoleAuthority.progressControlRoles, ['supervisor'], 'agentRoleAuthority.progressControlRoles');
    expectExactStringSet(agentRoleAuthority.judgmentForbiddenRoles, ['executor'], 'agentRoleAuthority.judgmentForbiddenRoles');
    expectExactStringSet(agentRoleAuthority.mergeRoles, ['integrator'], 'agentRoleAuthority.mergeRoles');
    expectExactStringSet(agentRoleAuthority.memoryRecordRoles, ['historian'], 'agentRoleAuthority.memoryRecordRoles');
    if (agentRoleAuthority.executionOwner !== 'station') {
      failures.push(`${files.contract}: agentRoleAuthority.executionOwner must be station`);
    }
    if (agentRoleAuthority.appletMayExecuteAuthority !== false) {
      failures.push(`${files.contract}: agentRoleAuthority.appletMayExecuteAuthority must be false`);
    }
  }
  const negotiationProjection = contract.negotiationProjection;
  if (negotiationProjection === undefined || typeof negotiationProjection !== 'object' || negotiationProjection === null || Array.isArray(negotiationProjection)) {
    failures.push(`${files.contract}: negotiationProjection must be an object`);
  } else {
    expectExactStringSet(negotiationProjection.voiceStances, ['proposal', 'objection', 'counter', 'signoff'], 'negotiationProjection.voiceStances');
    expectExactStringSet(negotiationProjection.requiredVoiceFields, ['role', 'stance', 'text'], 'negotiationProjection.requiredVoiceFields');
    expectExactStringSet(negotiationProjection.optionalVoiceFields, ['evidenceRef', 'sessionId', 'roundId', 'voiceId', 'objectionId'], 'negotiationProjection.optionalVoiceFields');
    expectExactStringSet(negotiationProjection.evidenceRequiredStances, ['objection'], 'negotiationProjection.evidenceRequiredStances');
    if (negotiationProjection.noEvidenceObjectionDisposition !== 'concern') {
      failures.push(`${files.contract}: negotiationProjection.noEvidenceObjectionDisposition must be concern`);
    }
    if (negotiationProjection.consensusOwner !== 'station') {
      failures.push(`${files.contract}: negotiationProjection.consensusOwner must be station`);
    }
    if (negotiationProjection.appletMayResolveConsensus !== false) {
      failures.push(`${files.contract}: negotiationProjection.appletMayResolveConsensus must be false`);
    }
    expectExactStringSet(
      negotiationProjection.forbiddenActions,
      ['agent.invoke', 'atelier.agent', 'orchestration.start', 'negotiation.run', 'provider.invoke', 'runtime.invokeProvider', 'runtime.execute', 'gate.rerun', 'taskGraph.diff.apply'],
      'negotiationProjection.forbiddenActions',
    );
  }
  if (contract.methodIntents === undefined || typeof contract.methodIntents !== 'object' || contract.methodIntents === null || Array.isArray(contract.methodIntents)) {
    failures.push(`${files.contract}: methodIntents must be an object`);
  } else {
    for (const method of contract.methods) {
      const intent = contract.methodIntents[method];
      if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) {
        failures.push(`${files.contract}: methodIntents.${method} must be an object`);
        continue;
      }
      if (!['station', 'desktop_host'].includes(intent.intentOwner)) {
        failures.push(`${files.contract}: methodIntents.${method}.intentOwner must be station or desktop_host`);
      }
      assertString(intent.intentKind, `methodIntents.${method}.intentKind`);
      if (!['none', 'host_ui', 'station_transaction'].includes(intent.sideEffectClass)) {
        failures.push(`${files.contract}: methodIntents.${method}.sideEffectClass must be none, host_ui, or station_transaction`);
      }
      if (intent.executionForbidden !== true) {
        failures.push(`${files.contract}: methodIntents.${method}.executionForbidden must be true`);
      }
    }
    for (const method of Object.keys(contract.methodIntents)) {
      if (!contract.methods.includes(method)) {
        failures.push(`${files.contract}: methodIntents entry ${method} missing from methods`);
      }
    }
    if (contract.methodIntents['atelier.project.createFromGoal']?.sideEffectClass !== 'station_transaction') {
      failures.push(`${files.contract}: atelier.project.createFromGoal sideEffectClass must be station_transaction`);
    }
    if (contract.methodIntents['atelier.artifact.preview.open']?.intentOwner !== 'desktop_host') {
      failures.push(`${files.contract}: atelier.artifact.preview.open intentOwner must be desktop_host`);
    }
    if (contract.methodIntents['atelier.artifact.preview.open']?.sideEffectClass !== 'host_ui') {
      failures.push(`${files.contract}: atelier.artifact.preview.open sideEffectClass must be host_ui`);
    }
    if (contract.methodIntents['atelier.provider.capabilities']?.sideEffectClass !== 'none') {
      failures.push(`${files.contract}: atelier.provider.capabilities sideEffectClass must be none`);
    }
  }
  for (const [method, payload] of Object.entries(contract.methodPayloads ?? {})) {
    if (!contract.methods.includes(method)) {
      failures.push(`${files.contract}: methodPayloads entry ${method} missing from methods`);
    }
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
      failures.push(`${files.contract}: methodPayloads.${method} must be an object`);
      continue;
    }
    if (payload.requiredFields !== undefined) {
      assertStringArray(payload.requiredFields, `methodPayloads.${method}.requiredFields`);
    } else if (payload.optionalFields === undefined && payload.responseFields === undefined) {
      failures.push(`${files.contract}: methodPayloads.${method}.requiredFields is required unless optionalFields or responseFields is declared`);
    }
    if (payload.optionalFields !== undefined) {
      assertStringArray(payload.optionalFields, `methodPayloads.${method}.optionalFields`);
    }
    if (payload.responseFields !== undefined) {
      assertStringArray(payload.responseFields, `methodPayloads.${method}.responseFields`);
    }
    if (payload.forbiddenActions !== undefined) {
      assertStringArray(payload.forbiddenActions, `methodPayloads.${method}.forbiddenActions`);
    }
    if (payload.allowedRunKinds !== undefined) {
      assertStringArray(payload.allowedRunKinds, `methodPayloads.${method}.allowedRunKinds`);
    }
      if (payload.allowedAgentFlowIds !== undefined) {
        assertStringArray(payload.allowedAgentFlowIds, `methodPayloads.${method}.allowedAgentFlowIds`);
      }
    if (payload.allowedStatus !== undefined) {
      assertStringArray(payload.allowedStatus, `methodPayloads.${method}.allowedStatus`);
    }
    if (payload.requiresStatus !== undefined) {
      assertString(payload.requiresStatus, `methodPayloads.${method}.requiresStatus`);
    }
  }
  const createFromGoalPayload = contract.methodPayloads?.['atelier.project.createFromGoal'];
  const setStatusPayload = contract.methodPayloads?.['atelier.task.setStatus'];
  if (!setStatusPayload || typeof setStatusPayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.task.setStatus is required`);
  } else if (JSON.stringify(setStatusPayload.allowedStatus) !== JSON.stringify(contract.taskLifecycle?.states)) {
    failures.push(`${files.contract}: atelier.task.setStatus.allowedStatus must match taskLifecycle.states`);
  }
  const purgePayload = contract.methodPayloads?.['atelier.task.purge'];
  if (!purgePayload || typeof purgePayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.task.purge is required`);
  } else if (purgePayload.requiresStatus !== contract.taskLifecycle?.purgeRequiresStatus) {
    failures.push(`${files.contract}: atelier.task.purge.requiresStatus must match taskLifecycle.purgeRequiresStatus`);
  }
  if (!createFromGoalPayload || typeof createFromGoalPayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.project.createFromGoal is required`);
  } else {
    expectExactStringSet(createFromGoalPayload.requiredFields, ['goal', 'agentIds'], 'atelier.project.createFromGoal.requiredFields');
    expectExactStringSet(createFromGoalPayload.optionalFields, ['intentPreset', 'run.kind', 'run.flowId', 'run.model'], 'atelier.project.createFromGoal.optionalFields');
    expectExactStringSet(createFromGoalPayload.allowedRunKinds, ['agents', 'model'], 'atelier.project.createFromGoal.allowedRunKinds');
    if (createFromGoalPayload.defaultRunKind !== 'agents') {
      failures.push(`${files.contract}: atelier.project.createFromGoal.defaultRunKind must be explicit and set to agents`);
    }
    expectExactStringSet(createFromGoalPayload.allowedDirectRunModels, ['openrouter-3o', 'claude-sonnet', 'gpt-5', 'gemini-pro'], 'atelier.project.createFromGoal.allowedDirectRunModels');
    if (createFromGoalPayload.defaultDirectRunModel !== 'openrouter-3o') {
      failures.push(`${files.contract}: atelier.project.createFromGoal.defaultDirectRunModel must be explicit and set to openrouter-3o`);
    }
    expectExactStringSet(createFromGoalPayload.allowedAgentFlowIds, ['expert-hierarchy', 'roundtable', 'debate-judge', 'expert-mesh', 'swarm', 'hierarchy'], 'atelier.project.createFromGoal.allowedAgentFlowIds');
      if (createFromGoalPayload.defaultAgentFlowId !== 'expert-hierarchy') {
        failures.push(`${files.contract}: atelier.project.createFromGoal.defaultAgentFlowId must be explicit and set to expert-hierarchy`);
      }
      if (!Array.isArray(createFromGoalPayload.agentFlowDescriptors)) {
        failures.push(`${files.contract}: atelier.project.createFromGoal.agentFlowDescriptors must be an array`);
      } else {
        const descriptorIds = createFromGoalPayload.agentFlowDescriptors.map((descriptor) => descriptor?.id);
        expectExactStringSet(descriptorIds, createFromGoalPayload.allowedAgentFlowIds, 'atelier.project.createFromGoal.agentFlowDescriptors.ids');
        for (const [index, descriptor] of createFromGoalPayload.agentFlowDescriptors.entries()) {
          if (
            !descriptor ||
            typeof descriptor !== 'object' ||
            typeof descriptor.label !== 'string' ||
            descriptor.label.length === 0 ||
            typeof descriptor.description !== 'string' ||
            descriptor.description.length === 0 ||
            ![1, 2].includes(descriptor.batch)
          ) {
            failures.push(`${files.contract}: atelier.project.createFromGoal.agentFlowDescriptors.${index} must declare id, label, description and batch`);
          }
        }
      }
    expectExactStringSet(createFromGoalPayload.allowedIntentPresets, Object.keys(expectedIntentPresetMapping), 'atelier.project.createFromGoal.allowedIntentPresets');
    for (const [preset, expectedMapping] of Object.entries(expectedIntentPresetMapping)) {
      const mapping = createFromGoalPayload.intentPresetMapping?.[preset];
      if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping)) {
        failures.push(`${files.contract}: atelier.project.createFromGoal.intentPresetMapping.${preset} is required`);
      } else {
        assertString(mapping.providerStrategyPreset, `atelier.project.createFromGoal.intentPresetMapping.${preset}.providerStrategyPreset`);
        assertString(mapping.gatePlanPreset, `atelier.project.createFromGoal.intentPresetMapping.${preset}.gatePlanPreset`);
        if (mapping.providerStrategyPreset !== expectedMapping.providerStrategyPreset) {
          failures.push(`${files.contract}: ${preset} preset must map to providerStrategyPreset=${expectedMapping.providerStrategyPreset}`);
        }
        if (mapping.gatePlanPreset !== expectedMapping.gatePlanPreset) {
          failures.push(`${files.contract}: ${preset} preset must map to gatePlanPreset=${expectedMapping.gatePlanPreset}`);
        }
      }
    }
    const directRunIntent = createFromGoalPayload.directRunIntent;
    if (!directRunIntent || typeof directRunIntent !== 'object' || Array.isArray(directRunIntent)) {
      failures.push(`${files.contract}: atelier.project.createFromGoal.directRunIntent is required`);
    } else {
      if (directRunIntent.kind !== 'model') {
        failures.push(`${files.contract}: atelier.project.createFromGoal.directRunIntent.kind must be model`);
      }
        expectExactStringSet(directRunIntent.requiredFields, ['run.model'], 'atelier.project.createFromGoal.directRunIntent.requiredFields');
        expectExactStringSet(directRunIntent.forbiddenFields, ['run.flowId', 'run.agentIds'], 'atelier.project.createFromGoal.directRunIntent.forbiddenFields');
      if (directRunIntent.stationSource !== 'atelier.direct_run.intent') {
        failures.push(`${files.contract}: atelier.project.createFromGoal.directRunIntent.stationSource must be atelier.direct_run.intent`);
      }
        expectExactStringSet(directRunIntent.forbiddenActions, ['invoke', 'execute', 'run', 'shell', 'file'], 'atelier.project.createFromGoal.directRunIntent.forbiddenActions');
    }
  }
  const providerCapabilitiesPayload = contract.methodPayloads?.['atelier.provider.capabilities'];
  if (!providerCapabilitiesPayload || typeof providerCapabilitiesPayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.provider.capabilities is required`);
  } else {
    expectExactStringSet(providerCapabilitiesPayload.optionalFields, ['taskId'], 'atelier.provider.capabilities.optionalFields');
    expectExactStringSet(providerCapabilitiesPayload.responseFields, ['capabilities', 'source'], 'atelier.provider.capabilities.responseFields');
      expectExactStringSet(providerCapabilitiesPayload.allowedCapabilityScopes, ['station-provider'], 'atelier.provider.capabilities.allowedCapabilityScopes');
      if (providerCapabilitiesPayload.capabilityScope !== 'station-provider') {
        failures.push(`${files.contract}: atelier.provider.capabilities.capabilityScope must be station-provider`);
      }
      if (providerCapabilitiesPayload.capabilityReadOnly !== true) {
        failures.push(`${files.contract}: atelier.provider.capabilities.capabilityReadOnly must be true`);
      }
    expectExactStringSet(providerCapabilitiesPayload.forbiddenActions, ['invoke', 'execute', 'run', 'action.execute', 'action.run', 'policy.override', 'rollback.execute'], 'atelier.provider.capabilities.forbiddenActions');
  }
  const feedbackSubmitPayload = contract.methodPayloads?.['atelier.feedback.submit'];
  if (!feedbackSubmitPayload || typeof feedbackSubmitPayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.feedback.submit is required`);
  } else {
    expectExactStringSet(feedbackSubmitPayload.requiredFields, ['taskId', 'blockId', 'signal'], 'atelier.feedback.submit.requiredFields');
    expectExactStringSet(feedbackSubmitPayload.optionalFields, ['comment'], 'atelier.feedback.submit.optionalFields');
    expectExactStringSet(feedbackSubmitPayload.responseFields, [
      'accepted',
      'feedbackId',
      'memoryCandidate',
      'memoryCandidate.status',
      'memoryCandidate.reason',
      'memoryCandidate.feeds',
      'memoryCandidate.requiresConfirmation',
      'memoryCandidate.confirmationMode',
      'rerunIntent',
      'rerunIntent.status',
      'rerunIntent.reason',
      'rerunIntent.feeds',
      'rerunIntent.requiresConfirmation',
      'rerunIntent.confirmationMode',
    ], 'atelier.feedback.submit.responseFields');
    expectExactStringSet(feedbackSubmitPayload.allowedSignals, ['positive', 'negative', 'copy', 'regenerate'], 'atelier.feedback.submit.allowedSignals');
    expectExactStringSet(feedbackSubmitPayload.forbiddenActions, ['memory.write', 'rerun', 'invoke', 'execute', 'run'], 'atelier.feedback.submit.forbiddenActions');
  }
  const workspaceOpenPayload = contract.methodPayloads?.['atelier.workspace.open'];
  if (!workspaceOpenPayload || typeof workspaceOpenPayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.workspace.open is required`);
  } else {
    expectExactStringSet(workspaceOpenPayload.requiredFields, ['taskId', 'workspaceUri'], 'atelier.workspace.open.requiredFields');
    expectExactStringSet(workspaceOpenPayload.optionalFields, ['ideHint'], 'atelier.workspace.open.optionalFields');
    expectExactStringSet(workspaceOpenPayload.responseFields, ['accepted', 'opened', 'workspaceUri', 'mode', 'reason'], 'atelier.workspace.open.responseFields');
    expectExactStringSet(workspaceOpenPayload.allowedUriSchemes, ['pt-workspace'], 'atelier.workspace.open.allowedUriSchemes');
    if (JSON.stringify(workspaceOpenPayload.uriShape) !== JSON.stringify({ scheme: 'pt-workspace', host: 'task', taskPathSegments: 1, workspaceQueryKey: 'workspace' })) {
      failures.push(`${files.contract}: atelier.workspace.open.uriShape must describe canonical pt-workspace task/workspace URI shape`);
    }
    expectExactStringSet(workspaceOpenPayload.forbiddenActions, ['file', 'shell', 'spawn', 'execute', 'run', 'openExternalUrl'], 'atelier.workspace.open.forbiddenActions');
  }
  const artifactBodyFetchPayload = contract.methodPayloads?.['atelier.artifact.body.fetch'];
  if (!artifactBodyFetchPayload || typeof artifactBodyFetchPayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.artifact.body.fetch is required`);
  } else {
    expectExactStringSet(artifactBodyFetchPayload.requiredFields, ['taskId', 'artifactId', 'bodyRef'], 'atelier.artifact.body.fetch.requiredFields');
    expectExactStringSet(artifactBodyFetchPayload.optionalFields, ['expectedHash', 'maxBytes'], 'atelier.artifact.body.fetch.optionalFields');
    expectExactStringSet(
      artifactBodyFetchPayload.responseFields,
      ['taskId', 'artifactId', 'bodyRef', 'bodyKind', 'bodyHash', 'bodySize', 'text', 'truncated', 'retentionStatus'],
      'atelier.artifact.body.fetch.responseFields',
    );
    expectExactStringSet(artifactBodyFetchPayload.allowedBodyKinds, contract.workbenchSurface?.artifactBodyKinds ?? [], 'atelier.artifact.body.fetch.allowedBodyKinds');
    expectExactStringSet(artifactBodyFetchPayload.forbiddenActions, ['file', 'path', 'url', 'iframe', 'image', 'html', 'execute', 'run', 'openExternalUrl'], 'atelier.artifact.body.fetch.forbiddenActions');
  }
  const artifactPreviewOpenPayload = contract.methodPayloads?.['atelier.artifact.preview.open'];
  if (!artifactPreviewOpenPayload || typeof artifactPreviewOpenPayload !== 'object') {
    failures.push(`${files.contract}: methodPayloads.atelier.artifact.preview.open is required`);
  } else {
    expectExactStringSet(artifactPreviewOpenPayload.requiredFields, ['taskId', 'artifactId', 'sandboxRef', 'bodyRef'], 'atelier.artifact.preview.open.requiredFields');
    expectExactStringSet(artifactPreviewOpenPayload.optionalFields, ['kind', 'mode'], 'atelier.artifact.preview.open.optionalFields');
    expectExactStringSet(artifactPreviewOpenPayload.allowedModes, ['sandbox_manifest'], 'atelier.artifact.preview.open.allowedModes');
      if (artifactPreviewOpenPayload.defaultMode !== 'sandbox_manifest') {
        failures.push(`${files.contract}: atelier.artifact.preview.open.defaultMode must be sandbox_manifest`);
      }
      if (!artifactPreviewOpenPayload.allowedModes.includes(artifactPreviewOpenPayload.defaultMode)) {
        failures.push(`${files.contract}: atelier.artifact.preview.open.defaultMode must be included in allowedModes`);
      }
    expectExactStringSet(artifactPreviewOpenPayload.allowedSandboxRefSchemes, ['atelier-sandbox'], 'atelier.artifact.preview.open.allowedSandboxRefSchemes');
    if (!contract.artifactPreview?.allowedPreviewTargetModes?.includes('sandbox_manifest')) {
      failures.push(`${files.contract}: artifactPreview.allowedPreviewTargetModes missing sandbox_manifest`);
    }
    if (!contract.artifactPreview?.allowedSandboxRefSchemes?.includes('atelier-sandbox')) {
      failures.push(`${files.contract}: artifactPreview.allowedSandboxRefSchemes missing atelier-sandbox`);
    }
    const expectedPreviewResponseFields = [
      'accepted',
      'opened',
      'prepared',
      'taskId',
      'artifactId',
      'sandboxRef',
      'bodyRef',
      'kind',
      'mode',
      'rendererSessionId',
      'rendererOwner',
      'rendererMode',
      'rendererStatus',
      'rendererCapabilities',
      'reason',
    ];
    expectExactStringSet(artifactPreviewOpenPayload.responseFields, expectedPreviewResponseFields, 'atelier.artifact.preview.open.responseFields');
    expectExactStringSet(artifactPreviewOpenPayload.allowedRendererOwner, ['desktop_host'], 'atelier.artifact.preview.open.allowedRendererOwner');
    expectExactStringSet(artifactPreviewOpenPayload.allowedRendererMode, ['host_sandbox_manifest'], 'atelier.artifact.preview.open.allowedRendererMode');
    expectExactStringSet(artifactPreviewOpenPayload.allowedRendererStatus, ['prepared_not_opened', 'rendered'], 'atelier.artifact.preview.open.allowedRendererStatus');
    expectExactStringSet(artifactPreviewOpenPayload.requiredRendererCapabilities, ['host_visual_renderer_surface'], 'atelier.artifact.preview.open.requiredRendererCapabilities');
    expectExactStringSet(artifactPreviewOpenPayload.hostSideEffects, ['ui.openAtelierArtifactPreview'], 'atelier.artifact.preview.open.hostSideEffects');
    expectExactStringSet(artifactPreviewOpenPayload.forbiddenActions, ['file', 'path', 'url', 'iframe', 'image', 'html', 'execute', 'run', 'openExternalUrl'], 'atelier.artifact.preview.open.forbiddenActions');
  }
  for (const method of contract.runtimeMethods) {
    if (!contract.methods.includes(method)) {
      failures.push(`${files.contract}: runtime method ${method} missing from methods`);
    }
  }
  if (!contract.methods.includes(contract.subscriptionMethod)) {
    failures.push(`${files.contract}: subscriptionMethod missing from methods`);
  }
  if (contract.runtimeMethods.includes(contract.subscriptionMethod)) {
    failures.push(`${files.contract}: subscriptionMethod must not be listed as a runtime method`);
  }
  if (contract.methodIntents?.[contract.subscriptionMethod]?.intentKind !== 'projection_event_subscription') {
    failures.push(`${files.contract}: subscriptionMethod intentKind must be projection_event_subscription`);
  }
  return contract;
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    failures.push(`${files.contract}: ${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || item.trim() === '')) {
    failures.push(`${files.contract}: ${label} must be a non-empty string array`);
  }
}

function readMalformedResponseFixtures(contract) {
  const fixtures = JSON.parse(read(files.malformedResponseFixtures));
  if (!isRecord(fixtures)) {
    failures.push(`${files.malformedResponseFixtures}: root must be an object`);
    return {};
  }
  const expectedSections = {
    providerCapabilities: 'atelier.provider.capabilities',
    nonArtifactCapabilities: [
      'atelier.feedback.submit',
      'atelier.memory.confirmCandidate',
      'atelier.feedback.confirmRerun',
      'atelier.workspace.open',
    ],
    artifactBody: 'atelier.artifact.body.fetch',
    artifactPreview: 'atelier.artifact.preview.open',
  };
  const seenNames = new Set();
  const seenOfficialNames = new Set();
  for (const [section, allowedMethods] of Object.entries(expectedSections)) {
    assertMalformedFixtureSection(fixtures, section, allowedMethods, contract, seenNames, seenOfficialNames);
  }
  for (const section of Object.keys(fixtures)) {
    if (!Object.prototype.hasOwnProperty.call(expectedSections, section)) {
      failures.push(`${files.malformedResponseFixtures}: unexpected section ${section}`);
    }
  }
  return fixtures;
}

function assertMalformedFixtureSection(fixtures, section, allowedMethods, contract, seenNames, seenOfficialNames) {
  const items = fixtures[section];
  if (!Array.isArray(items) || items.length === 0) {
    failures.push(`${files.malformedResponseFixtures}: ${section} must be a non-empty fixture array`);
    return;
  }
  const allowed = Array.isArray(allowedMethods) ? allowedMethods : [allowedMethods];
  const seenSectionNames = new Set();
  for (const [index, fixture] of items.entries()) {
    const label = `${section}.${index}`;
    if (!isRecord(fixture)) {
      failures.push(`${files.malformedResponseFixtures}: ${label} must be an object`);
      continue;
    }
    for (const field of ['name', 'officialName', 'method']) {
      if (!isNonEmptyString(fixture[field])) {
        failures.push(`${files.malformedResponseFixtures}: ${label}.${field} must be a non-empty string`);
      }
    }
    if (isNonEmptyString(fixture.name)) {
      if (seenNames.has(fixture.name)) {
        failures.push(`${files.malformedResponseFixtures}: duplicate fixture name ${fixture.name}`);
      }
      if (seenSectionNames.has(fixture.name)) {
        failures.push(`${files.malformedResponseFixtures}: duplicate ${section} fixture name ${fixture.name}`);
      }
      seenNames.add(fixture.name);
      seenSectionNames.add(fixture.name);
    }
    if (isNonEmptyString(fixture.officialName)) {
      if (!fixture.officialName.startsWith('official ')) {
        failures.push(`${files.malformedResponseFixtures}: ${label}.officialName must start with official`);
      }
      if (seenOfficialNames.has(fixture.officialName)) {
        failures.push(`${files.malformedResponseFixtures}: duplicate official fixture name ${fixture.officialName}`);
      }
      seenOfficialNames.add(fixture.officialName);
    }
    if (isNonEmptyString(fixture.method)) {
      if (!allowed.includes(fixture.method)) {
        failures.push(`${files.malformedResponseFixtures}: ${label}.method ${fixture.method} is not allowed in ${section}`);
      }
      if (!contract.methods.includes(fixture.method)) {
        failures.push(`${files.malformedResponseFixtures}: ${label}.method ${fixture.method} missing from contract methods`);
      }
    }
    if (!isRecord(fixture.payload)) {
      failures.push(`${files.malformedResponseFixtures}: ${label}.payload must be an object`);
    }
    if (!isRecord(fixture.response)) {
      failures.push(`${files.malformedResponseFixtures}: ${label}.response must be an object`);
    }
  }
}

function assertMalformedFixtureConsumers(fixtures, contents) {
  const bridgeSectionVariables = {
    providerCapabilities: 'providerCapabilityMalformedResponseFixtures',
    nonArtifactCapabilities: 'nonArtifactCapabilityMalformedResponseFixtures',
    artifactBody: 'artifactBodyMalformedResponseFixtures',
    artifactPreview: 'artifactPreviewMalformedResponseFixtures',
  };
  for (const [section, items] of Object.entries(fixtures)) {
    if (!Array.isArray(items)) {
      continue;
    }
    expectIncludes(
      files.officialFrontendGate,
      contents.officialFrontendGate,
      `malformedResponseFixtures.${section}`,
      `${files.malformedResponseFixtures} ${section} must be embedded into official frontend gate`,
    );
    expectIncludes(
      files.officialFrontendGate,
      contents.officialFrontendGate,
      'for (const fixture of ${JSON.stringify',
      'official frontend gate must execute shared malformed fixtures through a generated loop',
    );
    expectIncludes(
      files.officialFrontendGate,
      contents.officialFrontendGate,
      'fixture.officialName',
      'official frontend gate must use manifest officialName as executable fixture label',
    );
    const bridgeVariable = bridgeSectionVariables[section];
    expectIncludes(
      files.bridgeRuntimeGate,
      contents.bridgeRuntimeGate,
      `${bridgeVariable} = \${JSON.stringify(malformedResponseFixtures.${section}`,
      `${files.malformedResponseFixtures} ${section} must be embedded into bridge runtime gate`,
    );
    expectIncludes(
      files.bridgeRuntimeGate,
      contents.bridgeRuntimeGate,
      `${bridgeVariable}.map((fixture) => [fixture.method, fixture.payload, fixture.response])`,
      `${files.malformedResponseFixtures} ${section} must be expanded into bridge runtime malformed response cases`,
    );
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '';
}

function expectIncludes(file, haystack, needle, label = needle) {
  if (!haystack.includes(needle)) {
    failures.push(`${file}: missing ${label}`);
  }
}

function expectNotIncludes(file, haystack, needle, label = needle) {
  if (haystack.includes(needle)) {
    failures.push(`${file}: must not include ${label}`);
  }
}

function sliceRequired(file, source, startNeedle, endNeedle, label) {
  const start = source.indexOf(startNeedle);
  if (start < 0) {
    failures.push(`${file}: missing ${label} start`);
    return '';
  }
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) {
    failures.push(`${file}: missing ${label} end`);
    return source.slice(start);
  }
  return source.slice(start, end);
}

function expectGoStringMapKeySet(file, source, varName, expectedValues, label = varName) {
  const start = source.indexOf(`var ${varName} = map[string]struct{}{`);
  if (start < 0) {
    failures.push(`${file}: missing ${label}`);
    return;
  }
  const end = source.indexOf('\n}', start);
  if (end < 0) {
    failures.push(`${file}: malformed ${label}`);
    return;
  }
  const body = source.slice(start, end);
  const actual = [...body.matchAll(/"([^"]+)"\s*:\s*\{\}/g)].map((match) => match[1]).sort();
  const expected = [...expectedValues].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${file}: ${label} keys must match ${expected.join(', ')}; got ${actual.join(', ')}`);
  }
}

function expectExactPatchCaseSet(file, source, functionName, expectedPatchKinds) {
  const start = source.indexOf(`function ${functionName}`);
  if (start < 0) {
    failures.push(`${file}: missing ${functionName}`);
    return;
  }
  const end = source.indexOf('\nfunction ', start + 1);
  const body = source.slice(start, end < 0 ? source.length : end);
  const actual = [...body.matchAll(/case '([^']+)':/g)].map((match) => match[1]).sort();
  const expected = [...expectedPatchKinds].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${file}: ${functionName} patch cases must match contract non-snapshot patch kinds; expected ${expected.join(', ')} got ${actual.join(', ')}`);
  }
  if (!body.includes('assertNever(patch)')) {
    failures.push(`${file}: ${functionName} must assertNever(patch) for projection patch exhaustiveness`);
  }
}

function parseFeatureMatrixCounts(markdown) {
  const featureRows = markdown
    .split('\n')
    .filter((line) => /^\| F-[A-Z]+-\d+[a-z]? \|/.test(line));
  return {
    total: featureRows.length,
    complete: featureRows.filter((line) => line.includes('✅')).length,
    gap: featureRows.filter((line) => line.includes('⚠️')).length,
  };
}

function expectFeatureMatrixStatusEvidenceBoundary(file, markdown) {
  const unprovenRuntimePattern = /(runtime\/E2E|E2E pending|E2E 未(落|验|证明)|runtime 未落|运行时 E2E 待验|真实[^|]*(runtime|E2E)[^|]*(未落|未验|未证明|待验|pending))/;
  const invalidRows = markdown
    .split('\n')
    .filter((line) => /^\| F-[A-Z]+-\d+[a-z]? \|/.test(line))
    .filter((line) => line.includes('✅') && unprovenRuntimePattern.test(line));
  for (const line of invalidRows) {
    failures.push(`${file}: feature row with unproven runtime/E2E evidence must be ⚠️, not ✅: ${line}`);
  }
}

function expectFeatureMatrixSummaryCounts(file, markdown) {
  const counts = parseFeatureMatrixCounts(markdown);
  const expectedLines = [
    [`**功能点总数**：${counts.total}`, 'Feature matrix total count must match feature table rows'],
    [`**三处一致 ✅**：${counts.complete}`, 'Feature matrix complete count must match feature table rows'],
    [`**有缺口/错位 ⚠️**：${counts.gap}`, 'Feature matrix gap count must match feature table rows'],
  ];
  for (const [needle, label] of expectedLines) {
    expectIncludes(file, markdown, needle, label);
  }
}

const contract = readContract();
const malformedResponseFixtures = readMalformedResponseFixtures(contract);
try {
  execFileSync('node', ['tooling/scripts/generate-atelier-projection-contract.mjs', '--check'], {
    cwd: repoRoot,
    stdio: 'pipe',
  });
} catch (error) {
  failures.push(`atelier projection generated contract artifacts are stale: ${String(error.stderr || error.message || error)}`);
}
const contents = Object.fromEntries(
  Object.entries(files).map(([key, relativePath]) => [key, read(relativePath)]),
);
assertMalformedFixtureConsumers(malformedResponseFixtures, contents);
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_FEEDBACK_SIGNALS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.submit'].allowedSignals;", 'official generated contract must export feedback signals from submit payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export type AtelierFeedbackSignal = typeof ATELIER_FEEDBACK_SIGNALS[number];', 'official generated contract must export feedback signal type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export type AtelierMemoryCandidateFeed = typeof ATELIER_MEMORY_CANDIDATE_FEEDS[number];', 'official generated contract must export memory candidate feed type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, '"negotiationProjection"', 'official generated contract must carry negotiation projection metadata');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_FEEDBACK_SIGNALS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.submit'].allowedSignals;", 'prototype generated contract must export feedback signals from submit payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export type AtelierFeedbackSignal = typeof ATELIER_FEEDBACK_SIGNALS[number];', 'prototype generated contract must export feedback signal type');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export type AtelierMemoryCandidateFeed = typeof ATELIER_MEMORY_CANDIDATE_FEEDS[number];', 'prototype generated contract must export memory candidate feed type');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, '"negotiationProjection"', 'prototype generated contract must carry negotiation projection metadata');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'contract `responseFields` 显式包含 `memoryCandidate.status/reason/feeds` 与 `rerunIntent.status/reason/feeds`', 'prototype README must document feedback policy hint responseFields parity');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'contract gate 会 exact 校验 preview open `responseFields` 覆盖', 'prototype README must document exact preview open responseFields guard');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'projection contract gate exact 校验 `methodPayloads` keys 只允许 workspace service load 与 projection event subscription 保持 payloadless，其余 method 必须声明 payload metadata', 'prototype README must document exact methodPayloads key guard');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`atelier.provider.capabilities`、`atelier.feedback.submit`、`atelier.memory.confirmCandidate`、`atelier.feedback.confirmRerun`、`atelier.workspace.open` 的 responseFields', 'prototype README must document exact non-artifact responseFields guard');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'responseFields、requiredFields、optionalFields、allowedSignals/allowedUriSchemes/uriShape 与 forbiddenActions', 'prototype README must document exact non-artifact method payload metadata guard');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'artifact body / preview open 的 requiredFields、optionalFields、allowed body/mode/sandbox/renderer metadata、hostSideEffects 与 forbiddenActions', 'prototype README must document exact artifact method payload metadata guard');

for (const dataModelTerm of [
  'Provider {',
  'enum ProviderKind',
  'ProviderCapability {',
  'ProviderSideEffect {',
  'DataProvider extends Provider',
  'ActionProvider extends Provider',
  'rollback_plan_required : bool',
  'human_confirm_required : bool',
  'hard_deny_overridable  : false',
]) {
  expectIncludes(files.atelierDataModel, contents.atelierDataModel, dataModelTerm, `GAP-15 Provider schema term ${dataModelTerm}`);
}
expectIncludes(files.atelierDataModel, contents.atelierDataModel, 'Atelier applet 只能看到 Station 投影出的 read-only capability descriptor', 'Atelier applet must remain projection-only for Provider capabilities');
for (const eventBusTerm of [
  'StationEvent {',
  'SupervisorEventPayload {',
  'TaskGraphDiffProposal {',
  'payload_schema  : string',
  'atelier.supervisor_event/v0',
  'supervisor_loop : enum{ station_event_bus }',
  'interrupt_type  : enum{ supervisor_replan }',
  'version           : "atelier.task_graph_diff/v0"',
  'Applet 只能通过 projection snapshot / event stream 观察已持久化结果',
  '不得由 applet 直接写 TaskGraph',
]) {
  expectIncludes(files.atelierDataModel, contents.atelierDataModel, eventBusTerm, `F-FD-05 EventBus schema term ${eventBusTerm}`);
}
expectIncludes(files.atelierDataModel, contents.atelierDataModel, 'no_open_blockers(scope) ⟺', 'GAP-16 single completion blocker predicate');
expectIncludes(files.atelierDataModel, contents.atelierDataModel, 'no_open_blockers(project)', 'Project completion must use single blocker predicate');
expectIncludes(files.atelierDataModel, contents.atelierDataModel, 'no_open_blockers(milestone)', 'Milestone completion must use single blocker predicate');
expectNotIncludes(files.atelierDataModel, contents.atelierDataModel, 'open_blockers.count == 0', 'legacy project blocker count predicate');
expectNotIncludes(files.atelierDataModel, contents.atelierDataModel, 'milestone.open_blockers.count == 0', 'legacy milestone blocker count predicate');
expectNotIncludes(files.atelierDataModel, contents.atelierDataModel, 'no_unclosed_blocker', 'legacy role-specific blocker predicate');

const officialFrontendServiceMethods = new Map([
  ['atelier.workspace.load', "requestAtelierService('/v1/workspace', 'GET')"],
  ['atelier.project.createFromGoal', "requestAtelierService('/v1/projects', 'POST', payload)"],
  ['atelier.message.send', "requestAtelierService('/v1/messages', 'POST', input)"],
  ['atelier.escalation.resolve', "requestAtelierService('/v1/escalations:resolve', 'POST', input)"],
  ['atelier.task.setStatus', "requestAtelierService(`/v1/tasks/${encodeURIComponent(input.taskId)}/status`, 'PATCH', { status: input.status })"],
  ['atelier.task.purge', "requestAtelierService(`/v1/tasks/${encodeURIComponent(input.taskId)}`, 'DELETE')"],
]);

expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, contract.version, 'generated projection version');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, contract.version, 'generated prototype projection version');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS', 'generated official preview target field export');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS', 'generated prototype preview target field export');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_TASK_LIFECYCLE', 'generated official task lifecycle export');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_TASK_LIFECYCLE_STATES', 'generated prototype task lifecycle states export');
expectIncludes(files.contract, contents.contract, '"taskOrganizerModes"', 'projection contract must own task organizer mode taxonomy');
expectIncludes(files.contract, contents.contract, '"defaultTaskOrganizerMode"', 'projection contract must own default task organizer mode');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'workbenchSurface.taskOrganizerModes', 'projection contract generator must validate task organizer mode taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_DEFAULT_TASK_ORGANIZER_MODE', 'projection generator must export default task organizer mode');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'workbenchSurface.defaultTaskOrganizerMode must be one of taskOrganizerModes ids', 'projection generator must validate default task organizer mode');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_TASK_ORGANIZER_MODES', 'official generated contract must export task organizer mode descriptors');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_DEFAULT_TASK_ORGANIZER_MODE', 'official generated contract must export default task organizer mode');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_TASK_ORGANIZER_MODES', 'prototype generated contract must export task organizer mode descriptors');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_DEFAULT_TASK_ORGANIZER_MODE', 'prototype generated contract must export default task organizer mode');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'type AtelierTaskLifecycleStatus', 'official applet client must import generated task lifecycle status type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'status: AtelierTaskLifecycleStatus;', 'official applet setTaskStatus input must derive from generated task lifecycle taxonomy');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "status: 'active' | 'archived' | 'deleted';", 'official applet setTaskStatus input must not duplicate generated task lifecycle taxonomy');
expectIncludes(files.contract, contents.contract, '"workspace.budget"', 'Atelier projection contract must declare optional read-only budget descriptor');
expectIncludes(files.contract, contents.contract, '"budgetSurface"', 'Atelier projection contract must own budget projection taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateBudgetSurface(value.budgetSurface)', 'projection contract generator must validate budget projection taxonomy');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_BUDGET_STATUSES', 'official generated contract must export budget projection statuses');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_BUDGET_STATUSES', 'prototype generated contract must export budget projection statuses');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'interface AtelierBudgetProjection', 'official projection must type read-only budget descriptor');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'AtelierBudgetStatus', 'official projection budget type must come from generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_BUDGET_STATUSES', 'official projection guard must consume generated budget statuses');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isAtelierBudgetProjection', 'official projection guard must validate budget descriptor');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isAtelierBudgetDimensionProjection', 'official projection guard must validate budget dimensions');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'value.percent <= 100', 'official projection budget guard must bound budget dimension percent');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "value === 'ok' || value === 'warning'", 'official projection guard must not duplicate budget status taxonomy');
expectIncludes(files.tsProjection, contents.tsProjection, 'budget?: BudgetProjection', 'prototype projection must expose optional read-only budget descriptor');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'AtelierBudgetStatus', 'prototype budget type must come from generated contract');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_BUDGET_STATUSES', 'prototype projection guard must consume generated budget statuses');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isBudgetProjection', 'prototype projection guard must validate budget descriptor');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isBudgetDimensionProjection', 'prototype projection guard must validate budget dimensions');
expectNotIncludes(files.tsProjection, contents.tsProjection, "value === 'ok' || value === 'warning'", 'prototype projection guard must not duplicate budget status taxonomy');
expectIncludes(files.prototypePage, contents.prototypePage, 'function BudgetStrip', 'browser prototype topbar must render budget projection');
expectIncludes(files.prototypePage, contents.prototypePage, 'Read-only Station budget projection', 'browser prototype budget strip must disclose Station-owned budget routing');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'budget?.dimensions', 'official frontend must render structured budget dimensions when projected');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.budget.readOnly', 'official frontend budget UI must disclose Station-owned budget routing');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'budget: {', 'official frontend gate must include a valid structured budget fixture');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "status: 'halted'", 'official frontend gate must reject malformed budget status');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'percent: 101', 'official frontend gate must reject over-100 budget dimension percent');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'budget: {', 'bridge runtime gate must include a valid structured budget fixture');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "status: 'halted'", 'bridge runtime gate must reject malformed budget status');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'percent: 101', 'bridge runtime gate must reject over-100 budget dimension percent');
expectNotIncludes(files.contract, contents.contract, 'budget.halt', 'Atelier applet contract must not expose budget halt execution capability');
expectNotIncludes(files.contract, contents.contract, 'budget.resume', 'Atelier applet contract must not expose budget resume execution capability');
expectIncludes(files.prototypePage, contents.prototypePage, 'purgeConfirmId', 'browser prototype shell must own purge confirmation state');
expectIncludes(files.prototypePage, contents.prototypePage, 'requestPurge', 'browser prototype shell must expose first-click purge confirmation request');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, '确认彻底删除', 'browser prototype task menu must require second click before purge');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'host.requestPurge(t.id)', 'browser prototype task menu must request purge confirmation before calling purge');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'Station 仍会校验任务处于 deleted 后才允许 purge。', 'browser prototype task menu must disclose Station deleted-state purge precondition');
const prototypePurgeActionStart = contents.prototypePlugins.indexOf("else if (key === 'purge') {");
const prototypePurgeActionEnd = contents.prototypePlugins.indexOf('\n    }\n    setMenuOpen(false);', prototypePurgeActionStart);
const prototypePurgeActionSource =
  prototypePurgeActionStart >= 0 && prototypePurgeActionEnd > prototypePurgeActionStart
    ? contents.prototypePlugins.slice(prototypePurgeActionStart, prototypePurgeActionEnd)
    : '';
if (!prototypePurgeActionSource.includes('if (!confirmingPurge)')) {
  failures.push(`${files.prototypePlugins}: browser prototype purge action must guard first click behind confirmingPurge`);
}
if (!prototypePurgeActionSource.includes('host.purge(t.id)')) {
  failures.push(`${files.prototypePlugins}: browser prototype purge action must still delegate confirmed purge to host`);
}
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_PROJECTION_CONTRACT.version', 'prototype projection version must come from generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_PROJECTION_CONTRACT.version', 'official frontend projection version must come from generated contract');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export const ATELIER_RUN_TARGET_KINDS = ATELIER_PROJECTION_CONTRACT.methodPayloads', 'official generated contract must export run target kinds from createFromGoal payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export type AtelierRunTargetKind = typeof ATELIER_RUN_TARGET_KINDS[number];', 'official generated contract must export run target kind type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export const ATELIER_DEFAULT_RUN_TARGET_KIND = ATELIER_PROJECTION_CONTRACT.methodPayloads', 'official generated contract must export default run target kind from createFromGoal payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_DIRECT_RUN_MODELS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedDirectRunModels;", 'official generated contract must export direct run models from createFromGoal payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export type AtelierDirectRunModel = typeof ATELIER_DIRECT_RUN_MODELS[number];', 'official generated contract must export direct run model type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_DEFAULT_DIRECT_RUN_MODEL = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultDirectRunModel;", 'official generated contract must export default direct run model from createFromGoal payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export const ATELIER_AGENT_ROLE_AUTHORITY = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority;', 'official generated contract must export AgentRole authority matrix');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export const ATELIER_AGENT_ROLES = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles;', 'official generated contract must export AgentRole taxonomy');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export type AtelierAgentRole = typeof ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles[number];', 'official generated contract must export AgentRole type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_AGENT_FLOW_IDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedAgentFlowIds;", 'official generated contract must export agent flow ids from createFromGoal payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export type AtelierAgentFlowId = typeof ATELIER_AGENT_FLOW_IDS[number];', 'official generated contract must export agent flow id type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_DEFAULT_AGENT_FLOW_ID = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultAgentFlowId;", 'official generated contract must export default agent flow id from createFromGoal payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_AGENT_FLOW_DESCRIPTORS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].agentFlowDescriptors;", 'official generated contract must export agent flow descriptors from createFromGoal payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'export type AtelierAgentFlowDescriptor = typeof ATELIER_AGENT_FLOW_DESCRIPTORS[number];', 'official generated contract must export agent flow descriptor type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_MEMORY_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.memory.confirmCandidate'].allowedConfirmationMode;", 'official generated contract must export memory confirmation mode from confirmation payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_RERUN_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.confirmRerun'].allowedConfirmationMode;", 'official generated contract must export rerun confirmation mode from confirmation payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_WORKSPACE_OPEN_URI_SCHEMES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].allowedUriSchemes;", 'official generated contract must export workspace open URI schemes from workspace open payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_WORKSPACE_OPEN_URI_SHAPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].uriShape;", 'official generated contract must export workspace open URI shape from workspace open payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_PROVIDER_CAPABILITY_SCOPES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].allowedCapabilityScopes;", 'official generated contract must export provider capability scopes from discovery payload');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_PROVIDER_CAPABILITY_SCOPE', 'projection contract generator must export explicit provider capability scope from discovery payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_PROVIDER_CAPABILITY_SCOPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityScope;", 'official generated contract must export explicit provider capability scope from discovery payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_PROVIDER_CAPABILITY_READ_ONLY = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityReadOnly;", 'official generated contract must export provider capability read-only marker from discovery payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedModes;", 'official generated contract must export artifact preview open modes from method payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].defaultMode;", 'official generated contract must export default artifact preview open mode from method payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_BODY_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedBodyRefSchemes;", 'official generated contract must export artifact body ref schemes from artifact preview contract');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_BODY_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.bodyRefShape;", 'official generated contract must export artifact body ref shape from artifact preview contract');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_SANDBOX_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.sandboxRefShape;", 'official generated contract must export artifact sandbox ref shape from artifact preview contract');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererOwner;", 'official generated contract must export artifact preview open renderer owners from method payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererMode;", 'official generated contract must export artifact preview open renderer modes from method payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererStatus;", 'official generated contract must export artifact preview open renderer statuses from method payload');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, '"requiredRendererCapabilities": [', 'official generated contract must carry required artifact preview renderer capabilities');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, '"host_visual_renderer_surface"', 'official generated contract must carry required Host visual renderer surface capability');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export const ATELIER_RUN_TARGET_KINDS = ATELIER_PROJECTION_CONTRACT.methodPayloads', 'prototype generated contract must export run target kinds from createFromGoal payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export type AtelierRunTargetKind = typeof ATELIER_RUN_TARGET_KINDS[number];', 'prototype generated contract must export run target kind type');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export const ATELIER_DEFAULT_RUN_TARGET_KIND = ATELIER_PROJECTION_CONTRACT.methodPayloads', 'prototype generated contract must export default run target kind from createFromGoal payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_DIRECT_RUN_MODELS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedDirectRunModels;", 'prototype generated contract must export direct run models from createFromGoal payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export type AtelierDirectRunModel = typeof ATELIER_DIRECT_RUN_MODELS[number];', 'prototype generated contract must export direct run model type');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_DEFAULT_DIRECT_RUN_MODEL = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultDirectRunModel;", 'prototype generated contract must export default direct run model from createFromGoal payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export const ATELIER_AGENT_ROLE_AUTHORITY = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority;', 'prototype generated contract must export AgentRole authority matrix');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export const ATELIER_AGENT_ROLES = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles;', 'prototype generated contract must export AgentRole taxonomy');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export type AtelierAgentRole = typeof ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles[number];', 'prototype generated contract must export AgentRole type');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_AGENT_FLOW_IDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedAgentFlowIds;", 'prototype generated contract must export agent flow ids from createFromGoal payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export type AtelierAgentFlowId = typeof ATELIER_AGENT_FLOW_IDS[number];', 'prototype generated contract must export agent flow id type');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_DEFAULT_AGENT_FLOW_ID = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultAgentFlowId;", 'prototype generated contract must export default agent flow id from createFromGoal payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_AGENT_FLOW_DESCRIPTORS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].agentFlowDescriptors;", 'prototype generated contract must export agent flow descriptors from createFromGoal payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'export type AtelierAgentFlowDescriptor = typeof ATELIER_AGENT_FLOW_DESCRIPTORS[number];', 'prototype generated contract must export agent flow descriptor type');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_MEMORY_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.memory.confirmCandidate'].allowedConfirmationMode;", 'prototype generated contract must export memory confirmation mode from confirmation payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_RERUN_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.confirmRerun'].allowedConfirmationMode;", 'prototype generated contract must export rerun confirmation mode from confirmation payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_WORKSPACE_OPEN_URI_SCHEMES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].allowedUriSchemes;", 'prototype generated contract must export workspace open URI schemes from workspace open payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_WORKSPACE_OPEN_URI_SHAPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].uriShape;", 'prototype generated contract must export workspace open URI shape from workspace open payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_PROVIDER_CAPABILITY_SCOPES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].allowedCapabilityScopes;", 'prototype generated contract must export provider capability scopes from discovery payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_PROVIDER_CAPABILITY_SCOPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityScope;", 'prototype generated contract must export explicit provider capability scope from discovery payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_PROVIDER_CAPABILITY_READ_ONLY = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityReadOnly;", 'prototype generated contract must export provider capability read-only marker from discovery payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedModes;", 'prototype generated contract must export artifact preview open modes from method payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].defaultMode;", 'prototype generated contract must export default artifact preview open mode from method payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_BODY_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedBodyRefSchemes;", 'prototype generated contract must export artifact body ref schemes from artifact preview contract');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_BODY_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.bodyRefShape;", 'prototype generated contract must export artifact body ref shape from artifact preview contract');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_SANDBOX_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.sandboxRefShape;", 'prototype generated contract must export artifact sandbox ref shape from artifact preview contract');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererOwner;", 'prototype generated contract must export artifact preview open renderer owners from method payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererMode;", 'prototype generated contract must export artifact preview open renderer modes from method payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, "export const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererStatus;", 'prototype generated contract must export artifact preview open renderer statuses from method payload');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, '"requiredRendererCapabilities": [', 'prototype generated contract must carry required artifact preview renderer capabilities');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, '"host_visual_renderer_surface"', 'prototype generated contract must carry required Host visual renderer surface capability');
expectIncludes(files.contractGenerator, contents.contractGenerator, "assertStringArray(payload.requiredRendererCapabilities, 'methodPayloads.atelier.artifact.preview.open.requiredRendererCapabilities')", 'contract generator must validate required artifact preview renderer capabilities');
expectIncludes(files.contractGenerator, contents.contractGenerator, "requiredRendererCapabilities must include host_visual_renderer_surface", 'contract generator must require Host visual renderer surface capability');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities", 'official client must read required renderer capabilities from generated projection contract');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'hasRequiredAtelierArtifactPreviewRendererCapabilities(record.rendererCapabilities)', 'official client must reject preview open responses missing required renderer capabilities');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'hasRequiredAtelierArtifactPreviewRendererCapabilities(record.rendererCapabilities)', 'official frontend gate must prove required renderer capability guard stays active');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, "atelierProjectionContract.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities", 'Desktop artifact preview Host adapter must read required renderer capabilities from contract');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'Atelier artifact preview Host adapter requires contract renderer capabilities', 'Desktop artifact preview Host adapter must reject missing required renderer capabilities');
expectIncludes(files.desktopAtelierPreviewHostTest, contents.desktopAtelierPreviewHostTest, 'rejects preview sessions missing contract-required renderer capabilities', 'Desktop artifact preview Host adapter test must cover missing required renderer capabilities');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'artifact preview required renderer capability 当前有 controlled/static evidence', 'prototype README must document required renderer capability guard evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'official client 和 browser applet-sdk bridge 都会从 generated `ATELIER_PROJECTION_CONTRACT` 校验 Host response capabilities 覆盖 required set', 'prototype README must document official/prototype required renderer capability guard parity');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunHostStorageAttachmentsMetaKey', 'Station DirectRun input snapshot must define Host-owned attachment metadata key');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"host_storage_attachments_json"', 'Station DirectRun input snapshot must define Host-owned attachment metadata key value');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'type directRunInputSnapshotAttachment struct', 'Station DirectRun input snapshot must expose a typed attachment metadata shape');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'HostStorageRef string `json:"host_storage_ref"`', 'Station DirectRun attachment snapshot must require opaque Host Storage refs');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'normalizeDirectRunInputSnapshotAttachments(meta)', 'Station DirectRun input snapshot builder must normalize attachments before persistence');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'DirectRun input_snapshot attachments must not include raw path, URL, body, base64, or write intent fields', 'Station DirectRun attachment snapshot must reject raw or write-capable attachment inputs');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'strings.HasPrefix(hostStorageRef, directRunHostStorageRefPrefix)', 'Station DirectRun attachment snapshot must require Host Storage ref prefix');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestDirectRunRecordFromProviderPlanPreservesHostStorageAttachments', 'Station DirectRun tests must preserve Host Storage attachment metadata');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestDirectRunRecordFromProviderPlanRejectsRawAttachmentInputs', 'Station DirectRun tests must reject raw attachment inputs');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, '"attachments":[]', 'Station DirectRun tests must prove empty attachment snapshot is explicit');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'DirectRun input_snapshot attachment shape 当前有 service/static evidence', 'prototype README must document Station DirectRun attachment snapshot shape guard evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'DirectRun model selector taxonomy 当前有 controlled/static evidence', 'prototype README must document DirectRun model selector taxonomy guard evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '两端不再维护本地 `MODEL_OPTIONS` / `MODELS` 列表', 'prototype README must document official/prototype direct run model local-list removal');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Agent Flow selector descriptor taxonomy 当前也有 controlled/static evidence', 'prototype README must document Agent Flow descriptor taxonomy guard evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '两端不再维护本地 `AGENT_FLOW_LABELS` / `AGENT_FLOW_DETAILS`', 'prototype README must document official/prototype agent flow local-map removal');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_TASK_LIFECYCLE_STATES.includes', 'official frontend task status normalization must read generated lifecycle states');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'type TaskStatus = AtelierTaskLifecycleStatus', 'prototype task status type must alias generated lifecycle status');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "type TaskStatus = 'active'", 'prototype types must not duplicate generated task lifecycle taxonomy');
expectIncludes(files.contract, contents.contract, '"defaultTaskIntentPreset"', 'projection contract must define default task intent preset');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_DEFAULT_TASK_INTENT_PRESET', 'projection generator must export default task intent preset');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'workbenchSurface.defaultTaskIntentPreset must be one of taskIntentPresets', 'projection generator must validate default task intent preset');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_DEFAULT_TASK_INTENT_PRESET', 'official generated contract must expose default task intent preset');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_DEFAULT_TASK_INTENT_PRESET', 'prototype generated contract must expose default task intent preset');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type TaskIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];', 'prototype task intent preset type must derive from generated taxonomy');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type ArtifactKind = (typeof ATELIER_ARTIFACT_KINDS)[number];', 'prototype artifact kind type must derive from generated taxonomy');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type ArtifactBodyKind = (typeof ATELIER_ARTIFACT_BODY_KINDS)[number];', 'prototype artifact body kind type must derive from generated taxonomy');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type GateStatus = (typeof ATELIER_GATE_STATUSES)[number];', 'prototype gate status type must derive from generated taxonomy');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type GateCheckStatus = (typeof ATELIER_GATE_CHECK_STATUSES)[number];', 'prototype gate check status type must derive from generated taxonomy');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type TodoStatus = (typeof ATELIER_TODO_STATUSES)[number];', 'prototype todo status type must derive from generated taxonomy');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type ContextFileGroup = (typeof ATELIER_CONTEXT_FILE_GROUPS)[number];', 'prototype context file group type must derive from generated taxonomy');
expectIncludes(files.contract, contents.contract, '"defaultContextFileGroup"', 'projection contract must define default context file group');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_DEFAULT_CONTEXT_FILE_GROUP', 'projection generator must export default context file group');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'workbenchSurface.defaultContextFileGroup must be one of contextFileGroups', 'projection generator must validate default context file group');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_DEFAULT_CONTEXT_FILE_GROUP', 'official generated contract must expose default context file group');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_DEFAULT_CONTEXT_FILE_GROUP', 'prototype generated contract must expose default context file group');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "intentPreset?: 'work' | 'code' | 'design'", 'prototype task intent preset type must not duplicate generated taxonomy');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "kind: 'markdown' | 'web' | 'image' | 'diff'", 'prototype artifact kind type must not duplicate generated taxonomy');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "bodyKind?: 'markdown' | 'diff' | 'text' | 'json'", 'prototype artifact body kind type must not duplicate generated taxonomy');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "status: 'pending' | 'running' | 'passed' | 'failed' | 'blocked'", 'prototype gate status type must not duplicate generated taxonomy');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "status: 'passed' | 'failed' | 'pending'", 'prototype gate check status type must not duplicate generated taxonomy');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "status: 'done' | 'running' | 'todo'", 'prototype todo status type must not duplicate generated taxonomy');
expectNotIncludes(files.prototypeTypes, contents.prototypeTypes, "group: 'files' | 'other'", 'prototype context file group type must not duplicate generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_TASK_INTENT_PRESETS', 'prototype runtime createProjectFromGoal input must import generated intent preset taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_DEFAULT_TASK_INTENT_PRESET', 'prototype runtime createProjectFromGoal default intent preset must import generated default');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING', 'prototype runtime intentPreset metadata must consume generated createFromGoal intent preset mapping');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type IntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];', 'prototype runtime IntentPreset type must derive from generated intent preset taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'function intentPresetMetadata(intentPreset: IntentPreset = ATELIER_DEFAULT_TASK_INTENT_PRESET)', 'prototype runtime intentPreset metadata must default from generated default task intent preset');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[intentPreset]', 'prototype runtime intentPreset metadata must resolve selected preset through generated mapping');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[ATELIER_DEFAULT_TASK_INTENT_PRESET]', 'prototype runtime intentPreset metadata fallback must resolve generated default preset through generated mapping');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "export type IntentPreset = 'work' | 'code' | 'design';", 'prototype runtime must not duplicate generated intent preset taxonomy');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "function intentPresetMetadata(intentPreset: IntentPreset = 'work')", 'prototype runtime must not duplicate default task intent preset literal');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "intentPreset: 'work' as const", 'prototype runtime fallback metadata must not duplicate default task intent preset literal');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_RUN_TARGET_KINDS', 'prototype runtime createProjectFromGoal input must import generated run target taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type RunTargetKind = (typeof ATELIER_RUN_TARGET_KINDS)[number];', 'prototype runtime RunTargetKind type must derive from generated run target taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_AGENT_FLOW_IDS', 'prototype runtime createProjectFromGoal input must import generated agent flow taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type AgentFlowId = (typeof ATELIER_AGENT_FLOW_IDS)[number];', 'prototype runtime AgentFlowId type must derive from generated agent flow taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type ArtifactBodyResponseKind = (typeof ATELIER_ARTIFACT_BODY_KINDS)[number];', 'prototype runtime artifact body response type must derive body kind from generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type ArtifactPreviewOpenMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_MODES)[number];', 'prototype runtime artifact preview response type must derive mode from generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type ArtifactPreviewOpenRendererOwner = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS)[number];', 'prototype runtime artifact preview response type must derive renderer owner from generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type ArtifactPreviewOpenRendererMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES)[number];', 'prototype runtime artifact preview response type must derive renderer mode from generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type ArtifactPreviewOpenRendererStatus = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES)[number];', 'prototype runtime artifact preview response type must derive renderer status from generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type ProviderCapabilityScope = (typeof ATELIER_PROVIDER_CAPABILITY_SCOPES)[number];', 'prototype runtime provider capability type must derive scope from generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'export type ProviderCapabilityReadOnly = typeof ATELIER_PROVIDER_CAPABILITY_READ_ONLY;', 'prototype runtime provider capability type must derive read-only marker from generated contract');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'scope: ATELIER_PROVIDER_CAPABILITY_SCOPE', 'prototype runtime provider capability fixture must consume generated provider capability scope');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'readOnly: ATELIER_PROVIDER_CAPABILITY_READ_ONLY', 'prototype runtime provider capability fixture must consume generated provider capability read-only marker');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, "kind: Extract<RunTargetKind, 'model'>;", 'prototype runtime DirectRun model target must be a discriminated generated run kind branch');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, "kind: Extract<RunTargetKind, 'agents'>;", 'prototype runtime agents target must be a discriminated generated run kind branch');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'flowId?: AgentFlowId;', 'prototype runtime agents run target flowId must derive from generated taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'bodyKind: ArtifactBodyResponseKind;', 'prototype runtime artifact body response interface must expose generated-derived body kind type');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'mode: ArtifactPreviewOpenMode;', 'prototype runtime artifact preview response interface must expose generated-derived mode type');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'rendererOwner: ArtifactPreviewOpenRendererOwner;', 'prototype runtime artifact preview response interface must expose generated-derived renderer owner type');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'rendererMode: ArtifactPreviewOpenRendererMode;', 'prototype runtime artifact preview response interface must expose generated-derived renderer mode type');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'rendererStatus: ArtifactPreviewOpenRendererStatus;', 'prototype runtime artifact preview response interface must expose generated-derived renderer status type');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'scope: ProviderCapabilityScope;', 'prototype runtime provider capability interface must expose generated-derived scope type');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'readOnly: ProviderCapabilityReadOnly;', 'prototype runtime provider capability interface must expose generated-derived read-only marker type');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "kind: 'model' | 'agents';", 'prototype runtime run target input must not duplicate generated taxonomy');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'kind: RunTargetKind;', 'prototype runtime run target input must not allow model intent to carry flowId');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'flowId?: string;', 'prototype runtime run target flowId must not stay unbounded string');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "bodyKind: 'markdown' | 'diff' | 'text' | 'json';", 'prototype runtime artifact body response interface must not duplicate generated body kind taxonomy');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "scope: 'station-provider';", 'prototype runtime provider capability interface must not duplicate generated provider scope taxonomy');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'readOnly: true;', 'prototype runtime provider capability interface must not duplicate generated read-only marker');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "scope: 'station-provider'", 'prototype runtime provider capability fixture must not duplicate generated provider scope literal');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'readOnly: true', 'prototype runtime provider capability fixture must not duplicate generated read-only literal');
expectIncludes(files.tsProjection, contents.tsProjection, 'run.flowId ?? ATELIER_DEFAULT_AGENT_FLOW_ID', 'prototype projection run target label must default missing flowId from generated default agent flow id');
expectIncludes(files.tsProjection, contents.tsProjection, 'run.model ?? ATELIER_DEFAULT_DIRECT_RUN_MODEL', 'prototype projection run target label must default missing model from generated default direct run model');
expectNotIncludes(files.tsProjection, contents.tsProjection, "run.flowId ?? 'agents'", 'prototype projection run target label must not fallback to run kind literal for missing flowId');
expectNotIncludes(files.tsProjection, contents.tsProjection, "run.model ?? 'model'", 'prototype projection run target label must not fallback to run kind literal for missing model');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_RUN_TARGET_KINDS.map((k) => (', 'prototype RunPicker must render generated run target taxonomy');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_DIRECT_RUN_MODELS.map((m) => {', 'prototype RunPicker must render generated direct run model taxonomy');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'const MODELS = [', 'prototype RunPicker must not duplicate direct run model taxonomy locally');
expectIncludes(files.runtimeBootstrap, contents.runtimeBootstrap, 'ATELIER_DEFAULT_DIRECT_RUN_MODEL', 'prototype host bootstrap empty state must use generated default direct run model');
expectNotIncludes(files.runtimeBootstrap, contents.runtimeBootstrap, "model: 'openrouter-3o'", 'prototype host bootstrap must not duplicate default direct run model locally');
expectIncludes(files.prototypePage, contents.prototypePage, 'useState<RunKind>(ATELIER_DEFAULT_RUN_TARGET_KIND)', 'prototype RunPicker must default from explicit generated default run target kind');
expectNotIncludes(files.prototypePage, contents.prototypePage, "useState<RunKind>('agents')", 'prototype RunPicker must not duplicate default run target kind as a local literal');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'useState<RunKind>(ATELIER_RUN_TARGET_KINDS[0])', 'prototype RunPicker must not derive default run target from allowedRunKinds ordering');
expectIncludes(files.prototypePage, contents.prototypePage, "const run = runKind === 'model'", 'prototype createProjectFromGoal must branch run payload by generated run kind');
expectIncludes(files.prototypePage, contents.prototypePage, "{ kind: 'model' as const, model: state.model }", 'prototype DirectRun model intent must not include flowId');
expectIncludes(files.prototypePage, contents.prototypePage, "{ kind: 'agents' as const, model: state.model, flowId }", 'prototype agents intent may include generated flowId');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'run: { kind: runKind, model: state.model, flowId }', 'prototype createProjectFromGoal must not send flowId with DirectRun model intent');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => {', 'prototype RunPicker must render generated agent flow descriptors');
expectIncludes(files.prototypePage, contents.prototypePage, 'useState<AgentFlowId>(ATELIER_DEFAULT_AGENT_FLOW_ID)', 'prototype RunPicker must default flowId from generated default agent flow id');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'const AGENT_FLOW_DETAILS', 'prototype RunPicker must not duplicate generated agent flow descriptors locally');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'useState<AgentFlowId>(ATELIER_AGENT_FLOW_IDS[0])', 'prototype RunPicker must not derive default agent flow from allowedAgentFlowIds ordering');
expectIncludes(files.prototypePage, contents.prototypePage, 'type RunKind = RunTargetKind;', 'prototype RunPicker type must derive from generated run target taxonomy');
expectNotIncludes(files.prototypePage, contents.prototypePage, "type RunKind = 'model' | 'agents';", 'prototype RunPicker type must not duplicate generated run target taxonomy');
  expectNotIncludes(files.prototypePage, contents.prototypePage, 'const AGENT_FLOWS:', 'prototype RunPicker must not duplicate generated agent flow taxonomy');
expectNotIncludes(files.prototypePage, contents.prototypePage, "([['model', '⚡ 直接模型'], ['agents', '👥 Agents']] as const).map", 'prototype RunPicker tabs must not duplicate generated run target taxonomy');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_TASK_LIFECYCLE_STATES.includes', 'prototype projection task status guard must read generated lifecycle states');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_PROJECT_STATES', 'official frontend projection guard must import generated project surface states');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_PROJECT_STATES', 'prototype projection guard must import generated project surface states');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_TASK_INTENT_PRESETS', 'Browser prototype Work/Code/Design toggle must import generated task intent presets');
expectIncludes(files.prototypePage, contents.prototypePage, 'type TaskIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];', 'Browser prototype Work/Code/Design toggle must type-check against generated task intent presets');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_TASK_INTENT_PRESETS.map((m) => (', 'Browser prototype Work/Code/Design toggle must render generated task intent presets');
expectNotIncludes(files.prototypePage, contents.prototypePage, "(['work', 'code', 'design'] as const).map((m) => (", 'Browser prototype Work/Code/Design toggle must not duplicate task intent preset taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_TASK_INTENT_PRESETS', 'Official Work/Code/Design selector must import generated task intent presets');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const INTENT_PRESET_LABEL_KEYS: Record<AtelierIntentPreset, { labelKey: string; hintKey: string }>', 'Official Work/Code/Design selector labels must type-check against generated task intent presets');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_TASK_INTENT_PRESETS.map((option) => {', 'Official Work/Code/Design selector must render generated task intent presets');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const INTENT_PRESETS: Array', 'Official Work/Code/Design selector must not duplicate task intent preset taxonomy');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_ARTIFACT_KINDS', 'official frontend projection guard must import generated workbench artifact kinds');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_ARTIFACT_BODY_REF_SHAPE', 'official frontend projection guard must import generated artifact body ref shape');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_ARTIFACT_SANDBOX_REF_SHAPE', 'official frontend projection guard must import generated artifact sandbox ref shape');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_ARTIFACT_KINDS', 'prototype projection guard must import generated workbench artifact kinds');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_ARTIFACT_BODY_REF_SHAPE', 'prototype projection guard must import generated artifact body ref shape');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_ARTIFACT_SANDBOX_REF_SHAPE', 'prototype projection guard must import generated artifact sandbox ref shape');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_GATE_STATUSES', 'official frontend projection guard must import generated workbench gate statuses');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_GATE_STATUSES', 'prototype projection guard must import generated workbench gate statuses');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'type AtelierGateStatus = (typeof ATELIER_GATE_STATUSES)[number];', 'Official GatePanel visual status helper must type-check against generated gate statuses');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "const GATE_STATUS_PASSED: AtelierGateStatus = 'passed';", 'Official GatePanel must render canonical passed gate status as success');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const gatePassed = gate.status === GATE_STATUS_PASSED;', 'Official GatePanel must use canonical passed helper for success tone');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "gate.status === 'pass'", 'Official GatePanel must not render legacy pass gate status as success');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "status: 'passed'", 'Official frontend gate fixture must use canonical passed gate status');
expectNotIncludes(files.officialFrontendGate, contents.officialFrontendGate, "status: 'pass'", 'Official frontend gate fixture must not use legacy pass gate status');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "const ATELIER_PROJECT_STATES = [", 'official frontend projection guard must not duplicate project state taxonomy');
expectNotIncludes(files.tsProjection, contents.tsProjection, "const ATELIER_PROJECT_STATES = [", 'prototype projection guard must not duplicate project state taxonomy');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "const ATELIER_BLOCKER_SEVERITIES = ['block'", 'official frontend projection guard must not duplicate blocker severity taxonomy');
expectNotIncludes(files.tsProjection, contents.tsProjection, "const ATELIER_BLOCKER_SEVERITIES = ['block'", 'prototype projection guard must not duplicate blocker severity taxonomy');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "['done', 'running', 'todo']", 'official frontend projection guard must not duplicate todo status taxonomy');
expectNotIncludes(files.tsProjection, contents.tsProjection, "['done', 'running', 'todo']", 'prototype projection guard must not duplicate todo status taxonomy');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "['markdown', 'web', 'image', 'diff']", 'official frontend projection guard must not duplicate artifact kind taxonomy');
expectNotIncludes(files.tsProjection, contents.tsProjection, "['markdown', 'web', 'image', 'diff']", 'prototype projection guard must not duplicate artifact kind taxonomy');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "['pending', 'running', 'passed', 'failed', 'blocked']", 'official frontend projection guard must not duplicate gate status taxonomy');
expectNotIncludes(files.tsProjection, contents.tsProjection, "['pending', 'running', 'passed', 'failed', 'blocked']", 'prototype projection guard must not duplicate gate status taxonomy');
expectIncludes(files.tsProjection, contents.tsProjection, './projection.contract.generated', 'prototype projection guard must import generated contract');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_PROJECTION_CONTRACT.runtimeMethods', 'prototype runtime methods must come from generated contract');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_PROJECTION_CONTRACT.patchKinds', 'prototype patch kinds must come from generated contract');
expectIncludes(files.tsProjection, contents.tsProjection, 'projects?: AtelierProjectProjection[]', 'prototype projection must expose read-only projects');
expectIncludes(files.tsProjection, contents.tsProjection, 'isProjectProjection', 'prototype projection guard must validate project projection');
expectIncludes(files.tsProjection, contents.tsProjection, 'isTaskGraph', 'prototype projection guard must validate task graph projection');
expectIncludes(files.tsProjection, contents.tsProjection, 'isDefectProjection', 'prototype projection guard must validate defect projection');
expectIncludes(files.goProjection, contents.goProjection, contract.version, 'projection version');
expectIncludes(files.goProjection, contents.goProjection, 'Projects    []AtelierProjectProjection', 'Station workspace projection must expose read-only projects');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierProject', 'Station must materialize Project projection from orchestration state');
expectIncludes(files.goProjection, contents.goProjection, 'func loadAtelierProjectPersistenceByTask', 'Station workspace load must read Project acceptance persistence indexes');
expectIncludes(files.goProjection, contents.goProjection, 'projectPersistenceByTask', 'Station Project projection must receive persisted acceptance records');
expectIncludes(files.goProjection, contents.goProjection, 'ProjectState           string', 'Station Project projection must carry persisted ProjectState into the mapper');
expectIncludes(files.goProjection, contents.goProjection, 'MilestoneState         string', 'Station Project projection must carry persisted MilestoneState into the mapper');
expectIncludes(files.goProjection, contents.goProjection, 'Milestones             []atelierMilestoneRecord', 'Station Project projection must carry persisted Milestone records into the mapper');
expectIncludes(files.goProjection, contents.goProjection, 'TaskGraph              AtelierTaskGraph', 'Station Project projection must carry persisted TaskGraph records into the mapper');
expectIncludes(files.goProjection, contents.goProjection, 'Policy                 *AtelierPolicyProjection', 'Station Project projection must carry persisted Policy records into the mapper');
expectIncludes(files.goProjection, contents.goProjection, 'Defects                []AtelierDefectProjection', 'Station Project projection must carry persisted Defect records into the mapper');
expectIncludes(files.goProjection, contents.goProjection, 'var stateRecords []persistence.ProjectState', 'Station workspace load must read persisted ProjectState records');
expectIncludes(files.goProjection, contents.goProjection, 'AcceptancePredicates   []atelierAcceptancePredicateRecord', 'Station Project projection must carry persisted AcceptancePredicate records into completion');
expectIncludes(files.goProjection, contents.goProjection, 'AcceptancePredicateIDs []string', 'Station Project projection must carry acceptance predicate ids into milestone projection');
expectIncludes(files.goProjection, contents.goProjection, 'var predicateRecords []persistence.AcceptancePredicate', 'Station workspace load must read persisted AcceptancePredicate records');
expectIncludes(files.goProjection, contents.goProjection, 'var milestoneRecords []persistence.AtelierMilestone', 'Station workspace load must read persisted MilestoneTree records');
expectIncludes(files.goProjection, contents.goProjection, 'var taskGraphNodeRecords []persistence.AtelierTaskGraphNode', 'Station workspace load must read persisted TaskGraph node records');
expectIncludes(files.goProjection, contents.goProjection, 'var taskGraphEdgeRecords []persistence.AtelierTaskGraphEdge', 'Station workspace load must read persisted TaskGraph edge records');
expectIncludes(files.goProjection, contents.goProjection, 'var policyRecords []persistence.AtelierPolicy', 'Station workspace load must read persisted Policy records');
expectIncludes(files.goProjection, contents.goProjection, 'var ruleRecords []persistence.AtelierPolicyRule', 'Station workspace load must read persisted PolicyRule records');
expectIncludes(files.goProjection, contents.goProjection, 'var defectRecords []persistence.AtelierDefect', 'Station workspace load must read persisted Defect records');
expectIncludes(files.goProjection, contents.goProjection, 'func loadAtelierCheckpointsByTask', 'Station workspace load must read TaskCheckpoint anchors');
expectIncludes(files.goProjection, contents.goProjection, 'func loadAtelierMaterializedProjectionsByTask', 'Station workspace load must consume materialized checkpoint projections');
expectIncludes(files.goProjection, contents.goProjection, 'func parseAtelierMaterializedTaskProjection', 'Station checkpoint projection parser is required');
expectIncludes(files.goProjection, contents.goProjection, 'func buildChatTaskCheckpointStateJSONTx', 'Station checkpoint writer must fold projection state into TaskCheckpoint.StateJSON');
expectIncludes(files.goProjection, contents.goProjection, 'event_seq > ?', 'Station checkpoint replay must only load post-checkpoint event windows when materialized');
expectIncludes(files.goProjection, contents.goProjection, 'checkpoint-materialized+event-window', 'Station replay metadata must expose materialized checkpoint source');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierProjectState', 'Station must derive ProjectState from task status and completion');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierMilestoneState', 'Station must derive MilestoneState from project state and task graph');
expectIncludes(files.goProjection, contents.goProjection, 'func normalizeAtelierProjectState', 'Station must normalize explicit ProjectState overrides');
expectIncludes(files.goProjection, contents.goProjection, 'func normalizeAtelierMilestoneState', 'Station must normalize explicit MilestoneState overrides');
expectNotIncludes(files.goProjection, contents.goProjection, 'State:            normalizeAtelierTaskStatus(meta["atelier_status"])', 'Project projection must not reuse generic task status as ProjectState');
expectNotIncludes(files.goProjection, contents.goProjection, 'State:                  normalizeAtelierTaskStatus(task.GetMeta()["atelier_status"])', 'Milestone projection must not reuse generic task status as MilestoneState');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierCompletion', 'Station must derive project completion projection from durable state');
expectIncludes(files.goProjection, contents.goProjection, 'func atelierPersistedAutomatedAcceptancePassed', 'Station completion evaluator must consume persisted L0/L1 predicates');
expectIncludes(files.goProjection, contents.goProjection, 'func atelierPersistedHumanSignoffComplete', 'Station completion evaluator must consume persisted L2 predicates');
expectIncludes(files.goProjection, contents.goProjection, 'func atelierAutomatedAcceptancePassed', 'Station completion evaluator must derive L0/L1 acceptance from gate events');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'type AcceptancePredicateEvaluator struct', 'Station must own the AcceptancePredicate evaluator');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'func (e *AcceptancePredicateEvaluator) EvaluateTaskTx(ctx context.Context, db *gorm.DB, taskID string) error', 'AcceptancePredicate evaluator must run inside Station transaction scope');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'no_open_blockers(project)', 'AcceptancePredicate evaluator must support no_open_blockers(project)');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'all_milestones.status==accepted', 'AcceptancePredicate evaluator must support milestone accepted predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'memory_candidates.generated==true', 'AcceptancePredicate evaluator must support memory candidate predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'all(binproject.open_blockers:b.statein{resolved,waived})', 'AcceptancePredicate evaluator must support data-model blocker quantifier predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'all(tintasks:t.state==accepted)', 'AcceptancePredicate evaluator must support data-model task accepted quantifier predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'gate_result(', 'AcceptancePredicate evaluator must support data-model gate_result(g).passed predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'blockingGatesPassed', 'AcceptancePredicate evaluator must support data-model blocking gate aggregate predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'humanPredicatesSigned', 'AcceptancePredicate evaluator must support data-model L2 human_signoff aggregate predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'gateMatchesPredicateKey', 'AcceptancePredicate evaluator must support gate result predicates');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'return e.gatePassed(ctx, db, predicate.TaskID, normalized)', 'AcceptancePredicate evaluator must fail closed through supported gate predicate handling');
expectIncludes(files.goAcceptancePredicateEvaluator, contents.goAcceptancePredicateEvaluator, 'projectStateMachineAllNodesDone', 'AcceptancePredicate milestone evaluation must not depend on stale ProjectState rows');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'type ProjectStateMachine struct', 'Station must own the ProjectStateMachine runtime');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'func (m *ProjectStateMachine) AdvanceTaskTx(ctx context.Context, db *gorm.DB, taskID string, source *persistence.TaskEvent) error', 'ProjectStateMachine must advance inside Station transaction scope');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'persistence.ProjectState', 'ProjectStateMachine must write the Station-owned project state table');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'materializeAtelierProjectStructureTx', 'ProjectStateMachine must materialize Station-owned MilestoneTree/TaskGraph indexes');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'persistence.AtelierMilestone', 'ProjectStateMachine must write Station-owned MilestoneTree index');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'persistence.AtelierTaskGraphNode', 'ProjectStateMachine must write Station-owned TaskGraph node index');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'persistence.AtelierTaskGraphEdge', 'ProjectStateMachine must write Station-owned TaskGraph edge index');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'materializeAtelierPolicyDefectTx', 'ProjectStateMachine must materialize Station-owned Policy/Defect indexes');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'persistence.AtelierPolicy', 'ProjectStateMachine must write Station-owned Policy index');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'persistence.AtelierPolicyRule', 'ProjectStateMachine must write Station-owned PolicyRule index');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'persistence.AtelierDefect', 'ProjectStateMachine must write Station-owned Defect index');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'projectStateMachinePolicyProjectionID(taskID, policyID)', 'Policy projection index must be task-scoped');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'projectStateMachineAutomatedAcceptancePassed', 'ProjectStateMachine must derive state from acceptance/gate evidence');
expectIncludes(files.goProjectStateMachine, contents.goProjectStateMachine, 'projectStateMachineNoOpenBlockers', 'ProjectStateMachine must derive state from blocker lifecycle evidence');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'NewAcceptancePredicateEvaluator().EvaluateTaskTx(ctx, tx, req.Task.ID)', 'GateRunner must refresh AcceptancePredicate eval in the same Station transaction');
expectIncludes(files.goProjection, contents.goProjection, 'latestGatePassed', 'Station completion evaluator must use latest gate result per gate id');
expectIncludes(files.goProjection, contents.goProjection, 'func atelierGoalOwnerSignoffComplete', 'Station completion evaluator must derive L2/human signoff from meta/events');
expectIncludes(files.goProjection, contents.goProjection, 'func atelierGateStatusPassed', 'Station completion evaluator must normalize gate result status');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierTaskGraph', 'Station must materialize TaskGraph projection from task nodes');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierTaskGraphRefsByNode', 'Station must bind TaskGraph node refs from durable events');
expectIncludes(files.goProjection, contents.goProjection, 'node_id', 'TaskGraph node refs must support snake_case node ids from Station payloads');
expectIncludes(files.goProjection, contents.goProjection, 'taskNodeId', 'TaskGraph node refs must support camelCase task node ids from Station payloads');
expectIncludes(files.goProjection, contents.goProjection, 'appendAtelierUniqueString', 'TaskGraph node refs must deduplicate artifact/gate ids');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierMilestoneTree', 'Station must materialize MilestoneTree projection');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierOpenBlockers', 'Station must project blockers from durable events');
expectIncludes(files.goProjection, contents.goProjection, 'func atelierNoOpenBlockers', 'Station must evaluate no_open_blockers from Blocker.state');
expectIncludes(files.goProjection, contents.goProjection, 'human_decision_action', 'Station blocker projection must consume durable human decision route actions');
expectIncludes(files.goProjection, contents.goProjection, 'accept_risk', 'Station blocker projection must support waived blocker state');
expectNotIncludes(files.goProjection, contents.goProjection, 'NoOpenBlockers:            len(openBlockers) == 0', 'Project completion must not use legacy blocker count predicate');
expectIncludes(files.goProjection, contents.goProjection, 'func projectAtelierDefects', 'Station must project defect candidates from durable events');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestBuildAtelierProjectionSnapshotDerivesProjectCompletion', 'Station projection tests must cover derived project completion fields');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestLoadAtelierWorkspacePrefersPersistedProjectAcceptanceIndexes', 'Station projection tests must prove LoadWorkspace prefers persisted blocker/risk indexes');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestTaskEventWriterPersistsProjectAcceptanceIndexes', 'Station tests must prove task events persist Project blocker/risk indexes');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'evt_project_state_index', 'Station tests must prove task events persist ProjectState indexes');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'project-state-invalid', 'Station tests must reject invalid ProjectState indexes');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'evt_predicate_l1_index', 'Station tests must prove task events persist AcceptancePredicate indexes');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'evt_predicate_l1_update', 'Station tests must prove partial AcceptancePredicate updates preserve registry fields');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'predicate-invalid', 'Station tests must reject invalid AcceptancePredicate levels');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected persisted acceptance predicate ids', 'Station projection tests must prove milestone references persisted AcceptancePredicate ids');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected completion to use persisted acceptance predicates', 'Station projection tests must prove completion consumes persisted AcceptancePredicate results');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAcceptancePredicateEvaluatorEvaluatesDeterministicPredicates', 'Station tests must prove deterministic AcceptancePredicate evaluator behavior');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestTaskEventWriterAdvancesProjectStateMachineFromDurableEvidence', 'Station tests must prove durable events advance ProjectStateMachine without applet state production');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected runtime milestone index', 'Station tests must prove ProjectStateMachine writes MilestoneTree index');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected runtime graph node refs from Station indexes', 'Station tests must prove ProjectStateMachine writes TaskGraph node refs from Station indexes');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected projection to use persisted task graph artifact refs', 'Station tests must prove LoadWorkspace consumes persisted TaskGraph index');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestTaskEventWriterMaterializesPolicyDefectIndexes', 'Station tests must prove durable events materialize Policy/Defect indexes');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected projection to use persisted policy index', 'Station tests must prove LoadWorkspace consumes persisted Policy index');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected projection to use persisted defect index', 'Station tests must prove LoadWorkspace consumes persisted Defect index');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierMaterializedCheckpointProjectionFoldsPostCheckpointEvents', 'Station tests must prove materialized checkpoint projection is folded with post-checkpoint events');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierMaterializedCheckpointProjectionRejectsWrongVersion', 'Station tests must prove stale checkpoint projection versions are rejected');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestBuildChatTaskCheckpointStateJSONWritesReadableMaterializedProjection', 'Station tests must prove checkpoint writer emits readable materialized projection state');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'pred-blockers-dsl', 'Station tests must prove data-model blocker DSL predicates');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'pred-blocking-gates', 'Station tests must prove data-model blocking gate DSL predicates');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'pred-human-aggregate', 'Station tests must prove data-model L2 human signoff DSL predicates');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'pred-unknown', 'Station tests must prove unknown AcceptancePredicate expressions fail closed');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected persisted project/milestone state to override task meta fallback', 'Station projection tests must prove persisted ProjectState wins over task meta fallback');
expectIncludes(files.goGateRunnerTest, contents.goGateRunnerTest, 'predicate-gate-contract', 'GateRunner tests must prove gate append refreshes AcceptancePredicate eval');
expectIncludes(files.goGateRunnerTest, contents.goGateRunnerTest, 'expected gate append to advance ProjectStateMachine', 'GateRunner tests must prove gate append advances ProjectStateMachine');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'evt_gate_retry_passed', 'Station projection tests must cover recovered gate acceptance');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'expected recovered gate blocker to remain as resolved evidence', 'Station projection tests must cover resolved blocker evidence');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'for _, key := range []string{"gate_id", "gateId", "node_id", "nodeId"}', 'Station human decision route must preserve gate/node ids from pending interrupt payload');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'eventPayload["gate_id"] != "gate-block"', 'Station orchestration tests must prove resolved gate decisions preserve gate id');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'ProjectBlocker', 'Station purge tests must delete ProjectBlocker records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'ProjectResidualRisk', 'Station purge tests must delete ProjectResidualRisk records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'ProjectState', 'Station purge tests must delete ProjectState records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'AcceptancePredicate', 'Station purge tests must delete AcceptancePredicate records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'AtelierMilestone', 'Station purge tests must delete AtelierMilestone records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'AtelierTaskGraphNode', 'Station purge tests must delete AtelierTaskGraphNode records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'AtelierTaskGraphEdge', 'Station purge tests must delete AtelierTaskGraphEdge records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'AtelierPolicy', 'Station purge tests must delete AtelierPolicy records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'AtelierPolicyRule', 'Station purge tests must delete AtelierPolicyRule records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'AtelierDefect', 'Station purge tests must delete AtelierDefect records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'DirectRun', 'Station purge tests must delete DirectRun records');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&AcceptancePredicate{}', 'Station AutoMigrate must include AcceptancePredicate');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&ProjectState{}', 'Station AutoMigrate must include ProjectState');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&AtelierMilestone{}', 'Station AutoMigrate must include AtelierMilestone');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&AtelierTaskGraphNode{}', 'Station AutoMigrate must include AtelierTaskGraphNode');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&AtelierTaskGraphEdge{}', 'Station AutoMigrate must include AtelierTaskGraphEdge');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&AtelierPolicy{}', 'Station AutoMigrate must include AtelierPolicy');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&AtelierPolicyRule{}', 'Station AutoMigrate must include AtelierPolicyRule');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&AtelierDefect{}', 'Station AutoMigrate must include AtelierDefect');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&ProjectBlocker{}', 'Station AutoMigrate must include ProjectBlocker');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&ProjectResidualRisk{}', 'Station AutoMigrate must include ProjectResidualRisk');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&DirectRun{}', 'Station AutoMigrate must include DirectRun');
expectIncludes(files.goAcceptancePredicateModel, contents.goAcceptancePredicateModel, 'func (AcceptancePredicate) TableName() string { return "agent_acceptance_predicates" }', 'AcceptancePredicate must use Station-owned table name');
expectIncludes(files.goProjectStateModel, contents.goProjectStateModel, 'func (ProjectState) TableName() string { return "agent_project_states" }', 'ProjectState must use Station-owned table name');
expectIncludes(files.goAtelierMilestoneModel, contents.goAtelierMilestoneModel, 'func (AtelierMilestone) TableName() string { return "agent_atelier_milestones" }', 'AtelierMilestone must use Station-owned table name');
expectIncludes(files.goAtelierTaskGraphModel, contents.goAtelierTaskGraphModel, 'func (AtelierTaskGraphNode) TableName() string { return "agent_atelier_task_graph_nodes" }', 'AtelierTaskGraphNode must use Station-owned table name');
expectIncludes(files.goAtelierTaskGraphModel, contents.goAtelierTaskGraphModel, 'func (AtelierTaskGraphEdge) TableName() string { return "agent_atelier_task_graph_edges" }', 'AtelierTaskGraphEdge must use Station-owned table name');
expectIncludes(files.goAtelierPolicyDefectModel, contents.goAtelierPolicyDefectModel, 'func (AtelierPolicy) TableName() string { return "agent_atelier_policies" }', 'AtelierPolicy must use Station-owned table name');
expectIncludes(files.goAtelierPolicyDefectModel, contents.goAtelierPolicyDefectModel, 'func (AtelierPolicyRule) TableName() string { return "agent_atelier_policy_rules" }', 'AtelierPolicyRule must use Station-owned table name');
expectIncludes(files.goAtelierPolicyDefectModel, contents.goAtelierPolicyDefectModel, 'func (AtelierDefect) TableName() string { return "agent_atelier_defects" }', 'AtelierDefect must use Station-owned table name');
expectIncludes(files.goAtelierPolicyDefectModel, contents.goAtelierPolicyDefectModel, 'PolicyProjectionID string', 'AtelierPolicy index must be task-scoped instead of clobbering by reusable policy id');
expectIncludes(files.goProjectBlockerModel, contents.goProjectBlockerModel, 'func (ProjectBlocker) TableName() string { return "agent_project_blockers" }', 'ProjectBlocker must use Station-owned table name');
expectIncludes(files.goProjectResidualRiskModel, contents.goProjectResidualRiskModel, 'func (ProjectResidualRisk) TableName() string { return "agent_project_residual_risks" }', 'ProjectResidualRisk must use Station-owned table name');
expectIncludes(files.goDirectRunModel, contents.goDirectRunModel, 'func (DirectRun) TableName() string { return "agent_direct_runs" }', 'DirectRun must use Station-owned table name');
expectIncludes(files.goDirectRunModel, contents.goDirectRunModel, 'InputSnapshotJSON string', 'DirectRun must store replay input snapshot');
expectIncludes(files.goDirectRunModel, contents.goDirectRunModel, 'BudgetRef', 'DirectRun must keep Budget reference');
expectIncludes(files.goDirectRunModel, contents.goDirectRunModel, 'PolicyRef', 'DirectRun must keep Policy reference');
expectIncludes(files.goDirectRunModel, contents.goDirectRunModel, 'TraceID', 'DirectRun must keep trace reference');
expectIncludes(files.agentProto, contents.agentProto, 'TASK_SURFACE_DIRECT_RUN = 5;', 'TaskSurface proto must model DirectRun surface');
expectIncludes(files.agentProtoGo, contents.agentProtoGo, 'TaskSurface_TASK_SURFACE_DIRECT_RUN', 'Station generated proto must include DirectRun surface');
expectIncludes(files.acceptancePredicateMigration, contents.acceptancePredicateMigration, 'CREATE TABLE IF NOT EXISTS agent_acceptance_predicates', 'AcceptancePredicate migration table is required');
expectIncludes(files.projectStateMigration, contents.projectStateMigration, 'CREATE TABLE IF NOT EXISTS agent_project_states', 'ProjectState migration table is required');
expectIncludes(files.atelierTaskGraphMigration, contents.atelierTaskGraphMigration, 'CREATE TABLE IF NOT EXISTS agent_atelier_milestones', 'Atelier milestone migration table is required');
expectIncludes(files.atelierTaskGraphMigration, contents.atelierTaskGraphMigration, 'CREATE TABLE IF NOT EXISTS agent_atelier_task_graph_nodes', 'Atelier TaskGraph node migration table is required');
expectIncludes(files.atelierTaskGraphMigration, contents.atelierTaskGraphMigration, 'CREATE TABLE IF NOT EXISTS agent_atelier_task_graph_edges', 'Atelier TaskGraph edge migration table is required');
expectIncludes(files.atelierPolicyDefectMigration, contents.atelierPolicyDefectMigration, 'CREATE TABLE IF NOT EXISTS agent_atelier_policies', 'Atelier policy migration table is required');
expectIncludes(files.atelierPolicyDefectMigration, contents.atelierPolicyDefectMigration, 'CREATE TABLE IF NOT EXISTS agent_atelier_policy_rules', 'Atelier policy rule migration table is required');
expectIncludes(files.directRunMigration, contents.directRunMigration, 'CREATE TABLE IF NOT EXISTS agent_direct_runs', 'DirectRun migration table is required');
expectIncludes(files.directRunMigration, contents.directRunMigration, 'input_snapshot_json TEXT', 'DirectRun migration must store input snapshot');
expectIncludes(files.directRunMigration, contents.directRunMigration, 'budget_ref VARCHAR(128)', 'DirectRun migration must store budget ref');
expectIncludes(files.directRunMigration, contents.directRunMigration, 'policy_ref VARCHAR(128)', 'DirectRun migration must store policy ref');
expectIncludes(files.directRunMigration, contents.directRunMigration, 'trace_id VARCHAR(128)', 'DirectRun migration must store trace id');
expectIncludes(files.atelierPolicyDefectMigration, contents.atelierPolicyDefectMigration, 'CREATE TABLE IF NOT EXISTS agent_atelier_defects', 'Atelier defect migration table is required');
expectIncludes(files.projectAcceptanceMigration, contents.projectAcceptanceMigration, 'CREATE TABLE IF NOT EXISTS agent_project_blockers', 'Project blocker migration table is required');
expectIncludes(files.projectAcceptanceMigration, contents.projectAcceptanceMigration, 'CREATE TABLE IF NOT EXISTS agent_project_residual_risks', 'Project residual risk migration table is required');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'func syncAcceptancePredicateForTaskEventTx', 'TaskEventWriter must sync AcceptancePredicate from durable outbox events');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'func syncProjectStateForTaskEventTx', 'TaskEventWriter must sync ProjectState from durable outbox events');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'func syncProjectBlockerForTaskEventTx', 'TaskEventWriter must sync ProjectBlocker from durable outbox events');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'func syncProjectResidualRiskForTaskEventTx', 'TaskEventWriter must sync ProjectResidualRisk from durable outbox events');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'syncAcceptancePredicateForTaskEventTx(ctx, tx, &record)', 'TaskEventWriter append path must persist AcceptancePredicate indexes transactionally');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'syncProjectStateForTaskEventTx(ctx, tx, &record)', 'TaskEventWriter append path must persist ProjectState indexes transactionally');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'syncProjectBlockerForTaskEventTx(ctx, tx, &record)', 'TaskEventWriter append path must persist ProjectBlocker indexes transactionally');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'syncProjectResidualRiskForTaskEventTx(ctx, tx, &record)', 'TaskEventWriter append path must persist ProjectResidualRisk indexes transactionally');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'NewAcceptancePredicateEvaluator().EvaluateTaskTx(ctx, tx, record.TaskID)', 'TaskEventWriter must refresh AcceptancePredicate verdicts after index sync');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'NewProjectStateMachine().AdvanceTaskTx(ctx, tx, record.TaskID, &record)', 'TaskEventWriter must advance ProjectStateMachine after predicate eval');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'AcceptancePredicateEvaluator', 'Atelier frontend must not contain the Station AcceptancePredicate evaluator');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ProjectStateMachine', 'Atelier frontend must not contain the Station ProjectStateMachine');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'acceptancePredicate.evaluate', 'Atelier frontend must not expose predicate evaluation methods');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'gate_node_2', 'Station projection tests must cover TaskGraph gate refs');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'art_node_2', 'Station projection tests must cover TaskGraph artifact refs');
expectIncludes(files.contractSchemaGenerated, contents.contractSchemaGenerated, '"$id": "peers.atelier.projection.schema.generated.json"', 'generated projection JSON schema');
expectIncludes(files.contractSchemaGenerated, contents.contractSchemaGenerated, '"artifactUpsertPatch"', 'generated projection artifact patch schema');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS', 'generated forbidden artifact body fields');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, './projection.contract.generated', 'official frontend projection guard must import generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'projects?: AtelierProjectProjection[]', 'official projection must expose read-only projects');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierProjectProjection', 'official projection guard must validate project projection');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierTaskGraph', 'official projection guard must validate task graph projection');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_BLOCKER_SEVERITIES', 'official projection guard must validate blocker severity enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_BLOCKER_STATES', 'official projection guard must validate blocker state enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_RESIDUAL_RISK_STATES', 'official projection guard must validate residual risk state enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_DEPENDENCY_EDGE_TYPES', 'official projection guard must validate dependency edge type enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_TASK_GRAPH_PARALLEL_POLICIES', 'official projection guard must validate task graph parallel policy enum');
expectIncludes(files.contract, contents.contract, '"projectionDisplayLimits"', 'projection contract must own local projection display limits');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'projectSurface.projectionDisplayLimits', 'projection contract generator must validate projection display limits');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_PROJECTION_DISPLAY_LIMITS', 'official generated contract must export projection display limits');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_PROJECTION_DISPLAY_LIMITS', 'prototype generated contract must export projection display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS', 'Official projection panels must consume generated projection display limits');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_PROJECTION_DISPLAY_LIMITS', 'Browser prototype projection panels must consume generated projection display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.taskGraph.parallelPolicy', 'Official TaskGraph panel must disclose Station projected parallel policy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "project.taskGraph.parallelPolicy === 'integrator_required'", 'Official TaskGraph panel must disclose integrator-required boundary');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'visibleRootTaskIds', 'Official TaskGraph panel must disclose Station projected root task ids');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'hiddenRootTaskIdCount', 'Official TaskGraph panel must disclose hidden root task id count');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'visibleEdges', 'Official TaskGraph panel must disclose Station projected dependency edges');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'hiddenEdgeCount', 'Official TaskGraph panel must disclose hidden dependency edge count');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'visibleNodeArtifactIds', 'Official TaskGraph node row must disclose Station projected artifact refs');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'hiddenNodeArtifactCount', 'Official TaskGraph node row must disclose hidden artifact ref count');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'visibleNodeGateIds', 'Official TaskGraph node row must disclose Station projected gate refs');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'hiddenNodeGateCount', 'Official TaskGraph node row must disclose hidden gate ref count');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes', 'Official TaskGraph panel node display limit must derive from generated contract');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems', 'Official Project Health compact lists must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.legacyTodos', 'Official legacy Todo fallback limit must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities', 'Official provider capability compact list must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices', 'Official negotiation voice compact list must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.diffPaths', 'Official diff path compact list must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.contextFileRefs', 'Official context file refs limit must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.contextOtherRefs', 'Official context other-ref limit must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.sidePanelArtifacts', 'Official side-panel artifact limit must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.artifactPaths', 'Official artifact path compact list must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.safeTextPreviewLines', 'Official safe text preview line limit must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.gateItems', 'Official gate panel item limit must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.gateChecks', 'Official gate check compact list must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.gateArtifactRefs', 'Official gate artifact-ref compact list must derive from generated display limits');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleNodes = nodes.slice(0, 5);', 'Official TaskGraph panel must not hardcode node display limit');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleTodos = todos.slice(0, 5);', 'Official legacy Todo fallback must not hardcode display limit');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleBlockers = project.openBlockers.slice(0, 3);', 'Official Project Health blocker limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleCapabilities = capabilities.slice(0, 5);', 'Official provider capability display limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleVoices = voices.slice(0, 4);', 'Official negotiation voice display limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleFileRefs = fileRefs.slice(0, 4);', 'Official context file ref display limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleOtherRefs = otherRefs.slice(0, 3);', 'Official context other-ref display limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleArtifacts = artifacts.slice(0, 4);', 'Official artifact panel display limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visiblePaths = paths.slice(0, 5);', 'Official diff/artifact path display limits must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const lines = allLines.slice(0, 80);', 'Official safe text preview line limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleGates = gates.slice(0, 4);', 'Official gate panel display limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleChecks = gate.checks?.slice(0, 3) ?? [];', 'Official gate check display limit must not be hardcoded');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const visibleGateArtifactIds = gate.artifactIds?.slice(0, 4) ?? [];', 'Official gate artifact-ref display limit must not be hardcoded');
expectIncludes(files.officialFrontendEnLocale, contents.officialFrontendEnLocale, 'Integrator identity and merge execution remain Station-owned', 'Official TaskGraph integrator disclosure must keep execution Station-owned');
expectIncludes(files.officialFrontendEnLocale, contents.officialFrontendEnLocale, 'more Station TaskGraph dependency edges hidden', 'Official TaskGraph dependency edge overflow disclosure is required');
expectIncludes(files.officialFrontendEnLocale, contents.officialFrontendEnLocale, 'more artifact refs', 'Official TaskGraph node artifact ref overflow disclosure is required');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official TaskGraph panel must stay read-only Station projection and must not expose scheduling/execution/replan capabilities', 'official frontend gate must prove TaskGraph remains read-only projection only');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierDefectProjection', 'official projection guard must validate defect projection');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'package peers_touch.model.atelier.v1;', 'formal Atelier projection proto package');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierProjectionSnapshot', 'formal projection snapshot proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierProjectionEvent', 'formal projection event proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierProjectionPatch', 'formal projection patch proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'repeated AtelierAppletMethodIntent method_intents = 7;', 'formal projection contract proto must expose applet method intent metadata');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'message AtelierAppletMethodIntent', 'formal applet method intent proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'string intent_owner = 2;', 'formal method intent proto must expose intent owner');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'string side_effect_class = 4;', 'formal method intent proto must expose side effect class');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'bool execution_forbidden = 5;', 'formal method intent proto must fail closed on applet-visible execution ownership');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierAgentRoleAuthority agent_role_authority = 8;', 'formal projection contract proto must expose AgentRole authority metadata');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'enum AtelierAgentRole', 'formal projection contract proto must expose Atelier AgentRole enum');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'ATELIER_AGENT_ROLE_GOAL_OWNER = 1;', 'formal AgentRole enum must expose goal_owner role');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'ATELIER_AGENT_ROLE_HISTORIAN = 9;', 'formal AgentRole enum must expose historian role');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'message AtelierAgentRoleAuthority', 'formal projection contract proto must expose AgentRole authority matrix');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'repeated AtelierAgentRole terminal_signoff_roles = 2;', 'formal AgentRole authority proto must expose terminal signoff roles');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'repeated AtelierAgentRole judgment_forbidden_roles = 6;', 'formal AgentRole authority proto must expose judgment forbidden roles');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'bool applet_may_execute_authority = 10;', 'formal AgentRole authority proto must preserve applet no-execute boundary');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierArtifactPreviewTargetProjection preview_target = 13;', 'formal artifact projection proto must expose preview target metadata');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'message AtelierArtifactPreviewTargetProjection', 'formal artifact preview target metadata proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'string sandbox_ref = 4;', 'formal artifact preview target proto must expose sandbox ref metadata');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'string body_ref = 5;', 'formal artifact preview target proto must expose body ref metadata');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierWorkspaceOpenTarget', 'formal workspace open target proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierProjectProjection', 'formal project projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierProjectCompletionProjection', 'formal project completion projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierBlockerProjection', 'formal blocker projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierResidualRiskProjection', 'formal residual risk projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierMemoryCandidateProjection', 'formal memory candidate projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierMilestoneTreeProjection', 'formal milestone tree projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierTaskGraphProjection', 'formal task graph projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierDependencyEdgeProjection', 'formal dependency edge projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierPolicyProjection', 'formal policy projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierDefectProjection', 'formal defect projection proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'goal_owner_signoff', 'formal project projection must expose goal owner signoff');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'open_blockers', 'formal project projection must expose blocker refs/projections');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'residual_risks', 'formal project projection must expose residual risks');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'memory_candidates', 'formal project projection must expose memory candidates');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'AtelierProviderCapabilitiesResponse', 'formal provider capabilities response proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'SubmitAtelierFeedbackResponse', 'formal feedback response proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'requires_confirmation', 'formal feedback policy hint must expose confirmation-required flag');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'confirmation_mode', 'formal feedback policy hint must expose confirmation mode');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'repeated string feeds = 5;', 'formal feedback policy hint must expose MemoryCandidate.feeds');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'OpenAtelierWorkspaceResponse', 'formal workspace open response proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'FetchAtelierArtifactBodyRequest', 'formal artifact body fetch request proto');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'FetchAtelierArtifactBodyResponse', 'formal artifact body fetch response proto');
expectNotIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'provider_invoke', 'formal projection proto must not expose provider invoke');
expectNotIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'memory_write', 'formal projection proto must not expose memory write');
expectNotIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'file_uri', 'formal projection proto must not expose file URI');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'package ateliermodel', 'generated Station Atelier projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'MethodIntents      []*AtelierAppletMethodIntent', 'generated Station projection contract Go proto must expose applet method intent metadata');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'func (x *AtelierProjectionContract) GetMethodIntents() []*AtelierAppletMethodIntent', 'generated Station projection contract Go proto must expose method intent getter');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'type AtelierAppletMethodIntent struct', 'generated Station applet method intent Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'IntentOwner        string', 'generated Station method intent proto must expose intent owner');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'SideEffectClass    string', 'generated Station method intent proto must expose side effect class');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'ExecutionForbidden bool', 'generated Station method intent proto must expose execution forbidden guard');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AgentRoleAuthority *AtelierAgentRoleAuthority', 'generated Station projection contract Go proto must expose AgentRole authority metadata');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'type AtelierAgentRole int32', 'generated Station Atelier AgentRole enum');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierAgentRole_ATELIER_AGENT_ROLE_GOAL_OWNER', 'generated Station AgentRole enum must expose goal_owner');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierAgentRole_ATELIER_AGENT_ROLE_HISTORIAN', 'generated Station AgentRole enum must expose historian');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'type AtelierAgentRoleAuthority struct', 'generated Station AgentRole authority matrix proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'TerminalSignoffRoles      []AtelierAgentRole', 'generated Station AgentRole authority must expose terminal signoff roles');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'JudgmentForbiddenRoles    []AtelierAgentRole', 'generated Station AgentRole authority must expose judgment forbidden roles');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AppletMayExecuteAuthority bool', 'generated Station AgentRole authority must preserve applet no-execute boundary');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierProjectProjection', 'generated Station project projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierBlockerProjection', 'generated Station blocker projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierResidualRiskProjection', 'generated Station residual risk projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierMilestoneTreeProjection', 'generated Station milestone tree projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierTaskGraphProjection', 'generated Station task graph projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierPolicyProjection', 'generated Station policy projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'AtelierDefectProjection', 'generated Station defect projection Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'PreviewTarget *AtelierArtifactPreviewTargetProjection', 'generated Station artifact projection Go proto must expose preview target metadata');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'func (x *AtelierArtifactProjection) GetPreviewTarget() *AtelierArtifactPreviewTargetProjection', 'generated Station artifact projection Go proto must expose preview target getter');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'type AtelierArtifactPreviewTargetProjection struct', 'generated Station artifact preview target metadata Go proto');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'SandboxRef    string', 'generated Station preview target proto must expose sandbox ref metadata');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'BodyRef       string', 'generated Station preview target proto must expose body ref metadata');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'GetGoalOwnerSignoff', 'generated Station project signoff getter');
expectIncludes(files.atelierProjectionProtoGo, contents.atelierProjectionProtoGo, 'GetNoOpenBlockers', 'generated Station completion predicate getter');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierProjectionSnapshot', 'generated Desktop Atelier projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'methodIntents: AtelierAppletMethodIntent[];', 'generated Desktop projection contract TS proto must expose applet method intent metadata');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'export type AtelierAppletMethodIntent', 'generated Desktop applet method intent TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'intentOwner: string;', 'generated Desktop method intent proto must expose intent owner');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'sideEffectClass: string;', 'generated Desktop method intent proto must expose side effect class');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'executionForbidden: boolean;', 'generated Desktop method intent proto must expose execution forbidden guard');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierAppletMethodIntentSchema', 'generated Desktop applet method intent schema');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'agentRoleAuthority?: AtelierAgentRoleAuthority | undefined;', 'generated Desktop projection contract TS proto must expose AgentRole authority metadata');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'export enum AtelierAgentRole', 'generated Desktop Atelier AgentRole enum');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'ATELIER_AGENT_ROLE_GOAL_OWNER = 1;', 'generated Desktop AgentRole enum must expose goal_owner');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'ATELIER_AGENT_ROLE_HISTORIAN = 9;', 'generated Desktop AgentRole enum must expose historian');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'export type AtelierAgentRoleAuthority', 'generated Desktop AgentRole authority matrix proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'terminalSignoffRoles: AtelierAgentRole[];', 'generated Desktop AgentRole authority must expose terminal signoff roles');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'judgmentForbiddenRoles: AtelierAgentRole[];', 'generated Desktop AgentRole authority must expose judgment forbidden roles');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'appletMayExecuteAuthority: boolean;', 'generated Desktop AgentRole authority must preserve applet no-execute boundary');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierAgentRoleAuthoritySchema', 'generated Desktop AgentRole authority schema');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierProjectProjectionSchema', 'generated Desktop project projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierBlockerProjectionSchema', 'generated Desktop blocker projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierResidualRiskProjectionSchema', 'generated Desktop residual risk projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierMilestoneTreeProjectionSchema', 'generated Desktop milestone tree projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierTaskGraphProjectionSchema', 'generated Desktop task graph projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierPolicyProjectionSchema', 'generated Desktop policy projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierDefectProjectionSchema', 'generated Desktop defect projection TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'previewTarget?: AtelierArtifactPreviewTargetProjection | undefined;', 'generated Desktop artifact projection TS proto must expose preview target metadata');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'export type AtelierArtifactPreviewTargetProjection', 'generated Desktop artifact preview target metadata TS proto');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'sandboxRef: string;', 'generated Desktop preview target proto must expose sandbox ref metadata');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'bodyRef: string;', 'generated Desktop preview target proto must expose body ref metadata');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'AtelierArtifactPreviewTargetProjectionSchema', 'generated Desktop artifact preview target schema');
expectIncludes(files.atelierProjectionProtoTs, contents.atelierProjectionProtoTs, 'noOpenBlockers', 'generated Desktop completion predicate field');

for (const method of contract.methods) {
  if (contract.runtimeMethods.includes(method)) {
    expectIncludes(files.tsProjection, contents.tsProjection, method);
  }
  expectIncludes(files.manifest, contents.manifest, method);
  expectIncludes(files.capability, contents.capability, method);
}
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, './serviceClient', 'official frontend must use Atelier service client for HTTP service binding');
for (const [method, serviceCall] of officialFrontendServiceMethods.entries()) {
  expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, serviceCall, `official frontend service binding for ${method}`);
  expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, `sdk.invoke<unknown>('${method}'`, `official frontend direct invoke for ${method}`);
  expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, `sdk.invoke<unknown>("${method}"`, `official frontend direct invoke for ${method}`);
}
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, '/v1/workspace` through the Station-bundled `atelier` service binding', 'official applet README must describe workspace load as Station-bundled service binding');
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'After `/v1/workspace` service load', 'official applet README must document replay cursor after service workspace load');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'official applet product unit 已落在 `apps/applets/atelier/`', 'prototype README must point at the current official applet product unit path');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '不是一套独立草案协议', 'prototype README must not describe prototype projection.ts as a standalone draft protocol');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`atelier-projection/v0` product-unit contract 对齐下的联调契约', 'prototype README must describe projection as the current v0 product-unit contract alignment');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'product-unit contract + formal proto + generated schema/TS constants + gate 对齐', 'prototype README must describe the current v0 contract evidence boundary');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`projectSurface` 与 `workbenchSurface` 机器契约', 'prototype README must document contract-backed project/workbench projection taxonomy');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'prototype 不再维护这些本地 allowlist', 'prototype README must document generated allowlist ownership');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'official 也不再用 string-only 宽松校验替代 contract-backed enum', 'prototype README must document official ingress enum hardening');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'GET /v1/workspace` service binding', 'prototype README must document workspace load as service binding');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'provider discovery、feedback、workspace open、artifact body/preview 与 events subscribe 仍是 Host capability', 'prototype README must keep Host capability scope separate from service-bound workspace load');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '通过 product-window E2E launch options 触发 `atelier.events.subscribe`', 'prototype README must document product-window projection subscribe evidence boundary');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '受控 pre-replay / post-first-replay SSE close 后的 cursor replay 序列', 'prototype README must document product-window controlled reconnect cursor replay evidence boundary');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'cross-restart cursor recovery', 'prototype README must keep cross-restart cursor recovery outside the current product-window gate claim');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'applet-side rendered state assertion after projection event delivery', 'prototype README must describe product-window projection rendered-state evidence boundary');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, 'packages/applets/atelier/', 'prototype README stale official applet product unit path');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, '作为联调数据契约草案', 'prototype README stale standalone projection draft wording');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, '当前 projection 仍是联调草案', 'prototype README stale projection draft wording');
expectNotIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'atelier.workspace.load', 'official applet README stale workspace load capability wording');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, 'atelier.workspace.load', 'prototype README stale workspace load capability wording');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_PROJECTION_SUBSCRIPTION_METHOD', 'official frontend client must consume generated projection subscription method');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateEventSubscription(value.eventSubscription)', 'projection contract generator must validate event subscription source priority contract');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'eventSubscription: source.eventSubscription', 'projection contract generator must emit eventSubscription into generated TypeScript contract');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_PROJECTION_EVENT_TOPIC = ATELIER_PROJECTION_CONTRACT.eventTopic', 'projection contract generator must export projection event topic');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_PROJECTION_SUBSCRIPTION_METHOD = ATELIER_PROJECTION_CONTRACT.subscriptionMethod', 'projection contract generator must export projection subscription method');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_PROJECTION_EVENT_TOPIC', 'official generated contract must export projection event topic');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_PROJECTION_SUBSCRIPTION_METHOD', 'official generated contract must export projection subscription method');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, '"eventSubscription": {', 'official generated contract must include projection eventSubscription source priority contract');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_PROJECTION_EVENT_TOPIC', 'prototype generated contract must export projection event topic');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_PROJECTION_SUBSCRIPTION_METHOD', 'prototype generated contract must export projection subscription method');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, '"eventSubscription": {', 'prototype generated contract must include projection eventSubscription source priority contract');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_PROJECTION_CONTRACT.eventSubscription.agentIdSourcePriority', 'official frontend must derive projection stream agentId source order from generated eventSubscription contract');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority', 'official frontend must derive projection stream taskId source order from generated eventSubscription contract');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'projectionAgentIdResolvers', 'official frontend must centralize projection stream agentId source resolvers');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'projectionTaskIdResolvers', 'official frontend must centralize projection stream taskId source resolvers');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'return agentIdsFromSource(source)[0]', 'official frontend projection stream agentId fallback must not be a hidden first-agent implementation detail');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "return snapshot?.selectedTaskId || snapshot?.workspace.tasks[0]?.id || ''", 'official frontend projection stream taskId fallback order must come from eventSubscription contract');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'projectionAfterEventSeqFromSnapshot', 'official frontend must derive subscribe cursor from projection replay');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'workspace.replay?.[taskId]?.nextEventSeq', 'official frontend subscribe cursor must come from workspace.replay nextEventSeq');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'if (afterEventSeq > 0)', 'official frontend must omit zero replay cursor and let Host start from initial replay');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'sdk.invoke(ATELIER_PROJECTION_SUBSCRIPTION_METHOD, streamConfig)', 'official frontend must request Station Atelier stream through generated Host subscription method');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "const ATELIER_PROJECTION_EVENT_TOPIC = 'atelier.projection.event';", 'official frontend must not hardcode projection event topic');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke('atelier.events.subscribe', streamConfig)", 'official frontend must not hardcode Station stream subscription method');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'onMalformedEvent?.(payload)', 'official frontend must surface malformed projection events instead of silently dropping them');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'function safeUnsubscribeAtelierProjectionEventTopic', 'official frontend must centralize projection topic unsubscribe cleanup');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'void sdk.events.unsubscribe(ATELIER_PROJECTION_EVENT_TOPIC).catch', 'official frontend must handle projection topic unsubscribe rejection');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official client must handle projection event topic unsubscribe rejection on subscribe failure and release cleanup', 'official frontend gate must prove unsubscribe rejection cleanup handling');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official projection stream subscribe success', 'official frontend gate must execute successful projection subscription lifecycle');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official projection subscription release must remove local topic handler and request Host unsubscribe', 'official frontend gate must execute projection subscription release cleanup');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official projection stream subscribe rejects', 'official frontend gate must execute rejected projection subscription cleanup');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-after-rejected-official-subscription', 'official frontend gate must prove rejected projection subscription cleanup stops later Host event delivery');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official projection subscribe failure must not keep delivering Host events after local cleanup', 'official frontend gate must assert rejected projection subscription post-event delivery is blocked');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Official subscription cleanup 当前有 controlled/local evidence', 'prototype README must document official subscription cleanup controlled evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'safeUnsubscribeAtelierProjectionEventTopic()', 'prototype README must name official safe unsubscribe helper');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'reject 后的 Host event 不会进入 official handler', 'prototype README must document official rejected subscription cleanup blocks later Host event delivery');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '不等于真实跨重启 cursor-based replay、任意网络故障恢复或真实 product window E2E', 'prototype README must keep subscription cleanup evidence scoped below real E2E');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'void sdk.events.unsubscribe(ATELIER_PROJECTION_EVENT_TOPIC);', 'official frontend raw fire-and-forget projection topic unsubscribe');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'subscriptionAfterEventSeq', 'official controller subscription effect must key on replay cursor');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, '[hasSnapshot, subscriptionTaskId, subscriptionAfterEventSeq]', 'official controller must not resubscribe on ordinary snapshot object churn');
expectIncludes(files.officialFrontendControllerTransitions, contents.officialFrontendControllerTransitions, 'export function stateFromAtelierEventStreamConnecting', 'Official controller stream connecting transition must live in a pure helper');
expectIncludes(files.officialFrontendControllerTransitions, contents.officialFrontendControllerTransitions, "eventStreamState: 'subscribing'", 'Official controller stream connecting helper must enter subscribing/reconciling state');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'stateFromAtelierEventStreamConnecting()', 'official controller must enter reconciling state while reconnecting projection stream');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'stateFromMalformedAtelierProjectionEvent()', 'official controller must degrade on malformed projection events');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'applyAtelierProjectionEventWithResult(current, event)', 'official controller must consume reducer apply outcomes before marking event stream live');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, "result.outcome === 'stale' || result.outcome === 'unknown-task'", 'official controller must degrade stale or unknown-task projection events instead of reporting live');
expectIncludes(files.officialFrontendEventGuard, contents.officialFrontendEventGuard, "eventStreamState: 'degraded'", 'official malformed event guard must mark stream degraded');
expectIncludes(files.officialFrontendEventGuard, contents.officialFrontendEventGuard, "eventStreamErrorKind: 'invalid-projection'", 'official malformed event guard must classify malformed event as invalid projection');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'stateFromMalformedAtelierProjectionEvent', 'official frontend gate must prove malformed event degraded state');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Official malformed / rejected projection event handling 当前有 controlled/local evidence', 'prototype README must document official malformed/rejected event handling evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'applied / duplicate / stale / unknown-task', 'prototype README must document official reducer rejected-event outcome taxonomy');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '不会在 stale seq 或 unknown-task scope rejected event 后误报 `live`', 'prototype README must document official rejected projection events do not restore live status');
for (const [method, payload] of Object.entries(contract.methodPayloads ?? {})) {
  if (contract.runtimeMethods.includes(method) && !officialFrontendServiceMethods.has(method)) {
    expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, method, `method payload source ${method}`);
  }
  for (const field of payload.requiredFields ?? []) {
    if (contract.runtimeMethods.includes(method)) {
      expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, field, `frontend payload field ${method}.${field}`);
    }
    expectIncludes(files.goProjection, contents.goProjection, field, `Station payload field ${method}.${field}`);
  }
  for (const field of payload.optionalFields ?? []) {
    const needle = field.split('.').at(-1);
    if (contract.runtimeMethods.includes(method)) {
      expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, needle, `frontend optional payload field ${method}.${field}`);
    }
    expectIncludes(files.goProjection, contents.goProjection, needle, `Station optional payload field ${method}.${field}`);
  }
  for (const status of payload.allowedStatus ?? []) {
    if (method !== 'atelier.task.setStatus') {
      expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, status, `frontend status ${method}.${status}`);
    }
    expectIncludes(files.goProjection, contents.goProjection, status, `Station status ${method}.${status}`);
  }
  if (payload.requiresStatus) {
    expectIncludes(files.goProjection, contents.goProjection, payload.requiresStatus, `Station required status ${method}.${payload.requiresStatus}`);
  }
}

for (const action of contract.gatewayActions) {
  expectIncludes(files.rustGateway, contents.rustGateway, action, `atelier action ${action}`);
}

for (const patchKind of contract.patchKinds) {
  const protoEnumName = `ATELIER_PROJECTION_PATCH_KIND_${patchKind.toUpperCase().replaceAll('.', '_')}`;
  expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, protoEnumName, `formal proto patch kind ${patchKind}`);
  expectIncludes(files.tsProjection, contents.tsProjection, patchKind, `patch kind ${patchKind}`);
  expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, patchKind, `patch kind ${patchKind}`);
  if (patchKind !== 'snapshot' && patchKind !== 'task.upsert' && patchKind !== 'task.status' && patchKind !== 'context.replace' && patchKind !== 'todo.replace') {
    expectIncludes(files.goProjection, contents.goProjection, patchKind, `patch kind ${patchKind}`);
    expectIncludes(files.rustGateway, contents.rustGateway, patchKind, `patch kind ${patchKind}`);
  }
}
const nonSnapshotPatchKinds = contract.patchKinds.filter((patchKind) => patchKind !== 'snapshot');
expectExactPatchCaseSet(files.officialFrontendProjectionReducer, contents.officialFrontendProjectionReducer, 'applyAtelierProjectionPatch', nonSnapshotPatchKinds);
expectExactPatchCaseSet(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'applyPatch', nonSnapshotPatchKinds);
expectIncludes(files.officialFrontendProjectionReducer, contents.officialFrontendProjectionReducer, "if (patch.kind === 'snapshot') return cloneSnapshot(patch.snapshot);", 'official projection reducer must handle snapshot patch before non-snapshot exhaustive switch');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "if (patch.kind === 'snapshot') return toRuntimeSnapshot(patch.snapshot);", 'prototype bridge runtime must handle snapshot patch before non-snapshot exhaustive switch');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'exact 比对 contract `patchKinds` 与两侧 non-snapshot handler cases', 'prototype README must document exact patch-kind handler guard');

expectIncludes(files.rustGateway, contents.rustGateway, contract.eventTopic, 'projection event topic');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_PROJECTION_EVENT_TOPIC', 'official frontend client must consume generated projection event topic');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'loadAtelierProviderCapabilities', 'Official frontend provider capability discovery client');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke<unknown>('atelier.provider.capabilities'", 'Official frontend provider capability discovery must use Host capability');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierProviderCapabilitiesResponse', 'Official frontend provider capability discovery must validate Host response shape');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.source)', 'Official frontend provider capabilities response guard must reject empty source');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.id)', 'Official frontend provider capability guard must reject empty id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.label)', 'Official frontend provider capability guard must reject empty label');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.description)', 'Official frontend provider capability guard must reject empty description');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.slashCommand)', 'Official frontend provider capability guard must reject empty slash command');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.providerKind)', 'Official frontend provider capability guard must reject empty provider kind');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_PROVIDER_CAPABILITY_SCOPES', 'Official frontend provider capability guard must consume generated capability scope taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierProviderCapabilityScope = (typeof ATELIER_PROVIDER_CAPABILITY_SCOPES)[number];', 'Official frontend provider capability API type must derive scope from generated taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierProviderCapabilityReadOnly = typeof ATELIER_PROVIDER_CAPABILITY_READ_ONLY;', 'Official frontend provider capability API type must derive read-only marker from generated contract');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'scope: AtelierProviderCapabilityScope;', 'Official frontend provider capability interface must expose generated-derived scope type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'readOnly: AtelierProviderCapabilityReadOnly;', 'Official frontend provider capability interface must expose generated-derived read-only marker type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierProviderCapabilityScope(record.scope)', 'Official frontend provider capability guard must validate scope through generated taxonomy helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.readOnly === ATELIER_PROVIDER_CAPABILITY_READ_ONLY', 'Official frontend provider capability guard must consume generated read-only marker');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "record.scope === 'station-provider'", 'Official frontend provider capability guard must not hardcode station-provider scope');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.readOnly === true', 'Official frontend provider capability guard must not hardcode read-only marker');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'scope: string;', 'Official frontend provider capability interface must not widen generated scope to string');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'readOnly: boolean;', 'Official frontend provider capability interface must not widen generated read-only marker to boolean');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'skills.invoke', 'Official frontend must not invoke skills directly for Atelier provider capabilities');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'atelier.provider.invoke', 'Official frontend must not expose provider invoke');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'submitAtelierFeedback', 'Official frontend feedback submit client');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'onSubmitFeedback', 'Official frontend feedback bar must submit Station-owned feedback intent');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'openAtelierWorkspace', 'Official frontend workspace open client');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke<unknown>('atelier.workspace.open'", 'Official frontend workspace open must use Host capability');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierWorkspaceOpenResponse', 'Official frontend workspace open must validate Host response shape');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'function isAtelierWorkspaceUri', 'Official frontend workspace open response must strictly guard workspace URI shape');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_WORKSPACE_OPEN_URI_SCHEMES', 'Official frontend workspace open response guard must consume generated URI scheme taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_WORKSPACE_OPEN_URI_SHAPE', 'Official frontend workspace open response guard must consume generated URI shape descriptor');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierWorkspaceOpenUriScheme(uri.protocol.slice(0, -1))', 'Official frontend workspace open response guard must validate protocol through generated scheme helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'uri.hostname === shape.host', 'Official frontend workspace open response guard must validate host through generated shape descriptor');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'uri.searchParams.getAll(shape.workspaceQueryKey)', 'Official frontend workspace open response guard must read workspace query through generated shape descriptor');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'taskPath.length === shape.taskPathSegments', 'Official frontend workspace open response guard must validate path segment count through generated shape descriptor');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "uri.protocol === 'pt-workspace:'", 'Official frontend workspace open response guard must not hardcode pt-workspace protocol');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "uri.hostname === 'task'", 'Official frontend workspace open response guard must not hardcode workspace URI host');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "uri.searchParams.getAll('workspace')", 'Official frontend workspace open response guard must not hardcode workspace query key');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.mode)', 'Official frontend workspace open response guard must reject empty mode');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.reason)', 'Official frontend workspace open response guard must reject empty reason');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'workspaceOpenTarget', 'Official frontend task projection must include workspace open target');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isAtelierWorkspaceUri', 'Official frontend must strictly guard workspace URI shape');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_WORKSPACE_OPEN_URI_SCHEMES', 'Official frontend projection workspace URI guard must consume generated URI scheme taxonomy');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_WORKSPACE_OPEN_URI_SHAPE', 'Official frontend projection workspace URI guard must consume generated URI shape descriptor');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierWorkspaceOpenUriScheme(uri.protocol.slice(0, -1))', 'Official frontend projection workspace URI guard must validate protocol through generated scheme helper');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'uri.hostname === shape.host', 'Official frontend projection workspace URI guard must validate host through generated shape descriptor');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'uri.searchParams.getAll(shape.workspaceQueryKey)', 'Official frontend projection workspace URI guard must read workspace query through generated shape descriptor');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'taskPath.length === shape.taskPathSegments', 'Official frontend projection workspace URI guard must validate path segment count through generated shape descriptor');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "uri.protocol === 'pt-workspace:'", 'Official frontend projection workspace URI guard must not hardcode pt-workspace protocol');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "uri.hostname === 'task'", 'Official frontend projection workspace URI guard must not hardcode workspace URI host');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "uri.searchParams.getAll('workspace')", 'Official frontend projection workspace URI guard must not hardcode workspace query key');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierWorkspaceOpenTarget(value.workspaceOpenTarget, value.id)', 'Official frontend workspace open target must bind URI task segment to enclosing task id');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'taskPath[0] === taskId', 'Official frontend workspace URI guard must reject mismatched task segment');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "workspaceParams[0] === workspaceId", 'Official frontend must bind workspace URI query to workspaceId');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isWorkspaceUri', 'prototype projection must strictly guard workspace URI shape');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_WORKSPACE_OPEN_URI_SCHEMES', 'prototype projection workspace URI guard must consume generated URI scheme taxonomy');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_WORKSPACE_OPEN_URI_SHAPE', 'prototype projection workspace URI guard must consume generated URI shape descriptor');
expectIncludes(files.tsProjection, contents.tsProjection, 'isWorkspaceOpenUriScheme(uri.protocol.slice(0, -1))', 'prototype projection workspace URI guard must validate protocol through generated scheme helper');
expectIncludes(files.tsProjection, contents.tsProjection, 'uri.hostname === shape.host', 'prototype projection workspace URI guard must validate host through generated shape descriptor');
expectIncludes(files.tsProjection, contents.tsProjection, 'uri.searchParams.getAll(shape.workspaceQueryKey)', 'prototype projection workspace URI guard must read workspace query through generated shape descriptor');
expectIncludes(files.tsProjection, contents.tsProjection, 'taskPath.length === shape.taskPathSegments', 'prototype projection workspace URI guard must validate path segment count through generated shape descriptor');
expectNotIncludes(files.tsProjection, contents.tsProjection, "uri.protocol === 'pt-workspace:'", 'prototype projection workspace URI guard must not hardcode pt-workspace protocol');
expectNotIncludes(files.tsProjection, contents.tsProjection, "uri.hostname === 'task'", 'prototype projection workspace URI guard must not hardcode workspace URI host');
expectNotIncludes(files.tsProjection, contents.tsProjection, "uri.searchParams.getAll('workspace')", 'prototype projection workspace URI guard must not hardcode workspace query key');
expectIncludes(files.tsProjection, contents.tsProjection, 'isWorkspaceOpenTarget(value.workspaceOpenTarget, value.id)', 'prototype projection must bind workspace open target to task id');
expectIncludes(files.tsProjection, contents.tsProjection, 'taskPath[0] === taskId', 'prototype workspace URI guard must reject mismatched task segment');
expectIncludes(files.tsProjection, contents.tsProjection, "workspaceParams[0] === workspaceId", 'prototype projection must bind workspace URI query to workspaceId');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'WorkspaceOpenButton', 'Official frontend workspace open UI');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'controller.openWorkspace', 'Official frontend must route Open in IDE through controller intent');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.workspace.openBoundary', 'Official frontend workspace open UI must disclose Host-intent-only boundary');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'atelier.workspace.openBoundary', 'Official frontend gate must require workspace open boundary locale');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'pt-workspace://', 'Official frontend gate must require workspace open boundary to mention pt-workspace scheme');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "flexDirection: 'column', minHeight: px(0)", 'Official frontend shell must stack rail/stream/right projection sections for controlled single-column readiness');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "minWidth: px(0), padding: px(12), width: '100%'", 'Official frontend left rail must be safe for narrow single-column surfaces');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "minWidth: px(0), width: '100%'", 'Official frontend projection sections must be safe for narrow single-column surfaces');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "flexDirection: 'column', minHeight: px(0)", 'Official frontend gate must pin controlled single-column layout readiness');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'minWidth: px(360)', 'Official frontend stream column must not force desktop minimum width in single-column mode');
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'controlled single-column', 'Official applet README must describe current single-column projection surface');
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'run target selector', 'Official applet README must describe current run target selector');
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'Station-owned intents', 'Official applet README must keep run target boundary as Station-owned intent');
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'Host-owned safe text / sandbox manifest intents', 'Official applet README must describe official artifact preview rendering boundary');
expectNotIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'three-rail', 'Official applet README must not describe stale three-rail layout');
expectNotIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'model intent selector', 'Official applet README must not describe stale model-only selector');
expectNotIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'URL/source strings may be rendered', 'Official applet README must not imply raw URL/source rendering');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'controlled single-column projection surface', 'Prototype README official bundle section must describe current single-column official surface');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'controlled single-column projection UI', 'Prototype README official bundle evidence must describe current controlled single-column UI');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'UNSYNCED with official single-column product shape', 'Prototype README must explicitly mark browser rails as unsynced with official single-column product shape');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'official Lynx applet 当前使用 controlled single-column projection sections', 'Prototype README must distinguish official Lynx shape from browser prototype rails');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'budget、run target 与 replay metadata', 'Prototype README official bundle section must describe current run target metadata');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'negotiation folded disclosure + role/stance rendering', 'Prototype README official bundle section must describe current negotiation disclosure parity');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'new task create-from-goal run target intent', 'Prototype README official bundle section must describe current run target create intent');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'UNSYNCED：New task 的目标产品语义仍是先创建 `Project{state:draft}`', 'Prototype README must mark current New task shortcut as unsynced with draft Project target flow');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '当前 controlled shortcut，不是正式 draft Project E2E', 'Prototype README must not claim New task draft Project E2E is complete');
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'as a create-from-goal shortcut', 'Official applet README must describe current New task createFromGoal path as a shortcut');
expectIncludes(files.officialAppletReadme, contents.officialAppletReadme, 'not the target draft Project flow', 'Official applet README must not claim New task draft Project flow is complete');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, '新建 `Project{state:draft}` 🅟 原型只建 `Task`', 'UI mapping must preserve New task target draft Project vs prototype shortcut distinction');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, '原型直接建可对话的 Task，跳过了 draft Project', 'UI mapping must keep current New task shortcut gap explicit');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Official / browser TaskGraph parallel policy disclosure 当前有 controlled/local evidence', 'Prototype README must document TaskGraph parallel policy visibility evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'rootTaskIds` 与 `edges` 紧凑列表', 'Prototype README must document TaskGraph roots/edges visibility evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'node-level `artifactIds` / `gateIds`', 'Prototype README must document TaskGraph node evidence ref visibility evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'integrator identity 与 merge execution 仍归 Station', 'Prototype README must keep TaskGraph integrator execution Station-owned');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'URI task segment 与承载该 target 的 task id 一致', 'Prototype README must document workspace open task id binding');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, '三栏信息架构', 'Prototype README must not describe stale three-column official layout');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, '顶栏展示 budget / model', 'Prototype README must not describe stale model-only topbar');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, 'new task create-from-goal/model intent', 'Prototype README must not describe stale model-only create intent');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'controlled single-column projection surface', 'Functional modules plan must describe current single-column applet surface');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'conversation-first projection surface', 'Functional modules plan must describe current conversation-first prototype surface');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '当前 official applet 的实现口径', 'Functional modules plan must scope single-column product shape to the official applet');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'UNSYNCED with official single-column product shape', 'Functional modules plan must explicitly mark browser rails as unsynced with official single-column product shape');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '不能反推 official applet 采用三栏', 'Functional modules plan must prevent browser prototype rails from redefining official shape');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Task organizer：项目/任务 folders + flat list + lifecycle sections', 'Functional modules plan wireframe must show current task organizer section');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Projection stream：用户输入、Agent 回复、协商折叠行、Decision、Artifact 卡', 'Functional modules plan wireframe must show current projection stream section');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Project Health：completion / blockers / risks / milestones / policies', 'Functional modules plan wireframe must show current Project Health section');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Context / Artifacts / Gates：只读 Station projection + Host-owned intents', 'Functional modules plan wireframe must keep execution owned outside the applet');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '最小 UI（先把 controlled single-column projection sections 做出来）', 'Functional modules plan minimum UI must use current single-column sections wording');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'read-only projection sections', 'Functional modules plan must keep Atelier as projection sections, not orchestration runtime');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '§1 的三栏界面', 'Functional modules plan must not call the current applet a three-column UI');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '三栏+四种面孔', 'Functional modules plan must not describe the runnable prototype as stale three-column/four-face layout');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '左边是他的项目/任务列表，中间是「当前项目此刻在干什么」，右边是「这群 Agent 是怎么商量出来的 + 产出了什么」', 'Functional modules plan must not describe current product shape as left/middle/right rails');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '上面的宽屏三栏线框只保留为历史草图', 'Functional modules plan must not keep a three-column wireframe in the current shape section');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '当前 official applet 与可运行原型的实现口径', 'Functional modules plan must not claim browser prototype rails share the official product shape');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '### 1.3 中栏的四种面孔', 'Functional modules plan must not title current projection stream as center-column four faces');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '### 1.4 右栏：让「多 Agent 协商」看得见', 'Functional modules plan must not title current collaboration visibility as a right rail');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '最小 UI（先把四种面孔之③④ + 全局条 + 右栏做出来）', 'Functional modules plan minimum UI must not regress to four-face/right-rail wording');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, '具备三栏 projection UI', 'Prototype README official bundle evidence must not describe a stale three-column projection UI');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'workspace.projects[].taskGraph.parallelPolicy', 'UI mapping must track TaskGraph parallel policy projection');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'workspace.projects[].taskGraph.rootTaskIds[]', 'UI mapping must track TaskGraph root id projection');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'workspace.projects[].taskGraph.edges[]', 'UI mapping must track TaskGraph edge projection');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'workspace.projects[].taskGraph.tasks[].artifactIds/gateIds', 'UI mapping must track TaskGraph node artifact/gate refs projection');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, '`integrator_required` 只披露 Station-owned integrator policy', 'UI mapping must keep TaskGraph integrator execution Station-owned');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'Station projection 已产出 `WorkspaceOpenTarget`，official/browser guard 与 Desktop Host `atelier.workspace.open` intent handler 已接入', 'UI mapping must describe current WorkspaceOpenTarget projection and Host intent evidence');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'Station CreateTask/provider plan role allowlist + canonicalization service/static done', 'UI mapping must describe current AgentRole allowlist service/static evidence');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'formal `AtelierAgentRole` proto enum + `AtelierAgentRoleAuthority` matrix schema 已补', 'UI mapping must describe current formal AgentRole proto/schema evidence');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'WorkspaceOpenTarget projection + Desktop Host open intent 已接入', 'UI mapping topbar branch row must not collapse Workspace evidence to stale GAP-11 wording');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'GAP-10 / GAP-09 已在 roadmap 前移并与 B6 熔断 / B9.5 supervisor replan 绑定', 'UI mapping budget/resume section must describe Replan/Resume as already moved into the plan');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'Station `resume_anchor_policy=LATEST_ACCEPTED_CHECKPOINT`、`supervisor_replan` interrupt 与 `atelier.task_graph_diff/v0` apply service/static evidence 已落', 'UI mapping must describe current Resume/Replan service-static evidence');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'GAP-06/GAP-11/GAP-13/GAP-09/GAP-10 已从“缺 schema/需前移”收敛为 projection/service-static evidence 已落', 'UI mapping gap rollup must not keep stale schema/pre-move backlog wording');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'Station DirectRun input_snapshot attachment shape guard 已补，只接受 `host-storage://...` opaque ref + mime/size/sha256 metadata', 'UI mapping must describe current Station DirectRun attachment snapshot shape guard');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Station DirectRun input_snapshot attachment shape guard 已补，只接受 Host-owned opaque ref + metadata', 'Feature matrix must describe current Station DirectRun attachment snapshot shape guard');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Station DirectRun input_snapshot attachment shape guard，只接受 Host-owned opaque ref + metadata', 'Functional modules plan must describe current Station DirectRun attachment snapshot shape guard');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'Host sandbox console capture controlled gate 已补，可规范化 `host_sandbox_cdp` log/warn/error evidence', 'UI mapping must describe current Host sandbox console capture controlled evidence');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Host sandbox console capture controlled gate 已补，可规范化 `host_sandbox_cdp` log/warn/error evidence', 'Feature matrix must describe current Host sandbox console capture controlled evidence');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Host sandbox console capture controlled gate，可规范化 `host_sandbox_cdp` log/warn/error evidence', 'Functional modules plan must describe current Host sandbox console capture controlled evidence');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'Station/Host capability 未落', 'UI mapping must not describe Workspace/Sandbox capability as not landed');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'Station 权力约束未落', 'UI mapping must not describe AgentRole Station role constraints as not landed');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'proto enum / full 权力矩阵与真实 E2E 仍待后续', 'UI mapping must not describe formal AgentRole proto/schema as still missing');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, '| git 分支 ⎇ [Page.tsx#L474](../../../../packages/prototypes/desktop/applets/atelier/src/Page.tsx#L474) | 系统驱动 | 绑定 Workspace | Workspace.branch | — | `F-PR-05` | ⚠️ GAP-11 |', 'UI mapping topbar branch row must not keep stale GAP-11-only wording');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'GAP-10（Resume 应前移并与熔断绑定）、GAP-09（Replan 前移）', 'UI mapping must not describe Replan/Resume pre-move work as still open');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'GAP-09/10（Replan/Resume 前移）', 'UI mapping gap rollup must not keep stale Replan/Resume pre-move wording');
expectIncludes(files.userViewPlan, contents.userViewPlan, 'Artifact metadata projection + Host sandbox intent → `F-CO-07a` / `F-CO-07b`', 'User view must distinguish artifact metadata parity from Host rich runtime');
expectIncludes(files.userViewPlan, contents.userViewPlan, 'WorkspaceOpenTarget / Host open intent 已接入；真实 IDE launch、workspace resolver、sandbox runtime 与 E2E 待验', 'User view must describe current WorkspaceOpenTarget evidence and remaining E2E gap');
expectIncludes(files.userViewPlan, contents.userViewPlan, 'typed payload + route normalization service/static 已落；真实 E2E 未证明', 'User view must describe current escalation payload evidence');
expectIncludes(files.userViewPlan, contents.userViewPlan, '已前移到 B9.5 并接入 supervisor replan interrupt；真实运行时/E2E 待验', 'User view must not describe Replan as wrongly scheduled');
expectIncludes(files.userViewPlan, contents.userViewPlan, '`integrator_required` + Station integrator identity 前置条件已定；真实 merge runtime/E2E 未落', 'User view must describe current Integrator precondition evidence');
expectIncludes(files.userViewPlan, contents.userViewPlan, 'feedback policy feeds 已输出；真实 Planner/Risk/Verifier 反哺消费 E2E 未验', 'User view must describe current memory feedback evidence');
expectNotIncludes(files.userViewPlan, contents.userViewPlan, '`F-PR-05` ⚠️（当前缺口）', 'User view must not describe Workspace/Sandbox as a current unqualified gap');
expectNotIncludes(files.userViewPlan, contents.userViewPlan, '`F-HL-02` ⚠️（当前缺口）', 'User view must not describe escalation payload as a current unqualified gap');
expectNotIncludes(files.userViewPlan, contents.userViewPlan, '`F-CL-08` ⚠️（当前排期错位）', 'User view must not describe Replan as still wrongly scheduled');
expectNotIncludes(files.userViewPlan, contents.userViewPlan, '`F-MM-03` ⚠️（当前缺口）', 'User view must not describe memory feedback as a current unqualified gap');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Station supervisor replan interrupt + `atelier.task_graph_diff/v0` proposal + Goal Owner `replan` apply service/static done', 'Feature matrix F-CL-08 must describe current Station replan service/static evidence');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'GAP-09 | Replan 已前移到 B9.5', 'Feature matrix GAP-09 title must describe current replan placement');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'F-CO-12 | Resume / 恢复锚点 | §1.6, §7.3 | §4 | B6 | ⚠️ roadmap 已前移并与 B6 熔断/accepted anchor 绑定', 'Feature matrix F-CO-12 must describe current Resume B6 placement');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Station `TaskOrchestrationPolicy.resume_anchor_policy=LATEST_ACCEPTED_CHECKPOINT` 与既有 resume lifecycle 已接入；真实跨重启恢复 E2E 待验', 'Feature matrix F-CO-12 must distinguish service/static resume evidence from cross-restart E2E');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'GAP-10 | Resume 已前移并绑定 accepted anchor', 'Feature matrix GAP-10 title must describe current resume placement');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'F-FD-03 | Policy 引擎 | §4.6, §3.2 | §1.5(Policy) / formal proto / Station projection | B7 | ⚠️ 文档契约 + formal proto + read-only projection 已补', 'Feature matrix F-FD-03 must describe current Policy contract/projection evidence');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Station Policy/Defect query index、Project Health read-only projection visibility 与 DirectRun pre-provider hard-deny guard 已有 service/static evidence；完整 Policy engine / Defect governance lifecycle 与真实 E2E 未落', 'Feature matrix F-FD-03 must distinguish current Policy service/static evidence from full Policy engine E2E');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'formal `AtelierAgentRole` proto enum + `AtelierAgentRoleAuthority` matrix schema 已补', 'Feature matrix must describe current formal AgentRole proto/schema evidence');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'F-PR-05 | 工作区 / 沙箱 | §5.1(一句带过) | §1.2(Workspace/Sandbox) / `WorkspaceOpenTarget` | B1', 'Feature matrix F-PR-05 must describe current Workspace/Sandbox B1 placement');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Station projection 已产出 `pt-workspace://` `WorkspaceOpenTarget`，official/browser guard 与 Desktop Host `atelier.workspace.open` intent handler 已接入', 'Feature matrix F-PR-05 must describe current workspace open projection and Host intent evidence');
expectIncludes(files.featureMatrix, contents.featureMatrix, '并行前置条件已收敛为 `integrator_required` + Station integrator identity', 'Feature matrix F-CL-09 must describe current integrator precondition evidence');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'official/prototype TaskGraph projection 已只读展示 `parallelPolicy`', 'Feature matrix GAP-12 must describe TaskGraph parallel policy visibility');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Station blocking gate / supervisor runtime 会生成 typed escalation payload，resolve 侧按 durable payload 做 HumanDecisionRoute normalization', 'Feature matrix F-HL-02 must describe current typed escalation payload and route evidence');
expectFeatureMatrixStatusEvidenceBoundary(files.featureMatrix, contents.featureMatrix);
expectFeatureMatrixSummaryCounts(files.featureMatrix, contents.featureMatrix);
expectIncludes(files.atelierReadme, contents.atelierReadme, '当前由矩阵表格行动态推导功能点总数', 'Atelier README feature matrix nav must not hard-code stale feature counts');
expectNotIncludes(files.atelierReadme, contents.atelierReadme, '48 个功能点', 'Atelier README stale feature matrix feature count');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '**功能点总数**：48', 'Feature matrix stale total count');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '**三处一致 ✅**：31', 'Feature matrix stale complete count');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '**有缺口/错位 ⚠️**：17', 'Feature matrix stale gap count');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'service/static 已落，真实 runtime/E2E 待验', 'Feature matrix P1 section must describe remaining gaps as runtime/E2E evidence boundaries');
expectIncludes(files.featureMatrix, contents.featureMatrix, '当前 P1/P2 口径不再是 roadmap 积木错位', 'Feature matrix overview must not describe resolved P1/P2 work as roadmap block misplacement');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'P2 字段级补全已基本闭合', 'Feature matrix next actions must not keep stale P2 field backlog wording');
expectIncludes(files.atelierReadme, contents.atelierReadme, '**Updated**: 2026-07-05', 'Atelier README header must reflect current planning freshness');
expectIncludes(files.atelierDataModel, contents.atelierDataModel, '**Updated**: 2026-07-05', 'Atelier data model header must reflect current contract freshness');
expectIncludes(files.atelierDecisions, contents.atelierDecisions, '**Updated**: 2026-07-05', 'Atelier decisions header must reflect current decision freshness');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '**Updated**: 2026-07-05', 'Atelier prototype README header must reflect current prototype sync freshness');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '**Updated**: 2026-07-05', 'Atelier functional modules header must reflect current product-shape freshness');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, '**Updated**: 2026-07-05', 'Atelier UI mapping header must reflect current UI implementation freshness');
expectIncludes(files.userViewPlan, contents.userViewPlan, '**Updated**: 2026-07-05', 'Atelier user view header must reflect current user-view freshness');
expectIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, '**Updated**: 2026-07-05', 'Atelier multi-engine feasibility header must reflect current service-static evidence freshness');
expectIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, 'proto/service-static evidence', 'Atelier multi-engine feasibility must describe current proto/service-static evidence boundary');
expectIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, 'formal `AtelierAgentRole` proto enum + `AtelierAgentRoleAuthority` matrix schema 已补', 'Atelier multi-engine feasibility must describe current formal AgentRole proto/schema evidence');
expectIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, '`EnginePolicy` runtime 接口、`schedule` 实现', 'Atelier multi-engine feasibility must keep EnginePolicy runtime as the remaining gap');
expectIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, 'Atelier `flowId` 会映射到六个 EngineType，并拒绝未知 flow', 'Atelier multi-engine feasibility must document current flowId to EngineType mapping evidence');
expectIncludes(files.featureMatrix, contents.featureMatrix, '**Updated**: 2026-07-05', 'Feature matrix header must reflect current Atelier planning freshness');
expectIncludes(files.roadmap, contents.roadmap, '**Updated**: 2026-07-05', 'Atelier roadmap header must reflect current B9.5 planning freshness');
expectIncludes(files.featureMatrix, contents.featureMatrix, '已从 `data-model.md` v0.2 文档契约继续推进到 formal proto/codegen、Station read-only projection、official/prototype guard 或 service/static evidence', 'Feature matrix P0 preamble must describe current formal/projection/service-static evidence boundary');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'roadmap 积木错位/缺失（影响阶段能否凑齐，见上轮审计）', 'Feature matrix stale roadmap-misplacement P1 section title');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '**roadmap 积木错位/缺失**（机制类积木排错阶段或没排）', 'Feature matrix stale roadmap-misplacement overview wording');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '仍待后续落为 proto / Station Go 实体与运行时校验', 'Feature matrix P0 preamble must not keep stale proto/Station blanket backlog wording');
expectNotIncludes(files.atelierReadme, contents.atelierReadme, '**Updated**: 2026-07-02', 'Atelier README header must not keep stale July 2 update date');
expectNotIncludes(files.atelierDataModel, contents.atelierDataModel, '**Updated**: 2026-07-04', 'Atelier data model header must not keep stale July 4 update date');
expectNotIncludes(files.atelierDecisions, contents.atelierDecisions, '**Updated**: 2026-06-20', 'Atelier decisions header must not keep stale June update date');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, '**Updated**: 2026-07-04', 'Atelier prototype README header must not keep stale July 4 update date');
expectNotIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '**Updated**: 2026-06-21', 'Atelier functional modules header must not keep stale June update date');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, '**Updated**: 2026-06-22', 'Atelier UI mapping header must not keep stale June update date');
expectNotIncludes(files.userViewPlan, contents.userViewPlan, '**Updated**: 2026-06-20', 'Atelier user view header must not keep stale June update date');
expectNotIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, '**Updated**: 2026-06-22', 'Atelier multi-engine feasibility header must not keep stale June update date');
expectNotIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, '以下标识符在 Station 的 Go 代码里**一行都没有**', 'Atelier multi-engine feasibility must not keep stale zero-hit implementation claim');
expectNotIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, '多引擎编排目前 100% 停留在「文档 + 原型下拉框名字」', 'Atelier multi-engine feasibility must not claim multi-engine work is still 100 percent docs/prototype only');
expectNotIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, 'Station 没有任何实现', 'Atelier multi-engine feasibility must not erase current Station proto/service-static evidence');
expectNotIncludes(files.multiEngineFeasibility, contents.multiEngineFeasibility, '`AgentRole` 还不是 proto enum', 'Atelier multi-engine feasibility must not describe formal AgentRole proto enum as still missing');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '**Updated**: 2026-06-20', 'Feature matrix header must not keep stale June update date');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'proto enum / full 权力矩阵仍待后续', 'Feature matrix must not describe formal AgentRole proto/schema as still missing');
expectNotIncludes(files.roadmap, contents.roadmap, '**Updated**: 2026-06-20', 'Atelier roadmap header must not keep stale June update date');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'F-CL-08 | Replan 机制 | §4.5 | §2.2/§2.3(replanning) | B12 | ⚠️ 错位：应前移到 B 阶段', 'Feature matrix must not describe Replan as still wrongly scheduled to C phase');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'GAP-09 | Replan 错排到 C 阶段', 'Feature matrix GAP-09 title must not keep stale wrong-phase wording');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'F-CO-12 | Resume / 恢复锚点 | §1.6, §7.3 | §4 | B12 | ⚠️ 错位：应前移到 B6', 'Feature matrix must not describe Resume as still wrongly scheduled');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'GAP-10 | Resume 错排到 C 阶段', 'Feature matrix GAP-10 title must not keep stale wrong-phase wording');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'F-FD-03 | Policy 引擎 | §4.6, §3.2 | §1.5(Policy) / formal proto / Station projection | B7 | ⚠️ 文档契约 + formal proto + read-only projection 已补；Station Policy engine 未落', 'Feature matrix must not erase existing Policy/Defect service/static evidence');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'F-PR-05 | 工作区 / 沙箱 | §5.1(一句带过) | §1.2(Workspace/Sandbox) | — | ⚠️ 文档契约已补；roadmap 积木与 Station/Host capability 未落', 'Feature matrix must not describe Workspace/Sandbox roadmap and Host capability as not landed');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '并行前置条件与 Station Integrator 未定', 'Feature matrix must not describe integrator preconditions as undecided');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'Integrator 并行前置条件未定', 'Feature matrix GAP-12 title must not keep stale undecided wording');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, 'F-HL-02 | 升级载荷（证据/成本/选项/回滚影响） | §4.6 | §1.4(EscalationPayload) / §2.6 | B6/B7 | ⚠️ 文档契约已补；Station 路由未落', 'Feature matrix must not describe escalation payload route as not landed');
expectNotIncludes(files.featureMatrix, contents.featureMatrix, '修 P2（GAP-14~16）', 'Feature matrix next actions must not ask to fix already-closed P2 field gaps');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'type TaskOrganizerMode = AtelierTaskOrganizerMode', 'Official frontend task organizer mode type must derive from generated workbench surface taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_TASK_ORGANIZER_MODES.map', 'Official frontend task organizer selector must render generated organizer mode descriptors');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'useState<TaskOrganizerMode>(ATELIER_DEFAULT_TASK_ORGANIZER_MODE)', 'Official frontend task organizer default must consume generated default organizer mode');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'TASK_ORGANIZER_LABEL_KEYS[item.id]', 'Official frontend task organizer labels must be keyed by generated mode id');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "type TaskOrganizerMode = 'folders' | 'flat-list' | 'kanban' | 'dag'", 'Official frontend task organizer must not duplicate local organizer mode union');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "useState<TaskOrganizerMode>('folders')", 'Official frontend task organizer must not duplicate generated default organizer mode literal');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'useState<TaskOrganizerMode>(ATELIER_TASK_ORGANIZER_MODES[0].id)', 'Official frontend task organizer must not derive default from organizer mode ordering');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "id: 'folders', labelKey: 'atelier.taskOrganizer.folders', ready: true", 'Official frontend task organizer must not duplicate local organizer mode descriptors');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function TaskOrganizerPanel', 'Official frontend must render task organizer selector in the left rail');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function TaskFoldersList', 'Official frontend task organizer must support folders projection view');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function TaskFlatList', 'Official frontend task organizer must support flat-list projection view');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function TaskOrganizerLifecycleSection', 'Official frontend task organizer must support archived/deleted lifecycle sections');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function TaskOrganizerUnavailable', 'Official frontend task organizer must keep kanban/dag as explicit disabled boundaries');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "normalizeTaskStatus(task.status) === 'active'", 'Official frontend task organizer must keep active tasks in primary folders/flat lists');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "normalizeTaskStatus(task.status) === 'archived'", 'Official frontend task organizer must keep archived tasks in lifecycle section');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "normalizeTaskStatus(task.status) === 'deleted'", 'Official frontend task organizer must keep deleted tasks in lifecycle section');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'purgeConfirmTaskId={purgeConfirmTaskId}', 'Official frontend task organizer must expose existing purge confirmation state');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "onAction(task.id, 'purge')", 'Official frontend task organizer purge action must route through existing lifecycle controller intent');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.taskOrganizer.readOnly', 'Official frontend task organizer must disclose read-only Station projection ownership');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.taskOrganizer.deletedHint', 'Official frontend task organizer must disclose deleted-state purge precondition');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.taskOrganizer.unavailableBoundary', 'Official frontend task organizer must disclose disabled kanban/dag boundary');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'does not reorder, schedule, execute, or replan tasks', 'Official frontend gate must fix task organizer read-only boundary copy');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'consume Station projection and delegate task execution to Station orchestration', 'Official frontend gate must fix task organizer disabled boundary copy in English');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'function TaskOrganizerLifecycleSection', 'Official frontend gate must fix organizer lifecycle section parity');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, '!pageSource.includes(\'organizer.execute\')', 'Official frontend gate must reject organizer execute capability exposure');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const readyMode', 'Official frontend task organizer must not render a fallback folders list under disabled kanban/dag modes');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'organizer.reorder', 'Official frontend task organizer must not expose reorder capability');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'organizer.schedule', 'Official frontend task organizer must not expose schedule capability');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'organizer.execute', 'Official frontend task organizer must not expose execute capability');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'organizer.replan', 'Official frontend task organizer must not expose replan capability');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, "import type { AtelierTaskOrganizerMode } from './projection.contract.generated'", 'Browser prototype TaskPlugin id type must derive from generated organizer mode taxonomy');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'id: AtelierTaskOrganizerMode;', 'Browser prototype TaskPlugin id must use generated organizer mode taxonomy');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'ATELIER_TASK_ORGANIZER_MODES.map', 'Browser prototype plugin registry must render generated organizer mode descriptors');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'ready: mode.ready', 'Browser prototype plugin readiness must derive from generated organizer mode descriptor');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'ATELIER_DEFAULT_TASK_ORGANIZER_MODE', 'Browser prototype default plugin id must consume generated default organizer mode');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'export const DEFAULT_PLUGIN_ID = ATELIER_DEFAULT_TASK_ORGANIZER_MODE;', 'Browser prototype default plugin id must be generated default organizer mode');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'export function resolveTaskPlugin(pluginId: string): TaskPlugin', 'Browser prototype plugin resolver must centralize default organizer mode fallback');
expectIncludes(files.prototypePlugins, contents.prototypePlugins, 'item.id === DEFAULT_PLUGIN_ID', 'Browser prototype plugin resolver must fallback through generated default organizer mode');
expectIncludes(files.prototypePage, contents.prototypePage, 'resolveTaskPlugin(pluginId)', 'Browser prototype page must resolve plugin fallback through generated default organizer mode');
expectNotIncludes(files.prototypePlugins, contents.prototypePlugins, 'export const PLUGINS: TaskPlugin[] = [folders, flatList, kanban, dag];', 'Browser prototype plugin registry must not duplicate local organizer mode order');
expectNotIncludes(files.prototypePlugins, contents.prototypePlugins, 'export const DEFAULT_PLUGIN_ID = folders.id;', 'Browser prototype default plugin id must not duplicate local default organizer mode');
expectNotIncludes(files.prototypePlugins, contents.prototypePlugins, 'export const DEFAULT_PLUGIN_ID = ATELIER_TASK_ORGANIZER_MODES[0].id;', 'Browser prototype default plugin id must not derive default from organizer mode ordering');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'PLUGINS.find((p) => p.id === pluginId) ?? PLUGINS[0]', 'Browser prototype page must not fallback to plugin registry order when plugin id is unknown');
expectNotIncludes(files.prototypePage, contents.prototypePage, '?? PLUGINS[0]', 'Browser prototype page must not fallback to first plugin by registry order');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function ContextPanel', 'Official frontend must render Context projection panel');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function ContextRefGroup', 'Official frontend Context panel must render grouped context refs');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'type ContextFileGroup = (typeof ATELIER_CONTEXT_FILE_GROUPS)[number];', 'Official frontend Context group type must derive from generated taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'OFFICIAL_CONTEXT_FILE_GROUPS', 'Official frontend Context panel must render generated context groups with generated default first');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_DEFAULT_CONTEXT_FILE_GROUP', 'Official frontend Context group order must consume generated default context file group');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'CONTEXT_FILE_GROUP_LABEL_KEYS', 'Official frontend Context panel labels must be keyed by generated context group');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'CONTEXT_FILE_GROUP_MORE_KEYS', 'Official frontend Context hidden-count copy must be keyed by generated context group');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'CONTEXT_FILE_GROUP_DISPLAY_LIMITS', 'Official frontend Context display limits must be keyed by generated context group');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'satisfies Record<ContextFileGroup, string>', 'Official frontend Context string maps must be exhaustive over generated context groups');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'satisfies Record<ContextFileGroup, number>', 'Official frontend Context limit map must be exhaustive over generated context groups');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'OFFICIAL_CONTEXT_FILE_GROUPS.map((group) =>', 'Official frontend Context panel must group refs from generated context group order');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'file.group === group', 'Official frontend Context panel must filter refs by generated group');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'hiddenCount', 'Official frontend Context panel must disclose hidden refs per generated group');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.context.moreOther', 'Official frontend Context panel must localize hidden Other refs');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.context.readOnly', 'Official frontend Context panel must disclose read-only Station ownership');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "files.filter((file) => file.group === 'files')", 'Official frontend Context panel must not duplicate local files group filter');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "files.filter((file) => file.group === 'other')", 'Official frontend Context panel must not duplicate local other group filter');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_CONTEXT_FILE_GROUPS[0]', 'Official frontend Context panel must not derive default group from generated taxonomy ordering');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Workspace file discovery', 'Official frontend gate must require Context panel to disclose missing Workspace file discovery');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Run input_snapshot', 'Official frontend gate must require Context panel to disclose missing Run input_snapshot write');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official Context panel must stay read-only Station projection and must not expose workspace discovery or input snapshot writes', 'official frontend gate must prove Context panel remains read-only projection only');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official GatePanel must stay read-only Station gate projection and must not expose GateRunner execution or result submission capabilities', 'official frontend gate must prove GatePanel remains read-only projection only');
expectIncludes(files.goProjection, contents.goProjection, 'WorkspaceOpenTarget *AtelierWorkspaceOpenTarget', 'Station task projection must expose workspace open target');
expectIncludes(files.goProjection, contents.goProjection, 'pt-workspace://task/', 'Station workspace open target must use pt-workspace scheme');
expectIncludes(files.rustGateway, contents.rustGateway, 'handle_atelier_workspace_open', 'Desktop gateway must own workspace open validation');
expectIncludes(files.rustGateway, contents.rustGateway, 'pt-workspace://', 'Desktop gateway must restrict workspace open URI scheme');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'file://', 'Official frontend must not use file URLs for workspace open');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'fetchAtelierArtifactBody', 'Official frontend artifact body fetch client');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke<unknown>('atelier.artifact.body.fetch'", 'Official frontend artifact body fetch must use Host SDK capability');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactBodyResponse(response, input)', 'Official frontend artifact body response guard must compare Host response with request payload');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.taskId)', 'Official frontend artifact response guard must reject empty task id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.artifactId)', 'Official frontend artifact response guard must reject empty artifact id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.taskId === request.taskId', 'Official frontend artifact body response guard must reject mismatched task id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.artifactId === request.artifactId', 'Official frontend artifact body response guard must reject mismatched artifact id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.bodyRef === request.bodyRef', 'Official frontend artifact body response guard must reject mismatched body ref');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.bodyHash === request.expectedHash', 'Official frontend artifact body response guard must reject mismatched expected hash');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_ARTIFACT_BODY_REF_SHAPE', 'Official frontend artifact body response guard must consume generated body ref shape descriptor');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE)', 'Official frontend artifact body response guard must validate bodyRef through generated shape descriptor');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_ARTIFACT_BODY_REF_PATTERN', 'Official frontend artifact body response guard must not keep local body ref regex');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_ARTIFACT_BODY_KINDS', 'Official frontend artifact body response guard must consume generated body kind taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierArtifactBodyKind = (typeof ATELIER_ARTIFACT_BODY_KINDS)[number];', 'Official frontend artifact body response API type must derive body kind from generated taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'bodyKind: AtelierArtifactBodyKind;', 'Official frontend artifact body response interface must expose generated-derived body kind type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactBodyKind(record.bodyKind)', 'Official frontend artifact body response guard must validate body kind through generated taxonomy helper');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "['markdown', 'diff', 'text', 'json'].includes(record.bodyKind)", 'Official frontend artifact body response guard must not keep local body kind allowlist');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'bodyKind: string;', 'Official frontend artifact body response interface must not widen generated body kind to string');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`bodyKind` 必须来自 generated `ATELIER_ARTIFACT_BODY_KINDS`', 'prototype README must document generated body kind taxonomy for artifact body responses');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Artifact capability response API type 当前也有 controlled/local evidence', 'prototype README must document generated-derived artifact/provider response API type boundary');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'preview-open `mode / rendererOwner / rendererMode / rendererStatus` 从 generated preview-open taxonomy 派生', 'prototype README must document generated-derived preview-open descriptor API types');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'function isNonNegativeFiniteNumber', 'Official frontend artifact body response guard must define a finite non-negative number helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'function isNonEmptyString', 'Official frontend artifact response guard must define a non-empty string helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.bodyHash)', 'Official frontend artifact body response guard must reject empty body hash');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.retentionStatus)', 'Official frontend artifact body response guard must reject empty retention status');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonNegativeFiniteNumber(record.bodySize)', 'Official frontend artifact body response guard must reject negative or non-finite body size');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "typeof record.bodySize === 'number'", 'Official frontend artifact body response guard must not accept any number body size');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'openAtelierArtifactPreview', 'Official frontend artifact preview open client');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke<unknown>('atelier.artifact.preview.open'", 'Official frontend artifact preview open must use Host SDK capability');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactPreviewOpenResponse(response, input)', 'Official frontend artifact preview response guard must compare Host response with request payload');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_ARTIFACT_SANDBOX_REF_SHAPE', 'Official frontend artifact preview open must consume generated sandbox ref shape descriptor');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactSandboxRef(record.sandboxRef)', 'Official frontend artifact preview open must use canonical sandbox ref guard');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE)', 'Official frontend artifact preview open must validate sandboxRef through generated shape descriptor');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_ARTIFACT_SANDBOX_REF_PATTERN', 'Official frontend artifact preview open must not keep local sandbox ref regex');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.kind)', 'Official frontend artifact preview response guard must reject empty preview kind');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.rendererSessionId)', 'Official frontend artifact preview response guard must reject empty renderer session id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.rendererCapabilities.every(isNonEmptyString)', 'Official frontend artifact preview response guard must reject empty renderer capability labels');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.reason)', 'Official frontend artifact preview response guard must reject empty reason');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.sandboxRef === request.sandboxRef', 'Official frontend artifact preview response guard must reject mismatched sandbox ref');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_ARTIFACT_PREVIEW_OPEN_MODES', 'Official frontend artifact preview open response guard must consume generated preview open mode taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierArtifactPreviewOpenMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_MODES)[number];', 'Official frontend artifact preview response API type must derive mode from generated taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierArtifactPreviewOpenRendererOwner = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS)[number];', 'Official frontend artifact preview response API type must derive renderer owner from generated taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierArtifactPreviewOpenRendererMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES)[number];', 'Official frontend artifact preview response API type must derive renderer mode from generated taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierArtifactPreviewOpenRendererStatus = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES)[number];', 'Official frontend artifact preview response API type must derive renderer status from generated taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'mode: AtelierArtifactPreviewOpenMode;', 'Official frontend artifact preview response interface must expose generated-derived mode type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'rendererOwner: AtelierArtifactPreviewOpenRendererOwner;', 'Official frontend artifact preview response interface must expose generated-derived renderer owner type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'rendererMode: AtelierArtifactPreviewOpenRendererMode;', 'Official frontend artifact preview response interface must expose generated-derived renderer mode type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'rendererStatus: AtelierArtifactPreviewOpenRendererStatus;', 'Official frontend artifact preview response interface must expose generated-derived renderer status type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactPreviewOpenMode(record.mode)', 'Official frontend artifact preview open must validate mode through generated taxonomy helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactPreviewOpenRendererOwner(record.rendererOwner)', 'Official frontend artifact preview open must validate renderer owner through generated taxonomy helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactPreviewOpenRendererMode(record.rendererMode)', 'Official frontend artifact preview open must validate renderer mode through generated taxonomy helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactPreviewOpenRendererStatus(record.rendererStatus)', 'Official frontend artifact preview open must validate renderer status through generated taxonomy helper');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "record.mode === 'sandbox_manifest'", 'Official frontend artifact preview open must not hardcode preview open mode');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'rendererOwner: string;', 'Official frontend artifact preview response interface must not widen generated renderer owner to string');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'rendererMode: string;', 'Official frontend artifact preview response interface must not widen generated renderer mode to string');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'rendererStatus: string;', 'Official frontend artifact preview response interface must not widen generated renderer status to string');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "record.rendererOwner === 'desktop_host'", 'Official frontend artifact preview open must not hardcode renderer owner');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "record.rendererMode === 'host_sandbox_manifest'", 'Official frontend artifact preview open must not hardcode renderer mode');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "record.rendererStatus === 'prepared_not_opened'", 'Official frontend artifact preview open must not hardcode renderer status');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'fetchArtifactBody', 'Official frontend controller exposes artifact body fetch intent');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'artifactBodyFetchId', 'Official frontend controller tracks artifact body fetch loading state');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'expectedHash: artifact.bodyHash', 'Official frontend body fetch must pass expected hash metadata');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'isCanonicalAtelierArtifactBodyRef(bodyRef)', 'Official frontend body fetch must preflight canonical body refs before Host invoke');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'openArtifactPreview', 'Official frontend controller exposes artifact preview open intent');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'artifactPreviewOpenId', 'Official frontend controller tracks artifact preview open loading state');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'isCanonicalAtelierSandboxRef(sandboxRef)', 'Official frontend preview open must preflight canonical sandbox refs before Host invoke');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'ATELIER_ARTIFACT_BODY_REF_SHAPE', 'Official frontend controller must consume generated body ref shape descriptor');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'ATELIER_ARTIFACT_SANDBOX_REF_SHAPE', 'Official frontend controller must consume generated sandbox ref shape descriptor');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE', 'Official frontend preview open default mode must come from generated method payload default');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'isAtelierArtifactPreviewOpenMode(mode)', 'Official frontend preview open must reject non-generated preview open modes before Host invoke');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "previewTarget?.mode?.trim() || 'sandbox_manifest'", 'Official frontend preview open must not duplicate default sandbox manifest mode literal');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, 'previewTarget?.mode?.trim() || ATELIER_ARTIFACT_PREVIEW_OPEN_MODES[0]', 'Official frontend preview open must not derive default mode from allowed mode ordering');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "mode !== 'sandbox_manifest'", 'Official frontend preview open must not hardcode sandbox manifest mode before Host invoke');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'artifactPreviewInvalidation', 'Official frontend controller must invalidate local artifact preview state when selected task artifact projections change');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, "event.patch.kind === 'artifact.upsert'", 'Official frontend controller must key artifact preview invalidation off artifact projection events');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'event.patch.taskId === current.selectedTaskId', 'Official frontend controller must scope artifact preview invalidation to the selected task');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'projection artifact.upsert events for the selected task must invalidate stale artifact body and preview open state', 'Official frontend gate must prove artifact projection refresh clears stale local preview state');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'projectionEventHandlerSource.includes(\'artifactPreviewInvalidation\')', 'Official frontend gate must inspect projection event handler artifact preview invalidation specifically');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'sendMessage success must clear stale artifact body and preview open state', 'Official frontend gate must prove message send snapshot refresh clears stale artifact preview state');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'sendMessageSource.includes(\'artifactPreviewOpenResponse: null\')', 'Official frontend gate must inspect sendMessage preview response cleanup specifically');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official message send must stay text-only Station intent and must not expose run/provider/execute/input snapshot capabilities', 'Official frontend gate must prove message send remains text-only Station intent');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "sendMessageSource.includes('const snapshot = await sendAtelierMessage({ taskId, text });')", 'Official frontend gate must inspect exact text-only message send payload');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "clientSendMessageSource.includes(\"requestAtelierService('/v1/messages', 'POST', input)\")", 'Official frontend gate must inspect official message send service binding');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'const artifactBodyRequestSeq = useRef(0)', 'Official frontend body fetch must track async request ownership');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'current.artifactBodyFetchId !== fetchKey', 'Official frontend body fetch must ignore stale responses after pending key invalidation');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'const artifactPreviewOpenRequestSeq = useRef(0)', 'Official frontend preview open must track async request ownership');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'current.artifactPreviewOpenId !== openKey', 'Official frontend preview open must ignore stale responses after pending key invalidation');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'artifact body fetch must ignore stale async success/error', 'Official frontend gate must prove stale body fetch completions cannot overwrite current artifact preview state');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'artifact preview open must ignore stale async success/error', 'Official frontend gate must prove stale preview open completions cannot overwrite current artifact preview state');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'onFetchBody', 'Official frontend artifact preview fetch action');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'onOpenPreview', 'Official frontend artifact preview open action');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.bodyFetch', 'Official frontend artifact body fetch label');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.previewOpen', 'Official frontend artifact sandbox preview open label');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.bodyPreviewTruncated', 'Official frontend artifact body truncation label');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function SafeTextPreview', 'Official frontend artifact body preview must render Host-returned safe text via a dedicated text-only component');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'allLines', 'Official frontend safe text preview must compute local line overflow from Host-returned text');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.safeTextPreviewLines', 'Official frontend safe text preview line cap must derive from generated display limits');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'hiddenLineCount', 'Official frontend safe text preview must disclose locally hidden safe text lines');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.moreBodyLines', 'Official frontend safe text preview must label local line overflow');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'atelier.artifact.moreBodyLines', 'Official frontend gate must pin local safe text overflow disclosure');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "body.bodyKind === 'markdown'", 'Official frontend safe markdown preview must derive only from Host-returned body kind');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.safeMarkdownPreview', 'Official frontend safe markdown preview must disclose text-only boundary');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.safeTextBoundary', 'Official frontend safe text preview must disclose no raw renderer boundary');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.previewBoundaryLabel', 'Official frontend artifact preview must label metadata-only boundary');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.previewBoundary', 'Official frontend artifact preview must render metadata-only boundary');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "['Markdown', 'web', 'image', 'diff']", 'Official frontend gate must matrix-check artifact kind preview boundary disclosure');
for (const forbiddenOfficialRender of ['<iframe', '<img', '<image', 'src={artifact.url}', 'src={artifact.src}']) {
  expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, forbiddenOfficialRender, `Official frontend must not render artifact raw media via ${forbiddenOfficialRender}`);
}
expectIncludes(files.prototypePreview, contents.prototypePreview, 'Host safe text capability', 'Browser prototype artifact preview safe text capability label');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'atelier.artifact.body.fetch', 'Browser prototype artifact preview must explain official body fetch capability');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'onFetchBody', 'Browser prototype artifact preview fetch action');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'Station-projected bodyRef missing', 'Browser prototype artifact preview must not silently synthesize missing body refs');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'Host sandbox preview capability', 'Browser prototype artifact preview sandbox capability label');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'atelier.artifact.preview.open', 'Browser prototype artifact preview must explain official sandbox preview capability');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'Station-projected previewTarget missing', 'Browser prototype artifact preview must not silently synthesize missing sandbox preview refs');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'rendererStatus', 'Browser prototype artifact preview must display Host renderer session status');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'artifact.bodyHash, artifact.id, bodyRef, previewBodyRef, previewSandboxRef', 'Browser prototype preview must reset local safe body and sandbox session state when artifact refs change');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype preview must reset stale safe body and sandbox session state', 'bridge runtime gate must prove prototype preview artifact ref invalidation is guarded');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'function ArtifactMetadataPreview', 'Browser prototype artifact preview must use metadata-only preview component');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'Metadata-only artifact preview', 'Browser prototype artifact preview must label metadata-only boundary');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'Browser prototype no longer renders raw markdown, iframe, image, diff, URL, or source fields from projection', 'Browser prototype artifact preview must disclose raw field render removal');
expectIncludes(files.prototypePreview, contents.prototypePreview, '<ArtifactMetadataPreview artifact={artifact} />', 'Browser prototype artifact preview must render metadata-only fallback for all artifact kinds');
for (const forbiddenPrototypeRender of ['<iframe', '<img', 'artifact.markdown', 'artifact.content', 'artifact.diff', 'artifact.url', 'artifact.src']) {
  expectNotIncludes(files.prototypePreview, contents.prototypePreview, forbiddenPrototypeRender, `Browser prototype preview must not render artifact raw projection via ${forbiddenPrototypeRender}`);
}
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype artifact preview must stay metadata-only and must not render raw artifact projection fields', 'Bridge runtime gate must prove browser prototype artifact preview remains metadata-only');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'browser prototype artifact preview raw field hardening 当前有 controlled/static evidence', 'Prototype README must document browser prototype raw artifact field hardening evidence');
expectIncludes(files.prototypePreview, contents.prototypePreview, 'Prototype-only mock logs', 'Browser prototype Console Logs must disclose that real Run runtime stream is not wired');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype Console Logs panel must disclose mock logs and must not wire runtime log subscription', 'Bridge runtime gate must prove browser prototype Console Logs remain mock-only');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Prototype-only mock logs: real Run runtime stream is not wired.', 'Prototype README must document browser prototype Console Logs as mock-only');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Console Logs Host capture controlled slice 当前有 controlled/local evidence', 'Prototype README must document Host console capture controlled evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '不把 browser prototype mock logs 或 official unsupported disclosure 升级为真实 Console Logs runtime stream', 'Prototype README must keep Host console capture evidence below real runtime stream completion');
expectIncludes(files.packageJson, contents.packageJson, 'atelier:runtime-log-stream-controlled-gate', 'package script for Atelier runtime log stream controlled gate');
expectIncludes(files.atelierRuntimeLogStreamControlledGate, contents.atelierRuntimeLogStreamControlledGate, 'atelier-runtime-log-stream-controlled-gate.json', 'runtime log stream controlled gate must write dedicated evidence');
expectIncludes(files.atelierRuntimeLogStreamControlledGate, contents.atelierRuntimeLogStreamControlledGate, "source: 'host_sandbox_cdp'", 'runtime log stream controlled gate must classify logs as Host sandbox CDP capture');
expectIncludes(files.atelierRuntimeLogStreamControlledGate, contents.atelierRuntimeLogStreamControlledGate, "evidenceClass: 'CONTROLLED_LOCAL_UPSTREAM'", 'runtime log stream controlled gate must classify evidence as controlled local upstream');
expectIncludes(files.atelierRuntimeLogStreamControlledGate, contents.atelierRuntimeLogStreamControlledGate, 'seq,', 'runtime log stream controlled gate must normalize ordered log entries');
expectIncludes(files.atelierRuntimeLogStreamControlledGate, contents.atelierRuntimeLogStreamControlledGate, 'real Run runtime stream', 'runtime log stream controlled gate must keep real Run runtime stream unproven');
expectIncludes(files.atelierRuntimeLogStreamControlledGate, contents.atelierRuntimeLogStreamControlledGate, 'atelier.logs.subscribe applet capability', 'runtime log stream controlled gate must not claim applet log subscription capability');
expectIncludes(files.atelierRuntimeLogStreamControlledGate, contents.atelierRuntimeLogStreamControlledGate, 'runtime.logs.subscribe applet capability', 'runtime log stream controlled gate must not claim runtime log subscription capability');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'P2-04b Host runtime capability boundary 当前有 controlled/static evidence', 'Prototype README must document P2-04b forbidden runtime capability boundary evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`atelier.attachment.upload` / `attachment.upload`', 'Prototype README must document forbidden attachment upload methods');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`atelier.logs.subscribe` / `atelier.console.subscribe` / `console.logs.subscribe` / `runtime.logs.subscribe`', 'Prototype README must document forbidden runtime log subscription methods');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`atelier.artifact.rich.render` / `artifact.rich.render` / `iframe.render` / `image.render` / `html.render` / `rawUrl.render`', 'Prototype README must document forbidden rich renderer methods');
for (const [artifactRuntimeGap, message] of [
  ['web iframe/image/html/diff renderer', 'web/image/html/diff rich renderer gap'],
  ['Console Logs runtime stream', 'Console Logs runtime stream gap'],
  ['attachment Host Storage runtime', 'attachment Host Storage runtime gap'],
]) {
  expectIncludes(files.prototypeReadme, contents.prototypeReadme, artifactRuntimeGap, `Prototype README must preserve ${message} wording`);
  expectIncludes(files.atelierArtifactGateProductWindowGate, contents.atelierArtifactGateProductWindowGate, artifactRuntimeGap, `artifact product-window gate notCovered must preserve ${message} wording`);
  expectIncludes(files.atelierAcceptanceEvidenceReport, contents.atelierAcceptanceEvidenceReport, artifactRuntimeGap, `acceptance evidence report must preserve ${message} wording`);
  expectIncludes(files.atelierCompletionAudit, contents.atelierCompletionAudit, artifactRuntimeGap, `completion audit must preserve ${message} wording`);
}
expectIncludes(files.atelierCompletionAudit, contents.atelierCompletionAudit, 'Verdict: `NOT_READY`', 'completion audit must keep NOT_READY verdict until full objective is proven');
expectIncludes(files.atelierCompletionAudit, contents.atelierCompletionAudit, 'Atelier is not globally complete and is not ready for a final completion claim.', 'completion audit must not drift into a readiness claim');
expectIncludes(files.atelierAcceptanceEvidenceReport, contents.atelierAcceptanceEvidenceReport, 'does not claim global Atelier completion', 'acceptance evidence report must not claim global completion');
expectIncludes(files.atelierAcceptanceEvidenceReport, contents.atelierAcceptanceEvidenceReport, 'does not prove full Atelier readiness', 'acceptance evidence report must preserve non-readiness claim');
expectIncludes(files.atelierAcceptanceEvidenceReport, contents.atelierAcceptanceEvidenceReport, '`pnpm run applet:atelier-live-resume-product-window-gate`', 'acceptance evidence report must cite canonical packaged live-resume gate script');
expectIncludes(files.atelierCompletionAudit, contents.atelierCompletionAudit, '`pnpm run applet:atelier-live-resume-product-window-gate`', 'completion audit must cite canonical packaged live-resume gate script');
expectNotIncludes(files.atelierAcceptanceEvidenceReport, contents.atelierAcceptanceEvidenceReport, '`node tooling/scripts/applet-atelier-live-resume-product-window-gate.mjs`', 'acceptance evidence report must not cite direct node live-resume script without applets:build');
expectNotIncludes(files.atelierCompletionAudit, contents.atelierCompletionAudit, '`node tooling/scripts/applet-atelier-live-resume-product-window-gate.mjs`', 'completion audit must not cite direct node live-resume script without applets:build');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'F-CO-07a', 'Feature matrix must split artifact metadata-only parity from rich renderer runtime');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'F-CO-07b', 'Feature matrix must keep rich renderer / Console Logs / attachment runtime pending separately');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Artifact metadata-only projection parity', 'Feature matrix must name metadata-only artifact parity scope');
expectIncludes(files.featureMatrix, contents.featureMatrix, 'Artifact rich renderer / Console Logs / attachment runtime', 'Feature matrix must name Host-owned artifact runtime gap');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'GAP-UI-07 拆为 P2-04a / P2-04b', 'UI mapping must split GAP-UI-07 into controlled parity and Host runtime gap');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'P2-04a / F-CO-07a metadata-only projection / official UI 已收敛', 'UI mapping artifact contract row must classify metadata-only parity as P2-04a/F-CO-07a');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'P2-04a / F-CO-07a metadata-only projection parity 已落', 'UI mapping GAP table must classify metadata-only projection parity as P2-04a/F-CO-07a');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'P2-04b / F-CO-07b iframe / image / html 真预览仍待 Host-owned sandbox visual rendering runtime', 'UI mapping artifact contract row must keep rich rendering pending under P2-04b/F-CO-07b');
expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'P2-04b / F-CO-07b 仍 pending Host runtime/E2E', 'UI mapping GAP table must keep rich renderer runtime pending');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, 'P2-07 metadata-only projection / official UI 已收敛', 'legacy P2-07 metadata-only parity label');
expectNotIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, '✅ P2-07 metadata-only + safe text fetch', 'legacy P2-07 metadata-only UI row label');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Artifact metadata / evidence index', 'Functional modules M8 must scope artifact recovery to metadata/evidence index');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'F-CO-07a/07b', 'Functional modules must reference split artifact feature ids');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'P2-04a / F-CO-07a 已收口为 metadata-only projection parity', 'Functional modules M14 must classify metadata-only preview as P2-04a/F-CO-07a');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, '仍 pending Host runtime/E2E：web iframe/image/html/diff renderer、Console Logs 真实 Run runtime stream 与 attachment upload / Host Storage runtime', 'Functional modules M14 must keep rich preview and attachment runtime pending');
expectIncludes(files.functionalModulesPlan, contents.functionalModulesPlan, 'Applet 不接 renderer、不读 raw body、不上传附件、不执行 provider/run/shell', 'Functional modules M14 must preserve applet projection-only boundary');
expectNotIncludes(files.prototypePreview, contents.prototypePreview, '`artifact://${taskId}/${artifact.id}/body`', 'Browser prototype must not synthesize Station artifact body refs');
expectNotIncludes(files.prototypePreview, contents.prototypePreview, '`atelier-sandbox://${taskId}/${artifact.id}/preview`', 'Browser prototype must not synthesize Station sandbox preview refs');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'prototype 不再合成本地 `artifact://.../body`', 'Prototype README must document bodyRef synthesis removal');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '不再合成本地 `atelier-sandbox://.../preview`', 'Prototype README must document sandbox preview synthesis removal');
expectIncludes(files.prototypePage, contents.prototypePage, 'onFetchBody={runtime.fetchArtifactBody}', 'Browser prototype page must wire preview safe text fetch to runtime');
expectIncludes(files.prototypePage, contents.prototypePage, 'onOpenPreview={runtime.openArtifactPreview}', 'Browser prototype page must wire preview sandbox open to runtime');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype Open in IDE must stay Host workspace.open intent only and must not expose file/shell/execute', 'Bridge runtime gate must prove browser prototype Open in IDE remains Host intent only');
expectIncludes(files.prototypePage, contents.prototypePage, 'Attachment input is prototype-only', 'Browser prototype composer must disclose that attachment input is not wired to Host Storage');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype attachment input must stay disclosure-only and must not wire Host Storage or Run input_snapshot writes', 'Bridge runtime gate must prove browser prototype attachment input remains disclosure-only');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.composer.attachmentUnsupported', 'Official frontend must render unsupported attachment boundary');
if (contents.officialFrontendPage.indexOf('atelier.composer.attachmentUnsupported') === contents.officialFrontendPage.lastIndexOf('atelier.composer.attachmentUnsupported')) {
  failures.push(`${files.officialFrontendPage}: missing unsupported attachment boundary in both GoalComposer and MessageComposer`);
}
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official composers must stay disclosure-only for attachments and must not wire Host Storage or Run input_snapshot writes', 'official frontend gate must prove attachment composers remain disclosure-only');
expectIncludes(files.prototypePage, contents.prototypePage, 'Prototype run target selector only writes Station-owned run intent', 'Browser prototype run target picker must disclose Station-owned execution boundary');
expectIncludes(files.prototypePage, contents.prototypePage, 'does not invoke providers, run models, or execute CLI', 'Browser prototype run target picker must forbid applet-side provider/model/CLI execution');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype run target picker must stay Station-owned intent only and must not expose provider/model/CLI execution', 'Bridge runtime gate must prove browser prototype run target picker remains intent-only');
const prototypeSendDraftStart = contents.prototypePage.indexOf('const sendDraft = () => {');
const prototypeSendDraftEnd = contents.prototypePage.indexOf('\n  const insertProviderCapabilityCommand', prototypeSendDraftStart);
const prototypeSendDraftSource =
  prototypeSendDraftStart >= 0 && prototypeSendDraftEnd > prototypeSendDraftStart
    ? contents.prototypePage.slice(prototypeSendDraftStart, prototypeSendDraftEnd)
    : '';
if (!prototypeSendDraftSource.includes('runtime.sendMessage({')) {
  failures.push(`${files.prototypePage}: browser prototype sendDraft must call runtime.sendMessage`);
}
if (prototypeSendDraftSource.includes('run:')) {
  failures.push(`${files.prototypePage}: browser prototype message send must stay text-only and not submit run intent`);
}
const prototypeSendMessageInputStart = contents.prototypeRuntime.indexOf('export interface SendMessageInput {');
const prototypeSendMessageInputEnd = contents.prototypeRuntime.indexOf('\nexport interface ResolveDecisionInput', prototypeSendMessageInputStart);
const prototypeSendMessageInputSource =
  prototypeSendMessageInputStart >= 0 && prototypeSendMessageInputEnd > prototypeSendMessageInputStart
    ? contents.prototypeRuntime.slice(prototypeSendMessageInputStart, prototypeSendMessageInputEnd)
    : '';
if (!prototypeSendMessageInputSource.includes('taskId: string') || !prototypeSendMessageInputSource.includes('text: string')) {
  failures.push(`${files.prototypeRuntime}: browser prototype SendMessageInput must contain only task id and text fields`);
}
if (prototypeSendMessageInputSource.includes('run:')) {
  failures.push(`${files.prototypeRuntime}: browser prototype SendMessageInput must stay text-only and not expose run intent`);
}
const prototypeRuntimeSendMessageStart = contents.prototypeRuntime.indexOf('async sendMessage(input) {');
const prototypeRuntimeSendMessageEnd = contents.prototypeRuntime.indexOf('\n    async resolveDecision', prototypeRuntimeSendMessageStart);
const prototypeRuntimeSendMessageSource =
  prototypeRuntimeSendMessageStart >= 0 && prototypeRuntimeSendMessageEnd > prototypeRuntimeSendMessageStart
    ? contents.prototypeRuntime.slice(prototypeRuntimeSendMessageStart, prototypeRuntimeSendMessageEnd)
    : '';
if (prototypeRuntimeSendMessageSource.includes('input.run')) {
  failures.push(`${files.prototypeRuntime}: browser prototype sendMessage runtime must not branch on message-level run intent`);
}
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function RunTargetSelector', 'Official frontend must render explicit model/agents run target selector');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official Work/Code/Design preset selector must stay declarative intentPreset only and must not switch IDE/workspace/provider runtime', 'official frontend gate must prove Work/Code/Design preset selector remains intentPreset-only');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => {', 'Official frontend run target selector must render generated agent flow descriptors');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const AGENT_FLOW_LABELS', 'Official frontend run target flow labels must not duplicate generated agent flow descriptors locally');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const AGENT_FLOWS = [', 'Official frontend run target selector must not duplicate generated agent flow taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.runTarget.modelHint', 'Official frontend model branch must render DirectRun intent boundary');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.runTarget.agentsHint', 'Official frontend agents branch must render Station-owned agents intent boundary');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official run target selector must stay Station-owned intent only and must not expose provider/model/CLI execution', 'official frontend gate must prove run target selector remains intent-only');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function NegoDisclosure', 'Official frontend must keep negotiation blocks folded by default');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function NegoRoleMarker', 'Official frontend negotiation details must render role avatar markers');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'NEGO_ROLE_COLORS', 'Official frontend negotiation details must use role color semantics');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const roleColor = negoRoleColor(voice.role)', 'Official frontend negotiation details must derive role color per projected voice');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'borderLeftWidth: px(2)', 'Official frontend negotiation details must render role-colored visual lanes');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "const stanceLabel = noEvidenceObjection ? t('atelier.nego.concern') : negoStanceLabel(voice.stance)", 'Official frontend negotiation details must keep no-evidence objections downgraded to concern labels');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const [expanded, setExpanded] = useState(false)', 'Official frontend negotiation details must require local expand action');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'folded negotiation details', 'Official frontend gate must pin folded negotiation detail parity');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'function NegoRoleMarker', 'Official frontend gate must pin role marker negotiation parity');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official negotiation disclosure must stay read-only Station voice projection and must not expose agent orchestration/provider execution capabilities', 'official frontend gate must prove negotiation disclosure remains read-only voice projection');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-nego-stance', 'Official frontend gate must reject non-contract negotiation stances');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "stance: 'approval'", 'Official frontend gate must cover a malformed negotiation stance fixture');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-nego-empty-voice-fields', 'Official frontend gate must reject empty negotiation voice fields');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "role: ''", 'Official frontend gate must cover empty negotiation voice role');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "evidenceRef: ''", 'Official frontend gate must cover empty negotiation evidence refs');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "objectionId: 'objection-1'", 'Official frontend gate must preserve Station-projected negotiation trace ids');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype negotiation row must stay read-only Station voice projection and must not expose agent orchestration/provider execution capabilities', 'Bridge runtime gate must prove browser prototype negotiation row remains read-only voice projection');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype NegoVoice stance and trace ids must stay generated-contract derived', 'Bridge runtime gate must prove prototype NegoVoice taxonomy remains generated-contract derived');
expectIncludes(files.prototypeBlocks, contents.prototypeBlocks, 'ATELIER_PROJECTION_DISPLAY_LIMITS.negotiationVoices', 'Browser prototype NegoRow must cap visible Station negotiation voices from generated display limits');
expectIncludes(files.prototypeBlocks, contents.prototypeBlocks, 'more Station negotiation voices hidden in the compact prototype row.', 'Browser prototype NegoRow must disclose hidden Station negotiation voices');
expectIncludes(files.prototypeEngineTrace, contents.prototypeEngineTrace, 'Prototype-only local trace；真实编排归 Station', 'Browser prototype EngineTrace must visibly disclose local trace boundary');
expectIncludes(files.prototypePage, contents.prototypePage, 'without claiming applet orchestration', 'Browser prototype EngineTrace call site must not claim applet orchestration ownership');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype EngineTrace must stay prototype-only local trace disclosure and must not expose agent/provider execution capabilities', 'Bridge runtime gate must prove browser prototype EngineTrace remains prototype-only local trace');
expectIncludes(files.officialFrontendEnLocale, contents.officialFrontendEnLocale, 'Station-owned DirectRun intent', 'Official frontend model selector must disclose Station-owned DirectRun intent boundary');
expectIncludes(files.officialFrontendEnLocale, contents.officialFrontendEnLocale, 'Station-owned agents intent', 'Official frontend agents selector must disclose Station-owned agents intent boundary');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "locale['atelier.runTarget.modelHint'].includes('Station-owned DirectRun intent')", 'Official frontend gate must semantically check model selector DirectRun boundary');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "locale['atelier.runTarget.agentsHint'].includes('Station-owned agents intent')", 'Official frontend gate must semantically check agents selector boundary');
expectIncludes(files.prototypePage, contents.prototypePage, 'Host workspace.open intent only', 'Browser prototype Open in IDE must disclose Host-intent-only boundary');
expectIncludes(files.prototypePage, contents.prototypePage, 'no file URL, shell, or execute capability', 'Browser prototype Open in IDE must disclose it exposes no file/shell/execute capability');
expectIncludes(files.prototypePage, contents.prototypePage, 'Read-only Station context projection', 'Browser prototype Context panel must disclose Station-owned read-only context projection');
expectIncludes(files.prototypePage, contents.prototypePage, 'no Workspace file discovery', 'Browser prototype Context panel must forbid applet-side workspace discovery');
expectIncludes(files.prototypePage, contents.prototypePage, 'no Run input_snapshot write', 'Browser prototype Context panel must forbid applet-side input snapshot writes');
expectIncludes(files.prototypePage, contents.prototypePage, 'Host+Station+applet E2E proof', 'Browser prototype Context panel must not overclaim context E2E evidence');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype Context panel must stay read-only Station projection and must not expose workspace discovery or input snapshot writes', 'Bridge runtime gate must prove browser prototype Context panel remains read-only projection only');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype organizer Kanban/DAG plugins must stay placeholders and must not expose reorder/schedule/execute/replan', 'Bridge runtime gate must prove browser prototype Kanban/DAG remain organizer placeholders');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype task lifecycle menu must use lifecycle status/purge intents and must not expose execution or purge bypass capabilities', 'Bridge runtime gate must prove browser prototype task lifecycle menu remains lifecycle-only');
expectIncludes(files.prototypePage, contents.prototypePage, 'terminal panel is not wired to shell or execute capability', 'Browser prototype terminal topbar tool must disclose it is not a shell/execute capability');
expectIncludes(files.prototypePage, contents.prototypePage, 'outline panel is not wired to a real task graph panel', 'Browser prototype outline topbar tool must disclose it is not a real task graph panel');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'must stay non-interactive', 'Official frontend gate must prove Terminal/Outline boundary pills are non-interactive');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype topbar must disclose Terminal/Outline as prototype-only placeholders', 'bridge runtime gate must prove browser prototype Terminal/Outline placeholder boundary');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype topbar placeholder must not expose', 'bridge runtime gate must forbid browser prototype Terminal/Outline capability exposure');
expectIncludes(files.prototypePage, contents.prototypePage, 'Read-only Station TaskGraph projection', 'Browser prototype right panel must consume TaskGraph as a read-only Station projection');
expectIncludes(files.prototypePage, contents.prototypePage, 'does not schedule, execute, or replan nodes', 'Browser prototype TaskGraph panel must forbid applet-side scheduling/execution/replan');
expectIncludes(files.prototypePage, contents.prototypePage, 'Parallel policy: {project.taskGraph.parallelPolicy}', 'Browser prototype TaskGraph panel must disclose Station projected parallel policy');
expectIncludes(files.prototypePage, contents.prototypePage, "project.taskGraph.parallelPolicy === 'integrator_required'", 'Browser prototype TaskGraph panel must disclose integrator-required boundary');
expectIncludes(files.prototypePage, contents.prototypePage, 'Integrator identity and merge execution remain Station-owned', 'Browser prototype TaskGraph integrator disclosure must keep execution Station-owned');
expectIncludes(files.prototypePage, contents.prototypePage, 'visibleRootTaskIds', 'Browser prototype TaskGraph panel must disclose Station projected root task ids');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenRootTaskIdCount', 'Browser prototype TaskGraph panel must disclose hidden root task id count');
expectIncludes(files.prototypePage, contents.prototypePage, 'visibleEdges', 'Browser prototype TaskGraph panel must disclose Station projected dependency edges');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenEdgeCount', 'Browser prototype TaskGraph panel must disclose hidden dependency edge count');
expectIncludes(files.prototypePage, contents.prototypePage, 'visibleNodeArtifactIds', 'Browser prototype TaskGraph node row must disclose Station projected artifact refs');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenNodeArtifactCount', 'Browser prototype TaskGraph node row must disclose hidden artifact ref count');
expectIncludes(files.prototypePage, contents.prototypePage, 'visibleNodeGateIds', 'Browser prototype TaskGraph node row must disclose Station projected gate refs');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenNodeGateCount', 'Browser prototype TaskGraph node row must disclose hidden gate ref count');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.taskGraphNodes', 'Browser prototype TaskGraph node display limit must derive from generated contract');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenNodeCount', 'Browser prototype TaskGraph panel must disclose hidden node count');
expectIncludes(files.prototypePage, contents.prototypePage, 'more Station TaskGraph nodes hidden', 'Browser prototype TaskGraph panel must disclose hidden generated-limited nodes');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.projectHealthItems', 'Browser prototype Project Health compact lists must derive from generated display limits');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_PROJECTION_DISPLAY_LIMITS.providerCapabilities', 'Browser prototype provider capability compact list must derive from generated display limits');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'const visibleRootTaskIds = project.taskGraph.rootTaskIds.slice(0, 3);', 'Browser prototype TaskGraph root display limit must not be hardcoded');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'const visibleEdges = project.taskGraph.edges.slice(0, 4);', 'Browser prototype TaskGraph edge display limit must not be hardcoded');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'const visibleBlockers = project.openBlockers.slice(0, 3);', 'Browser prototype Project Health blocker limit must not be hardcoded');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'const visibleCapabilities = capabilities.slice(0, 5);', 'Browser prototype provider capability display limit must not be hardcoded');
expectNotIncludes(files.prototypeBlocks, contents.prototypeBlocks, 'const visibleVoices = b.voices.slice(0, 4);', 'Browser prototype negotiation voice display limit must not be hardcoded');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype TaskGraph panel must stay read-only Station projection and must not expose scheduling/execution/replan capabilities', 'Bridge runtime gate must prove browser prototype TaskGraph remains read-only projection only');
expectIncludes(files.prototypePage, contents.prototypePage, 'ProjectHealthProjectionPanel', 'Browser prototype right panel must render Project Health projection');
expectIncludes(files.prototypePage, contents.prototypePage, 'Read-only Station project health projection', 'Browser prototype project health panel must state read-only Station ownership');
expectIncludes(files.prototypePage, contents.prototypePage, 'does not accept, waive, or mutate project state', 'Browser prototype project health panel must forbid applet-side project mutation');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenBlockerCount', 'Browser prototype project health panel must disclose hidden blocker projections');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenRiskCount', 'Browser prototype project health panel must disclose hidden residual risk projections');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenMilestoneCount', 'Browser prototype project health panel must disclose hidden milestone projections');
expectIncludes(files.prototypePage, contents.prototypePage, 'visiblePredicateIds', 'Browser prototype milestone row must disclose Station projected acceptance predicate refs');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenPredicateCount', 'Browser prototype milestone row must disclose hidden acceptance predicate ref count');
expectIncludes(files.prototypePage, contents.prototypePage, 'visibleMilestoneBlockerRefs', 'Browser prototype milestone row must disclose Station projected milestone blocker refs');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenMilestoneBlockerCount', 'Browser prototype milestone row must disclose hidden milestone blocker ref count');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenMemoryCandidateCount', 'Browser prototype project health panel must disclose hidden memory candidate projections');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenPolicyRuleCount', 'Browser prototype project health panel must disclose hidden policy rule projections');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenDefectCount', 'Browser prototype project health panel must disclose hidden defect projections');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype Project Health panel must stay read-only Station projection and must not expose project mutation/evaluator capabilities', 'Bridge runtime gate must prove browser prototype Project Health remains read-only projection only');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official Project Health panel must stay read-only Station projection and must not expose project mutation/evaluator capabilities', 'official frontend gate must prove Project Health remains read-only projection only');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'visiblePredicateIds', 'Official frontend gate must pin milestone acceptance predicate ref disclosure');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'hiddenPredicateCount', 'Official frontend gate must pin hidden milestone acceptance predicate ref count');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'visibleMilestoneBlockerRefs', 'Official frontend gate must pin milestone blocker ref disclosure');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'hiddenMilestoneBlockerCount', 'Official frontend gate must pin hidden milestone blocker ref count');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'hiddenMemoryCandidateCount', 'Official frontend gate must pin project health memory candidate projection disclosure');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'hiddenPolicyRuleCount', 'Official frontend gate must pin project health policy rule projection disclosure');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'hiddenDefectCount', 'Official frontend gate must pin project health defect projection disclosure');
expectIncludes(files.tsProjection, contents.tsProjection, 'projects: state.projects', 'Browser prototype projection adapter must preserve project projections into Host snapshots');
expectIncludes(files.tsProjection, contents.tsProjection, 'projects: snapshot.workspace.projects', 'Browser prototype projection adapter must preserve project projections from Host snapshots');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'openArtifactPreview', 'Browser prototype runtime exposes artifact preview open intent');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "'atelier.artifact.preview.open'", 'Browser prototype bridge runtime maps artifact preview open capability');
expectIncludes(files.goProjection, contents.goProjection, 'FetchArtifactBody', 'Station artifact body fetch service');
expectIncludes(files.goProjection, contents.goProjection, 'loadOwnedAtelierTask(ctx, actorID, taskID)', 'Station artifact body fetch must enforce task ownership');
expectIncludes(files.goProjection, contents.goProjection, 'bodyRef != canonicalBodyRef', 'Station artifact body fetch must enforce canonical body ref');
expectIncludes(files.goProjection, contents.goProjection, 'Where("task_id = ? AND artifact_id = ? AND body_uri = ?", taskID, artifactID, bodyRef)', 'Station artifact body fetch must query by task/artifact/body URI');
expectIncludes(files.goProjection, contents.goProjection, 'strings.TrimSpace(blob.RetentionStatus) != "active"', 'Station artifact body fetch must enforce active retention status');
expectIncludes(files.goProjection, contents.goProjection, 'blob.ExpiresAt != nil && !blob.ExpiresAt.After(time.Now().UTC())', 'Station artifact body fetch must reject expired bodies');
expectIncludes(files.goProjection, contents.goProjection, 'isAtelierFetchableArtifactBodyKind(bodyKind)', 'Station artifact body fetch must enforce text body kind allowlist');
expectIncludes(files.goProjection, contents.goProjection, 'actualHash := atelierArtifactBodyHash(blob.BodyText)', 'Station artifact body fetch must verify stored hash against body');
expectIncludes(files.goProjection, contents.goProjection, 'truncateUTF8Bytes(blob.BodyText, maxBytes)', 'Station artifact body fetch must cap safe text response');
expectIncludes(files.goProjectionHandler, contents.goProjectionHandler, 'HandleFetchArtifactBody', 'Station artifact body fetch handler');
expectIncludes(files.goAgent, contents.goAgent, '/agent/atelier/artifact/body/fetch', 'Station artifact body fetch route');
expectIncludes(files.rustGateway, contents.rustGateway, '/sub-agent/agent/atelier/artifact/body/fetch', 'Desktop gateway artifact body fetch route');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestFetchAtelierArtifactBodyReturnsOwnedSafeTextBody', 'Station artifact body safe text fetch test');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestFetchAtelierArtifactBodyRejectsUnsafeOrUnownedBlob', 'Station artifact body unsafe/unowned rejection test');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'artifact.body.produce', 'Official frontend must not expose artifact production');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'artifact.body.upload', 'Official frontend must not expose artifact upload');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'openExternalUrl', 'Official frontend must not bypass Host workspace open via external URL');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'shell', 'Official frontend must not invoke shell for workspace open');
expectIncludes(files.goProjection, contents.goProjection, 'func (s *AtelierProjectionService) SubmitFeedback', 'Station feedback submit endpoint');
expectIncludes(files.goProjection, contents.goProjection, 'EventTypeCollaborationFeedbackRecorded', 'Station feedback must be durable typed event intent');
expectIncludes(files.goProjection, contents.goProjection, 'memory_candidate_status', 'Station feedback must emit memory candidate policy metadata');
expectIncludes(files.goProjection, contents.goProjection, 'memory_confirmation_required', 'Station feedback must emit memory confirmation-required metadata');
expectIncludes(files.goProjection, contents.goProjection, 'memory_candidate_feeds', 'Station feedback must emit MemoryCandidate.feeds metadata');
expectIncludes(files.goProjection, contents.goProjection, 'station_memory_review', 'Station feedback must label memory confirmation as Station-owned review');
expectIncludes(files.goProjection, contents.goProjection, 'rerun_intent_status', 'Station feedback must emit rerun intent policy metadata');
expectIncludes(files.goProjection, contents.goProjection, 'rerun_confirmation_required', 'Station feedback must emit rerun confirmation-required metadata');
expectIncludes(files.goProjection, contents.goProjection, 'station_rerun_review', 'Station feedback must label rerun confirmation as Station-owned review');
expectIncludes(files.goProjection, contents.goProjection, 'TASK_EVENT_TYPE_FEEDBACK_RECORDED', 'Feedback event must not project as stream block');
expectIncludes(files.agentProto, contents.agentProto, 'TASK_EVENT_TYPE_FEEDBACK_RECORDED', 'Feedback must have typed task event enum');
expectIncludes(files.rustGateway, contents.rustGateway, '/sub-agent/agent/atelier/feedback/submit', 'Desktop gateway feedback submit Station route');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'submitAtelierFeedback', 'Official frontend feedback submit client');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke<unknown>('atelier.feedback.submit'", 'Official frontend must use Host capability for feedback submit');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isSubmitAtelierFeedbackResponse', 'Official frontend feedback submit must validate Host response shape');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.feedbackId)', 'Official frontend feedback submit response guard must reject empty feedback id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isFeedbackPolicyHint', 'Official frontend feedback submit response guard must validate policy hints');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.status)', 'Official frontend feedback policy hint guard must reject empty status');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.confirmationMode)', 'Official frontend feedback policy hint guard must reject empty confirmation mode');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'memory.write', 'Official frontend must not write memory directly');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'requiresConfirmation', 'Official frontend must validate memory confirmation affordance flag');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.feeds', 'Official frontend must validate MemoryCandidate.feeds');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_MEMORY_CANDIDATE_FEEDS', 'Official frontend feedback response guard must consume generated memory candidate feed taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.feeds.every(isAtelierMemoryCandidateFeed)', 'Official frontend feedback response guard must validate feeds through generated taxonomy helper');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "new Set(['planner', 'risk', 'verifier'])", 'Official frontend feedback response guard must not keep local memory candidate feed allowlist');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'atelier.feedback.memoryConfirmationRequired', 'Official frontend must show Station-owned memory confirmation requirement');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'atelier.feedback.rerunConfirmationRequired', 'Official frontend must show Station-owned rerun review requirement');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'ATELIER_MEMORY_CONFIRMATION_MODE', 'Official frontend feedback flow must consume generated memory confirmation mode');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'ATELIER_RERUN_CONFIRMATION_MODE', 'Official frontend feedback flow must consume generated rerun confirmation mode');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "confirmationMode === 'station_memory_review'", 'Official frontend feedback flow must not hardcode memory confirmation mode comparison');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "confirmationMode === 'station_rerun_review'", 'Official frontend feedback flow must not hardcode rerun confirmation mode comparison');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'requiresConfirmation: true', 'Browser prototype feedback must show memory confirmation-required affordance');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_MEMORY_CONFIRMATION_MODE', 'Browser prototype runtime must consume generated memory confirmation mode');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'ATELIER_RERUN_CONFIRMATION_MODE', 'Browser prototype runtime must consume generated rerun confirmation mode');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "confirmationMode: 'station_memory_review'", 'Browser prototype runtime must not hardcode memory confirmation mode response');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "confirmationMode: 'station_rerun_review'", 'Browser prototype runtime must not hardcode rerun confirmation mode response');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, "['planner', 'risk', 'verifier']", 'Browser prototype feedback must model MemoryCandidate.feeds');
expectIncludes(files.prototypePage, contents.prototypePage, 'Station memory confirmation required', 'Browser prototype feedback status must explain memory confirmation is pending');
expectIncludes(files.prototypePage, contents.prototypePage, 'Station rerun review required', 'Browser prototype feedback status must explain rerun review is pending');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_MEMORY_CONFIRMATION_MODE', 'Browser prototype feedback flow must consume generated memory confirmation mode');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_RERUN_CONFIRMATION_MODE', 'Browser prototype feedback flow must consume generated rerun confirmation mode');
expectNotIncludes(files.prototypePage, contents.prototypePage, "confirmationMode === 'station_memory_review'", 'Browser prototype feedback flow must not hardcode memory confirmation mode comparison');
expectNotIncludes(files.prototypePage, contents.prototypePage, "confirmationMode === 'station_rerun_review'", 'Browser prototype feedback flow must not hardcode rerun confirmation mode comparison');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'atelier.rerun', 'Official frontend must not expose direct rerun');
if (!contract.methods.includes('atelier.memory.confirmCandidate')) {
  failures.push(`${files.contract}: methods missing atelier.memory.confirmCandidate`);
}
if (!contract.runtimeMethods.includes('atelier.memory.confirmCandidate')) {
  failures.push(`${files.contract}: runtimeMethods missing atelier.memory.confirmCandidate`);
}
if (!contract.gatewayActions.includes('memory.confirmCandidate')) {
  failures.push(`${files.contract}: gatewayActions missing memory.confirmCandidate`);
}
const memoryConfirmationPayload = contract.methodPayloads?.['atelier.memory.confirmCandidate'];
if (!memoryConfirmationPayload || typeof memoryConfirmationPayload !== 'object') {
  failures.push(`${files.contract}: methodPayloads.atelier.memory.confirmCandidate is required`);
} else {
    expectExactStringSet(memoryConfirmationPayload.requiredFields, ['taskId', 'feedbackId'], 'atelier.memory.confirmCandidate.requiredFields');
  expectExactStringSet(
    memoryConfirmationPayload.responseFields,
    ['accepted', 'feedbackId', 'memoryId', 'status', 'source', 'alreadyDone'],
    'atelier.memory.confirmCandidate.responseFields',
  );
  if (memoryConfirmationPayload.allowedConfirmationMode !== 'station_memory_review') {
    failures.push(`${files.contract}: atelier.memory.confirmCandidate.allowedConfirmationMode must be station_memory_review`);
  }
    expectExactStringSet(memoryConfirmationPayload.forbiddenActions, ['memory.write', 'invoke', 'execute', 'run'], 'atelier.memory.confirmCandidate.forbiddenActions');
}
expectIncludes(files.goProjection, contents.goProjection, 'func (s *AtelierProjectionService) ConfirmMemoryCandidate', 'Station memory candidate confirmation service');
expectIncludes(files.goProjection, contents.goProjection, 'loadAtelierFeedbackCandidatePayload(ctx, db, taskID, feedbackID)', 'Station confirmation must load durable feedback payload');
expectIncludes(files.goProjection, contents.goProjection, 'atelierStringValue(payload, "memory_candidate_status") != "candidate"', 'Station confirmation must require candidate feedback policy');
expectIncludes(files.goProjection, contents.goProjection, 'atelierStringValue(payload, "memory_confirmation_mode") != "station_memory_review"', 'Station confirmation must require Station memory review mode');
expectIncludes(files.goProjection, contents.goProjection, '!atelierBoolValue(payload, "memory_confirmation_required")', 'Station confirmation must require confirmation-required flag');
expectIncludes(files.goProjection, contents.goProjection, 's.memoryService.AddMemory', 'Station confirmation must write memory through MemoryService');
expectIncludes(files.goProjection, contents.goProjection, 'domain.MemoryTargetMemory', 'Station confirmation must target long-term memory');
expectIncludes(files.goProjection, contents.goProjection, 'domain.MemoryLayerExperience', 'Station confirmation must write experience-layer memory');
expectIncludes(files.goProjection, contents.goProjection, 'domain.MemorySourceReview', 'Station confirmation must mark review as memory source');
expectIncludes(files.goProjection, contents.goProjection, '"source":', 'Station confirmation must emit audit event source field');
expectIncludes(files.goProjection, contents.goProjection, '"atelier.memory.confirmCandidate"', 'Station confirmation must emit audit event source');
expectIncludes(files.goProjection, contents.goProjection, '"block_kind":', 'Station confirmation must emit audit block kind field');
expectIncludes(files.goProjection, contents.goProjection, '"memory_candidate_confirmed"', 'Station confirmation must emit memory candidate confirmed audit block');
expectIncludes(files.goProjectionHandler, contents.goProjectionHandler, 'HandleConfirmMemoryCandidate', 'Station memory candidate confirmation handler');
expectIncludes(files.goAgent, contents.goAgent, '/agent/atelier/memory/confirm-candidate', 'Station memory candidate confirmation route');
expectIncludes(files.rustGateway, contents.rustGateway, '/sub-agent/agent/atelier/memory/confirm-candidate', 'Desktop gateway memory candidate confirmation Station route');
expectIncludes(files.rustGateway, contents.rustGateway, '"memory.confirmCandidate" | "memoryConfirmCandidate"', 'Desktop gateway memory candidate confirmation action');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestConfirmAtelierMemoryCandidateWritesStationOwnedMemory', 'Station confirmation writes memory test');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestConfirmAtelierMemoryCandidateRejectsNonCandidateFeedback', 'Station confirmation rejects non-candidate test');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'confirmAtelierMemoryCandidate', 'Official frontend memory confirmation client');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke<unknown>('atelier.memory.confirmCandidate'", 'Official frontend must use Host capability for memory confirmation');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isConfirmAtelierMemoryCandidateResponse', 'Official frontend memory confirmation must validate Host response shape');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.memoryId)', 'Official frontend memory confirmation response guard must reject empty memory id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.source)', 'Official frontend memory/rerun confirmation response guard must reject empty source');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'memoryConfirmationFeedbackId', 'Official controller must track pending memory confirmation feedback id');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'confirmMemoryCandidate', 'Official controller must expose memory confirmation action');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.feedback.confirmMemory', 'Official page must render memory confirmation action');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'confirmMemoryCandidate(input', 'Browser prototype runtime must model memory confirmation action');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "call('atelier.memory.confirmCandidate'", 'Browser prototype bridge must call memory confirmation method');
expectIncludes(files.appletBridge, contents.appletBridge, "case 'atelier.memory.confirmCandidate'", 'applet bridge must handle memory confirmation response outside projection snapshot assertion');
expectIncludes(files.appletBridge, contents.appletBridge, 'isMemoryConfirmationResponse', 'applet bridge must validate memory confirmation response shape');
expectIncludes(files.prototypePage, contents.prototypePage, 'runtime.confirmMemoryCandidate', 'Browser prototype page must call runtime memory confirmation');
expectIncludes(files.prototypePage, contents.prototypePage, 'feedbackStatusBlockId', 'Browser prototype feedback status must bind to the source block id');
expectIncludes(files.prototypePage, contents.prototypePage, 'setFeedbackStatusBlockId(blockId)', 'Browser prototype feedback status must remember the source feedback block id');
expectIncludes(files.prototypePage, contents.prototypePage, "feedbackStatusBlockId === b.id ? feedbackStatus : ''", 'Browser prototype feedback status must render only on the source block');
expectIncludes(files.prototypePage, contents.prototypePage, 'memoryConfirmationTaskId', 'Browser prototype must bind pending memory confirmation to the source task id');
expectIncludes(files.prototypePage, contents.prototypePage, 'setMemoryConfirmationTaskId(selected)', 'Browser prototype memory confirmation must remember the source task id');
expectIncludes(files.prototypePage, contents.prototypePage, 'memoryConfirmationBlockId', 'Browser prototype must bind pending memory confirmation affordance to the source block id');
expectIncludes(files.prototypePage, contents.prototypePage, 'setMemoryConfirmationBlockId(blockId)', 'Browser prototype memory confirmation must remember the source block id');
expectIncludes(files.prototypePage, contents.prototypePage, "memoryConfirmationBlockId === b.id ? memoryConfirmationFeedbackId : ''", 'Browser prototype memory confirmation affordance must render only on the source block');
expectIncludes(files.prototypePage, contents.prototypePage, 'taskId: memoryConfirmationTaskId', 'Browser prototype memory confirmation must not use the currently selected task after task switches');
expectIncludes(files.prototypePage, contents.prototypePage, 'setMemoryConfirmationFeedbackId((current) => current)', 'Browser prototype memory confirmation failure must preserve pending review affordance for retry');
expectIncludes(files.prototypePage, contents.prototypePage, 'setMemoryConfirmationTaskId((current) => current)', 'Browser prototype memory confirmation failure must preserve source task id for retry');
expectIncludes(files.prototypePage, contents.prototypePage, 'setMemoryConfirmationBlockId((current) => current)', 'Browser prototype memory confirmation failure must preserve source block id for retry');
expectIncludes(files.prototypeBlocks, contents.prototypeBlocks, 'onConfirmMemoryCandidate', 'Browser prototype feedback bar must render memory confirmation action');
if (!contract.methods.includes('atelier.feedback.confirmRerun')) {
  failures.push(`${files.contract}: methods missing atelier.feedback.confirmRerun`);
}
if (!contract.runtimeMethods.includes('atelier.feedback.confirmRerun')) {
  failures.push(`${files.contract}: runtimeMethods missing atelier.feedback.confirmRerun`);
}
if (!contract.gatewayActions.includes('feedback.confirmRerun')) {
  failures.push(`${files.contract}: gatewayActions missing feedback.confirmRerun`);
}
const rerunConfirmationPayload = contract.methodPayloads?.['atelier.feedback.confirmRerun'];
if (!rerunConfirmationPayload || typeof rerunConfirmationPayload !== 'object') {
  failures.push(`${files.contract}: methodPayloads.atelier.feedback.confirmRerun is required`);
} else {
    expectExactStringSet(rerunConfirmationPayload.requiredFields, ['taskId', 'feedbackId'], 'atelier.feedback.confirmRerun.requiredFields');
  expectExactStringSet(
    rerunConfirmationPayload.responseFields,
    ['accepted', 'feedbackId', 'taskId', 'rerunTaskId', 'status', 'source', 'alreadyDone', 'started'],
    'atelier.feedback.confirmRerun.responseFields',
  );
  if (rerunConfirmationPayload.allowedConfirmationMode !== 'station_rerun_review') {
    failures.push(`${files.contract}: atelier.feedback.confirmRerun.allowedConfirmationMode must be station_rerun_review`);
  }
    expectExactStringSet(rerunConfirmationPayload.forbiddenActions, ['rerun', 'invoke', 'execute', 'run'], 'atelier.feedback.confirmRerun.forbiddenActions');
}
expectIncludes(files.goProjection, contents.goProjection, 'func (s *AtelierProjectionService) ConfirmRerun', 'Station rerun confirmation facade');
expectIncludes(files.goProjection, contents.goProjection, 'func (s *OrchestrationService) createConfirmedFeedbackRerun', 'Station orchestration owns rerun creation');
expectIncludes(files.goProjection, contents.goProjection, 'cloneAtelierFeedbackRerunTaskTx', 'Station rerun confirmation must clone a task transactionally');
expectIncludes(files.goProjection, contents.goProjection, 'atelierStringValue(payload, "rerun_intent_status") != "intent_recorded"', 'Station rerun confirmation must require rerun intent policy');
expectIncludes(files.goProjection, contents.goProjection, 'atelierStringValue(payload, "rerun_confirmation_mode") != "station_rerun_review"', 'Station rerun confirmation must require Station rerun review mode');
expectIncludes(files.goProjection, contents.goProjection, '"source":                        "atelier.feedback.confirmRerun"', 'Station rerun confirmation must emit audit event source');
expectIncludes(files.goProjection, contents.goProjection, '"block_kind":                    "rerun_confirmed"', 'Station rerun confirmation must emit rerun confirmed audit block');
expectIncludes(files.goProjectionHandler, contents.goProjectionHandler, 'HandleConfirmRerun', 'Station rerun confirmation handler');
expectIncludes(files.goAgent, contents.goAgent, '/agent/atelier/feedback/confirm-rerun', 'Station rerun confirmation route');
expectIncludes(files.rustGateway, contents.rustGateway, '/sub-agent/agent/atelier/feedback/confirm-rerun', 'Desktop gateway rerun confirmation Station route');
expectIncludes(files.rustGateway, contents.rustGateway, '"feedback.confirmRerun" | "feedbackConfirmRerun"', 'Desktop gateway rerun confirmation action');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestConfirmAtelierRerunCreatesStationOwnedNewRun', 'Station rerun confirmation creates new run test');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestConfirmAtelierRerunRejectsNonRerunFeedback', 'Station rerun confirmation rejects non-rerun test');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'confirmAtelierFeedbackRerun', 'Official frontend rerun confirmation client');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "sdk.invoke<unknown>('atelier.feedback.confirmRerun'", 'Official frontend must use Host capability for rerun confirmation');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isConfirmAtelierRerunResponse', 'Official frontend rerun confirmation must validate Host response shape');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.taskId)', 'Official frontend rerun confirmation response guard must reject empty task id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isNonEmptyString(record.rerunTaskId)', 'Official frontend rerun confirmation response guard must reject empty rerun task id');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'rerunConfirmationFeedbackId', 'Official controller must track pending rerun confirmation feedback id');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'confirmRerun', 'Official controller must expose rerun confirmation action');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.feedback.confirmRerun', 'Official page must render rerun confirmation action');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official FeedbackBar confirmations must stay Host capability policy intents and must not expose direct memory write/rerun/execute/provider capabilities', 'official frontend gate must prove official FeedbackBar confirmation remains Host capability intent only');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'type AtelierFeedbackSignal', 'Official applet client feedback signal type must come from generated feedback taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'type AtelierMemoryCandidateFeed', 'Official applet client memory candidate feed type must come from generated project taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type { AtelierAgentFlowId, AtelierFeedbackSignal, AtelierRunTargetKind }', 'Official applet client must re-export generated feedback signal type for app consumers');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'feeds: AtelierMemoryCandidateFeed[];', 'Official applet feedback response feeds must derive from generated memory candidate feed taxonomy');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "export type AtelierFeedbackSignal = 'positive' | 'negative' | 'copy' | 'regenerate';", 'Official applet client must not duplicate generated feedback signal taxonomy');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "Array<'planner' | 'risk' | 'verifier'>", 'Official applet client must not duplicate generated memory candidate feed taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_FEEDBACK_SIGNALS.map((signal) => ({', 'Official FeedbackBar must render generated feedback signal taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const FEEDBACK_SIGNAL_LABEL_KEYS: Record<AtelierFeedbackSignal, string>', 'Official FeedbackBar labels must be type-checked against generated feedback signal taxonomy');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "signal: 'positive'", 'Official FeedbackBar must not duplicate generated feedback signal taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'confirmRerun(input', 'Browser prototype runtime must model rerun confirmation action');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'AtelierFeedbackSignal', 'Browser prototype runtime feedback signal type must come from generated feedback taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'AtelierMemoryCandidateFeed', 'Browser prototype runtime memory candidate feed type must come from generated project taxonomy');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'feeds: AtelierMemoryCandidateFeed[];', 'Browser prototype runtime feedback response feeds must derive from generated memory candidate feed taxonomy');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "export type AtelierFeedbackSignal = 'positive' | 'negative' | 'copy' | 'regenerate';", 'Browser prototype runtime must not duplicate generated feedback signal taxonomy');
expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, "Array<'planner' | 'risk' | 'verifier'>", 'Browser prototype runtime must not duplicate generated memory candidate feed taxonomy');
expectIncludes(files.prototypeBlocks, contents.prototypeBlocks, 'ATELIER_FEEDBACK_SIGNALS.map((signal) => button(signal, FEEDBACK_SIGNAL_LABELS[signal]))', 'Browser prototype FeedbackBar must render generated feedback signal taxonomy');
expectIncludes(files.prototypeBlocks, contents.prototypeBlocks, 'const FEEDBACK_SIGNAL_LABELS: Record<AtelierFeedbackSignal, string>', 'Browser prototype FeedbackBar labels must be type-checked against generated feedback signal taxonomy');
expectNotIncludes(files.prototypeBlocks, contents.prototypeBlocks, "button('positive', '👍')", 'Browser prototype FeedbackBar must not duplicate generated feedback signal taxonomy');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "call('atelier.feedback.confirmRerun'", 'Browser prototype bridge must call rerun confirmation method');
expectIncludes(files.appletBridge, contents.appletBridge, "case 'atelier.feedback.confirmRerun'", 'applet bridge must handle rerun confirmation response outside projection snapshot assertion');
expectIncludes(files.appletBridge, contents.appletBridge, 'isRerunConfirmationResponse', 'applet bridge must validate rerun confirmation response shape');
expectIncludes(files.prototypePage, contents.prototypePage, 'runtime.confirmRerun', 'Browser prototype page must call runtime rerun confirmation');
expectIncludes(files.prototypePage, contents.prototypePage, 'rerunConfirmationTaskId', 'Browser prototype must bind pending rerun confirmation to the source task id');
expectIncludes(files.prototypePage, contents.prototypePage, 'setRerunConfirmationTaskId(selected)', 'Browser prototype rerun confirmation must remember the source task id');
expectIncludes(files.prototypePage, contents.prototypePage, 'rerunConfirmationBlockId', 'Browser prototype must bind pending rerun confirmation affordance to the source block id');
expectIncludes(files.prototypePage, contents.prototypePage, 'setRerunConfirmationBlockId(blockId)', 'Browser prototype rerun confirmation must remember the source block id');
expectIncludes(files.prototypePage, contents.prototypePage, "rerunConfirmationBlockId === b.id ? rerunConfirmationFeedbackId : ''", 'Browser prototype rerun confirmation affordance must render only on the source block');
expectIncludes(files.prototypePage, contents.prototypePage, 'taskId: rerunConfirmationTaskId', 'Browser prototype rerun confirmation must not use the currently selected task after task switches');
expectIncludes(files.prototypePage, contents.prototypePage, 'setRerunConfirmationFeedbackId((current) => current)', 'Browser prototype rerun confirmation failure must preserve pending review affordance for retry');
expectIncludes(files.prototypePage, contents.prototypePage, 'setRerunConfirmationTaskId((current) => current)', 'Browser prototype rerun confirmation failure must preserve source task id for retry');
expectIncludes(files.prototypePage, contents.prototypePage, 'setRerunConfirmationBlockId((current) => current)', 'Browser prototype rerun confirmation failure must preserve source block id for retry');
expectIncludes(files.prototypeBlocks, contents.prototypeBlocks, 'onConfirmRerun', 'Browser prototype feedback bar must render rerun confirmation action');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype FeedbackBar confirmations must stay Station-owned policy intents and must not expose direct memory write/rerun/execute/provider capabilities', 'Bridge runtime gate must prove browser prototype FeedbackBar confirmation remains policy-intent only');
for (const replayField of contract.replayFields) {
  expectIncludes(files.tsProjection, contents.tsProjection, replayField, `replay field ${replayField}`);
  expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, replayField, `replay field ${replayField}`);
  expectIncludes(files.goProjection, contents.goProjection, replayField, `replay field ${replayField}`);
}

const forbiddenAppletProductionMethods = [
  'atelier.artifact.create',
  'atelier.artifact.rich.render',
  'atelier.artifact.upsert',
  'atelier.attachment.upload',
  'atelier.console.subscribe',
  'atelier.gate.accept',
  'atelier.gate.cancel',
  'atelier.gate.continue',
  'atelier.gate.recover',
  'atelier.gate.rerun',
  'atelier.gate.resume',
  'atelier.gate.submit',
  'atelier.gate.upsert',
  'atelier.gate.result',
  'atelier.gate.run',
  'atelier.gate.retry',
  'atelier.check.execute',
  'atelier.check.run',
  'atelier.action.execute',
  'atelier.action.run',
  'atelier.policy.override',
  'atelier.provider.execute',
  'atelier.provider.invoke',
  'atelier.provider.plan',
  'atelier.provider.run',
  'atelier.provider.upsert',
  'action.execute',
  'action.run',
  'policy.override',
  'rollback.execute',
  'atelier.gate.plan',
  'atelier.resume.live',
  'atelier.resume.await',
  'atelier.supervisor.start',
  'atelier.supervisor.loop',
  'atelier.replan',
  'atelier.replan.apply',
  'atelier.integrator.run',
  'atelier.logs.subscribe',
  'artifact.rich.render',
  'attachment.upload',
  'console.logs.subscribe',
  'html.render',
  'iframe.render',
  'image.render',
  'rawUrl.render',
  'runtime.logs.subscribe',
];
for (const forbiddenMethod of forbiddenAppletProductionMethods) {
  if (contract.methods.includes(forbiddenMethod) || contract.runtimeMethods.includes(forbiddenMethod)) {
    failures.push(`${files.contract}: ${forbiddenMethod} must not be exposed by the Atelier projection surface`);
  }
  if (contents.officialFrontendClient.includes(forbiddenMethod)) {
    failures.push(`${files.officialFrontendClient}: ${forbiddenMethod} must not be invoked by the Atelier applet`);
  }
  if (contents.manifest.includes(forbiddenMethod)) {
    failures.push(`${files.manifest}: ${forbiddenMethod} must not be declared by the Atelier applet`);
  }
}

expectIncludes(files.goOrchestration, contents.goOrchestration, 'nodeResultArtifactsMetaKey', 'Station node-result artifact meta key symbol');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"artifacts_json"', 'Station node-result artifact meta key value');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'nodeResultGatesMetaKey', 'Station node-result gate meta key symbol');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"gates_json"', 'Station node-result gate meta key value');
expectIncludes(files.agentProto, contents.agentProto, 'TASK_EVENT_TYPE_GATE_RESULT = 13', 'Station gate result event type');
expectIncludes(files.agentProto, contents.agentProto, 'message SubmitCollaborationNodeResultRequest', 'Station typed node-result request');
expectIncludes(files.agentProto, contents.agentProto, 'repeated TaskArtifactRef artifacts', 'Station typed node-result artifacts');
expectIncludes(files.agentProto, contents.agentProto, 'repeated TaskGateResult gates', 'Station typed node-result gates');
expectIncludes(files.goOrchestrationHandler, contents.goOrchestrationHandler, '*model.SubmitCollaborationNodeResultRequest', 'Station node-result handler typed request');
expectIncludes(files.goOrchestrationHandler, contents.goOrchestrationHandler, '*model.SubmitCollaborationNodeResultResponse', 'Station node-result handler typed response');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'collaborationProjectionEventsFromNodeResultRequest', 'Station typed node-result parser');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'collaborationProjectionEventsFromNodeResultMeta', 'Station node-result projection payload parser');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'validateNodeResultArtifactPayload', 'Station artifact payload validator');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"paths", "refs", "artifact_refs", "artifactRefs"', 'Station artifact payload validator must guard artifact refs');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'validateArtifactEvidencePolicy(payload, taskID, "meta."+nodeResultArtifactsMetaKey)', 'Station node-result artifact policy');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'validateNodeResultGatePayload', 'Station gate payload validator');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'isBlockingGateFailure', 'Station blocking gate policy');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gateDecisionFromPayload', 'Station shared blocking gate decision');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'TaskEventType_TASK_EVENT_TYPE_GATE_RESULT', 'Station gate result event type mapping');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'runActiveTaskGatePlanTx(ctx, tx, &task, &node)', 'Station node-result must schedule active GatePlan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'func runActiveTaskGatePlanTx', 'Station active GatePlan scheduler');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"task_id = ? AND step_id = ? AND status = ?"', 'Station active GatePlan lookup scope');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'GatePlanFromPersistence(record)', 'Station scheduler must use GatePlan persistence adapter');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'NewGateRunner(nil).RunPlan', 'Station scheduler must execute typed GatePlan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'ProducedBy: "station.gate_runner"', 'Station scheduled GatePlan event source');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'events = append(events, result.Event)', 'Station scheduler must emit gate projection events');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'status := "executed"', 'Station scheduler must mark executed GatePlan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'status = "blocked"', 'Station scheduler must mark blocked GatePlan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'type gateRecoveryAction string', 'Station-owned gate recovery action type');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gateRecoveryActionContinue gateRecoveryAction = "continue"', 'Station gate recovery continue action');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gateRecoveryActionRerun    gateRecoveryAction = "rerun"', 'Station gate recovery rerun action');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gateRecoveryActionAccept   gateRecoveryAction = "accept"', 'Station gate recovery accept action');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gateRecoveryActionCancel   gateRecoveryAction = "cancel"', 'Station gate recovery cancel action');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gateRecoveryActionFromPayload(payload)', 'Station interrupt resolution must parse gate recovery action');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'resumeCollaborationTaskWithGateRecoveryTx', 'Station guarded resume must own gate recovery');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'applyGateBlockedRecoveryTx', 'Station blocked gate recovery state machine');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'updateBlockedGatePlansTx', 'Station blocked GatePlan status update');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'expireOrRejectActiveGateRecoveryLeasesTx', 'Station gate recovery lease fence');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'executorLeaseStatusActive', 'Station gate recovery checks active executor leases');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'executorLeaseStatusExpired', 'Station gate recovery expires stale executor leases');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gate-blocked task has an active executor lease', 'Station gate recovery rejects duplicate active execution');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'gateBlockedNodeMatches', 'Station rerun targets blocked node');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxAcceptsGateBlockedTask', 'Station gate recovery accept test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxRerunsGateBlockedNode', 'Station gate recovery rerun test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxCancelsGateBlockedTask', 'Station gate recovery cancel test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxRejectsGateBlockedTaskWithActiveLease', 'Station gate recovery active lease rejection test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxExpiresStaleLeaseBeforeGateRecovery', 'Station gate recovery expired lease recovery test');
expectIncludes(files.goLiveResumeBroker, contents.goLiveResumeBroker, 'type LiveResumeBroker struct', 'Station live resume broker');
expectIncludes(files.goLiveResumeBroker, contents.goLiveResumeBroker, 'func (b *LiveResumeBroker) Await', 'Station live resume broker await');
expectIncludes(files.goLiveResumeBroker, contents.goLiveResumeBroker, 'func (b *LiveResumeBroker) Resolve', 'Station live resume broker resolve');
expectIncludes(files.goLiveResumeBroker, contents.goLiveResumeBroker, 'func (b *LiveResumeBroker) HasWaiter', 'Station live resume broker waiter guard');
expectIncludes(files.goTurnService, contents.goTurnService, 'liveResumeBroker *LiveResumeBroker', 'TurnService owns live resume broker handle');
expectIncludes(files.goTurnService, contents.goTurnService, 'func (s *TurnService) SetLiveResumeBroker', 'TurnService shared live resume broker injection');
expectIncludes(files.goTurnService, contents.goTurnService, 'func (s *TurnService) AwaitLiveResume', 'TurnService live resume await entry');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'liveResume        *LiveResumeBroker', 'OrchestrationService owns live resume broker handle');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'turnService.SetLiveResumeBroker(broker)', 'OrchestrationService injects shared live resume broker');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'resolveCollaborationInterruptWithLiveResumeTx', 'Station interrupt resolution uses live-aware helper');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'tryLiveResumePausedRunningTaskTx', 'Station live resume path is explicit');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'broker.HasWaiter(task.ID, interruptID)', 'Station live resume requires matching waiter');
expectIncludes(files.goOrchestration, contents.goOrchestration, 's.liveResume.Resolve(liveDecision)', 'Station interrupt resolution delivers live decision after commit');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'return task, nodes, false, liveDecision, nil', 'Station live resume must not start new execution loop');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxRejectsPausedTaskWithRunningNodeWithoutEvent', 'Station no-waiter live resume rejection test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptWithLiveResumeTxWakesWaitingTurn', 'Station live waiter resume test');
expectIncludes(files.goLiveResumeBrokerTest, contents.goLiveResumeBrokerTest, 'TestLiveResumeBrokerDeliversDecision', 'Station live resume broker delivery test');
expectIncludes(files.goLiveResumeBrokerTest, contents.goLiveResumeBrokerTest, 'TestLiveResumeBrokerRejectsDuplicateAndMissingWaiter', 'Station live resume broker duplicate/missing waiter test');
expectIncludes(files.agentProto, contents.agentProto, 'enum TaskGateBlockingLevel', 'Station GatePlan blocking level enum');
expectIncludes(files.agentProto, contents.agentProto, 'enum TaskGateType', 'Station typed Gate type enum');
expectIncludes(files.agentProto, contents.agentProto, 'enum TaskGateCheckType', 'Station typed Gate check enum');
expectIncludes(files.agentProto, contents.agentProto, 'enum TaskGateEvaluatorKind', 'Station typed Gate evaluator enum');
expectIncludes(files.agentProto, contents.agentProto, 'message TaskProviderSpec', 'Station typed provider spec');
expectIncludes(files.agentProto, contents.agentProto, 'string agent_id = 6', 'Station typed provider spec execution agent id');
expectIncludes(files.agentProto, contents.agentProto, 'string role = 7', 'Station typed provider spec node role');
expectIncludes(files.agentProto, contents.agentProto, 'message TaskProviderPlan', 'Station typed provider plan');
expectIncludes(files.agentProto, contents.agentProto, 'TaskProviderPlan provider_plan = 10', 'Station CreateTask typed provider plan request');
expectIncludes(files.agentProto, contents.agentProto, 'message TaskOrchestrationPolicy', 'Station typed orchestration policy');
expectIncludes(files.agentProto, contents.agentProto, 'enum TaskGraphParallelPolicy', 'Station typed task graph parallel policy');
expectIncludes(files.agentProto, contents.agentProto, 'enum SupervisorLoopKind', 'Station typed supervisor loop policy');
expectIncludes(files.agentProto, contents.agentProto, 'enum ReplanPolicyKind', 'Station typed replan policy');
expectIncludes(files.agentProto, contents.agentProto, 'enum ResumeAnchorPolicyKind', 'Station typed resume anchor policy');
expectIncludes(files.agentProto, contents.agentProto, 'TaskOrchestrationPolicy orchestration_policy = 4', 'Station typed orchestration policy attached to provider plan');
expectIncludes(files.agentProto, contents.agentProto, 'message TaskGateEvaluatorSpec', 'Station typed Gate evaluator spec');
expectIncludes(files.agentProto, contents.agentProto, 'message TaskGatePlan', 'Station typed GatePlan proto');
expectIncludes(files.agentProto, contents.agentProto, 'message TaskGateSpec', 'Station typed GateSpec proto');
expectIncludes(files.agentProto, contents.agentProto, 'message TaskGateCheckSpec', 'Station typed GateCheckSpec proto');
expectIncludes(files.agentProto, contents.agentProto, 'TaskGateCheckType typed_check_type = 7', 'Station typed GateCheckSpec check type');
expectIncludes(files.agentProto, contents.agentProto, 'TaskGateType typed_gate_type = 10', 'Station typed GateSpec gate type');
expectIncludes(files.agentProto, contents.agentProto, 'TaskGateEvaluatorSpec evaluator_spec = 11', 'Station typed GateSpec evaluator');
expectIncludes(files.agentProto, contents.agentProto, 'string gate_plan_id = 8', 'Station gate result must link GatePlan');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'type GateRunner struct', 'Station-owned GateRunner');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'type GateCheckExecutor interface', 'Station-owned Gate CheckExecutor');
expectIncludes(files.goGateRunner, contents.goGateRunner, '*model.TaskGateResult', 'Station GateRunner typed gate result');
expectIncludes(files.goGateRunner, contents.goGateRunner, '*model.TaskGatePlan', 'Station GateRunner typed GatePlan input');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'GatePlanFromPersistence', 'Station GatePlan persistence adapter');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'protojson.Unmarshal([]byte(record.PlanJSON), plan)', 'Station GatePlan plan_json single source');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'RunPlan', 'Station GateRunner plan execution entry');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'TypedType model.TaskGateCheckType', 'Station GateRunner check uses typed check type');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'GateType    model.TaskGateType', 'Station GateRunner request uses typed gate type');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'Evaluator   *model.TaskGateEvaluatorSpec', 'Station GateRunner request uses typed evaluator spec');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'gateCheckTypeName(check.TypedType)', 'Station GateRunner prioritizes typed check type');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'addGateRunnerTypedMetadata', 'Station GateRunner emits typed gate/provider metadata');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'check.GetTypedCheckType()', 'Station GateRunner adapter reads typed check type');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'spec.GetTypedGateType()', 'Station GateRunner adapter reads typed gate type');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'spec.GetEvaluatorSpec()', 'Station GateRunner adapter reads typed evaluator spec');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"gate_type", "evaluator_kind", "evaluator_id", "policy_id", "provider_id", "model", "reasoning_effort"', 'Station gate payload validator allows typed gate/provider metadata');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"provider_capabilities", "evaluator_capabilities"', 'Station gate payload validator allows typed capabilities');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'providerPlanFromCreateTaskRequest', 'Station CreateTask consumes typed provider plan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'req.GetProviderPlan()', 'Station CreateTask reads typed provider plan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'provider_plan.providers.agent_id conflicts with meta.agent_ids', 'Station CreateTask rejects typed provider plan and legacy meta conflict');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'taskProviderPlanRecordFromProto', 'Station CreateTask persists typed provider plan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunRecordFromProviderPlan', 'Station CreateTask creates DirectRun entity from DirectRun provider plan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunLifecycleRecordsFromProviderPlan', 'Station CreateTask creates DirectRun TaskRun/ExecutionStep lifecycle marker');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'tx.Create(directRunLifecycle.Run)', 'Station CreateTask persists DirectRun entity transactionally');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'tx.Create(directRunLifecycle.Task)', 'Station CreateTask persists DirectRun TaskRun marker transactionally');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'tx.Create(directRunLifecycle.Step)', 'Station CreateTask persists DirectRun ExecutionStep marker transactionally');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunCreatedEventPayload', 'Station CreateTask emits DirectRun durable marker payload');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'writer.appendTx(ctx, tx, "", taskRecord.ID, directRunLifecycle.Step.StepID', 'Station CreateTask writes DirectRun marker through TaskEventWriter');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'if directRunLifecycle == nil {\n\t\ts.startTaskExecution(actorID, taskRecord, nodeRecords, "create")\n\t} else {\n\t\ts.startDirectRunExecution(actorID, taskRecord.ID, "create")\n\t}', 'Station DirectRun must start the dedicated no-session runtime, not normal collaboration execution');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'TaskSurface_TASK_SURFACE_DIRECT_RUN', 'Station DirectRun TaskRun uses typed DirectRun surface');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'TaskNodeStatus_TASK_NODE_STATUS_PENDING', 'Station DirectRun marker must not claim provider execution started');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'validateDirectRunRuntimePreflight(records)', 'Station DirectRun marker must pass deterministic runtime preflight');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'DirectRun runtime preflight requires provider, model, budget, policy and trace refs', 'Station DirectRun preflight requires global refs');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'DirectRun runtime preflight requires pending step without turn', 'Station DirectRun preflight must not claim provider turn started');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"runtime_preflight":  "passed"', 'Station DirectRun marker event exposes runtime preflight status');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"provider_execution": "not_started"', 'Station DirectRun marker event must not claim provider execution');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'isDirectRunTaskForRecovery', 'Station recovery must split DirectRun away from normal collaboration execution');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'starting DirectRun recovery outside normal collaboration path', 'Station recovery must route DirectRun to dedicated runtime');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'executePendingDirectRun', 'Station has a DirectRun no-session execution entry');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'CallDirectRunProvider', 'Station DirectRun provider call is behind an internal executor');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'evaluateDirectRunRuntimePolicyPreflight', 'Station DirectRun must evaluate Budget/Policy before provider call');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'taskTimeBudgetExceeded(&runtime.Task, time.Now())', 'Station DirectRun enforces time budget before provider call');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunBudgetUsedTokens', 'Station DirectRun enforces token budget usage before provider call');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunBudgetUsedMoney', 'Station DirectRun enforces money budget usage before provider call');
expectIncludes(files.goProviderService, contents.goProviderService, 'BilledMoney', 'Station ProviderCallResponse must expose provider-reported billed money');
expectIncludes(files.goProviderService, contents.goProviderService, 'BillingSource', 'Station ProviderCallResponse must expose provider billing source');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'createDirectRunBudgetUsageTx', 'Station DirectRun must settle provider token usage into budget ledger');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunProviderBilling', 'Station DirectRun must capture provider-reported billing evidence');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'ProviderBilledMoney:', 'Station DirectRun budget ledger must persist provider billed money');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'EstimatedMoney:', 'Station DirectRun budget ledger must retain catalog estimate');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunProviderPricing', 'Station DirectRun must capture provider pricing snapshot');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunProviderPricingFromCatalog', 'Station DirectRun must resolve formal provider pricing catalog snapshots');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunProviderPricingCatalogEntry', 'Station DirectRun pricing catalog must select model-specific entries');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'provider.config.pricing_catalog', 'Station DirectRun pricing catalog source must be durable in pricing_source');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'input_token_usd', 'DirectRun money pricing must come from explicit provider config');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'PricingSource:', 'DirectRun budget ledger must record pricing source');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunPolicyHardDenied', 'Station DirectRun enforces policy hard deny before provider call');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"direct_run_budget_exceeded"', 'Station DirectRun budget block must become a durable interrupt');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"direct_run_policy_denied"', 'Station DirectRun policy block must become a durable interrupt');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'generateID("direct_run_runtime_gate")', 'Station DirectRun runtime block must emit gate evidence');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'isCLIProviderRecord(provider)', 'Station DirectRun detects CLI providers before Station provider execution');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunCLIProviderHandoffBlocker', 'Station DirectRun must convert CLI providers into typed Desktop CodingProvider handoff');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'desktop_coding_provider', 'DirectRun CLI handoff must use stable desktop CodingProvider adapter marker');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'direct_run_desktop_coding_provider_handoff', 'DirectRun CLI handoff interrupt type must be stable');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'cli_command_ref', 'DirectRun CLI handoff must reference provider command without exposing raw command');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'blocker.Extra', 'DirectRun runtime interrupt must persist typed blocker metadata');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'finishDirectRunSuccess', 'Station DirectRun success path persists terminal runtime state');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunArtifactPayload', 'Station DirectRun provider result must become durable artifact evidence');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'directRunGatePayload', 'Station DirectRun provider result must produce gate evidence');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestExecutePendingDirectRunSuccessPersistsProviderArtifactGateAndTraceHooks', 'DirectRun provider success test required');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'load direct run budget usage', 'DirectRun provider success must prove token budget ledger persistence');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'seed provider pricing config', 'DirectRun provider success must prove explicit pricing config is consumed');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'provider.response.invoice', 'DirectRun provider success must prove provider billing evidence is persisted');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'expected direct run pricing catalog snapshot', 'DirectRun provider success must prove pricing snapshot is persisted');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestDirectRunProviderPricingResolvesModelCatalogSnapshot', 'DirectRun provider pricing catalog resolver test required');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'station.provider_pricing_catalog@2026-07-05:gpt-4.1', 'DirectRun provider pricing catalog test must persist source/version/model');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'money budget exceeded', 'DirectRun Budget preflight test must cover persisted money usage');
expectIncludes(files.goBudgetUsageReconciler, contents.goBudgetUsageReconciler, 'type BudgetUsageReconciler struct', 'Station must provide budget usage reconciler');
expectIncludes(files.goBudgetUsageReconciler, contents.goBudgetUsageReconciler, 'budgetUsageExpectedMoney', 'Budget usage reconciler must calculate expected money from pricing snapshot');
expectIncludes(files.goBudgetUsageReconciler, contents.goBudgetUsageReconciler, 'BudgetUsageMismatch', 'Budget usage reconciler must report mismatches');
expectIncludes(files.goBudgetUsageReconciler, contents.goBudgetUsageReconciler, 'BudgetUsageMissingPricing', 'Budget usage reconciler must report missing pricing snapshots');
expectIncludes(files.goBudgetUsageReconciler, contents.goBudgetUsageReconciler, 'MissingPricings', 'Budget usage reconciliation must expose missing pricing evidence');
expectIncludes(files.goBudgetUsageReconciler, contents.goBudgetUsageReconciler, 'ProviderBillingSource', 'Budget usage reconciler must preserve provider billing mismatch source');
expectIncludes(files.goBudgetUsageReconcilerTest, contents.goBudgetUsageReconcilerTest, 'TestBudgetUsageReconcilerBalancesCatalogSnapshot', 'Budget usage reconciler balanced test required');
expectIncludes(files.goBudgetUsageReconcilerTest, contents.goBudgetUsageReconcilerTest, 'TestBudgetUsageReconcilerReportsPricingMismatch', 'Budget usage reconciler mismatch test required');
expectIncludes(files.goBudgetUsageReconcilerTest, contents.goBudgetUsageReconcilerTest, 'TestBudgetUsageReconcilerReportsMissingPricingSnapshot', 'Budget usage reconciler missing pricing test required');
expectIncludes(files.goBudgetUsageReconcilerTest, contents.goBudgetUsageReconcilerTest, 'TestBudgetUsageReconcilerUsesProviderBillingAsActualMoney', 'Budget usage reconciler provider billing mismatch test required');
expectIncludes(files.goBudgetUsageReconcilerTest, contents.goBudgetUsageReconcilerTest, 'TestBudgetUsageReconcilerAcceptsProviderBillingWithoutPricingSnapshot', 'Budget usage reconciler provider billing without pricing test required');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestExecutePendingDirectRunProviderFailurePersistsFailureArtifact', 'DirectRun provider failure test required');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestExecutePendingDirectRunBudgetPolicyPreflightEscalatesBeforeProviderCall', 'DirectRun Budget/Policy preflight test required');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'token budget exceeded', 'DirectRun Budget preflight test must cover persisted token usage');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestExecutePendingDirectRunCreatesCLICodingProviderHandoffWithoutProviderCall', 'DirectRun CLI CodingProvider handoff test required');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'awaiting_desktop_coding_provider', 'DirectRun CLI handoff test must assert adapter state');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'direct_run_desktop_coding_provider_handoff', 'DirectRun CLI handoff test must assert interrupt type');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'must not expose raw CLI command', 'DirectRun CLI handoff test must guard against raw command leakage');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&TaskBudgetUsage{}', 'Station persistence models must register TaskBudgetUsage');
expectIncludes(files.goTaskBudgetUsageModel, contents.goTaskBudgetUsageModel, 'type TaskBudgetUsage struct', 'Station must define TaskBudgetUsage index');
expectIncludes(files.goTaskBudgetUsageModel, contents.goTaskBudgetUsageModel, 'EstimatedMoney', 'TaskBudgetUsage must store estimated money');
expectIncludes(files.goTaskBudgetUsageModel, contents.goTaskBudgetUsageModel, 'ProviderBilledMoney', 'TaskBudgetUsage must store provider billed money');
expectIncludes(files.goTaskBudgetUsageModel, contents.goTaskBudgetUsageModel, 'ProviderBillingSource', 'TaskBudgetUsage must store provider billing source');
expectIncludes(files.goTaskBudgetUsageModel, contents.goTaskBudgetUsageModel, 'func (TaskBudgetUsage) TableName() string { return "agent_task_budget_usages" }', 'TaskBudgetUsage table name must be stable');
expectIncludes(files.taskBudgetUsageMigration, contents.taskBudgetUsageMigration, 'CREATE TABLE IF NOT EXISTS agent_task_budget_usages', 'TaskBudgetUsage migration required');
expectIncludes(files.taskBudgetUsageMigration, contents.taskBudgetUsageMigration, 'estimated_money REAL NOT NULL DEFAULT 0', 'TaskBudgetUsage migration must store estimated money');
expectIncludes(files.taskBudgetUsageMigration, contents.taskBudgetUsageMigration, 'provider_billed_money REAL NOT NULL DEFAULT 0', 'TaskBudgetUsage migration must store provider billed money');
expectIncludes(files.taskBudgetUsageMigration, contents.taskBudgetUsageMigration, 'provider_billing_source TEXT', 'TaskBudgetUsage migration must store provider billing source');
expectIncludes(files.taskBudgetUsageMigration, contents.taskBudgetUsageMigration, 'total_tokens INTEGER NOT NULL DEFAULT 0', 'TaskBudgetUsage migration must store token totals');
expectIncludes(files.taskBudgetUsageMigration, contents.taskBudgetUsageMigration, 'input_token_price REAL NOT NULL DEFAULT 0', 'TaskBudgetUsage migration must store input token price');
expectIncludes(files.taskBudgetUsageMigration, contents.taskBudgetUsageMigration, 'pricing_source TEXT', 'TaskBudgetUsage migration must store pricing source');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'collaborationProviderPlanSourceDirectRun', 'Station DirectRun provider plan source is centralized');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"atelier.direct_run.intent"', 'Station DirectRun provider plan source literal');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'loadRuntimeProviderOverrideForNode', 'Station execution consumes persisted TaskProviderPlan at runtime');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'providerSpecForNode', 'Station execution matches provider plan spec to task node');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'runtimeProvider.ProviderID', 'Station TurnConfig provider can be overridden by provider plan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'runtimeProvider.Model', 'Station TurnConfig model can be overridden by provider plan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'runtimeProvider.ReasoningEffort', 'Station TurnConfig reasoning effort can be overridden by provider plan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'providerPlanRoleForIndex', 'Station node builder consumes typed provider roles');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'atelierAgentRoles', 'Station has canonical Atelier AgentRole allowlist');
expectGoStringMapKeySet(files.goOrchestration, contents.goOrchestration, 'atelierAgentRoles', contract.agentRoleAuthority.roles, 'Station Atelier AgentRole allowlist');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'normalizeAtelierAgentRole', 'Station normalizes typed provider roles to Atelier AgentRole');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'provider_plan.providers.role must be a known Atelier AgentRole', 'Station rejects unknown provider roles');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'collaborationRoleIntegrator = "integrator"', 'Station synthesis node uses AgentRole.integrator');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'applyCollaborationPlanConstraints', 'Station applies P1-10 orchestration constraints');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'parallel collaboration engine requires provider_plan.synthesizer_agent_id as integrator', 'Station parallel engines require integrator identity');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'TaskGraphParallelPolicy_TASK_GRAPH_PARALLEL_POLICY_INTEGRATOR_REQUIRED', 'Station typed integrator-required parallel policy');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'SupervisorLoopKind_SUPERVISOR_LOOP_KIND_STATION_EVENT_BUS', 'Station typed supervisor event bus policy');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'ReplanPolicyKind_REPLAN_POLICY_KIND_BEFORE_B10_FROM_RESUME_ANCHOR', 'Station typed replan policy before B10');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'ResumeAnchorPolicyKind_RESUME_ANCHOR_POLICY_KIND_LATEST_ACCEPTED_CHECKPOINT', 'Station typed resume anchor policy');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'RunCollaborationSupervisorTick', 'Station exposes service-level supervisor runtime tick');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'RunCollaborationSupervisorSweep', 'Station exposes service-level supervisor scheduler sweep');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'CollaborationSupervisorSweepResult', 'Station supervisor sweep returns bounded observability result');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'runCollaborationSupervisorTickTx', 'Station supervisor tick is transactional');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'collaborationSupervisorInterruptReplan', 'Station supervisor emits replan interrupt, not applet method');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'resume_anchor_checkpoint_id', 'Station supervisor replan carries resume anchor');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'task_graph_diff', 'Station supervisor replan carries TaskGraph diff proposal');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'atelier.task_graph_diff/v0', 'Station supervisor TaskGraph diff proposal has versioned contract');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'affected_node_ids', 'Station supervisor TaskGraph diff lists affected nodes');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'retained_node_ids', 'Station supervisor TaskGraph diff lists retained nodes');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'applySupervisorReplanTx', 'Station applies approved supervisor replan inside interrupt resolution');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'pending supervisor replan interrupt is required', 'Station requires pending supervisor replan interrupt before applying diff');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'task_graph_diff_status"] = "applied"', 'Station marks TaskGraph diff applied only after approved replan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'TASK_NODE_STATUS_PENDING', 'Station resets affected nodes for approved replan');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'normalizeHumanDecisionRouteTx', 'Station normalizes HumanDecisionRoute before resolving Atelier escalations');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'human_decision_route"] = "station.orchestration"', 'Station resolved event records HumanDecisionRoute source');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'selectedHumanDecisionOptionAction', 'Station resolves selected HumanDecisionOption.action from durable escalation payload');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'policy human decision route cannot continue hard deny', 'Station rejects policy hard-deny human override');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'blockingGateInterruptPayload', 'Station emits typed EscalationPayload when a blocking gate pauses a task');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"action": "rerun_failed_node"', 'Station blocking gate payload exposes typed rerun_failed_node HumanDecisionOption action');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"reason":                  decision.Reason', 'Station supervisor replan payload exposes generic HumanDecisionRoute reason');
expectIncludes(files.goOrchestration, contents.goOrchestration, '"action": "replan"', 'Station supervisor replan payload exposes typed replan HumanDecisionOption action');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'expected typed human decision options', 'Station tests blocking gate EscalationPayload options');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'expected typed supervisor human decision options', 'Station tests supervisor EscalationPayload options');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxRoutesHumanDecisionGateRerun', 'Station tests HumanDecisionRoute gate rerun path');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxRejectsPolicyContinueRoute', 'Station tests HumanDecisionRoute policy hard deny rejection');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'workspace_conflict', 'Station supervisor detects workspace conflict');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'max_fix_loops', 'Station supervisor detects max fix loop exhaustion');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'station.supervisor.tick', 'Station supervisor replan event source');
expectIncludes(files.goSchedulerService, contents.goSchedulerService, 'JobKindCollaborationSupervisor', 'Station scheduler has collaboration supervisor job kind');
expectIncludes(files.goSchedulerService, contents.goSchedulerService, 'SetOrchestrationService', 'Station scheduler receives orchestration service directly');
expectIncludes(files.goSchedulerService, contents.goSchedulerService, 'executeCollaborationSupervisorSweep', 'Station scheduler executes supervisor sweep without HTTP self-call');
expectIncludes(files.goSchedulerService, contents.goSchedulerService, 'RunCollaborationSupervisorSweep', 'Station scheduler calls supervisor sweep service');
expectIncludes(files.goSchedulerService, contents.goSchedulerService, 'Kind:     JobKindCollaborationSupervisor', 'Station default scheduler config includes supervisor job');
expectIncludes(files.goAgent, contents.goAgent, 'schedulerSvc.SetOrchestrationService(orchestrationSvc)', 'Station wires scheduler to orchestration service');
expectIncludes(files.goProjection, contents.goProjection, 'atelierProviderPlanFromCreateRequest', 'Atelier createFromGoal passes typed provider plan');
expectIncludes(files.goProjection, contents.goProjection, 'ProviderPlan: atelierProviderPlanFromCreateRequest(agentIDs, req.Run)', 'Atelier createFromGoal uses Station typed provider plan');
expectIncludes(files.goProjection, contents.goProjection, 'SynthesizerAgentId: agentIDs[0]', 'Atelier createFromGoal supplies explicit Station integrator identity');
expectIncludes(files.goProjection, contents.goProjection, 'func validateAtelierRunTarget', 'Station Atelier facade validates DirectRun target shape');
expectIncludes(files.goProjection, contents.goProjection, 'run.kind must be agents or model', 'Station Atelier facade rejects unknown run kind');
expectIncludes(files.goProjection, contents.goProjection, 'run.model is required for DirectRun model intent', 'Station DirectRun intent requires model');
expectIncludes(files.goProjection, contents.goProjection, 'run.flowId is not allowed for DirectRun model intent', 'Station DirectRun intent must not mix flowId');
expectIncludes(files.goProjection, contents.goProjection, 'run.agentIds is not allowed for DirectRun model intent', 'Station DirectRun intent must not mix nested agentIds');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, '"agent_ids":     {Kind: "model", Model: "gpt-4.1", AgentIDs: []string{"agent-1"}}', 'Station tests reject nested agentIds in DirectRun model intent');
expectIncludes(files.goProjection, contents.goProjection, '"direct_run_intent"', 'Station createFromGoal must mark DirectRun as Station-owned intent metadata');
expectIncludes(files.goProjection, contents.goProjection, 'source = "atelier.direct_run.intent"', 'Station provider plan source must distinguish DirectRun intent');
expectIncludes(files.goProjection, contents.goProjection, 'func normalizeAtelierIntentPreset', 'Station Atelier facade must normalize Work/Code/Design intent presets');
expectIncludes(files.goProjection, contents.goProjection, 'intentPreset must be work, code, or design', 'Station Atelier facade must reject execution-shaped intent presets');
expectIncludes(files.goProjection, contents.goProjection, '"provider_strategy_preset": "coding_provider_preferred"', 'Code preset must map to a declarative provider strategy preference');
expectIncludes(files.goProjection, contents.goProjection, '"gate_plan_preset":         "lint_typecheck_build"', 'Code preset must map to a declarative gate plan preference');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING', 'projection contract generator must export createFromGoal intent preset mapping');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING', 'Official generated contract must expose createFromGoal intent preset mapping');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING', 'Prototype generated contract must expose createFromGoal intent preset mapping');
for (const [preset, mapping] of Object.entries(expectedIntentPresetMapping)) {
  expectIncludes(files.contract, contents.contract, `"${preset}"`, `projection contract must declare ${preset} intent preset`);
  expectIncludes(files.contract, contents.contract, `"providerStrategyPreset": "${mapping.providerStrategyPreset}"`, `projection contract must map ${preset} provider strategy exactly`);
  expectIncludes(files.contract, contents.contract, `"gatePlanPreset": "${mapping.gatePlanPreset}"`, `projection contract must map ${preset} gate plan exactly`);
  expectIncludes(files.goProjection, contents.goProjection, `"provider_strategy_preset": "${mapping.providerStrategyPreset}"`, `Station facade must map ${preset} provider strategy exactly`);
  expectIncludes(files.goProjection, contents.goProjection, `"gate_plan_preset":         "${mapping.gatePlanPreset}"`, `Station facade must map ${preset} gate plan exactly`);
  expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, `providerStrategyPreset: '${mapping.providerStrategyPreset}'`, `Browser prototype runtime must not duplicate ${preset} provider strategy literal outside generated mapping`);
  expectNotIncludes(files.prototypeRuntime, contents.prototypeRuntime, `gatePlanPreset: '${mapping.gatePlanPreset}'`, `Browser prototype runtime must not duplicate ${preset} gate plan literal outside generated mapping`);
  expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, `"providerStrategyPreset": "${mapping.providerStrategyPreset}"`, `Official generated contract must preserve ${preset} provider strategy mapping`);
  expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, `"gatePlanPreset": "${mapping.gatePlanPreset}"`, `Official generated contract must preserve ${preset} gate plan mapping`);
  expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, `"providerStrategyPreset": "${mapping.providerStrategyPreset}"`, `Prototype generated contract must preserve ${preset} provider strategy mapping`);
  expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, `"gatePlanPreset": "${mapping.gatePlanPreset}"`, `Prototype generated contract must preserve ${preset} gate plan mapping`);
  expectIncludes(files.prototypeReadme, contents.prototypeReadme, `${mapping.providerStrategyPreset} + ${mapping.gatePlanPreset}`, `Prototype README must document ${preset} preset mapping exactly`);
  expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, mapping.providerStrategyPreset, `UI mapping must document ${preset} provider strategy preset`);
  expectIncludes(files.uiImplementationMapping, contents.uiImplementationMapping, mapping.gatePlanPreset, `UI mapping must document ${preset} gate plan preset`);
}
expectIncludes(files.goProjection, contents.goProjection, 'IntentPreset:        meta["intent_preset"]', 'Station projection must expose normalized intent preset metadata');
expectIncludes(files.goProjection, contents.goProjection, 'ProviderStrategy:    meta["provider_strategy_preset"]', 'Station projection must expose provider strategy preset metadata');
expectIncludes(files.goProjection, contents.goProjection, 'GatePlanPreset:      meta["gate_plan_preset"]', 'Station projection must expose gate plan preset metadata');
expectIncludes(files.goProjection, contents.goProjection, 'atelierEngineTypeFromFlowID', 'Station Atelier facade maps applet flowId to EngineType');
expectIncludes(files.goProjection, contents.goProjection, '"expert-hierarchy"', 'Station Atelier flow map includes expert-hierarchy');
expectIncludes(files.goProjection, contents.goProjection, '"roundtable"', 'Station Atelier flow map includes roundtable');
expectIncludes(files.goProjection, contents.goProjection, '"debate-judge"', 'Station Atelier flow map includes debate-judge');
expectIncludes(files.goProjection, contents.goProjection, '"expert-mesh"', 'Station Atelier flow map includes expert-mesh');
expectIncludes(files.goProjection, contents.goProjection, '"swarm"', 'Station Atelier flow map includes swarm');
expectIncludes(files.goProjection, contents.goProjection, '"hierarchy"', 'Station Atelier flow map includes hierarchy');
expectIncludes(files.goProjection, contents.goProjection, 'run.flowId must be a known Atelier EngineType', 'Station Atelier facade rejects unknown flowId');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierEngineTypeFromFlowIDMapsPrototypeFlows', 'Station tests applet flowId to EngineType mapping');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierEngineTypeFromFlowIDRejectsUnknownFlow', 'Station tests unknown flowId rejection');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierDirectRunTargetIsStationOwnedIntent', 'Station tests DirectRun intent remains Station-owned');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierDirectRunTargetRejectsProviderExecutionShape', 'Station tests reject applet provider execution-shaped DirectRun input');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierIntentPresetMapsToDeclarativeProviderAndGatePresets', 'Station tests Work/Code/Design preset mapping to declarative metadata');
expectIncludes(files.goProjectionTest, contents.goProjectionTest, 'TestAtelierIntentPresetRejectsExecutionShapedPreset', 'Station tests preset rejection for execution-shaped input');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];', 'Official applet client intentPreset type must come from generated task intent presets');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'type AtelierRunTargetKind', 'Official applet client run target type must come from generated run target taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'type AtelierAgentFlowId', 'Official applet client flowId type must come from generated agent flow taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type { AtelierAgentFlowId, AtelierFeedbackSignal, AtelierRunTargetKind }', 'Official applet client must re-export generated run target and flowId types for app consumers');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "export type AtelierRunTargetKind = 'model' | 'agents';", 'Official applet client must not duplicate generated run target taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'flowId?: AtelierAgentFlowId', 'Official applet create intent flowId input must derive from generated agent flow taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'const runKind: AtelierRunTargetKind = input.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND', 'Official applet client must default run kind from explicit generated default run target kind');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "const runKind: AtelierRunTargetKind = input.runKind ?? (selectedModel ? 'model' : 'agents')", 'Official applet client must not derive default run target from selected model presence');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierAgentFlowId(source.flowId)', 'Official applet launch config flowId must be validated against generated agent flow taxonomy');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'ATELIER_DEFAULT_TASK_INTENT_PRESET', 'Official applet client must import generated default task intent preset');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'intentPreset: input.intentPreset ?? ATELIER_DEFAULT_TASK_INTENT_PRESET', 'Official applet create intent must submit bounded generated default intentPreset metadata');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "intentPreset: input.intentPreset ?? 'work'", 'Official applet create intent must not duplicate default task intent preset literal');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'ATELIER_DEFAULT_TASK_INTENT_PRESET', 'Official applet controller must import generated default task intent preset');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'useState<AtelierIntentPreset>(ATELIER_DEFAULT_TASK_INTENT_PRESET)', 'Official applet controller must default intentPreset from generated default task intent preset');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "useState<AtelierIntentPreset>('work')", 'Official applet controller must not duplicate default task intent preset literal');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'useState<AtelierRunTargetKind>(ATELIER_DEFAULT_RUN_TARGET_KIND)', 'Official applet controller must default run kind from explicit generated default run target kind');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'certificationCreate.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND', 'Official applet certification create path must default run kind from explicit generated default run target kind');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'useState<string>(ATELIER_DEFAULT_DIRECT_RUN_MODEL)', 'Official applet controller must default direct run model from explicit generated default model');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "useState('openrouter-3o')", 'Official applet controller must not duplicate generated direct run model default');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "certificationCreate.runKind ?? 'agents'", 'Official applet certification create path must not duplicate generated run target default');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, "useState<AtelierRunTargetKind>('model')", 'Official applet controller must not duplicate generated run target default');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, 'useState<AtelierRunTargetKind>(ATELIER_RUN_TARGET_KINDS[0])', 'Official applet controller must not derive default run target from allowedRunKinds ordering');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'useState<AtelierAgentFlowId>(ATELIER_DEFAULT_AGENT_FLOW_ID)', 'Official applet controller must default flowId from explicit generated default agent flow id');
expectNotIncludes(files.officialFrontendController, contents.officialFrontendController, 'useState<AtelierAgentFlowId>(ATELIER_AGENT_FLOW_IDS[0])', 'Official applet controller must not derive default flowId from allowedAgentFlowIds ordering');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'IntentPresetSelector', 'Official applet page must render Work/Code/Design preset selector');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_RUN_TARGET_KINDS.map((kind) => {', 'Official applet run target selector must render generated run target taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ATELIER_DIRECT_RUN_MODELS.map((modelId) => {', 'Official applet run target selector must render generated direct run model taxonomy');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "(['model', 'agents'] as const).map((kind) => {", 'Official applet run target selector must not duplicate generated run target taxonomy');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const MODEL_OPTIONS = [', 'Official applet run target selector must not duplicate direct run model taxonomy locally');
expectIncludes(files.prototypeRuntime, contents.prototypeRuntime, 'intentPresetMetadata(input.intentPreset)', 'Browser prototype runtime must preserve Work/Code/Design preset metadata');
expectIncludes(files.prototypePage, contents.prototypePage, 'intentPreset: mode', 'Browser prototype Work/Code/Design toggle must feed create intent preset');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype Work/Code/Design toggle must stay declarative intentPreset only and must not switch IDE/workspace/provider runtime', 'Bridge runtime gate must prove browser prototype Work/Code/Design toggle remains intentPreset-only');
expectIncludes(files.goProjection, contents.goProjection, 'func (s *AtelierProjectionService) ProviderCapabilities', 'Station provider capability discovery endpoint');
expectIncludes(files.goProjection, contents.goProjection, 'ReadOnly:     true', 'Station provider capabilities must be read-only descriptors');
expectIncludes(files.goProjection, contents.goProjection, 'station.provider.capabilities', 'Station provider capability discovery source');
expectIncludes(files.rustGateway, contents.rustGateway, 'provider.capabilities', 'Desktop gateway provider capability discovery action');
expectIncludes(files.rustGateway, contents.rustGateway, '/sub-agent/agent/atelier/provider/capabilities', 'Desktop gateway provider capability Station route');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'ProviderCapabilitiesPanel', 'Official frontend provider capability panel');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'insertProviderCapabilityCommand', 'Official frontend inserts slash command instead of invoking provider');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official provider capabilities panel must stay read-only discovery and must only insert slash commands', 'official frontend gate must prove provider capability panel remains insert-only');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official provider capability insert command must only edit composer text and must not send, invoke, run, or orchestrate', 'official frontend gate must prove provider capability insert command remains composer-text-only');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "insertProviderCapabilitySource.includes('setComposerText((current) => {')", 'official frontend gate must inspect provider capability insert command setComposerText path');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "!insertProviderCapabilitySource.includes('sendAtelierMessage')", 'official frontend gate must forbid provider capability insert command from sending messages');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "!insertProviderCapabilitySource.includes('sdk.invoke')", 'official frontend gate must forbid provider capability insert command from invoking Host capabilities');
expectIncludes(files.prototypePage, contents.prototypePage, 'visibleCapabilities', 'Browser prototype provider capability panel must derive visible capability descriptors');
expectIncludes(files.prototypePage, contents.prototypePage, 'hiddenCapabilityCount', 'Browser prototype provider capability panel must disclose hidden capability descriptor overflow');
expectIncludes(files.prototypePage, contents.prototypePage, 'more Station provider capability descriptors hidden', 'Browser prototype provider capability panel must explain hidden descriptors remain Station-owned discovery metadata');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype provider capabilities panel must stay read-only discovery and must only insert slash commands', 'Bridge runtime gate must prove browser prototype provider capability panel remains discovery-only');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'sdk.skills.invoke', 'Official page must not invoke skills');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'TaskGateEvaluatorKind_TASK_GATE_EVALUATOR_KIND_PROVIDER', 'Station GateRunner maps typed provider evaluator');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'TaskGateCheckType_TASK_GATE_CHECK_TYPE_CONTRACT_GATE', 'Station GateRunner maps typed contract gate check');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'TaskGateType_TASK_GATE_TYPE_CONTRACT', 'Station GateRunner maps typed contract gate');
expectIncludes(files.goGateRunnerTest, contents.goGateRunnerTest, 'TestGateRunnerRunPlanUsesTypedGateAndProviderSpecs', 'Station typed gate/provider spec test');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'GatePlanId:  strings.TrimSpace(req.GatePlanID)', 'Station GateRunner result links GatePlan');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'nodeResultGatePayloads([]*model.TaskGateResult{gate})', 'Station GateRunner typed gate payload normalization');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'payload["source"] = "station.gate_runner"', 'Station GateRunner event source');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'EventType: domain.EventTypeCollaborationGateResult', 'Station GateRunner gate result event');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'RunAndAppendTx', 'Station GateRunner durable outbox append');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'appendCommittedTaskEventTx', 'Station GateRunner must use TaskEventWriter path');
expectIncludes(files.goGateRunner, contents.goGateRunner, 'gateDecisionFromPayload', 'Station GateRunner must share blocking gate decision');
expectIncludes(files.goGateRunner, contents.goGateRunner, '"schema", "typecheck", "contract-gate"', 'Station GateRunner deterministic check kinds');
expectIncludes(files.goArtifactPolicy, contents.goArtifactPolicy, 'artifactURIPrefix = "artifact://"', 'Station artifact URI policy');
expectIncludes(files.goArtifactPolicy, contents.goArtifactPolicy, 'uri must be artifact://<task_id>/<artifact_id>', 'Station artifact canonical URI error');
expectIncludes(files.goArtifactPolicy, contents.goArtifactPolicy, 'checksum must be sha256:<64 hex chars>', 'Station artifact checksum policy');
expectIncludes(files.goArtifactPolicy, contents.goArtifactPolicy, 'must not self-reference artifact_id', 'Station artifact refs self-reference policy');
expectIncludes(files.desktopOrchestration, contents.desktopOrchestration, '"nodeId": node_id', 'Desktop node result typed node_id');
expectIncludes(files.desktopOrchestration, contents.desktopOrchestration, '"leaseId": lease_id', 'Desktop node result typed lease_id');
expectIncludes(files.desktopOrchestration, contents.desktopOrchestration, '"executorId": executor_id', 'Desktop node result typed executor_id');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'appendNodeResultTaskEventsTx', 'Station node-result transactional outbox append');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'writer.appendTx', 'Station node-result events must use durable TaskEventWriter appendTx');
expectIncludes(files.goOrchestration, contents.goOrchestration, 'items = append(items, strings.TrimSpace(value))', 'Station typed node-result string slices must preserve empty items for policy rejection');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestSubmitCollaborationNodeResultTypedFixturePersistsArtifactGateIndexes', 'Station public typed node-result fixture test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestSubmitCollaborationNodeResultRejectsTypedInvalidArtifactRefsBeforeMutation', 'Station typed node-result invalid refs rollback test');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'syncTaskArtifactForTaskEventTx', 'Station artifact store sync');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'TaskEventType_TASK_EVENT_TYPE_ARTIFACT_CREATED', 'Station artifact store sync must cover artifact event type');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'artifact_id is required', 'Station artifact store sync must reject missing artifact id');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'validateArtifactEvidencePolicy(payload, event.TaskID, "artifact")', 'Station artifact store sync must enforce artifact policy');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'EventSeq:    event.EventSeq', 'Station artifact store sync must index outbox event_seq');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'payloadStringListJSON(payload, "refs", "artifact_refs", "artifactRefs")', 'Station artifact store sync must validate artifact refs');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'RefsJSON:    refsJSON', 'Station artifact store sync must index artifact refs');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'artifactBodyEvidenceFromPayload', 'Station artifact body extraction before outbox append');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'syncTaskArtifactBlobForTaskEventTx', 'Station artifact body blob sync');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'return []string{"markdown", "content", "body", "html", "diff", "patch"}', 'Station artifact body fields must be detached from projection');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'delete(payloadMap, key)', 'Station artifact outbox payload must remove body fields');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'payloadMap["body_ref"]', 'Station artifact outbox payload must expose body ref metadata');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'payloadMap["preview_target"]', 'Station artifact outbox payload must expose Host sandbox preview target metadata');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'artifactPreviewTargetMetadata', 'Station artifact outbox must build deterministic preview target metadata');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'atelier-sandbox://%s/%s/preview', 'Station artifact preview target must use Host-owned sandbox ref, not raw URL');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'payloadMap["preview_hint"] = "metadata_only"', 'Station artifact outbox payload must default metadata-only preview');
expectIncludes(files.goProjection, contents.goProjection, 'PreviewHint', 'Atelier artifact projection preview hint field');
expectIncludes(files.goProjection, contents.goProjection, 'BodyRef', 'Atelier artifact projection body ref field');
expectIncludes(files.goProjection, contents.goProjection, 'PreviewTarget *AtelierArtifactPreviewTarget', 'Atelier artifact projection preview target metadata field');
expectIncludes(files.goProjection, contents.goProjection, 'atelierArtifactPreviewTargetFromPayload', 'Atelier artifact projection must sanitize/derive preview target metadata');
expectIncludes(files.goProjection, contents.goProjection, 'normalizeAtelierArtifactPreviewHint', 'Atelier artifact projection normalizes preview hint');
expectIncludes(files.rustGateway, contents.rustGateway, '"previewHint"', 'Desktop mapper forwards artifact preview hint metadata');
expectIncludes(files.rustGateway, contents.rustGateway, '"bodyRef"', 'Desktop mapper forwards artifact body ref metadata');
expectIncludes(files.rustGateway, contents.rustGateway, 'atelier_artifact_preview_target', 'Desktop mapper forwards sanitized preview target metadata');
expectIncludes(files.rustGateway, contents.rustGateway, '"sandboxRef"', 'Desktop mapper maps preview target sandbox ref metadata');
expectIncludes(files.rustGateway, contents.rustGateway, 'handle_atelier_artifact_preview_open', 'Desktop gateway owns artifact sandbox preview validation');
expectIncludes(files.rustGateway, contents.rustGateway, 'is_canonical_atelier_sandbox_ref', 'Desktop gateway must reject non-canonical sandbox preview refs');
expectIncludes(files.rustGateway, contents.rustGateway, 'is_canonical_atelier_artifact_body_ref', 'Desktop gateway must reject non-canonical artifact body refs');
expectIncludes(files.rustGateway, contents.rustGateway, 'canonical atelier-sandbox://', 'Desktop gateway error must disclose canonical sandbox preview refs');
expectIncludes(files.rustGateway, contents.rustGateway, 'atelier.artifact.preview.open only accepts sandbox_manifest mode', 'Desktop gateway must restrict preview open mode');
expectIncludes(files.rustGateway, contents.rustGateway, '"rendererOwner": "desktop_host"', 'Desktop gateway must return Host renderer owner');
expectIncludes(files.rustGateway, contents.rustGateway, '"rendererMode": "host_sandbox_manifest"', 'Desktop gateway must return Host renderer mode');
expectIncludes(files.rustGateway, contents.rustGateway, '"rendererStatus": "rendered"', 'Desktop gateway must return rendered Host renderer status');
expectIncludes(files.rustGateway, contents.rustGateway, '"__hostCommands"', 'Desktop gateway must hand Atelier preview open to Host command side-effect');
expectIncludes(files.rustGateway, contents.rustGateway, '"action": "openAtelierArtifactPreview"', 'Desktop gateway must request Host-owned Atelier preview UI surface');
expectIncludes(files.rustGateway, contents.rustGateway, 'atelier_artifact_preview_open_accepts_only_host_sandbox_manifest_intent', 'Desktop gateway must test artifact sandbox preview open intent');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactPreviewTargetMode', 'Official projection guard must validate previewTarget mode against generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactPreviewTargetSandboxRef', 'Official projection guard must validate previewTarget sandbox ref scheme against generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactBodyRef(value.bodyRef, taskId, artifactId)', 'Official projection guard must require artifact:// previewTarget body refs bound to task/artifact ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactBodyRef(value.bodyRef, taskId, artifactId)', 'Official projection guard must bind artifact body refs to task/artifact ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactPreviewTargetMode(value.mode)', 'Official projection guard must require previewTarget mode');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactPreviewTargetSandboxRef(value.sandboxRef, taskId, artifactId)', 'Official projection guard must require previewTarget sandbox ref bound to task/artifact ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactPreviewTarget(value.previewTarget, taskId, artifactId)', 'Official projection guard must bind previewTarget refs to task/artifact ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE, taskId, artifactId)', 'Official projection guard must validate canonical artifact body ref shape from generated descriptor');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE, taskId, artifactId)', 'Official projection guard must validate canonical sandbox ref shape from generated descriptor');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_ARTIFACT_BODY_REF_PATTERN', 'Official projection guard must not keep local artifact body ref regex');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_ARTIFACT_PREVIEW_TARGET_SANDBOX_REF_SCHEMES', 'Official projection guard must not validate sandbox refs from scheme-only taxonomy');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`artifactPreview.bodyRefShape` 是 canonical `artifact://<task>/<artifact>/body` 的 contract source-of-truth', 'prototype README must document artifact body ref shape as contract source of truth');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`artifactPreview.sandboxRefShape` 是 canonical `atelier-sandbox://<task>/<artifact>/preview` 的 contract source-of-truth', 'prototype README must document artifact sandbox ref shape as contract source of truth');
for (const [file, source] of [
  [files.prototypeReadme, contents.prototypeReadme],
  [files.functionalModulesPlan, contents.functionalModulesPlan],
  [files.uiImplementationMapping, contents.uiImplementationMapping],
]) {
  for (const staleRichPreviewClaim of [
    'browser prototype 支持四种产物',
    'web 真 `<iframe>`',
    'web 真 iframe',
    '产物预览：web `<iframe>`',
    'markdown rich render 仍 prototype only',
    'Artifact{src/paths}',
    'Artifact{uri}',
    '真 `<iframe>` 内嵌浏览器',
    '真 iframe 内嵌浏览器',
    '真实 `<iframe>` 内嵌浏览器',
    'richer mock artifact preview',
    'markdown/web/image/diff 直接预览',
    'PrototypeOnlyRichPreviewNotice',
    'rich preview branches 必须保留',
    'UNSYNCED notice 位于 markdown/web/image/diff rich render 分支之前',
  ]) {
    expectNotIncludes(file, source, staleRichPreviewClaim, 'Atelier prototype docs must not claim raw rich preview is current browser prototype behavior');
  }
}
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactSandboxRef(record.sandboxRef)', 'Official client response guard must validate canonical sandbox ref shape');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'isAtelierArtifactBodyRef(record.bodyRef)', 'Official client response guard must validate canonical artifact body ref shape');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateMethodIntents(value.methods, value.methodIntents)', 'projection contract generator must validate method intent metadata');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_METHOD_INTENTS', 'projection contract generator must export method intent metadata');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'executionForbidden !== true', 'projection contract generator must fail closed unless applet-visible methods forbid execution');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateCreateFromGoalPayload', 'projection contract generator must validate createFromGoal payload metadata');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'allowedIntentPresets', 'projection contract generator must validate allowed Work/Code/Design presets');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'intentPresetMapping', 'projection contract generator must validate preset provider/gate mappings');
expectIncludes(files.contractGenerator, contents.contractGenerator, "assertString(payload.defaultRunKind, 'methodPayloads.atelier.project.createFromGoal.defaultRunKind')", 'projection contract generator must validate explicit default run target kind');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'payload.allowedRunKinds.includes(payload.defaultRunKind)', 'projection contract generator must require default run target kind to be part of allowed run target taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'payload.allowedDirectRunModels.includes(payload.defaultDirectRunModel)', 'projection contract generator must require default direct run model to be part of allowed model taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'payload.allowedAgentFlowIds.includes(payload.defaultAgentFlowId)', 'projection contract generator must require default agent flow id to be part of allowed agent flow taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateAgentFlowDescriptors(payload)', 'projection contract generator must validate agent flow descriptors');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'agentFlowDescriptors ids must match allowedAgentFlowIds order', 'projection contract generator must require agent flow descriptor ids to match allowed flow ids');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_DEFAULT_RUN_TARGET_KIND', 'projection contract generator must export explicit default run target kind');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_DEFAULT_AGENT_FLOW_ID', 'projection contract generator must export explicit default agent flow id');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_AGENT_FLOW_DESCRIPTORS', 'projection contract generator must export agent flow descriptors');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateTaskLifecycle(value.taskLifecycle, value.methodPayloads)', 'projection contract generator must validate task lifecycle metadata against method payloads');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_TASK_LIFECYCLE_STATES', 'projection contract generator must export task lifecycle states');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'status: { enum: source.taskLifecycle.states }', 'projection contract schema must constrain task.status patches to lifecycle states');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateAgentRoleAuthority(value.agentRoleAuthority)', 'projection contract generator must validate AgentRole authority metadata');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_AGENT_ROLE_AUTHORITY', 'projection contract generator must export AgentRole authority matrix');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_AGENT_ROLES', 'projection contract generator must export AgentRole taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateNegotiationProjection(value.negotiationProjection)', 'projection contract generator must validate negotiation projection metadata');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'negotiationProjection: source.negotiationProjection', 'projection contract generator must emit negotiation projection metadata into generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'type AtelierNegotiationVoiceStance =', 'Official projection validator must type negotiation stance from contract metadata');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isNonEmptyString(value.role)', 'Official projection validator must reject empty negotiation voice role');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_PROJECTION_CONTRACT.negotiationProjection.voiceStances', 'Official projection validator must validate negotiation stance against generated contract metadata');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isNonEmptyString(value.text)', 'Official projection validator must reject empty negotiation voice text');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'value.evidenceRef === undefined || isNonEmptyString(value.evidenceRef)', 'Official projection validator must reject empty negotiation evidence refs while allowing missing refs for concern downgrade');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'value.objectionId === undefined || isNonEmptyString(value.objectionId)', 'Official projection validator must accept non-empty Station-projected objection trace ids');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'export type AtelierNegotiationVoiceStance =', 'Prototype NegoVoice stance must be generated-contract derived');
expectIncludes(files.prototypeTypes, contents.prototypeTypes, 'ATELIER_PROJECTION_CONTRACT.negotiationProjection.voiceStances', 'Prototype NegoVoice stance must consume generated contract taxonomy');
expectIncludes(files.contract, contents.contract, '"projectSurface"', 'projection contract must own project surface taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateProjectSurface(value.projectSurface)', 'projection contract generator must validate project surface taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_PROJECT_SURFACE', 'projection contract generator must export project surface taxonomy');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_PROJECT_STATES', 'official generated contract must export project surface states');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_PROJECT_STATES', 'prototype generated contract must export project surface states');
expectIncludes(files.contract, contents.contract, '"workbenchSurface"', 'projection contract must own workbench surface taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateWorkbenchSurface(value.workbenchSurface)', 'projection contract generator must validate workbench surface taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_WORKBENCH_SURFACE', 'projection contract generator must export workbench surface taxonomy');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_ARTIFACT_KINDS', 'official generated contract must export workbench artifact kind taxonomy');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_ARTIFACT_KINDS', 'prototype generated contract must export workbench artifact kind taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, "assertStringArray(value.artifactPreview.allowedPreviewTargetModes", 'projection contract generator must validate previewTarget allowed modes');
expectIncludes(files.contractGenerator, contents.contractGenerator, "assertStringArray(value.artifactPreview.allowedBodyRefSchemes", 'projection contract generator must validate artifact body ref schemes');
expectIncludes(files.contractGenerator, contents.contractGenerator, "assertStringArray(value.artifactPreview.allowedSandboxRefSchemes", 'projection contract generator must validate previewTarget sandbox ref schemes');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateArtifactRefShape(value.artifactPreview.bodyRefShape', 'projection contract generator must validate artifact body ref shape');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateArtifactRefShape(value.artifactPreview.sandboxRefShape', 'projection contract generator must validate artifact sandbox ref shape');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateArtifactPreviewOpenPayload', 'projection contract generator must validate artifact preview open method payload');
expectIncludes(files.contractGenerator, contents.contractGenerator, "assertStringArray(payload.allowedRendererOwner, 'methodPayloads.atelier.artifact.preview.open.allowedRendererOwner')", 'projection contract generator must validate preview open renderer owner taxonomy');
expectIncludes(files.contract, contents.contract, '"viewSurface"', 'projection contract must own view surface status taxonomy');
expectIncludes(files.contract, contents.contract, '"statusNoticeKinds"', 'projection contract must own page status notice taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateViewSurface(value.viewSurface)', 'projection contract generator must validate view surface status taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_VIEW_STATUSES', 'projection contract generator must export view status taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_STATUS_NOTICE_KINDS', 'projection contract generator must export status notice taxonomy');
expectIncludes(files.contract, contents.contract, '"kinds"', 'projection contract must define recovery kind taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_RECOVERY_KINDS', 'projection contract generator must export recovery kind taxonomy');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'viewSurface.recovery.kinds must match toneByKind keys', 'projection contract generator must validate recovery kind/tone key alignment');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'ATELIER_RECOVERY_TONE_BY_KIND', 'projection contract generator must export recovery tone taxonomy');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_VIEW_SURFACE', 'official generated contract must include view surface taxonomy');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_STATUS_NOTICE_KINDS', 'official generated contract must export status notice taxonomy');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'AtelierRecoveryKind', 'official generated contract must export recovery kind type');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_RECOVERY_KINDS', 'official generated contract must export recovery kind taxonomy');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_VIEW_SURFACE', 'prototype generated contract must include view surface taxonomy');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_STATUS_NOTICE_KINDS', 'prototype generated contract must export status notice taxonomy');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_RECOVERY_KINDS', 'prototype generated contract must export recovery kind taxonomy');
expectIncludes(files.contract, contents.contract, '"statusSeverityByStatus"', 'projection contract must define status chip severity taxonomy');
expectIncludes(files.contract, contents.contract, '"ready": "success"', 'projection contract ready status chip must be the success state');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, '"statusSeverityByStatus"', 'official generated contract must carry status chip severity taxonomy');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, '"statusSeverityByStatus"', 'prototype generated contract must carry status chip severity taxonomy');
expectIncludes(files.contract, contents.contract, '"ready": "✓"', 'projection contract ready prototype recovery symbol must be a steady-state success mark');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, '"ready": "✓"', 'official generated contract must carry ready steady-state symbol');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, '"ready": "✓"', 'prototype generated contract must carry ready steady-state symbol');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official view status matrix must cover every generated view status', 'Official frontend gate must prove exhaustive generated view status matrix coverage');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official typed recovery matrix must cover every generated typed recovery kind', 'Official frontend gate must prove exhaustive typed recovery coverage');
expectIncludes(files.officialViewStatus, contents.officialViewStatus, 'AtelierTypedRecoveryKind', 'Official view status helper must import generated typed recovery kind');
expectIncludes(files.officialViewStatus, contents.officialViewStatus, 'kind is AtelierTypedRecoveryKind', 'Official view status helper must narrow typed recovery status with generated type');
expectNotIncludes(files.officialViewStatus, contents.officialViewStatus, "Extract<AtelierViewStatus, 'auth-denied' | 'disconnected'>", 'Official view status helper must not hardcode typed recovery status subset');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype recovery view matrix must cover every generated view status', 'Bridge runtime gate must prove exhaustive generated prototype recovery status coverage');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype recovery severity matrix must match generated severity taxonomy', 'Bridge runtime gate must prove prototype recovery severity matrix matches generated taxonomy');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype recovery symbol matrix must match generated symbol taxonomy', 'Bridge runtime gate must prove prototype recovery symbol matrix matches generated taxonomy');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'ready shows steady-state success symbol', 'Bridge runtime gate must prove ready does not reuse error-style recovery symbol');
expectNotIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'ready does not look like empty or warning', 'Bridge runtime gate must not preserve vague ready-symbol coverage');
expectNotIncludes(files.contract, contents.contract, '"ready": "!"', 'projection contract ready prototype recovery symbol must not reuse danger symbol');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'auth-denied wins over empty workspace', 'Official frontend gate must cover typed status priority over empty workspace');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'reconciling wins over empty workspace', 'Official frontend gate must cover reconciling priority over empty workspace');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'controller stream connecting transition must derive reconciling view status', 'Official frontend gate must prove stream connecting transition derives reconciling');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'zh-CN status key must be localized', 'Official frontend gate must prevent zh-CN status chips from falling back to English');
expectIncludes(files.prototypePage, contents.prototypePage, 'derivePrototypeRecoveryView(status)', 'Browser prototype recovery panel must use the pure recovery view helper');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'derivePrototypePageSurface', 'Browser prototype must expose a pure page-surface view helper');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'emptyVisible', 'Browser prototype page surface must model empty affordance ownership');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'streamVisible', 'Browser prototype page surface must model stream preservation');
expectIncludes(files.prototypePage, contents.prototypePage, 'resolvePrototypeStatusScenario(window.location.search)', 'Browser prototype page must expose controlled UI status query scenarios');
expectIncludes(files.prototypePage, contents.prototypePage, 'const visibleRuntimeStatus = scenarioStatus ?? runtimeStatus;', 'Browser prototype status scenario must only override the visible UI status');
expectIncludes(files.prototypePage, contents.prototypePage, 'derivePrototypePageSurface({ status: visibleRuntimeStatus, streamLength: stream.length })', 'Browser prototype page must consume pure page-surface view helper');
expectIncludes(files.prototypePage, contents.prototypePage, 'pageSurface.emptyVisible', 'Browser prototype page must render empty affordance from page surface');
expectIncludes(files.prototypePage, contents.prototypePage, 'pageSurface.streamVisible', 'Browser prototype page must render stream from page surface');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype page surface matrix failed', 'Bridge runtime gate must execute browser prototype page-surface matrix');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype page surface matrix must cover every generated view status', 'Bridge runtime gate must prove browser prototype page-surface matrix covers every generated view status');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'empty status owns recovery panel without duplicate empty affordance', 'Bridge runtime gate must prove explicit empty status does not duplicate empty affordance');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'disconnected empty stream shows recovery panel without empty affordance', 'Bridge runtime gate must prove disconnected empty stream does not show empty affordance');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'auth-denied empty stream shows recovery panel without empty affordance', 'Bridge runtime gate must prove auth-denied empty stream does not show empty affordance');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'error preserves stream with recovery panel', 'Bridge runtime gate must prove error recovery preserves existing stream projection');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'disconnected preserves stream with recovery panel', 'Bridge runtime gate must prove disconnected recovery preserves existing stream');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'loading owns page surface', 'Bridge runtime gate must prove loading does not render stale stream');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype controlled status scenario query failed', 'Bridge runtime gate must execute browser prototype controlled status scenario query matrix');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype controlled status scenario must reject execution-shaped status', 'Bridge runtime gate must reject execution-shaped browser prototype status scenarios');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype controlled status scenario must reject runtime capability-shaped status', 'Bridge runtime gate must reject runtime-capability-shaped browser prototype status scenarios');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'ATELIER_PROTOTYPE_STATUS_SCENARIOS', 'Browser prototype recovery helper must define controlled status scenarios');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, "['loading', 'empty', 'disconnected', 'auth-denied']", 'Browser prototype controlled status scenarios must cover loading/empty/disconnected/auth-denied');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, "new URLSearchParams(search).get('atelierStatus')", 'Browser prototype controlled status scenario parser must use query param atelierStatus');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '?atelierStatus=loading|empty|disconnected|auth-denied', 'Prototype README must document controlled visual status scenario query');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '该入口会拒绝 execution-shaped 或 runtime-capability-shaped status，不调用 provider/run/shell', 'Prototype README must keep controlled visual status scenario below execution/runtime capability');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS', 'Browser prototype recovery helper must consume generated severity taxonomy');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS', 'Browser prototype recovery helper must consume generated symbol taxonomy');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'ATELIER_RECOVERY_RETRYABLE_KINDS', 'Browser prototype recovery helper must consume generated retryable taxonomy');
expectIncludes(files.prototypeRecoveryView, contents.prototypeRecoveryView, 'retryableKinds.includes(status.kind)', 'Browser prototype recovery helper must fail closed when status kind is not generated retryable');
expectIncludes(files.prototypePage, contents.prototypePage, 'Projection reload only; no execution, rerun, or provider invoke.', 'Browser prototype recovery retry must disclose projection-only retry boundary');
expectIncludes(files.prototypePage, contents.prototypePage, '<RecoveryPanel status={recoveryStatus} onRetry={reloadWorkspace} />', 'Browser prototype recovery retry must be wired to projection reload');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype recovery retry must reload projection only', 'Bridge runtime gate must fix recovery retry as projection reload only');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'RecoveryPanel` 的 Retry 按钮只绑定 `runtime.loadWorkspace()` projection reload', 'prototype README must document browser recovery retry as projection reload only');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "t('atelier.recovery.retryBoundary')", 'Official recovery retry must disclose projection-only retry boundary');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'bindtap={() => void onRetry()}', 'Official recovery retry must remain a reload callback, not execution');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'atelier.recovery.retryBoundary', 'Official frontend gate must require localized recovery retry boundary');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'official `ErrorPanel` 的 Retry 也只绑定 `controller.load` projection reload', 'prototype README must document official recovery retry as projection reload only');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'auth-denied ignores stale retryable flag', 'Bridge runtime gate must prove prototype auth-denied never shows retry');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'degraded uses warning symbol but is not retryable outside generated retryable kinds', 'Bridge runtime gate must prove prototype degraded does not bypass generated retryable taxonomy');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'error obeys generated retryable kind when runtime marks retryable', 'Bridge runtime gate must prove prototype retry visibility requires generated retryable kind');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'prototype recovery retry visibility matrix must cover every generated retryable recovery kind', 'Bridge runtime gate must prove prototype recovery retry visibility covers every generated retryable kind');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'deriveOfficialRecoveryView(kind)', 'Official recovery panel must derive retry visibility from typed error kind');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, '<ErrorPanel kind={pageSurface.typedRecoveryKind} message={controller.eventStreamError} onRetry={controller.load} />', 'Official typed recovery call site must not own auth/disconnected label fallback');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "pageSurface.typedRecoveryKind === 'auth-denied'", 'Official typed recovery page call site must not branch on generated typed recovery labels');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'deriveOfficialStatusPillView(status)', 'Official status pill must derive tone from contract-backed helper');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 't(statusPillView.labelKey)', 'Official status pill label must derive from the status pill helper');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'type AtelierViewStatus', 'Official status pill must consume generated AtelierViewStatus type');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "type ViewStatus = 'loading'", 'Official page must not duplicate the generated view status taxonomy');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "status === 'auth-denied'", 'Official status pill must not branch on generated view status labels in the page');
expectIncludes(files.officialStatusPillView, contents.officialStatusPillView, 'ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus', 'Official status pill helper must consume generated status severity taxonomy');
expectIncludes(files.officialStatusPillView, contents.officialStatusPillView, '(typeof ATELIER_VIEW_SURFACE.recovery.statusSeverityByStatus)[AtelierViewStatus]', 'Official status pill tone type must derive from generated status severity taxonomy');
expectNotIncludes(files.officialStatusPillView, contents.officialStatusPillView, "OfficialStatusPillTone = 'info' | 'warning' | 'danger' | 'success'", 'Official status pill tone type must not duplicate generated severity taxonomy as a local union');
expectIncludes(files.officialStatusPillView, contents.officialStatusPillView, 'statusLabelKeyByStatus: Record<AtelierViewStatus, string>', 'Official status pill helper must own the exhaustive status label key map');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official status pill tone matrix must cover every generated view status', 'Official frontend gate must prove exhaustive status pill tone coverage');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official status pill label key matrix failed', 'Official frontend gate must prove every status pill label key');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "['loading', 'info', 'atelier.status.loading']", 'Official frontend gate must prove loading status pill is info, not success');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "['empty', 'info', 'atelier.status.empty']", 'Official frontend gate must prove empty status pill is info, not success');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official status pill tone type must derive from generated status severity taxonomy', 'Official frontend gate must prove status pill tone type is generated');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'P2-03 status chip tone 当前也由 projection contract 驱动', 'prototype README must document contract-backed official status chip tones');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`loading/empty -> info`', 'prototype README must document loading/empty status chip tone');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'deriveAtelierPageSurface', 'Official page composition must expose a pure page-surface view model');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'ATELIER_STATUS_NOTICE_KINDS', 'Official page composition must consume generated status notice taxonomy');
expectNotIncludes(files.officialPageComposition, contents.officialPageComposition, "input.viewStatus === 'reconciling' || input.viewStatus === 'degraded'", 'Official page composition must not hardcode status notice status subset');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'globalErrorVisible', 'Official page composition must model global error ownership');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'typedRecoveryKind', 'Official page composition must model typed recovery panel ownership');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'statusNotice', 'Official page composition must model reconciling/degraded notice ownership');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'loadingVisible', 'Official page composition must model loading ownership');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'emptyVisible', 'Official page composition must model empty CTA ownership');
expectIncludes(files.officialPageComposition, contents.officialPageComposition, 'mainContentVisible', 'Official page composition must model main-content preservation');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'deriveAtelierPageSurface', 'Official page must consume pure page-surface view model');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'pageSurface.globalErrorVisible', 'Official page must render global error from page surface');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'pageSurface.typedRecoveryKind', 'Official page must render typed recovery from page surface');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'pageSurface.statusNotice', 'Official page must render status notice from page surface');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'type AtelierStatusNoticeKind', 'Official status notice component must consume generated status notice type');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'status: AtelierStatusNoticeKind', 'Official status notice component props must use generated status notice taxonomy');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "status: 'reconciling' | 'degraded'", 'Official status notice component must not duplicate generated status notice taxonomy');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'pageSurface.loadingVisible', 'Official page must render loading state from page surface');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'pageSurface.emptyVisible', 'Official page must render empty state from page surface');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'pageSurface.mainContentVisible', 'Official page must render main content from page surface');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official page surface matrix failed', 'Official frontend gate must execute page-surface composition matrix');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'officialPageSurfaceMatrix', 'Official frontend gate must keep page-surface cases in an auditable matrix');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'generic error owns page surface', 'Official frontend gate must prove generic error owns the full page surface');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official page surface matrix must cover every generated view status', 'Official frontend gate must prove page-surface matrix covers every generated view status');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'disconnected empty workspace shows typed recovery only', 'Official frontend gate must prove disconnected empty workspace shows typed recovery instead of empty CTA');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'auth-denied snapshot preserves main content with typed recovery', 'Official frontend gate must prove auth-denied preserves existing snapshot content with typed recovery');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'disconnected snapshot preserves main content with typed recovery', 'Official frontend gate must prove typed recovery preserves existing snapshot content');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'reconciling snapshot preserves main content with notice', 'Official frontend gate must prove reconciling preserves existing snapshot content');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'degraded snapshot preserves main content with notice', 'Official frontend gate must prove degraded preserves existing snapshot content with notice');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'degraded empty workspace shows notice without empty CTA', 'Official frontend gate must prove degraded owns empty workspace surface before empty CTA');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "recoveryView.tone === 'warning'", 'Official recovery panel must derive visual tone from the pure recovery view helper');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 't(recoveryView.titleKey)', 'Official recovery panel title must derive from the pure recovery view helper');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'recoveryView.detailKey ? t(recoveryView.detailKey) : message || title', 'Official recovery panel detail must derive from the pure recovery view helper');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'const rawMessageVisible = Boolean(message) && detail !== message;', 'Official recovery panel raw error disclosure must not render empty typed recovery messages');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "t('atelier.error.authDeniedTitle')", 'Official recovery panel page must not own auth-denied title label mapping');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, "t('atelier.error.disconnectedTitle')", 'Official recovery panel page must not own disconnected title label mapping');
expectIncludes(files.officialRecoveryView, contents.officialRecoveryView, 'ATELIER_RECOVERY_RETRYABLE_KINDS', 'Official recovery helper must consume generated retryable taxonomy');
expectIncludes(files.officialRecoveryView, contents.officialRecoveryView, 'ATELIER_RECOVERY_TONE_BY_KIND', 'Official recovery helper must consume generated tone taxonomy');
expectIncludes(files.officialRecoveryView, contents.officialRecoveryView, 'recoveryToneByKind.error', 'Official recovery helper must use generated error tone for global recovery fallback');
expectNotIncludes(files.officialRecoveryView, contents.officialRecoveryView, "?? 'danger'", 'Official recovery helper must not silently fallback to danger when tone taxonomy drifts');
expectNotIncludes(files.officialRecoveryView, contents.officialRecoveryView, 'Record<string, AtelierRecoveryTone>', 'Official recovery helper must not widen generated tone taxonomy to arbitrary strings');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'type AtelierRecoveryKind', 'Official applet client must import generated recovery kind type');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'export type AtelierErrorKind = AtelierRecoveryKind;', 'Official applet error kind must alias generated recovery kind type');
expectNotIncludes(files.officialFrontendClient, contents.officialFrontendClient, "export type AtelierErrorKind = 'auth-denied' | 'disconnected' | 'invalid-projection' | 'agent-ids-required' | 'error';", 'Official applet error kind must not duplicate recovery taxonomy as a local union');
expectIncludes(files.officialRecoveryView, contents.officialRecoveryView, 'satisfies Record<AtelierErrorKind, { titleKey: string; detailKey?: string }>', 'Official recovery helper must own an exhaustive recovery label key map over generated recovery kind type');
expectIncludes(files.officialRecoveryView, contents.officialRecoveryView, 'satisfies Record<AtelierErrorKind, AtelierRecoveryTone>', 'Official recovery helper tone map must be checked against generated recovery kind type');
expectIncludes(files.officialFrontendEventStreamRecovery, contents.officialFrontendEventStreamRecovery, 'ATELIER_RECOVERY_RETRYABLE_KINDS', 'Official event stream retry helper must consume generated retryable taxonomy');
expectIncludes(files.officialFrontendControllerTransitions, contents.officialFrontendControllerTransitions, 'export function stateFromAtelierEventStreamError', 'Official controller stream failure transition must live in a pure helper');
expectIncludes(files.officialFrontendControllerTransitions, contents.officialFrontendControllerTransitions, "eventStreamState: 'degraded'", 'Official controller stream failure helper must degrade existing snapshot surfaces');
expectIncludes(files.officialFrontendControllerTransitions, contents.officialFrontendControllerTransitions, 'pendingActionReset()', 'Official controller stream failure helper must clear pending UI actions');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'stateFromAtelierEventStreamError(error, Boolean(current.snapshot))', 'Official controller subscribe catch must consume stream failure transition helper');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'const normalizedMessage = error.message.toLowerCase();', 'Official frontend error normalization must classify Host/Service errors case-insensitively');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, "normalizedMessage.includes('forbidden')", 'Official frontend error normalization must classify forbidden as auth-denied');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official error normalization matrix failed', 'Official frontend gate must execute error normalization matrix');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'mixed-case unauthorized maps to auth-denied', 'Official frontend gate must prove mixed-case unauthorized maps to auth-denied');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'mixed-case timeout maps to disconnected', 'Official frontend gate must prove mixed-case timeout maps to disconnected');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'controller stream failure transition must stop loading', 'Official frontend gate must prove stream failure transition stops loading');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'subscribe disconnected degrades existing snapshot surface', 'Official frontend gate must prove disconnected subscribe failure degrades existing snapshot surface');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'subscribe auth-denied degrades existing snapshot but hard-stops retry', 'Official frontend gate must prove auth-denied subscribe failure hard-stops retry');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'subscribe failure without snapshot becomes global disconnected load error', 'Official frontend gate must prove no-snapshot stream failure becomes a global typed error');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'first retry starts at 500ms', 'Official frontend gate must prove event stream retry starts with bounded backoff');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'retry stops after bounded attempts', 'Official frontend gate must prove event stream retry stops after bounded attempts');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'retry requires snapshot', 'Official frontend gate must prove event stream retry only runs after a valid snapshot exists');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'eventStreamRetryCases', 'Official frontend gate must keep event stream retry cases in an auditable matrix');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'event stream retry matrix must cover every generated retryable recovery kind', 'Official frontend gate must prove event stream retry covers every generated retryable kind');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'event stream retry matrix must hard-stop every generated non-retryable recovery kind', 'Official frontend gate must prove event stream retry hard-stops every generated non-retryable kind');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'agent ids required never retries', 'Official frontend gate must prove event stream retry hard-stops non-retryable agent-id errors');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'malformed projection event must degrade an existing snapshot surface', 'Official frontend gate must prove malformed projection events degrade an existing snapshot surface');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'P2-05 event-stream retry taxonomy 补充', 'prototype README must document official event-stream retry taxonomy hardening');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'auth-denied / invalid-projection / agent-ids-required 不 retry', 'prototype README must document generated taxonomy non-retryable stream errors');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, 'auth-denied/invalid-projection hard stop', 'prototype README stale event-stream retry hard-stop wording');
expectNotIncludes(files.officialFrontendEventStreamRecovery, contents.officialFrontendEventStreamRecovery, "input.errorKind === 'auth-denied' || input.errorKind === 'invalid-projection'", 'official event stream retry hard-coded non-retryable error list');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official recovery view matrix failed', 'Official frontend gate must prove recovery view matrix');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'officialRecoveryViewMatrix', 'Official frontend gate must keep recovery view cases in an auditable matrix');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official recovery label key matrix must cover every generated recovery tone kind', 'Official frontend gate must prove recovery label key matrix');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'official recovery retry visibility matrix must cover every generated retryable recovery kind', 'Official frontend gate must prove recovery retry visibility covers every generated retryable kind');
expectIncludes(files.officialFrontendZhLocale, contents.officialFrontendZhLocale, '"atelier.status.empty": "空工作区"', 'Atelier zh-CN empty status chip must be localized');
expectIncludes(files.officialFrontendZhLocale, contents.officialFrontendZhLocale, '"atelier.status.authDenied": "无权访问"', 'Atelier zh-CN auth denied status chip must be localized');
expectIncludes(files.officialFrontendZhLocale, contents.officialFrontendZhLocale, '"atelier.status.disconnected": "已断开"', 'Atelier zh-CN disconnected status chip must be localized');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'handleAtelierArtifactPreviewHostUiRequest', 'Desktop Host must have a typed Atelier preview UI adapter');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'Atelier artifact preview Host adapter rejects raw render field', 'Desktop Host preview adapter must reject raw render fields');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'atelierProjectionContract.artifactPreview.sandboxRefShape', 'Desktop Host preview adapter must consume contract sandbox ref shape');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'atelierProjectionContract.artifactPreview.bodyRefShape', 'Desktop Host preview adapter must consume contract artifact body ref shape');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'isAtelierArtifactRef(sandboxRef, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE)', 'Desktop Host preview adapter must validate canonical sandbox refs through contract shape');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'isAtelierArtifactRef(bodyRef, ATELIER_ARTIFACT_BODY_REF_SHAPE)', 'Desktop Host preview adapter must validate canonical artifact body refs through contract shape');
expectNotIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'ATELIER_ARTIFACT_SANDBOX_REF_PATTERN', 'Desktop Host preview adapter must not keep local sandbox ref regex');
expectNotIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, 'ATELIER_ARTIFACT_BODY_REF_PATTERN', 'Desktop Host preview adapter must not keep local body ref regex');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, "rendererOwner !== 'desktop_host'", 'Desktop Host preview adapter must restrict renderer ownership');
expectIncludes(files.desktopAtelierPreviewHost, contents.desktopAtelierPreviewHost, "rendererMode !== 'host_sandbox_manifest'", 'Desktop Host preview adapter must restrict renderer mode');
expectIncludes(files.desktopAtelierPreviewHostTest, contents.desktopAtelierPreviewHostTest, 'records Host-owned sandbox renderer sessions without raw render targets', 'Desktop Host preview adapter must test session recording');
expectIncludes(files.desktopAtelierPreviewHostTest, contents.desktopAtelierPreviewHostTest, 'rejects raw render fields and non-Host preview modes', 'Desktop Host preview adapter must test raw render rejection');
expectIncludes(files.desktopAtelierPreviewHostTest, contents.desktopAtelierPreviewHostTest, 'rejects non-canonical sandbox and body refs', 'Desktop Host preview adapter must test canonical ref rejection');
expectIncludes(files.lynxHostElementTest, contents.lynxHostElementTest, 'executes Atelier artifact preview Host UI commands and hides command metadata from applet result', 'Lynx Host must strip Atelier preview Host command metadata from applet result');
expectIncludes(files.lynxHostElementTest, contents.lynxHostElementTest, "action: 'openAtelierArtifactPreview'", 'Lynx Host test must dispatch Atelier preview Host UI action');
expectIncludes(files.lynxHostElementTest, contents.lynxHostElementTest, '.__hostCommands).toBeUndefined()', 'Lynx Host test must prove applet result does not expose Host commands');
expectIncludes(files.capability, contents.capability, 'AtelierArtifactPreviewOpen', 'Applet capability contract must include artifact preview open method');
expectIncludes(files.manifest, contents.manifest, 'atelier.artifact.preview.open', 'Atelier manifest must explicitly request artifact preview open capability');
expectIncludes(files.rustGateway, contents.rustGateway, 'ATELIER_PROJECTION_CONTRACT_JSON', 'Desktop Gateway preview.open mapper must load Atelier projection contract JSON');
expectIncludes(files.rustGateway, contents.rustGateway, 'body_ref_shape: contract.artifact_preview.body_ref_shape', 'Desktop Gateway preview.open mapper must consume contract artifact body ref shape');
expectIncludes(files.rustGateway, contents.rustGateway, 'sandbox_ref_shape: contract.artifact_preview.sandbox_ref_shape', 'Desktop Gateway preview.open mapper must consume contract sandbox ref shape');
expectIncludes(files.rustGateway, contents.rustGateway, 'is_canonical_atelier_ref(value, &shapes.body_ref_shape)', 'Desktop Gateway preview.open mapper must validate body refs through contract shape');
expectIncludes(files.rustGateway, contents.rustGateway, 'is_canonical_atelier_ref(value, &shapes.sandbox_ref_shape)', 'Desktop Gateway preview.open mapper must validate sandbox refs through contract shape');
expectNotIncludes(files.rustGateway, contents.rustGateway, 'is_canonical_atelier_ref(value, "atelier-sandbox://", "preview")', 'Desktop Gateway preview.open mapper must not hardcode sandbox ref prefix/suffix');
expectNotIncludes(files.rustGateway, contents.rustGateway, 'is_canonical_atelier_ref(value, "artifact://", "body")', 'Desktop Gateway preview.open mapper must not hardcode artifact body ref prefix/suffix');
expectNotIncludes(files.rustGateway, contents.rustGateway, '"markdown": payload.get("markdown")', 'Desktop mapper must not forward artifact markdown body');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'RetentionPolicy: body.RetentionPolicy', 'Station artifact blob must store retention policy');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'syncTaskGateResultForTaskEventTx', 'Station gate result index sync');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'TaskEventType_TASK_EVENT_TYPE_GATE_RESULT', 'Station gate result index must cover gate result event type');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'blockKind != "gate_result"', 'Station gate result index must cover legacy block_kind gate_result');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'gate_id is required', 'Station gate result index must reject missing gate id');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'ArtifactIDsJSON: artifactIDsJSON', 'Station gate result index must store artifact ids');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'ChecksJSON:      checksJSON', 'Station gate result index must store checks');
expectIncludes(files.goTaskEventWriter, contents.goTaskEventWriter, 'EventSeq:        event.EventSeq', 'Station gate result index must store event_seq');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&TaskArtifact{}', 'Station AutoMigrate artifact model');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&TaskArtifactBlob{}', 'Station AutoMigrate artifact blob model');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&TaskProviderPlan{}', 'Station AutoMigrate provider plan model');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&TaskGatePlan{}', 'Station AutoMigrate GatePlan model');
expectIncludes(files.goPersistenceModels, contents.goPersistenceModels, '&TaskGateResult{}', 'Station AutoMigrate GateResult model');
expectIncludes(files.goTaskArtifactModel, contents.goTaskArtifactModel, 'type TaskArtifact struct', 'Station artifact persistence model');
expectIncludes(files.goTaskArtifactModel, contents.goTaskArtifactModel, 'TableName() string { return "agent_task_artifacts" }', 'Station artifact persistence table name');
expectIncludes(files.goTaskArtifactModel, contents.goTaskArtifactModel, 'EventSeq', 'Station artifact persistence model must store event_seq');
expectIncludes(files.goTaskArtifactBlobModel, contents.goTaskArtifactBlobModel, 'type TaskArtifactBlob struct', 'Station artifact blob persistence model');
expectIncludes(files.goTaskArtifactBlobModel, contents.goTaskArtifactBlobModel, 'TableName() string { return "agent_task_artifact_blobs" }', 'Station artifact blob table name');
expectIncludes(files.goTaskArtifactBlobModel, contents.goTaskArtifactBlobModel, 'BodyURI', 'Station artifact blob must store body URI');
expectIncludes(files.goTaskArtifactBlobModel, contents.goTaskArtifactBlobModel, 'ContentHash', 'Station artifact blob must store content hash');
expectIncludes(files.goTaskArtifactBlobModel, contents.goTaskArtifactBlobModel, 'RetentionPolicy', 'Station artifact blob must store retention policy');
expectIncludes(files.goTaskArtifactBlobModel, contents.goTaskArtifactBlobModel, 'BodyText', 'Station artifact blob must store detached body');
expectIncludes(files.goTaskProviderPlanModel, contents.goTaskProviderPlanModel, 'type TaskProviderPlan struct', 'Station provider plan persistence model');
expectIncludes(files.goTaskProviderPlanModel, contents.goTaskProviderPlanModel, 'TableName() string { return "agent_task_provider_plans" }', 'Station provider plan table name');
expectIncludes(files.goTaskProviderPlanModel, contents.goTaskProviderPlanModel, 'PlanJSON', 'Station provider plan persistence model must store plan_json');
expectIncludes(files.goTaskGatePlanModel, contents.goTaskGatePlanModel, 'type TaskGatePlan struct', 'Station GatePlan persistence model');
expectIncludes(files.goTaskGatePlanModel, contents.goTaskGatePlanModel, 'TableName() string { return "agent_task_gate_plans" }', 'Station GatePlan persistence table name');
expectIncludes(files.goTaskGatePlanModel, contents.goTaskGatePlanModel, 'PlanJSON', 'Station GatePlan persistence model must store plan_json');
expectNotIncludes(files.goTaskGatePlanModel, contents.goTaskGatePlanModel, 'GatesJSON', 'GatePlan gates_json dual source');
expectIncludes(files.goTaskGateResultModel, contents.goTaskGateResultModel, 'type TaskGateResult struct', 'Station GateResult query index model');
expectIncludes(files.goTaskGateResultModel, contents.goTaskGateResultModel, 'TableName() string { return "agent_task_gate_results" }', 'Station GateResult query index table name');
expectIncludes(files.goTaskGateResultModel, contents.goTaskGateResultModel, 'GatePlanID', 'Station GateResult query index must link GatePlan');
expectIncludes(files.goTaskGateResultModel, contents.goTaskGateResultModel, 'EventSeq', 'Station GateResult query index must store event_seq');
expectIncludes(files.goTaskGateResultModel, contents.goTaskGateResultModel, 'ArtifactIDsJSON', 'Station GateResult query index must store artifact ids');
expectIncludes(files.goTaskGateResultModel, contents.goTaskGateResultModel, 'ChecksJSON', 'Station GateResult query index must store checks');
expectIncludes(files.taskGatePlanMigration, contents.taskGatePlanMigration, 'CREATE TABLE IF NOT EXISTS agent_task_gate_plans', 'Station GatePlan migration');
expectIncludes(files.taskGatePlanMigration, contents.taskGatePlanMigration, 'plan_json TEXT', 'Station GatePlan migration must store plan_json');
expectNotIncludes(files.taskGatePlanMigration, contents.taskGatePlanMigration, 'gates_json', 'GatePlan gates_json dual source');
expectIncludes(files.taskGateResultMigration, contents.taskGateResultMigration, 'CREATE TABLE IF NOT EXISTS agent_task_gate_results', 'Station GateResult query index migration');
expectIncludes(files.taskGateResultMigration, contents.taskGateResultMigration, 'event_seq BIGINT NOT NULL DEFAULT 0', 'Station GateResult migration event_seq column');
expectIncludes(files.taskGateResultMigration, contents.taskGateResultMigration, 'gate_plan_id VARCHAR(64)', 'Station GateResult migration gate_plan_id column');
expectIncludes(files.taskGateResultMigration, contents.taskGateResultMigration, 'artifact_ids_json TEXT', 'Station GateResult migration artifact ids column');
expectIncludes(files.taskGateResultMigration, contents.taskGateResultMigration, 'checks_json TEXT', 'Station GateResult migration checks column');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestTaskEventWriterIndexesLegacyGateResultTurnEvent', 'Station legacy gate result index test');
expectIncludes(files.goTaskArtifactModel, contents.goTaskArtifactModel, 'RefsJSON', 'Station artifact persistence model must store refs_json');
expectIncludes(files.taskArtifactMigration, contents.taskArtifactMigration, 'CREATE TABLE IF NOT EXISTS agent_task_artifacts', 'Station artifact migration table');
expectIncludes(files.taskArtifactMigration, contents.taskArtifactMigration, 'event_seq BIGINT NOT NULL DEFAULT 0', 'Station artifact migration event_seq column');
expectIncludes(files.taskArtifactMigration, contents.taskArtifactMigration, 'refs_json TEXT', 'Station artifact migration refs_json column');
expectIncludes(files.taskArtifactMigration, contents.taskArtifactMigration, 'payload_json TEXT', 'Station artifact migration payload preservation');
expectIncludes(files.taskArtifactBlobMigration, contents.taskArtifactBlobMigration, 'CREATE TABLE IF NOT EXISTS agent_task_artifact_blobs', 'Station artifact blob migration table');
expectIncludes(files.taskArtifactBlobMigration, contents.taskArtifactBlobMigration, 'body_uri TEXT', 'Station artifact blob migration body_uri column');
expectIncludes(files.taskArtifactBlobMigration, contents.taskArtifactBlobMigration, 'content_hash TEXT', 'Station artifact blob migration content_hash column');
expectIncludes(files.taskArtifactBlobMigration, contents.taskArtifactBlobMigration, 'retention_policy VARCHAR(64)', 'Station artifact blob migration retention policy column');
expectIncludes(files.taskArtifactBlobMigration, contents.taskArtifactBlobMigration, 'body_text TEXT', 'Station artifact blob migration body text column');
expectIncludes(files.taskProviderPlanMigration, contents.taskProviderPlanMigration, 'CREATE TABLE IF NOT EXISTS agent_task_provider_plans', 'Station provider plan migration table');
expectIncludes(files.taskProviderPlanMigration, contents.taskProviderPlanMigration, 'plan_json TEXT', 'Station provider plan migration plan_json column');
expectIncludes(files.goProjection, contents.goProjection, 'purgeAtelierTaskRecordsTx', 'Atelier task purge helper');
expectIncludes(files.goProjection, contents.goProjection, 'redactedAtelierArtifactPayload', 'Atelier artifact projection redacts body fields');
expectIncludes(files.goProjection, contents.goProjection, 'case "markdown", "content", "body", "html", "diff", "patch", "url", "src", "iframe":', 'Station artifact projection redaction must cover contract-forbidden raw body/ref fields');
expectNotIncludes(files.goProjection, contents.goProjection, 'Markdown      string                        `json:"markdown,omitempty"`', 'Station artifact projection struct must not expose raw markdown body');
expectNotIncludes(files.goProjection, contents.goProjection, 'URL           string                        `json:"url,omitempty"`', 'Station artifact projection struct must not expose raw url ref');
expectNotIncludes(files.goProjection, contents.goProjection, 'Src           string                        `json:"src,omitempty"`', 'Station artifact projection struct must not expose raw src ref');
expectNotIncludes(files.goProjection, contents.goProjection, 'Markdown: atelierStringValue(payload, "markdown")', 'Atelier artifact projection markdown body leak');
expectNotIncludes(files.goProjection, contents.goProjection, 'URL:           atelierStringValue(payload, "url"),', 'Station artifact projection mapper must not copy raw url ref from event payload');
expectNotIncludes(files.goProjection, contents.goProjection, 'Src:           atelierStringValue(payload, "src"),', 'Station artifact projection mapper must not copy raw src ref from event payload');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.TaskArtifactBlob{})', 'Atelier task purge must delete artifact blob body store');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.TaskBudgetUsage{})', 'Atelier task purge must delete budget usage ledger');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.TaskProviderPlan{})', 'Atelier task purge must delete provider plans');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.DirectRun{})', 'Atelier task purge must delete DirectRun records');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.TaskGateResult{})', 'Atelier task purge must delete gate result index');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.TaskArtifact{})', 'Atelier task purge must delete artifact index');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.TaskGatePlan{})', 'Atelier task purge must delete gate plans');
expectIncludes(files.goProjection, contents.goProjection, 'Delete(&persistence.InterruptRequest{})', 'Atelier task purge must delete interrupt lifecycle records');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestPurgeAtelierTaskRecordsTxDeletesDurableIndexes', 'Atelier purge durable index cleanup test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'budget usage', 'Atelier purge test must cover budget usage ledger cleanup');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestProviderPlanFromCreateTaskRequestUsesTypedPlan', 'Station typed provider plan create test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestProviderPlanFromCreateTaskRequestRejectsMetaConflict', 'Station typed provider plan conflict test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestProviderPlanFromCreateTaskRequestRejectsUnknownAgentRole', 'Station typed provider plan rejects unknown AgentRole');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'risk-reviewer', 'Station typed provider plan tests AgentRole alias normalization');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestTaskProviderPlanRecordFromProto', 'Station provider plan persistence test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestDirectRunRecordFromProviderPlanCreatesStationOwnedEntity', 'Station tests DirectRun entity persistence record');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestDirectRunLifecycleRecordsFromProviderPlanCreatesNoSessionTaskRunMarker', 'Station tests DirectRun TaskRun/ExecutionStep marker');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestDirectRunLifecycleMarkerPersistsDurableTaskCreatedEvent', 'Station tests DirectRun durable marker event');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestValidateDirectRunRuntimePreflightRejectsMissingTraceRef', 'Station tests DirectRun preflight rejects missing trace ref');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestValidateDirectRunRuntimePreflightRejectsStartedStep', 'Station tests DirectRun preflight rejects started step');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestIsDirectRunTaskForRecoverySplitsNormalCollaborationRecovery', 'Station tests DirectRun recovery does not use normal collaboration execution');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestDirectRunRecordFromProviderPlanRejectsMissingModel', 'Station tests DirectRun entity rejects missing model intent');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestLoadRuntimeProviderOverrideForNodeUsesPersistedPlan', 'Station tests provider plan runtime override');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestApplyCollaborationPlanConstraintsRequiresIntegratorForParallelEngine', 'Station P1-10 parallel integrator constraint test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestApplyCollaborationPlanConstraintsMarksSerialOnlyForSequentialEngine', 'Station P1-10 serial task graph constraint test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestRunCollaborationSupervisorTickTxRequestsWorkspaceConflictReplan', 'Station P1-10 supervisor workspace conflict replan test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestRunCollaborationSupervisorTickTxSkipsDuplicatePendingReplan', 'Station P1-10 supervisor duplicate interrupt fence test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxAppliesSupervisorReplanDiff', 'Station P1-10 approved supervisor replan apply test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestResolveCollaborationInterruptTxRejectsSupervisorReplanWithoutPendingInterrupt', 'Station P1-10 supervisor replan pending interrupt guard test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestRunCollaborationSupervisorSweepRequestsEligibleTasks', 'Station P1-10 supervisor sweep eligible task test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestSchedulerExecuteCollaborationSupervisorSweepRequestsEligibleTasks', 'Station P1-10 scheduler-backed supervisor sweep test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestSchedulerCollaborationSupervisorSweepRequiresOrchestrationService', 'Station P1-10 scheduler missing orchestration guard test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'TestCollaborationSupervisorDecisionDetectsMaxFixLoops', 'Station P1-10 supervisor max fix loops test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'task_graph_diff', 'Station P1-10 supervisor TaskGraph diff payload test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'node-blocked', 'Station P1-10 supervisor TaskGraph diff affected node test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'node-done', 'Station P1-10 supervisor TaskGraph diff retained node test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'expected outbox payload to omit detached body', 'Station artifact outbox body redaction test');
expectIncludes(files.goOrchestrationTest, contents.goOrchestrationTest, 'artifact-report:markdown', 'Station artifact blob body persistence test');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS', 'Official Atelier projection guard must reject generated forbidden body fields');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS', 'Official Atelier projection guard must reject unknown preview target fields');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isArtifactPreviewHint', 'Official Atelier projection guard validates preview hint');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactPreviewTarget', 'Official Atelier projection guard validates preview target metadata');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'value.previewTarget === undefined || isAtelierArtifactPreviewTarget(value.previewTarget, taskId, artifactId)', 'Official Atelier projection guard must validate preview target and ref segment binding');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isKnownTaskArtifactRecordList(workspace.artifacts, taskIds)', 'Official Atelier projection guard must bind snapshot artifacts to task record keys');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactProjection(value.artifact, value.taskId)', 'Official Atelier projection patch guard must bind artifact refs to patch task id');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'Object.prototype.hasOwnProperty.call(value, field)', 'Official Atelier projection guard must reject forbidden body fields before rendering');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierArtifactBodyRef(value.bodyRef, taskId, artifactId)', 'Official Atelier projection guard must require artifact:// body refs bound to task/artifact ids');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-bad-body-ref-shape', 'Official frontend gate must reject malformed artifact:// bodyRef shape');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-body-ref-task-mismatch', 'Official frontend gate must reject bodyRef task segment mismatch');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-body-ref-artifact-mismatch', 'Official frontend gate must reject bodyRef artifact segment mismatch');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-preview-target-empty', 'Official frontend gate must reject empty previewTarget descriptors');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-preview-target-missing-sandbox', 'Official frontend gate must reject previewTarget missing sandboxRef');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-preview-target-missing-body', 'Official frontend gate must reject previewTarget missing bodyRef');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-preview-target-bad-body-ref-shape', 'Official frontend gate must reject malformed previewTarget artifact:// bodyRef shape');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-preview-target-task-mismatch', 'Official frontend gate must reject previewTarget task segment mismatch');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-artifact-preview-target-artifact-mismatch', 'Official frontend gate must reject previewTarget artifact segment mismatch');
expectNotIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'markdown?: string;', 'Official Atelier artifact projection type must not expose markdown body');
expectNotIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'artifact.markdown', 'Official Atelier page must not render artifact markdown body');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'artifact.previewHint', 'Official Atelier page renders preview hint metadata');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'artifact.bodyRef', 'Official Atelier page renders body ref metadata');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'artifact.previewTarget', 'Official Atelier page renders preview target metadata only');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.artifact.previewTargetSandbox', 'Official Atelier page labels preview target sandbox ref as metadata');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'reserved 5, 6;', 'Atelier artifact proto must reserve raw url/src field numbers');
expectIncludes(files.atelierProjectionProto, contents.atelierProjectionProto, 'reserved "markdown", "content", "body", "html", "diff", "patch", "url", "src", "iframe";', 'Atelier artifact proto must reserve all contract-forbidden raw body/ref field names');
const artifactProjectionProtoBlock = sliceRequired(
  files.atelierProjectionProto,
  contents.atelierProjectionProto,
  'message AtelierArtifactProjection {',
  'message AtelierArtifactPreviewTargetProjection {',
  'AtelierArtifactProjection proto message block',
);
for (const forbiddenArtifactField of ['markdown', 'content', 'body', 'html', 'diff', 'patch', 'url', 'src', 'iframe']) {
  expectNotIncludes(files.atelierProjectionProto, artifactProjectionProtoBlock, `string ${forbiddenArtifactField} =`, `Atelier artifact proto must not expose raw ${forbiddenArtifactField} field`);
}
const artifactProjectionGoBlock = sliceRequired(
  files.atelierProjectionProtoGo,
  contents.atelierProjectionProtoGo,
  'type AtelierArtifactProjection struct {',
  'func (x *AtelierArtifactProjection) Reset()',
  'AtelierArtifactProjection Go struct block',
);
const artifactProjectionGoMethodsBlock = sliceRequired(
  files.atelierProjectionProtoGo,
  contents.atelierProjectionProtoGo,
  'func (x *AtelierArtifactProjection) GetId() string {',
  'type AtelierArtifactPreviewTargetProjection struct {',
  'AtelierArtifactProjection Go getter block',
);
const artifactProjectionTsBlock = sliceRequired(
  files.atelierProjectionProtoTs,
  contents.atelierProjectionProtoTs,
  'export type AtelierArtifactProjection = Message<"peers_touch.model.atelier.v1.AtelierArtifactProjection"> & {',
  'export const AtelierArtifactProjectionSchema',
  'AtelierArtifactProjection TS block',
);
for (const [field, goField] of [
  ['markdown', 'Markdown'],
  ['content', 'Content'],
  ['body', 'Body'],
  ['html', 'Html'],
  ['diff', 'Diff'],
  ['patch', 'Patch'],
  ['url', 'Url'],
  ['src', 'Src'],
  ['iframe', 'Iframe'],
]) {
  expectNotIncludes(files.atelierProjectionProtoGo, artifactProjectionGoBlock, `${goField} `, `Atelier artifact proto Go output must not expose raw ${goField} field`);
  expectNotIncludes(files.atelierProjectionProtoGo, artifactProjectionGoBlock, `name=${field},proto3`, `Atelier artifact proto Go output must not carry raw ${field} protobuf tag`);
  expectNotIncludes(files.atelierProjectionProtoGo, artifactProjectionGoMethodsBlock, `Get${goField}()`, `Atelier artifact proto Go output must not expose Get${goField}`);
  expectNotIncludes(files.atelierProjectionProtoTs, artifactProjectionTsBlock, `${field}: string;`, `Atelier artifact proto TS output must not expose raw ${field} field`);
  expectNotIncludes(files.atelierProjectionProtoTs, artifactProjectionTsBlock, `${field}?: string;`, `Atelier artifact proto TS output must not expose optional raw ${field} field`);
  expectNotIncludes(files.atelierProjectionProtoTs, artifactProjectionTsBlock, `string ${field} =`, `Atelier artifact proto TS output must not document raw ${field} field`);
}

expectIncludes(files.appletBridge, contents.appletBridge, 'assertAtelierProjectionSnapshot', 'snapshot guard');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'parseAtelierProjectionEvent', 'bridge runtime must own Host projection event parsing');
expectIncludes(files.tsProjection, contents.tsProjection, 'const taskIds = new Set(workspace.tasks.map((task) => task.id))', 'prototype projection snapshot guard must derive known task ids before task-scoped buckets');
expectIncludes(files.tsProjection, contents.tsProjection, 'isSnapshotSelectedTaskId(value.selectedTaskId, taskIds)', 'prototype projection snapshot guard must reject selectedTaskId outside workspace tasks');
expectIncludes(files.tsProjection, contents.tsProjection, 'isKnownTaskRecordList(workspace.streams, taskIds, isStreamBlock)', 'prototype projection snapshot guard must bind stream records to known task ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'workspace.tasks.every(isTaskProjection)', 'prototype projection snapshot guard must validate task envelopes before load');
expectIncludes(files.tsProjection, contents.tsProjection, 'isKnownTaskRecordList(workspace.todos, taskIds, isTodoItem)', 'prototype projection snapshot guard must bind todo records to known task ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'isKnownTaskRecordValue(workspace.contexts, taskIds, isTaskContext)', 'prototype projection snapshot guard must bind context records to known task ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'isKnownTaskArtifactRecordList(workspace.artifacts, taskIds)', 'prototype projection snapshot guard must bind artifact records to known task ids and ref segments');
expectIncludes(files.tsProjection, contents.tsProjection, 'isKnownTaskRecordList(workspace.gates, taskIds, isGateResultProjection)', 'prototype projection snapshot guard must bind gate records to known task ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'isReplayRecord(workspace.replay, taskIds)', 'prototype projection snapshot guard must bind replay records to known task ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isRecordList', 'prototype projection snapshot guard must own record list validation helper');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isRecordValue', 'prototype projection snapshot guard must own record value validation helper');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isKnownTaskRecordList', 'prototype projection snapshot guard must own known-task record list validation helper');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isKnownTaskRecordValue', 'prototype projection snapshot guard must own known-task record value validation helper');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isTaskProjection', 'prototype projection snapshot/event guard must validate task envelopes');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isWorkspaceOpenTarget', 'prototype projection task guard must reject non-pt-workspace open targets');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isArtifactProjection', 'prototype projection snapshot guard must validate artifact envelopes before load');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isGateResultProjection', 'prototype projection snapshot guard must validate gate result envelopes before load');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isNonEmptyString', 'prototype projection event guard must reject empty task scope strings');
expectIncludes(files.tsProjection, contents.tsProjection, 'value.taskId !== undefined && !isNonEmptyString(value.taskId)', 'prototype projection event guard must reject empty top-level event taskId');
expectIncludes(files.tsProjection, contents.tsProjection, "case 'task.upsert':\n      return isTaskProjection(value.task)", 'prototype projection patch guard must reject malformed task upsert envelopes');
expectIncludes(files.tsProjection, contents.tsProjection, "case 'stream.append':\n      return isNonEmptyString(value.taskId)", 'prototype projection patch guard must reject empty task-scoped stream append taskId');
expectIncludes(files.tsProjection, contents.tsProjection, "case 'decision.resolved':\n      return isNonEmptyString(value.taskId) && isNonEmptyString(value.blockId) && isNonEmptyString(value.choice)", 'prototype projection patch guard must reject empty decision block or choice');
expectIncludes(files.tsProjection, contents.tsProjection, 'value.blocks.every(isStreamBlock)', 'prototype projection patch guard must reject malformed stream block envelopes');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isStreamBlock', 'prototype projection event guard must validate stream block envelope id/kind before append');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isNegoVoice', 'prototype projection event guard must validate negotiation voice schema before append');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_PROJECTION_CONTRACT.negotiationProjection.voiceStances', 'prototype projection event guard must validate negotiation stances from generated contract metadata');
expectIncludes(files.tsProjection, contents.tsProjection, 'value.evidenceRef === undefined || isNonEmptyString(value.evidenceRef)', 'prototype projection event guard must reject empty negotiation evidence refs while allowing missing refs for concern downgrade');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_STREAM_BLOCK_KINDS', 'prototype projection guard must read stream block kinds from generated contract');
expectIncludes(files.contract, contents.contract, '"requiredFieldsByKind"', 'Atelier projection contract must define stream block required fields by kind');
expectIncludes(files.contractGenerator, contents.contractGenerator, 'validateStreamBlockRequiredFields', 'Atelier projection generator must validate stream block required fields');
expectIncludes(files.officialFrontendContractGenerated, contents.officialFrontendContractGenerated, 'ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND', 'Official generated projection contract must export stream block required fields');
expectIncludes(files.prototypeContractGenerated, contents.prototypeContractGenerated, 'ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND', 'Prototype generated projection contract must export stream block required fields');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_DIFF_STREAM_SUMMARY_FIELDS', 'prototype projection guard must read diff stream summary fields from generated contract');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isStreamBlockKind', 'prototype projection guard must reject unknown stream block kinds');
expectIncludes(files.tsProjection, contents.tsProjection, 'function hasRequiredStreamBlockFields', 'prototype projection guard must require generated fields for each stream block kind');
expectIncludes(files.tsProjection, contents.tsProjection, 'function hasDiffStreamSummaryFields', 'prototype projection guard must require generated diff summary fields');
expectIncludes(files.tsProjection, contents.tsProjection, "if (value.kind === 'diff')", 'prototype projection guard must apply diff stream block specific validation');
expectIncludes(files.tsProjection, contents.tsProjection, 'isNonEmptyStringArray(value.paths)', 'prototype projection guard must require non-empty diff stream path refs');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-stream-kind', 'bridge runtime gate must prove unknown stream block kinds are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-user-stream-required-fields', 'bridge runtime gate must prove user stream blocks require text');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-decision-stream-required-fields', 'bridge runtime gate must prove decision stream blocks require decision metadata');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-artifact-stream-required-fields', 'bridge runtime gate must prove artifact stream blocks require artifact metadata');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-nego-stance', 'bridge runtime gate must prove malformed negotiation stances are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-nego-empty-voice-fields', 'bridge runtime gate must prove empty negotiation voice fields are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-diff-stream-block', 'bridge runtime gate must prove malformed diff stream blocks are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-diff-stream-empty-paths', 'bridge runtime gate must prove empty diff stream path refs are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-diff-valid', 'bridge runtime gate must prove valid diff stream metadata is accepted');
expectIncludes(files.tsProjection, contents.tsProjection, "case 'artifact.upsert':\n      return isNonEmptyString(value.taskId) && isArtifactProjection(value.artifact, value.taskId)", 'prototype projection patch guard must reject malformed artifact upsert envelopes and ref segment mismatches');
expectIncludes(files.tsProjection, contents.tsProjection, "case 'gate.upsert':\n      return isNonEmptyString(value.taskId) && isGateResultProjection(value.gate)", 'prototype projection patch guard must reject malformed gate upsert envelopes');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS', 'prototype artifact guard must reject artifact body leaks before projection load');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isArtifactPreviewTarget', 'prototype artifact guard must validate artifact preview target envelopes');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isArtifactBodyRef', 'prototype artifact guard must own artifact:// body ref validation helper');
expectIncludes(files.tsProjection, contents.tsProjection, 'isArtifactBodyRef(value.bodyRef, taskId, artifactId)', 'prototype artifact guard must require artifact:// body refs bound to task/artifact ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'isArtifactBodyRef(value.bodyRef, taskId, artifactId)', 'prototype artifact guard must bind bodyRef to task/artifact ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'isArtifactPreviewTarget(value.previewTarget, taskId, artifactId)', 'prototype artifact guard must bind previewTarget refs to task/artifact ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'isArtifactPreviewTargetMode(value.mode)', 'prototype artifact guard must require previewTarget mode');
expectIncludes(files.tsProjection, contents.tsProjection, 'isArtifactPreviewTargetSandboxRef(value.sandboxRef, taskId, artifactId)', 'prototype artifact guard must require previewTarget sandbox ref bound to task/artifact ids');
expectIncludes(files.tsProjection, contents.tsProjection, 'isArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE, taskId, artifactId)', 'prototype artifact guard must validate canonical artifact body ref shape from generated descriptor');
expectIncludes(files.tsProjection, contents.tsProjection, 'isArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE, taskId, artifactId)', 'prototype artifact guard must validate canonical sandbox ref shape from generated descriptor');
expectNotIncludes(files.tsProjection, contents.tsProjection, 'ARTIFACT_BODY_REF_PATTERN', 'prototype artifact guard must not keep local artifact body ref regex');
expectNotIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_ARTIFACT_PREVIEW_TARGET_SANDBOX_REF_SCHEMES', 'prototype artifact guard must not validate sandbox refs from scheme-only taxonomy');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-bad-body-ref-shape', 'bridge runtime gate must prove malformed artifact:// bodyRef shape is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-upsert-body-ref-task-mismatch', 'bridge runtime gate must prove bodyRef task mismatch is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-upsert-body-ref-artifact-mismatch', 'bridge runtime gate must prove bodyRef artifact mismatch is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-preview-target-empty', 'bridge runtime gate must prove empty previewTarget is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-preview-target-missing-sandbox', 'bridge runtime gate must prove previewTarget missing sandboxRef is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-preview-target-bad-sandbox-ref-shape', 'bridge runtime gate must prove malformed previewTarget sandboxRef shape is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-preview-target-missing-body', 'bridge runtime gate must prove previewTarget missing bodyRef is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-preview-target-bad-body-ref-shape', 'bridge runtime gate must prove malformed previewTarget artifact:// bodyRef shape is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-upsert-preview-target-task-mismatch', 'bridge runtime gate must prove previewTarget task mismatch is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-upsert-preview-target-artifact-mismatch', 'bridge runtime gate must prove previewTarget artifact mismatch is rejected before patch apply');
expectIncludes(files.tsProjection, contents.tsProjection, "case 'context.replace':\n      return isNonEmptyString(value.taskId) && isTaskContext(value.context)", 'prototype projection patch guard must reject malformed task context envelopes');
expectIncludes(files.tsProjection, contents.tsProjection, 'value.todos.every(isTodoItem)', 'prototype projection patch guard must reject malformed todo item envelopes');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isTodoItem', 'prototype projection event guard must validate todo id/text/status before replace');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isTaskContext', 'prototype projection event guard must validate context usedPct/files before replace');
expectIncludes(files.tsProjection, contents.tsProjection, 'isNonNegativeFiniteNumber(value.usedPct)', 'prototype projection context guard must reject negative context usage');
expectIncludes(files.tsProjection, contents.tsProjection, 'value.usedPct <= 100', 'prototype projection context guard must reject over-100 context usage');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isContextFile', 'prototype projection event guard must validate context file name/group before replace');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'workspace.tasks.every(isAtelierTask)', 'official projection snapshot guard must validate task envelopes before load');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'const taskIds = new Set(workspace.tasks.map((task) => task.id))', 'official projection snapshot guard must derive known task ids before task-scoped buckets');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isSnapshotSelectedTaskId(value.selectedTaskId, taskIds)', 'official projection snapshot guard must reject selectedTaskId outside workspace tasks');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isKnownTaskRecordList(workspace.streams, taskIds, isAtelierStreamBlock)', 'official projection snapshot guard must bind stream records to known task ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_STREAM_BLOCK_KINDS', 'official projection guard must read stream block kinds from generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND', 'official projection guard must read stream block required fields from generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_DIFF_STREAM_SUMMARY_FIELDS', 'official projection guard must read diff stream summary fields from generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isAtelierStreamBlockKind', 'official projection guard must reject unknown stream block kinds');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function hasRequiredStreamBlockFields', 'official projection guard must require generated fields for each stream block kind');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function hasDiffStreamSummaryFields', 'official projection guard must require generated diff summary fields');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, "if (value.kind === 'diff')", 'official projection guard must apply diff stream block specific validation');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isNonEmptyStringArray(value.paths)', 'official projection guard must require non-empty diff stream path refs');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'function DiffSummary', 'official frontend must render diff stream metadata summary');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'atelier.diff.morePaths', 'official frontend diff stream card must disclose hidden diff path refs');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-diff-stream-block', 'official frontend gate must prove malformed diff stream blocks are rejected before render');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-user-stream-required-fields', 'official frontend gate must prove user stream blocks require text');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-decision-stream-required-fields', 'official frontend gate must prove decision stream blocks require decision metadata');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'Atelier official decision options must stay human-choice resolve intent only and must not expose resume/rerun/execute/provider capabilities', 'official frontend gate must prove decision options remain resolve-intent only');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'Browser prototype decision card must stay human-choice resolve intent only and must not expose resume/rerun/execute/provider capabilities', 'Bridge runtime gate must prove browser prototype decision card remains resolve-intent only');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-artifact-stream-required-fields', 'official frontend gate must prove artifact stream blocks require artifact metadata');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-diff-stream-empty-paths', 'official frontend gate must prove empty diff stream path refs are rejected before render');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-diff-valid', 'official frontend gate must prove valid diff stream metadata is accepted');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'streamBlocks.requiredFieldsByKind', 'Prototype README must document stream block required-field projection guard');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isKnownTaskRecordList(workspace.todos, taskIds, isAtelierTodoItem)', 'official projection snapshot guard must bind todo records to known task ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isKnownTaskRecordValue(workspace.contexts, taskIds, isAtelierTaskContext)', 'official projection snapshot guard must bind context records to known task ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isNonNegativeFiniteNumber(value.usedPct)', 'official projection context guard must reject negative context usage');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'value.usedPct <= 100', 'official projection context guard must reject over-100 context usage');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isKnownTaskArtifactRecordList(workspace.artifacts, taskIds)', 'official projection snapshot guard must bind artifact records to known task ids and ref segments');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isKnownTaskRecordList(workspace.gates, taskIds, isAtelierGateProjection)', 'official projection snapshot guard must bind gate records to known task ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierReplayRecord(workspace.replay, taskIds)', 'official projection snapshot guard must bind replay cursor records to known task ids');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isKnownTaskRecordList', 'official projection snapshot guard must own known-task record list validation helper');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isKnownTaskRecordValue', 'official projection snapshot guard must own known-task record value validation helper');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'value.taskId !== undefined && !isNonEmptyString(value.taskId)', 'official projection event guard must reject empty top-level event taskId');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isAtelierProjectionEventTaskScopeConsistent', 'official projection event parser must correlate top-level event taskId with patch task scope');
expectIncludes(files.officialFrontendProjectionReducer, contents.officialFrontendProjectionReducer, 'function canApplyPatchToKnownTask', 'official projection reducer must reject unknown task-scoped patches before state mutation');
expectIncludes(files.officialFrontendProjectionReducer, contents.officialFrontendProjectionReducer, "patch.kind === 'snapshot' || patch.kind === 'task.upsert'", 'official projection reducer must keep task.upsert as the only task-creating patch');
expectIncludes(files.officialFrontendProjectionReducer, contents.officialFrontendProjectionReducer, 'current.workspace.tasks.some((task) => task.id === patch.taskId)', 'official projection reducer must bind task-scoped patches to known tasks');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isAtelierTaskStatus', 'official projection task guard must validate lifecycle status against generated contract');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isNonEmptyString', 'official projection task guard must reject empty task envelope strings');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isNonEmptyStringArray', 'official projection project guard must reject empty project reference arrays');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isOneOfString', 'official projection project guard must own enum validation helper');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_PROJECT_STATES', 'official projection guard must validate project state enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_MILESTONE_STATES', 'official projection guard must validate milestone state enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_TASK_GRAPH_NODE_STATES', 'official projection guard must validate task graph node state enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_MEMORY_CANDIDATE_TYPES', 'official projection guard must validate memory candidate type enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_MEMORY_CANDIDATE_SCOPES', 'official projection guard must validate memory candidate scope enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_MEMORY_CANDIDATE_FEEDS', 'official projection guard must validate memory candidate feeds enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_POLICY_RULE_SCOPES', 'official projection guard must validate policy rule scope enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_DEFECT_SOURCES', 'official projection guard must validate defect source enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_DEFECT_STATES', 'official projection guard must validate defect state enum');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'value.length > 0 && value.every(isNonEmptyString)', 'official projection project guard must reject empty reference arrays');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_BLOCKER_SEVERITIES', 'prototype projection guard must validate blocker severity enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_DEPENDENCY_EDGE_TYPES', 'prototype projection guard must validate dependency edge type enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_TASK_GRAPH_PARALLEL_POLICIES', 'prototype projection guard must validate task graph parallel policy enum');
expectIncludes(files.prototypePage, contents.prototypePage, 'Parallel policy: {project.taskGraph.parallelPolicy}', 'Browser prototype TaskGraph panel must disclose Station projected parallel policy');
expectIncludes(files.prototypePage, contents.prototypePage, "project.taskGraph.parallelPolicy === 'integrator_required'", 'Browser prototype TaskGraph panel must disclose integrator-required boundary');
expectIncludes(files.prototypePage, contents.prototypePage, 'Integrator identity and merge execution remain Station-owned', 'Browser prototype TaskGraph integrator disclosure must keep execution Station-owned');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_PROJECT_STATES', 'prototype projection guard must validate project state enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_MILESTONE_STATES', 'prototype projection guard must validate milestone state enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_TASK_GRAPH_NODE_STATES', 'prototype projection guard must validate task graph node state enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_MEMORY_CANDIDATE_TYPES', 'prototype projection guard must validate memory candidate type enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_MEMORY_CANDIDATE_SCOPES', 'prototype projection guard must validate memory candidate scope enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_MEMORY_CANDIDATE_FEEDS', 'prototype projection guard must validate memory candidate feeds enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_POLICY_RULE_SCOPES', 'prototype projection guard must validate policy rule scope enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_DEFECT_SOURCES', 'prototype projection guard must validate defect source enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_DEFECT_STATES', 'prototype projection guard must validate defect state enum');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isNonEmptyStringArray', 'prototype projection project guard must reject empty project reference arrays');
expectIncludes(files.tsProjection, contents.tsProjection, 'value.length > 0 && value.every(isNonEmptyString)', 'prototype projection project guard must reject empty reference arrays');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isRecordList', 'official projection snapshot guard must own record list validation helper');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isRecordValue', 'official projection snapshot guard must own record value validation helper');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'function isAtelierReplayRecord', 'official projection snapshot guard must own replay cursor validation helper');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'isNonNegativeFiniteNumber(item.nextEventSeq)', 'official projection replay guard must reject invalid subscribe cursors');
expectIncludes(files.tsProjection, contents.tsProjection, 'function isReplayRecord', 'prototype projection snapshot guard must own replay cursor validation helper');
expectIncludes(files.tsProjection, contents.tsProjection, 'isNonEmptyString(key)', 'prototype projection replay guard must reject empty task keys');
expectIncludes(files.tsProjection, contents.tsProjection, 'isNonEmptyString(item.source)', 'prototype projection replay guard must reject empty replay sources');
expectIncludes(files.tsProjection, contents.tsProjection, 'isNonNegativeFiniteNumber(item.nextEventSeq)', 'prototype projection replay guard must reject invalid subscribe cursors');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_CONTEXT_FILE_GROUPS', 'official projection context guard must reject invalid file groups from generated taxonomy');
expectIncludes(files.tsProjection, contents.tsProjection, 'ATELIER_CONTEXT_FILE_GROUPS', 'prototype projection context guard must reject invalid file groups from generated taxonomy');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_CONTEXT_FILE_GROUPS.map((k) =>', 'Browser prototype Context tabs must render from generated context file group taxonomy');
expectIncludes(files.prototypePage, contents.prototypePage, 'ATELIER_DEFAULT_CONTEXT_FILE_GROUP', 'Browser prototype Context selected tab must initialize from generated default context file group');
expectIncludes(files.prototypePage, contents.prototypePage, 'useState<ContextFileGroup>(ATELIER_DEFAULT_CONTEXT_FILE_GROUP)', 'Browser prototype Context selected tab must consume generated default context file group');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'useState<ContextFileGroup>(ATELIER_DEFAULT_CONTEXT_FILE_GROUP)', 'Bridge runtime gate must guard generated default context file group usage');
expectNotIncludes(files.prototypePage, contents.prototypePage, 'useState<ContextFileGroup>(ATELIER_CONTEXT_FILE_GROUPS[0])', 'Browser prototype Context selected tab must not derive default from context group ordering');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "!prototypePageSource.includes('useState<ContextFileGroup>(ATELIER_CONTEXT_FILE_GROUPS[0])')", 'Bridge runtime gate must reject context group ordering default');
expectNotIncludes(files.prototypePage, contents.prototypePage, "useState<'files' | 'other'>('files')", 'Browser prototype Context selected tab must not duplicate local files/other taxonomy');
expectNotIncludes(files.prototypePage, contents.prototypePage, "(['files', 'other'] as const).map((k) =>", 'Browser prototype Context tabs must not duplicate local files/other taxonomy');
expectIncludes(files.officialFrontendProjection, contents.officialFrontendProjection, 'ATELIER_TODO_STATUSES', 'official projection todo guard must reject invalid todo status from generated taxonomy');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'invalidWorkspacePatch', 'official frontend gate must prove malformed snapshot task and bucket envelopes are rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad workspace target missing task id', 'official frontend gate must reject malformed pt-workspace URI missing task id');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad workspace target mismatched task id', 'official frontend gate must reject workspaceUri task segment mismatch');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-task-upsert-workspace-target-task-mismatch', 'official frontend gate must reject task.upsert workspaceUri task segment mismatch');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad workspace target mismatched workspace query', 'official frontend gate must reject workspaceUri/workspaceId mismatch');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "state: 'executing'", 'official frontend gate valid project fixture must use canonical project state');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad project state', 'official frontend gate must prove malformed project state is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad milestone state', 'official frontend gate must prove malformed milestone state is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad task graph node state', 'official frontend gate must prove malformed task graph node state is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad risk state', 'official frontend gate must prove malformed project risk state is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'random_note', 'official frontend gate must prove malformed memory candidate type is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad feed', 'official frontend gate must prove malformed memory candidate feeds are rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'depends_on', 'official frontend gate must prove malformed project dependency edge type is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'filesystem', 'official frontend gate must prove malformed policy rule scope is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "severity: 'fatal'", 'official frontend gate must prove malformed policy rule severity is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad source', 'official frontend gate must prove malformed defect source is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'bad state', 'official frontend gate must prove malformed defect state is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'empty evidence', 'official frontend gate must prove empty defect evidence ref is rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'empty targets', 'official frontend gate must prove empty defect target refs are rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'empty target', 'official frontend gate must prove empty defect target refs are rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad risk state', 'bridge runtime gate must prove malformed project risk state is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad workspace target missing task id', 'bridge runtime gate must reject malformed pt-workspace URI missing task id');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad workspace target mismatched task id', 'bridge runtime gate must reject workspaceUri task segment mismatch');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-task-upsert-workspace-target-task-mismatch', 'bridge runtime gate must reject task.upsert workspaceUri task segment mismatch');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad workspace target mismatched workspace query', 'bridge runtime gate must reject workspaceUri/workspaceId mismatch');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'random_note', 'bridge runtime gate must prove malformed memory candidate type is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad feed', 'bridge runtime gate must prove malformed memory candidate feeds are rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "state: 'executing'", 'bridge runtime gate valid project fixture must use canonical project state');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad project state', 'bridge runtime gate must prove malformed project state is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad milestone state', 'bridge runtime gate must prove malformed milestone state is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad task graph node state', 'bridge runtime gate must prove malformed task graph node state is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'parallel_all', 'bridge runtime gate must prove malformed task graph parallel policy is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'filesystem', 'bridge runtime gate must prove malformed policy rule scope is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "severity: 'fatal'", 'bridge runtime gate must prove malformed policy rule severity is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad source', 'bridge runtime gate must prove malformed defect source is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bad state', 'bridge runtime gate must prove malformed defect state is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'empty evidence', 'bridge runtime gate must prove empty defect evidence ref is rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'empty targets', 'bridge runtime gate must prove empty defect target refs are rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'empty target', 'bridge runtime gate must prove empty defect target refs are rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'checkpointEventSeq: -1', 'official frontend gate must prove malformed replay cursor snapshots are rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "checkpointId: ''", 'bridge runtime gate must prove empty replay checkpoint ids are rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'checkpointEventSeq: -1', 'bridge runtime gate must prove malformed replay cursor snapshots are rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-task-upsert-status', 'official frontend gate must prove malformed task.upsert status is rejected before reducer apply');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-malformed-stream-block', 'official frontend gate must prove malformed stream block patch is rejected before reducer apply');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-empty-artifact-id', 'official frontend gate must prove empty artifact upsert id is rejected before reducer apply');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-empty-gate-id', 'official frontend gate must prove empty gate upsert id is rejected before reducer apply');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'task-unknown', 'official frontend gate must prove unknown task-scoped snapshot buckets are rejected before load');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-unknown-task-stream', 'official frontend gate must prove unknown task-scoped patches do not create projection buckets or advance event memory');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "duplicateOutcome.outcome, 'duplicate'", 'official frontend gate must prove duplicate projection events are recognized as benign no-ops');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "staleOutcome.outcome, 'stale'", 'official frontend gate must prove stale projection events are recognized before live status restoration');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, "unknownTaskOutcome.outcome, 'unknown-task'", 'official frontend gate must prove unknown-task projection events are recognized before live status restoration');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'MAX_ATELIER_EVENT_KEYS + 1', 'official frontend gate must prove the reducer dedupe cache is bounded');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'block-official-evicted-stale-replay', 'official frontend gate must prove evicted stale replay does not mutate projection stream');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-snapshot-with-task-scope', 'official frontend gate must prove snapshot events cannot carry a task scope');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-task-upsert-mismatched-task-scope', 'official frontend gate must prove task.upsert event scope matches the upserted task id when present');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-mismatched-event-patch-task-scope', 'official frontend gate must prove mismatched event/patch task scope is rejected before reducer apply');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'evt-mismatched-task-1-task-2-seq-1', 'official frontend gate must prove mismatched event/patch task scope cannot advance another task scope');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'function canApplyPatchToKnownTask', 'prototype bridge runtime must reject unknown task-scoped patches before state mutation');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "patch.kind === 'snapshot' || patch.kind === 'task.upsert'", 'prototype bridge runtime must keep task.upsert as the only task-creating patch');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'snapshot.state.tasks.some((task) => task.id === patch.taskId)', 'prototype bridge runtime must bind task-scoped patches to known tasks');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'const MAX_SEEN_EVENT_KEYS = 500', 'prototype bridge runtime must bound projection event dedupe cache');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'seenEventOrder.shift()', 'prototype bridge runtime must evict old projection event dedupe keys');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeDedupeCacheEvictsBoundedlyAndSeqGuardRejectsReplay', 'bridge runtime gate must prove bounded dedupe cache eviction still falls back to seq guard');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'block-evicted-stale-replay', 'bridge runtime gate must prove evicted stale replay does not mutate projection stream');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'official reducer 侧也由 `MAX_ATELIER_EVENT_KEYS=500` 有界保存', 'Prototype README must document official reducer bounded dedupe cache evidence');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'evicted stale replay 仍进入 `stale` outcome', 'Prototype README must document official evicted replay remains fail-closed by seq guard');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsUnknownTaskScopeEventsAndRecovers', 'bridge runtime gate must prove unknown task-scoped events fail closed and recover');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'Official / prototype known-task projection guard 当前有 controlled/local evidence', 'Prototype README must document known-task projection guard evidence');
expectIncludes(files.appletBridge, contents.appletBridge, 'host.onEvent(projectionEventTopic, (payload)', 'applet bridge must forward Host projection payloads through a lifecycle-aware runtime guard wrapper');
expectIncludes(files.appletBridge, contents.appletBridge, 'if (!closed) listener(payload);', 'applet bridge must stop forwarding Host projection payloads after subscription closure');
expectIncludes(files.appletBridge, contents.appletBridge, 'function invokeProjectionSubscription', 'applet bridge must centralize projection subscription invokes');
expectIncludes(files.appletBridge, contents.appletBridge, '.catch((error: unknown)', 'applet bridge must handle rejected projection subscription invokes');
expectIncludes(files.appletBridge, contents.appletBridge, "'events.subscribe'", 'applet bridge must subscribe projection topic through Host events');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_PROJECTION_EVENT_TOPIC', 'applet bridge default projection topic must derive from generated contract');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_PROJECTION_SUBSCRIPTION_METHOD', 'applet bridge Station stream subscription method must derive from generated contract');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority', 'applet bridge projection stream taskId fallback order must derive from generated eventSubscription contract');
expectIncludes(files.appletBridge, contents.appletBridge, 'projectionTaskIdResolvers', 'applet bridge must centralize projection stream taskId source resolvers');
expectIncludes(files.appletBridge, contents.appletBridge, 'invokeProjectionSubscription(host, ATELIER_PROJECTION_SUBSCRIPTION_METHOD', 'applet bridge must request Station Atelier stream through generated Host capability method');
expectNotIncludes(files.appletBridge, contents.appletBridge, "const DEFAULT_PROJECTION_EVENT_TOPIC = 'atelier.projection.event';", 'applet bridge must not hardcode default projection event topic');
expectNotIncludes(files.appletBridge, contents.appletBridge, "invokeProjectionSubscription(host, 'atelier.events.subscribe'", 'applet bridge must not hardcode Station Atelier stream subscription method');
expectNotIncludes(files.appletBridge, contents.appletBridge, 'return snapshot?.selectedTaskId || snapshot?.workspace.tasks[0]?.id', 'applet bridge projection stream taskId fallback order must not be hidden in a local selected/first task expression');
expectIncludes(files.appletBridge, contents.appletBridge, 'compactProjectionStreamPayload', 'applet bridge must compact projection stream payload before calling subscribe');
expectIncludes(files.appletBridge, contents.appletBridge, 'input.afterEventSeq > 0', 'applet bridge must omit zero replay cursor from projection stream subscribe payload');
expectIncludes(files.appletBridge, contents.appletBridge, "'events.unsubscribe'", 'applet bridge teardown must unsubscribe projection topic and trigger Desktop stream cancel');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeExplicitProjectionStreamIntentWinsOverSnapshotCursor', 'bridge runtime gate must prove explicit projection stream intent wins over snapshot-derived replay cursor');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeCorrelatesCustomProjectionTopicAcrossLifecycle', 'bridge runtime gate must prove custom projection topic is correlated across subscribe/listen/unsubscribe');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-wrong-topic', 'bridge runtime gate must prove mismatched projection topics do not reach the applet listener');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-custom-topic', 'bridge runtime gate must prove matching custom projection topic reaches the applet listener');
expectIncludes(files.appletBridge, contents.appletBridge, 'function assertNonSnapshotRuntimeResponse', 'applet bridge must guard non-snapshot Host responses before returning them');
expectIncludes(files.appletBridge, contents.appletBridge, 'assertNonSnapshotRuntimeResponse(request.method, response, request.payload)', 'applet bridge must pass request payload into non-snapshot response guards');
expectIncludes(files.appletBridge, contents.appletBridge, 'isProviderCapabilitiesResponse', 'applet bridge must validate provider capability response shape');
expectIncludes(files.appletBridge, contents.appletBridge, 'matchesRequestField', 'applet bridge artifact response guard must compare required response fields to request payload');
expectIncludes(files.appletBridge, contents.appletBridge, 'matchesOptionalRequestField', 'applet bridge artifact response guard must compare optional response fields when requested');
expectIncludes(files.appletBridge, contents.appletBridge, "matchesRequestField(payload, 'taskId', value.taskId)", 'applet bridge artifact response guard must reject mismatched task id');
expectIncludes(files.appletBridge, contents.appletBridge, "matchesRequestField(payload, 'artifactId', value.artifactId)", 'applet bridge artifact response guard must reject mismatched artifact id');
expectIncludes(files.appletBridge, contents.appletBridge, "matchesRequestField(payload, 'bodyRef', value.bodyRef)", 'applet bridge artifact response guard must reject mismatched body ref');
expectIncludes(files.appletBridge, contents.appletBridge, "matchesOptionalRequestField(payload, 'expectedHash', value.bodyHash)", 'applet bridge artifact body response guard must reject mismatched expected hash');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_ARTIFACT_BODY_KINDS', 'applet bridge artifact body response guard must consume generated body kind taxonomy');
expectIncludes(files.appletBridge, contents.appletBridge, 'bodyKinds.includes(value)', 'applet bridge artifact body response guard must validate body kind through generated taxonomy helper');
expectNotIncludes(files.appletBridge, contents.appletBridge, "value === 'markdown' || value === 'diff' || value === 'text' || value === 'json'", 'applet bridge artifact body response guard must not keep local body kind allowlist');
expectIncludes(files.appletBridge, contents.appletBridge, "matchesRequestField(payload, 'sandboxRef', value.sandboxRef)", 'applet bridge artifact preview response guard must reject mismatched sandbox ref');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.feedbackId === input.feedbackId', 'official client memory/rerun response guard must reject mismatched feedback id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.taskId === input.taskId', 'official client rerun response guard must reject mismatched task id');
expectIncludes(files.officialFrontendClient, contents.officialFrontendClient, 'record.workspaceUri === input.workspaceUri', 'official client workspace open response guard must reject mismatched workspace uri');
expectIncludes(files.appletBridge, contents.appletBridge, "matchesRequestField(payload, 'feedbackId', value.feedbackId)", 'applet bridge memory/rerun response guard must reject mismatched feedback id');
expectIncludes(files.appletBridge, contents.appletBridge, "matchesRequestField(payload, 'workspaceUri', value.workspaceUri)", 'applet bridge workspace open response guard must reject mismatched workspace uri');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_WORKSPACE_OPEN_URI_SCHEMES', 'applet bridge workspace open response guard must consume generated URI scheme taxonomy');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_WORKSPACE_OPEN_URI_SHAPE', 'applet bridge workspace open response guard must consume generated URI shape descriptor');
expectIncludes(files.appletBridge, contents.appletBridge, 'isWorkspaceOpenUriScheme(uri.protocol.slice(0, -1))', 'applet bridge workspace open response guard must validate protocol through generated scheme helper');
expectIncludes(files.appletBridge, contents.appletBridge, 'uri.hostname === shape.host', 'applet bridge workspace open response guard must validate host through generated shape descriptor');
expectIncludes(files.appletBridge, contents.appletBridge, 'uri.searchParams.getAll(shape.workspaceQueryKey)', 'applet bridge workspace open response guard must read workspace query through generated shape descriptor');
expectIncludes(files.appletBridge, contents.appletBridge, 'taskPath.length === shape.taskPathSegments', 'applet bridge workspace open response guard must validate path segment count through generated shape descriptor');
expectNotIncludes(files.appletBridge, contents.appletBridge, "uri.protocol === 'pt-workspace:'", 'applet bridge workspace open response guard must not hardcode pt-workspace protocol');
expectNotIncludes(files.appletBridge, contents.appletBridge, "uri.hostname === 'task'", 'applet bridge workspace open response guard must not hardcode workspace URI host');
expectNotIncludes(files.appletBridge, contents.appletBridge, "uri.searchParams.getAll('workspace')", 'applet bridge workspace open response guard must not hardcode workspace query key');
expectIncludes(files.appletBridge, contents.appletBridge, 'isArtifactPreviewOpenResponse', 'applet bridge must validate artifact preview open response shape');
expectIncludes(files.appletBridge, contents.appletBridge, "value.slashCommand.startsWith('/')", 'applet bridge provider capability guard must require slash command prefix');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_PROVIDER_CAPABILITY_SCOPES', 'applet bridge provider capability guard must consume generated capability scope taxonomy');
expectIncludes(files.appletBridge, contents.appletBridge, 'isProviderCapabilityScope(value.scope)', 'applet bridge provider capability guard must validate scope through generated taxonomy helper');
expectIncludes(files.appletBridge, contents.appletBridge, 'value.readOnly === ATELIER_PROVIDER_CAPABILITY_READ_ONLY', 'applet bridge provider capability guard must consume generated read-only marker');
expectNotIncludes(files.appletBridge, contents.appletBridge, "value.scope === 'station-provider'", 'applet bridge provider capability guard must not hardcode station-provider scope');
expectNotIncludes(files.appletBridge, contents.appletBridge, 'value.readOnly === true', 'applet bridge provider capability guard must not hardcode read-only marker');
expectIncludes(files.appletBridge, contents.appletBridge, 'value.accepted === true', 'applet bridge artifact preview response must require accepted Host response');
expectIncludes(files.appletBridge, contents.appletBridge, 'isFeedbackSubmitResponse', 'applet bridge must validate feedback submit response shape');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_MEMORY_CANDIDATE_FEEDS', 'applet bridge feedback response guard must consume generated memory candidate feed taxonomy');
expectIncludes(files.appletBridge, contents.appletBridge, 'feeds.includes(value)', 'applet bridge feedback response guard must validate feeds through generated taxonomy helper');
expectNotIncludes(files.appletBridge, contents.appletBridge, "value === 'planner' || value === 'risk' || value === 'verifier'", 'applet bridge feedback response guard must not keep local memory candidate feed allowlist');
expectIncludes(files.appletBridge, contents.appletBridge, 'isMemoryConfirmationResponse', 'applet bridge must validate memory confirmation response shape');
expectIncludes(files.appletBridge, contents.appletBridge, 'isRerunConfirmationResponse', 'applet bridge must validate rerun confirmation response shape');
expectIncludes(files.appletBridge, contents.appletBridge, 'isWorkspaceOpenResponse', 'applet bridge must validate workspace open response shape');
expectIncludes(files.appletBridge, contents.appletBridge, 'value.prepared === true', 'applet bridge artifact preview response must require prepared Host renderer session');
expectIncludes(files.appletBridge, contents.appletBridge, "value.rendererSessionId.startsWith('atelier-preview:')", 'applet bridge artifact preview response must require opaque Atelier preview session id');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_ARTIFACT_PREVIEW_OPEN_MODES', 'applet bridge artifact preview response guard must consume generated preview open mode taxonomy');
expectIncludes(files.appletBridge, contents.appletBridge, 'isArtifactPreviewOpenMode(value.mode)', 'applet bridge artifact preview response must validate mode through generated taxonomy helper');
expectIncludes(files.appletBridge, contents.appletBridge, 'isArtifactPreviewOpenRendererOwner(value.rendererOwner)', 'applet bridge artifact preview response must validate renderer owner through generated taxonomy helper');
expectIncludes(files.appletBridge, contents.appletBridge, 'isArtifactPreviewOpenRendererMode(value.rendererMode)', 'applet bridge artifact preview response must validate renderer mode through generated taxonomy helper');
expectIncludes(files.appletBridge, contents.appletBridge, 'isArtifactPreviewOpenRendererStatus(value.rendererStatus)', 'applet bridge artifact preview response must validate renderer status through generated taxonomy helper');
expectIncludes(files.appletBridge, contents.appletBridge, "ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities", 'applet bridge artifact preview response guard must read required renderer capabilities from generated contract');
expectIncludes(files.appletBridge, contents.appletBridge, 'hasRequiredArtifactPreviewRendererCapabilities(value.rendererCapabilities)', 'applet bridge artifact preview response guard must reject responses missing required renderer capabilities');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_ARTIFACT_BODY_REF_SHAPE', 'applet bridge artifact body response guard must consume generated body ref shape descriptor');
expectIncludes(files.appletBridge, contents.appletBridge, 'ATELIER_ARTIFACT_SANDBOX_REF_SHAPE', 'applet bridge artifact preview response guard must consume generated sandbox ref shape descriptor');
expectIncludes(files.appletBridge, contents.appletBridge, 'isArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE)', 'applet bridge artifact body response guard must validate bodyRef through generated shape descriptor');
expectIncludes(files.appletBridge, contents.appletBridge, 'isArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE)', 'applet bridge artifact preview response guard must validate sandboxRef through generated shape descriptor');
expectNotIncludes(files.appletBridge, contents.appletBridge, "value.mode === 'sandbox_manifest'", 'applet bridge artifact preview response guard must not hardcode preview open mode');
expectNotIncludes(files.appletBridge, contents.appletBridge, "value.rendererOwner === 'desktop_host'", 'applet bridge artifact preview response guard must not hardcode renderer owner');
expectNotIncludes(files.appletBridge, contents.appletBridge, "value.rendererMode === 'host_sandbox_manifest'", 'applet bridge artifact preview response guard must not hardcode renderer mode');
expectNotIncludes(files.appletBridge, contents.appletBridge, "value.rendererStatus === 'prepared_not_opened'", 'applet bridge artifact preview response guard must not hardcode renderer status');
expectNotIncludes(files.appletBridge, contents.appletBridge, String.raw`^artifact:\/\/[^/\s]+\/[^/\s]+\/body$`, 'applet bridge artifact bodyRef guard must not keep local body ref regex');
expectNotIncludes(files.appletBridge, contents.appletBridge, String.raw`^atelier-sandbox:\/\/[^/\s]+\/[^/\s]+\/preview$`, 'applet bridge artifact preview guard must not keep local sandbox ref regex');
expectIncludes(files.appletBridge, contents.appletBridge, 'did not return a valid typed response', 'applet bridge must fail closed on malformed non-snapshot Host responses');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"providerCapabilities"', 'Atelier malformed response fixtures must include provider capability discovery cases');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"nonArtifactCapabilities"', 'Atelier malformed response fixtures must include non-artifact capability response cases');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"artifactBody"', 'Atelier malformed response fixtures must include artifact body response cases');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"artifactPreview"', 'Atelier malformed response fixtures must include artifact preview response cases');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'artifact preview rejects missing required renderer capability', 'Atelier malformed response fixtures must cover missing required artifact preview renderer capability');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact preview rejects missing required renderer capability', 'Atelier malformed response fixtures must cover official missing required artifact preview renderer capability');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'atelier-malformed-response-fixtures.json', 'official frontend gate must consume shared malformed response fixtures');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'atelier-malformed-response-fixtures.json', 'bridge runtime gate must consume shared malformed response fixtures');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'providerCapabilityMalformedResponseFixtures.map', 'bridge runtime gate must expand shared provider malformed fixtures');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'nonArtifactCapabilityMalformedResponseFixtures.map', 'bridge runtime gate must expand shared non-artifact malformed fixtures');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeAllowsArtifactBodyFetchResponse', 'bridge runtime gate must prove artifact body fetch success responses remain typed and request-correlated');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeAllowsArtifactPreviewOpenResponse', 'bridge runtime gate must prove artifact preview open success responses remain typed and request-correlated');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'artifactBodyMalformedResponseFixtures.map', 'bridge runtime gate must expand shared artifact body malformed fixtures');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'artifactPreviewMalformedResponseFixtures.map', 'bridge runtime gate must expand shared artifact preview malformed fixtures');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, '__atelierOfficialFrontendGateInvoke', 'official frontend gate must mock Host SDK invoke for executable capability response fixtures');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'assertCapabilityRejectsMalformedResponse', 'official frontend gate must execute malformed capability response fixtures through public client APIs');
expectIncludes(files.officialFrontendGate, contents.officialFrontendGate, 'invokeMalformedCapabilityFixture', 'official frontend gate must route shared malformed fixtures through public client APIs');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official provider capabilities reject empty source', 'shared fixtures must cover official provider capability responses with empty source');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official provider capabilities reject empty descriptor id', 'shared fixtures must cover official provider capability responses with empty descriptor id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official provider capabilities reject empty slash command', 'shared fixtures must cover official provider capability responses with empty slash command');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official provider capabilities reject missing slash prefix', 'shared fixtures must cover official provider capability responses missing slash command prefix');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official provider capabilities reject non-station scope', 'shared fixtures must cover official provider capability responses outside station-provider discovery scope');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official provider capabilities reject writable descriptor', 'shared fixtures must cover official provider capability writable descriptors');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official feedback submit rejects accepted false', 'shared fixtures must cover feedback responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official feedback submit rejects forbidden feed', 'shared fixtures must cover feedback responses with forbidden feed values');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official feedback submit rejects empty feedback id', 'shared fixtures must cover feedback responses with empty feedback id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official feedback submit rejects empty policy reason', 'shared fixtures must cover feedback responses with empty policy reason');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official feedback submit rejects empty confirmation mode', 'shared fixtures must cover feedback responses with empty confirmation mode');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official feedback submit rejects non-boolean confirmation requirement', 'shared fixtures must cover feedback responses with non-boolean confirmation requirement');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official feedback submit rejects rerun forbidden feed', 'shared fixtures must cover rerun policy hints with forbidden feed values');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official memory confirmation rejects accepted false', 'shared fixtures must cover memory confirmation responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official memory confirmation rejects empty memory id', 'shared fixtures must cover memory confirmation responses with empty memory id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official memory confirmation rejects empty source', 'shared fixtures must cover memory confirmation responses with empty source');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official memory confirmation rejects wrong feedback id', 'shared fixtures must cover memory confirmation responses with mismatched feedback id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official rerun confirmation rejects accepted false', 'shared fixtures must cover rerun confirmation responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official rerun confirmation rejects non-boolean started', 'shared fixtures must cover rerun confirmation responses with non-boolean started');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official rerun confirmation rejects empty rerun task id', 'shared fixtures must cover rerun confirmation responses with empty rerun task id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official rerun confirmation rejects wrong feedback id', 'shared fixtures must cover rerun confirmation responses with mismatched feedback id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official rerun confirmation rejects wrong task id', 'shared fixtures must cover rerun confirmation responses with mismatched task id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official workspace open rejects accepted false', 'shared fixtures must cover workspace open responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official workspace open rejects bad workspace uri', 'shared fixtures must cover workspace open responses with bad workspace URI');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official workspace open rejects wrong workspace uri', 'shared fixtures must cover workspace open responses with mismatched workspace URI');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official workspace open rejects empty mode', 'shared fixtures must cover workspace open responses with empty mode');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official workspace open rejects empty reason', 'shared fixtures must cover workspace open responses with empty reason');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact body rejects expected hash mismatch', 'shared fixtures must cover artifact body responses with mismatched expected hash');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact body rejects wrong task', 'shared fixtures must cover artifact body responses for a different task');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact body rejects wrong artifact', 'shared fixtures must cover artifact body responses for a different artifact');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact body rejects wrong body ref', 'shared fixtures must cover artifact body responses for a different body ref');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact preview rejects accepted false', 'shared fixtures must cover artifact preview responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact preview rejects raw url renderer', 'shared fixtures must cover artifact preview responses with raw URL renderer semantics');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact preview rejects bad renderer mode', 'shared fixtures must cover artifact preview responses with malformed Host renderer mode');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact preview rejects bad renderer status', 'shared fixtures must cover artifact preview responses with malformed Host renderer status');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact preview rejects empty renderer capability', 'shared fixtures must cover artifact preview responses with empty renderer capability labels');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'official artifact preview rejects missing required renderer capability', 'shared fixtures must cover artifact preview responses missing required renderer capability');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'rendererCapabilities: [""]', 'prototype README must document shared empty renderer capability malformed fixture coverage');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'missing `host_visual_renderer_surface`', 'prototype README must document shared missing required renderer capability malformed fixture coverage');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'cap-empty-source', 'shared fixtures must reject provider capability responses with empty source');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'cap-empty-command', 'shared fixtures must reject provider capability responses with empty slash command');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'cap-missing-slash-command', 'shared fixtures must reject provider capability responses missing slash command prefix');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'cap-non-station-scope', 'shared fixtures must reject provider capability responses outside station-provider discovery scope');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'cap-writable-descriptor', 'shared fixtures must reject writable provider capability descriptors');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'feedback-not-accepted', 'shared fixtures must reject feedback responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'feedback-empty-confirmation-mode', 'shared fixtures must reject feedback policy hints with empty confirmation mode');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'feedback-non-boolean-confirmation', 'shared fixtures must reject feedback policy hints with non-boolean confirmation requirement');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'feedback-rerun-bad-feed', 'shared fixtures must reject rerun policy hints with forbidden feed values');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'memory-not-accepted', 'shared fixtures must reject memory confirmation responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'task-rerun-not-accepted', 'shared fixtures must reject rerun confirmation responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"reason": "not accepted"', 'shared fixtures must reject workspace open responses with accepted=false');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'feedback-empty-reason', 'shared fixtures must reject feedback policy hints with empty reason');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"source": ""', 'shared fixtures must reject confirmation responses with empty source');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"rerunTaskId": ""', 'shared fixtures must reject rerun confirmation responses with empty rerun task id');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"mode": ""', 'shared fixtures must reject workspace open responses with empty mode');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '"reason": ""', 'shared fixtures must reject workspace open responses with empty reason');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'bad renderer mode', 'shared fixtures must reject malformed artifact preview Host renderer mode response');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'bad renderer status', 'shared fixtures must reject malformed artifact preview Host renderer status response');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'bad session id', 'shared fixtures must reject malformed artifact preview Host renderer session id response');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'bad renderer capability', 'shared fixtures must reject empty artifact preview Host renderer capability labels');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '# wrong task', 'shared fixtures must reject artifact body responses for a different task');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '# wrong artifact', 'shared fixtures must reject artifact body responses for a different artifact');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '# wrong ref', 'shared fixtures must reject artifact body responses for a different body ref');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, '# wrong hash', 'shared fixtures must reject artifact body responses with mismatched expected hash');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'wrong sandbox ref', 'shared fixtures must reject artifact preview responses for a different sandbox ref');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'wrong body ref', 'shared fixtures must reject artifact preview responses for a different body ref');
expectIncludes(files.runtimeBootstrap, contents.runtimeBootstrap, 'function readProjectionStreamConfig', 'prototype runtime bootstrap must own projection stream config loading');
expectIncludes(files.runtimeBootstrap, contents.runtimeBootstrap, 'export function normalizeProjectionStreamConfig', 'prototype runtime bootstrap must normalize projection stream config');
expectIncludes(files.runtimeBootstrap, contents.runtimeBootstrap, 'record.agentId.trim()', 'prototype runtime bootstrap must trim global projection stream agentId');
expectIncludes(files.runtimeBootstrap, contents.runtimeBootstrap, 'parsed > 0', 'prototype runtime bootstrap must omit non-positive replay cursor');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'const response = await bridge.call({ method, payload })', 'bridge runtime must catch async capability errors before returning');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'restoreStatusOnSuccess', 'bridge runtime must restore non-snapshot status after successful capability calls');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'latestCallStatusToken', 'bridge runtime must assign status ownership to the latest Host capability call');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'callStatusToken === latestCallStatusToken', 'bridge runtime must ignore stale non-snapshot call completions when updating status');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'activeCallRestorableStatus', 'bridge runtime must restore the pre-loading stable status for concurrent non-snapshot calls');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'latestSnapshotCallToken', 'bridge runtime must assign projection ownership to the latest snapshot Host capability call');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'snapshotCallToken !== latestSnapshotCallToken', 'bridge runtime must ignore stale snapshot call completions before writing projection or error status');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "kind: 'auth-denied'", 'prototype bridge runtime must classify auth failures as auth-denied');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'retryable: false', 'prototype bridge runtime must not show retry for auth-denied recovery');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'type NonSnapshotAtelierRuntimeMethod', 'bridge runtime must maintain an explicit non-snapshot method type boundary');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "'atelier.memory.confirmCandidate'", 'bridge runtime non-snapshot boundary must include memory confirmation');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, "'atelier.feedback.confirmRerun'", 'bridge runtime non-snapshot boundary must include rerun confirmation');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'type SnapshotAtelierRuntimeMethod = Exclude<AtelierRuntimeMethod, NonSnapshotAtelierRuntimeMethod>', 'bridge runtime snapshot call helper must exclude all non-snapshot methods');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeSubscriptionReferenceLifecycle', 'bridge runtime gate must cover subscription reuse and last-listener cleanup');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'invalidWorkspacePatch', 'bridge runtime gate must prove malformed snapshot record values and task envelopes are rejected before load');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-task-upsert-status', 'bridge runtime gate must prove malformed task.upsert status is rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-body-leak', 'bridge runtime gate must prove artifact body leaks are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-artifact-bad-body-ref-file', 'bridge runtime gate must prove non-artifact body refs are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-malformed-gate-artifact-ids', 'bridge runtime gate must prove malformed gate artifact ids are rejected before patch apply');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsStaleSeqPerScopeOnly', 'bridge runtime gate must prove stale seq rejection is scoped per task/workspace');
expectIncludes(files.tsProjection, contents.tsProjection, 'isProjectionEventTaskScopeConsistent', 'prototype projection event parser must correlate top-level event taskId with patch task scope');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-snapshot-with-task-scope', 'bridge runtime gate must prove snapshot events cannot carry a task scope');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-task-upsert-mismatched-task-scope', 'bridge runtime gate must prove task.upsert event scope matches the upserted task id when present');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsMismatchedEventPatchTaskScopeAndRecovers', 'bridge runtime gate must prove mismatched event/patch task scope cannot mutate another task');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'P2-05 event task-scope correlation 当前已补齐 official / browser prototype parity', 'prototype README must document official/browser event task-scope correlation parity');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'snapshot event 不允许携带 task scope', 'prototype README must document snapshot event task-scope rejection');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'event.taskId === patch.taskId', 'prototype README must document task-scoped event/patch correlation');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeListenerFailuresDoNotPoisonOtherSubscribers', 'bridge runtime gate must prove listener failures and mutations do not poison other subscribers');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'function toRuntimeSnapshot(projection: unknown)', 'prototype bridge runtime must validate every projection-to-runtime snapshot conversion');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'fromProjectionSnapshot(assertAtelierProjectionSnapshot(projection))', 'prototype bridge runtime must fail closed on malformed initial/load/snapshot patch projection snapshots');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsMalformedInitialSnapshot', 'bridge runtime gate must prove malformed initial snapshots are rejected before runtime state creation');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'bridge runtime must reject malformed initial projection snapshot before creating runtime state', 'bridge runtime gate must assert initial snapshot fail-closed behavior');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'initialSnapshot` 也统一经过 `assertAtelierProjectionSnapshot`', 'prototype README must document initial snapshot projection ingress guard');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeSubscriptionFailuresPreserveSnapshot', 'bridge runtime gate must prove subscribeProjection sync failures preserve the last valid snapshot');
expectIncludes(files.prototypeBridgeRuntime, contents.prototypeBridgeRuntime, 'snapshot = withStatus(snapshot, readyStatus(snapshot.state));', 'prototype bridge runtime must restore ready after successful projection subscription setup');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "seen.at(-2)?.status?.kind, 'reconciling'", 'bridge runtime gate must prove subscription setup enters reconciling before ready');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "seen.at(-1)?.status?.kind, 'ready'", 'bridge runtime gate must prove successful subscription setup returns to ready before new events arrive');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '成功 `subscribeProjection` 拿到 cleanup 后会恢复 ready', 'prototype README must document successful browser bridge subscription does not remain stuck reconciling');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeHandlesRejectedSubscriptionInvokes', 'bridge runtime gate must prove rejected applet subscription invokes are handled');
expectIncludes(files.appletBridge, contents.appletBridge, "kind: 'atelier.projection.subscription-rejected'", 'applet bridge must surface rejected subscription invokes to the runtime guard');
expectIncludes(files.appletBridge, contents.appletBridge, 'closeAfterRejectedSubscribe', 'applet bridge must close local listeners after rejected subscription invokes');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'evt-after-rejected-subscription-invoke', 'bridge runtime gate must prove rejected subscription invokes do not keep delivering host events');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, "seen[0].kind, 'atelier.projection.subscription-rejected'", 'bridge runtime gate must assert rejected subscription failure payload');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'adapter 会 fail-closed：先关闭本地 `host.onEvent` listener', 'prototype README must document applet bridge fail-closed subscription rejection handling');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`atelier.projection.subscription-rejected` malformed payload', 'prototype README must document rejected subscription invokes flow through malformed-event runtime guard');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '`evt-after-rejected-subscription-invoke` 不会进入 applet listener', 'prototype README must document rejected subscription invokes do not keep delivering host events');
expectNotIncludes(files.prototypeReadme, contents.prototypeReadme, '也不阻断本地 event listener', 'prototype README must not preserve stale warning-only subscription rejection wording');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeMalformedUnsubscribeDoesNotStickSubscription', 'bridge runtime gate must prove malformed unsubscribe returns do not leave a stuck subscription');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeCleanupFailureClearsSubscriptionAndPreservesSnapshot', 'bridge runtime gate must prove cleanup failures clear subscription state and preserve projection data');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeEventApplyFailurePreservesSnapshotAndRecovers', 'bridge runtime gate must prove event apply failures preserve projection data and allow recovery');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsMalformedProjectionEventsAndRecovers', 'bridge runtime gate must prove malformed Host projection events are rejected before patch apply and later valid events recover');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsEmptyTaskScopeEventsAndRecovers', 'bridge runtime gate must prove empty task scope events are rejected before patch apply and later valid events recover');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsMalformedStreamBlocksAndRecovers', 'bridge runtime gate must prove malformed stream blocks are rejected before append and later valid events recover');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsEmptyUpsertEntityIdsAndRecovers', 'bridge runtime gate must prove empty upsert entity ids are rejected before patch apply and later valid events recover');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsMalformedTodoItemsAndRecovers', 'bridge runtime gate must prove malformed todo items are rejected before replace and later valid events recover');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsEmptyDecisionResolutionAndRecovers', 'bridge runtime gate must prove empty decision resolution fields are rejected before patch apply and later valid events recover');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeRejectsMalformedTaskContextAndRecovers', 'bridge runtime gate must prove malformed task contexts are rejected before replace and later valid events recover');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testRuntimeBootstrapNormalizesProjectionStreamConfig', 'bridge runtime gate must prove runtime bootstrap rejects blank stream config and compacts cursor fields');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeOmitsEmptyReplayCursorFields', 'bridge runtime gate must prove appletBridge omits empty task/cursor fields');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeUnsubscribesProjectionTopicAndStream', 'bridge runtime gate must cover applet bridge unsubscribe cleanup');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeForwardsMalformedEventsToRuntimeGuard', 'bridge runtime gate must prove appletBridge forwards malformed Host events to the runtime guard instead of silently dropping them');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testPrototypeRecoveryViewMatrix', 'bridge runtime gate must cover browser prototype recovery status view matrix');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'auth-denied is danger without retry', 'bridge runtime gate must keep auth-denied recovery non-retryable');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeNonSnapshotErrorsUpdateStatus', 'bridge runtime gate must cover non-snapshot async error status mapping');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeNormalizesHostErrorEnvelopes', 'bridge runtime gate must cover applet Host error envelope normalization');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'resolved forbidden error envelope', 'bridge runtime gate must prove resolved forbidden Host error envelopes map to auth-denied');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'rejected network error object', 'bridge runtime gate must prove rejected network Host error objects map to disconnected');
expectIncludes(files.appletBridge, contents.appletBridge, 'throwIfAtelierBridgeErrorEnvelope(request.method, response);', 'applet bridge must reject resolved Host error envelopes before snapshot assertion');
expectIncludes(files.appletBridge, contents.appletBridge, 'normalizeAtelierBridgeHostError(request.method, error)', 'applet bridge must normalize rejected Host error envelopes');
expectIncludes(files.appletBridge, contents.appletBridge, 'Atelier bridge method ${method} failed: ${envelope.code} ${envelope.message}', 'applet bridge normalized Host errors must preserve code and message for runtime status mapping');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeNonSnapshotSuccessRestoresStatus', 'bridge runtime gate must cover non-snapshot success status restoration');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeNonSnapshotStaleSuccessDoesNotClearNewerError', 'bridge runtime gate must prove stale non-snapshot success cannot clear a newer error status');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'FORBIDDEN memory confirmation', 'bridge runtime gate must prove newer auth-denied status wins over stale success');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeNonSnapshotStaleFailureDoesNotClearNewerSuccess', 'bridge runtime gate must prove stale non-snapshot failure cannot clear a newer success status');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'FORBIDDEN provider discovery', 'bridge runtime gate must prove newer success status wins over stale failure');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeSnapshotStaleSuccessDoesNotOverwriteNewerSnapshot', 'bridge runtime gate must prove stale snapshot success cannot overwrite a newer projection snapshot');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'task-stale', 'bridge runtime gate must prove stale snapshot task data is not inserted');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testBridgeSnapshotStaleFailureDoesNotClearNewerSnapshot', 'bridge runtime gate must prove stale snapshot failure cannot clear a newer projection snapshot');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'FORBIDDEN stale workspace load', 'bridge runtime gate must prove stale snapshot failure is ignored after a newer snapshot success');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'latest Host capability call owns runtime status completion', 'prototype README must document non-snapshot call status race guard');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'stale failure', 'prototype README must document stale failure race behavior');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'browser `appletBridge` 现在会在 snapshot assertion / typed response guard 前统一规范化 Host error envelope', 'prototype README must document browser appletBridge Host error envelope normalization');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '而不会退成 invalid snapshot 或 `[object Object]` generic error', 'prototype README must document Host error envelope avoids generic bridge errors');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, 'latest snapshot Host capability call owns projection writes', 'prototype README must document snapshot call projection race guard');
expectIncludes(files.prototypeReadme, contents.prototypeReadme, '旧 workspace.load success / failure', 'prototype README must document stale snapshot call success/failure behavior');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'testAppletBridgeRejectsMalformedNonSnapshotResponses', 'bridge runtime gate must prove malformed applet non-snapshot Host responses are rejected');
expectIncludes(files.bridgeRuntimeGate, contents.bridgeRuntimeGate, 'did not return a valid typed response', 'bridge runtime gate must assert malformed applet non-snapshot responses fail closed');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'artifact://task 1/artifact-1/body', 'shared fixtures must prove body fetch rejects whitespace task segment bodyRef');
expectIncludes(files.malformedResponseFixtures, contents.malformedResponseFixtures, 'artifact://task-1/artifact 1/body', 'shared fixtures must prove preview open rejects whitespace artifact segment bodyRef');
expectIncludes(files.rustGateway, contents.rustGateway, 'ensure_atelier_projection_subscription', 'Desktop gateway must keep Atelier projection subscription registry');
expectIncludes(files.rustGateway, contents.rustGateway, 'cancel_atelier_projection_subscriptions_for_session', 'Desktop gateway must cancel Atelier projection subscriptions on unsubscribe/session cleanup');
expectIncludes(files.rustGateway, contents.rustGateway, 'persist_atelier_projection_cursor', 'Desktop gateway must persist Atelier projection cursor');
expectIncludes(files.rustGateway, contents.rustGateway, 'reloads_atelier_projection_cursor_after_registry_restart', 'Desktop gateway must test projection cursor recovery after registry restart');
expectIncludes(files.rustGateway, contents.rustGateway, 'reuses_and_cancels_atelier_projection_subscription_registry', 'Desktop gateway must test subscription reuse/cancel registry');
const packageScripts = JSON.parse(contents.packageJson).scripts ?? {};
const controlledGatesScript = packageScripts['atelier:controlled-gates'];
const realProductGatesScript = packageScripts['atelier:real-product-gates'];
if (typeof controlledGatesScript !== 'string') {
  failures.push(`${files.packageJson}: missing atelier:controlled-gates script`);
} else {
  if (!controlledGatesScript.includes('applet:atelier-desktop-injection-gate')) {
    failures.push(`${files.packageJson}: atelier:controlled-gates must include desktop injection controlled gate`);
  }
  if (controlledGatesScript.includes('applet:atelier-real-product-gate')) {
    failures.push(`${files.packageJson}: atelier:controlled-gates must not include real-product gate; use atelier:real-product-gates`);
  }
}
if (typeof realProductGatesScript !== 'string') {
  failures.push(`${files.packageJson}: missing atelier:real-product-gates script`);
} else {
  for (const requiredRealProductGate of [
    'applet:atelier-real-product-gate',
    'applet:atelier-product-window-gate',
    'applet:atelier-product-window-cross-restart-gate',
    'applet:atelier-decision-product-window-gate',
    'applet:atelier-live-resume-product-window-gate',
    'applet:atelier-artifact-gate-product-window-gate',
    'applet:atelier-artifact-gate-recovery-product-window-gate',
    'applet:atelier-artifact-gate-recovery-variants-product-window-gate',
  ]) {
    if (!realProductGatesScript.includes(requiredRealProductGate)) {
      failures.push(`${files.packageJson}: atelier:real-product-gates must run ${requiredRealProductGate}`);
    }
}
}
const recoveryVariantGateScripts = {
  'applet:atelier-artifact-gate-recovery-accept-product-window-gate':
    'pnpm applets:build && node tooling/scripts/applet-atelier-artifact-gate-product-window-gate.mjs --resolve-blocking-gate --gate-recovery-action=accept_risk',
  'applet:atelier-artifact-gate-recovery-continue-product-window-gate':
    'pnpm applets:build && node tooling/scripts/applet-atelier-artifact-gate-product-window-gate.mjs --resolve-blocking-gate --gate-recovery-action=continue',
  'applet:atelier-artifact-gate-recovery-cancel-product-window-gate':
    'pnpm applets:build && node tooling/scripts/applet-atelier-artifact-gate-product-window-gate.mjs --resolve-blocking-gate --gate-recovery-action=cancel',
};
for (const [scriptName, expectedScript] of Object.entries(recoveryVariantGateScripts)) {
  if (packageScripts[scriptName] !== expectedScript) {
    failures.push(`${files.packageJson}: ${scriptName} must exactly run ${expectedScript}`);
  }
}
const recoveryVariantAggregateScript = packageScripts['applet:atelier-artifact-gate-recovery-variants-product-window-gate'];
const expectedRecoveryVariantAggregateScript = Object.keys(recoveryVariantGateScripts)
  .map((scriptName) => `pnpm run ${scriptName}`)
  .join(' && ');
if (recoveryVariantAggregateScript !== expectedRecoveryVariantAggregateScript) {
  failures.push(
    `${files.packageJson}: applet:atelier-artifact-gate-recovery-variants-product-window-gate must exactly aggregate accept_risk, continue, and cancel recovery variant gates`,
  );
}
expectNotIncludes(files.masterGoal, contents.masterGoal, 'controlled-gates` PASS（包含 official applet build 与 real-product gate', 'Atelier ledger must not claim controlled-gates includes real-product gate');
expectIncludes(files.masterGoal, contents.masterGoal, 'controlled-gates` PASS（包含 official applet build 与 desktop-injection gate；real-product gate 由 `pnpm run atelier:real-product-gates` 独立覆盖', 'Atelier ledger must distinguish controlled desktop-injection evidence from separate real-product gate evidence');
expectIncludes(files.masterGoal, contents.masterGoal, '全局 Atelier readiness 仍为 `NOT_READY`', 'Atelier ledger must preserve global NOT_READY readiness boundary');
expectIncludes(files.masterGoal, contents.masterGoal, 'ledger readiness boundary guard', 'Atelier ledger must record the readiness-boundary guard scope');
expectNotIncludes(files.masterGoal, contents.masterGoal, '全局 Atelier readiness 为 `READY`', 'Atelier ledger must not claim global READY readiness');
expectNotIncludes(files.masterGoal, contents.masterGoal, 'Atelier is globally complete and ready for a final completion claim.', 'Atelier ledger must not claim global final completion');
expectIncludes(files.packageJson, contents.packageJson, 'applet:atelier-real-product-gate', 'package script for Atelier real product gate');
expectIncludes(files.packageJson, contents.packageJson, 'applet:atelier-product-window-gate', 'package script for Atelier product-window gate');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, 'atelier-real-product-gate.json', 'Atelier real product gate evidence file');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, 'PEERS_APPLET_ATELIER_GATE_BASE_URL', 'Atelier real product gate must drive Desktop Gateway against Station gate server');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, 'PEERS_APPLET_ATELIER_GATE_AGENT_ID', 'Atelier real product gate must pass real replay agent id to Desktop Gateway test');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, 'PEERS_APPLET_ATELIER_GATE_TASK_ID', 'Atelier real product gate must pass real replay task id to Desktop Gateway test');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, 'PEERS_ATELIER_GATE_CLOSE_BEFORE_FIRST_REPLAY', 'Atelier real product gate must enable controlled Station SSE close before any replay event');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, 'PEERS_ATELIER_GATE_CLOSE_AFTER_FIRST_REPLAY', 'Atelier real product gate must enable controlled Station SSE close for reconnect coverage');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, 'atelier_gateway_reaches_station_bundled_atelier_workspace', 'Atelier real product gate must run Desktop Gateway cargo test');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "evidenceClass: 'REAL_PRODUCT_PATH'", 'Atelier real product gate must classify evidence as REAL_PRODUCT_PATH');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "'atelier.projection.event replay via /sub-agent/agent/events/subscribe'", 'Atelier real product gate must cover real Station projection event replay path');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "'afterEventSeq cursor-filtered replay through Desktop Gateway and Station EventStreamService'", 'Atelier real product gate must cover cursor-filtered replay through product path');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "'controlled Station SSE close before first replay followed by Desktop Gateway reconnect with afterEventSeq=0'", 'Atelier real product gate must cover controlled pre-replay reconnect with zero cursor');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "'controlled Station SSE close after first replay followed by Desktop Gateway reconnect using persisted cursor'", 'Atelier real product gate must cover controlled reconnect with persisted cursor');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "'arbitrary network failure outside controlled pre-replay/post-replay Station SSE EOF'", 'Atelier real product gate must not overclaim arbitrary network failure E2E');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "'cross-restart cursor recovery in real Desktop product window UI'", 'Atelier real product gate must not overclaim product-window cursor recovery E2E');
expectIncludes(files.atelierRealProductGate, contents.atelierRealProductGate, "'real Desktop product window UI'", 'Atelier real product gate must not overclaim product window UI E2E');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'sqlite.Open("file:atelier-real-product-gate?mode=memory&cache=shared")', 'Atelier real product gate server must use sqlite-backed Station store');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'CREATE TABLE agent_collaboration_tasks', 'Atelier real product gate server must create sqlite-compatible collaboration task table for real projection service');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'CREATE TABLE agent_task_runs', 'Atelier real product gate server must create sqlite-compatible task run table for replay ownership');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'CREATE TABLE agent_task_events', 'Atelier real product gate server must create sqlite-compatible durable event table for real replay service');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'projectionService.LoadWorkspace', 'Atelier real product gate server must call Station-owned projection service');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'eventStreamService.ReplayTaskEvents', 'Atelier real product gate server must call Station-owned event replay service');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'agent_task_events', 'Atelier real product gate server must seed durable outbox event');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'atelier-real-product-event-2', 'Atelier real product gate server must seed a later event for cursor replay coverage');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, '/__atelier_gate/replay_probe', 'Atelier real product gate server must expose local replay probe for reconnect cursor evidence');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'consumeCloseBeforeFirstReplay', 'Atelier real product gate server must simulate controlled Station SSE close before replay');
expectIncludes(files.atelierRealProductGateServer, contents.atelierRealProductGateServer, 'shouldCloseAfterFirstReplayEvent', 'Atelier real product gate server must simulate controlled Station SSE close');
expectIncludes(files.rustGateway, contents.rustGateway, 'fn atelier_gateway_reaches_station_bundled_atelier_workspace()', 'Desktop Gateway must test real Atelier service binding path');
expectIncludes(files.rustGateway, contents.rustGateway, 'PEERS_APPLET_SERVICE_ATELIER', 'Desktop Gateway Atelier test must use service override for Station gate server');
expectIncludes(files.rustGateway, contents.rustGateway, 'PEERS_STATION_URL', 'Desktop Gateway Atelier event replay test must point station_base_url at Station gate server');
expectIncludes(files.rustGateway, contents.rustGateway, '"atelier.projection.event"', 'Desktop Gateway Atelier test must subscribe and poll projection event topic');
expectIncludes(files.rustGateway, contents.rustGateway, 'Some("stream.append")', 'Desktop Gateway Atelier test must assert replayed projection patch');
expectIncludes(files.rustGateway, contents.rustGateway, 'Some("atelier-projection/v0")', 'Desktop Gateway Atelier test must assert projection contract version');
expectIncludes(files.rustGateway, contents.rustGateway, '"afterEventSeq": 1', 'Desktop Gateway Atelier test must request cursor-filtered replay');
expectIncludes(files.rustGateway, contents.rustGateway, 'first controlled stream request should close before replay and keep afterEventSeq=0', 'Desktop Gateway Atelier test must assert pre-replay close reconnect starts from zero cursor');
expectIncludes(files.rustGateway, contents.rustGateway, 'replayed_sequences.contains(&2)', 'Desktop Gateway Atelier test must assert later cursor replay event');
expectIncludes(files.rustGateway, contents.rustGateway, '!replayed_sequences.contains(&1)', 'Desktop Gateway Atelier test must reject already-seen cursor event replay');
expectIncludes(files.rustGateway, contents.rustGateway, 'controlled stream close should reconnect from persisted cursor and deliver seq=2', 'Desktop Gateway Atelier test must assert reconnect after controlled stream close');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'atelier-product-window-gate.json', 'Atelier product-window gate evidence file');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'applet-desktop-product-window-gate.mjs', 'Atelier product-window gate must reuse packaged Desktop product-window harness');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'--product-app'", 'Atelier product-window gate must run product app mode');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "appletId: 'peers.atelier'", 'Atelier product-window gate evidence must be scoped to peers.atelier');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "evidenceClass: 'REAL_PRODUCT_PATH'", 'Atelier product-window gate must classify evidence as REAL_PRODUCT_PATH');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'packaged peers.atelier renders inside the normal Desktop product shell'", 'Atelier product-window gate must cover packaged product shell rendering');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_EXTERNAL_STATION_BASE_URL', 'Atelier product-window gate must proxy product-window Station requests to the sqlite-backed Atelier gate server');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_JSON', 'Atelier product-window gate must inject launch options so official applet can start Station projection replay');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_REQUIRED_URLS', 'Atelier product-window gate must wait for the Station workspace request inside product-window UI');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, '/sub-agent/agent/events/subscribe', 'Atelier product-window gate must wait for Station projection subscribe inside product-window UI');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_ATELIER_GATE_CLOSE_BEFORE_FIRST_REPLAY', 'Atelier product-window gate must exercise controlled pre-replay SSE close inside product-window UI');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_ATELIER_GATE_CLOSE_AFTER_FIRST_REPLAY', 'Atelier product-window gate must exercise controlled post-first-replay SSE close inside product-window UI');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER', 'Atelier product-window gate must close the product-window applet after render for unsubscribe evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_UNSUBSCRIBE_EVIDENCE', 'Atelier product-window gate must request explicit Desktop Gateway unsubscribe evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'atelier-product-window-unsubscribe-evidence.json', 'Atelier product-window gate must write dedicated unsubscribe evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_RENDERED_PROJECTION_EVIDENCE', 'Atelier product-window gate must request explicit rendered projection state evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'atelier-product-window-rendered-projection-evidence.json', 'Atelier product-window gate must write dedicated rendered projection evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'expectedReplayProbeSequence', 'Atelier product-window gate must assert the controlled replay/cursor sequence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, '/__atelier_gate/replay_probe', 'Atelier product-window gate must assert Station replay probe evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'official peers.atelier loads Station workspace through /v1/workspace service binding inside the real Desktop product window UI'", 'Atelier product-window gate must cover Station workspace load inside product window UI');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'official peers.atelier starts Station projection event replay through atelier.events.subscribe -> /sub-agent/agent/events/subscribe inside the real Desktop product window UI'", 'Atelier product-window gate must cover Station projection replay request inside product window UI');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'official peers.atelier reconnects after controlled post-first-replay SSE close and resumes from the persisted cursor inside the real Desktop product window UI'", 'Atelier product-window gate must cover controlled product-window reconnect/cursor replay');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'official peers.atelier applies a Station projection event to rendered stream state inside the real Desktop product window UI'", 'Atelier product-window gate must cover applet-side rendered projection state');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'official peers.atelier unsubscribes atelier.projection.event and cancels the Desktop Gateway projection subscription after product-window close'", 'Atelier product-window gate must cover product-window unsubscribe/cancel evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'atelier.projection.unsubscribe'", 'Atelier product-window gate must assert explicit unsubscribe event evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'atelier.projection.rendered'", 'Atelier product-window gate must assert explicit rendered projection event evidence');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, 'renderedProjectionProperties.eventBlockIds.every', 'Atelier product-window gate must prove event blocks reached rendered state');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'projection SSE cross-restart cursor recovery inside real Desktop product window UI'", 'Atelier product-window gate must not overclaim cross-restart cursor recovery inside product window');
expectIncludes(files.atelierProductWindowGate, contents.atelierProductWindowGate, "'complete Host + Station + applet E2E'", 'Atelier product-window gate must not overclaim full E2E');
expectIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, 'atelier-decision-product-window-gate.json', 'Atelier decision product-window gate evidence file');
expectIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, '/applets/atelier/v1/escalations:resolve', 'Atelier decision product-window gate must require Station resolve service binding');
expectIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_ATELIER_DECISION_RESOLVED_EVIDENCE', 'Atelier decision product-window gate must request explicit rendered decision evidence');
expectIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, 'atelier.decision.resolved.rendered', 'Atelier decision product-window gate must assert rendered decision telemetry');
expectIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, '/__atelier_gate/resolve_probe', 'Atelier decision product-window gate must assert Station guarded resume probe evidence');
expectIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, 'humanDecisionRoute', 'Atelier decision product-window gate must prove Station-owned human decision route normalization');
expectIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, "'Artifact/Gate production and blocking-gate recovery E2E'", 'Atelier decision product-window gate must not overclaim P3-06');
expectNotIncludes(files.atelierDecisionProductWindowGate, contents.atelierDecisionProductWindowGate, "'complete Host + Station + applet E2E',\n        'complete Host + Station + applet E2E'", 'Atelier decision product-window gate must not duplicate full E2E notCovered evidence');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'externalStationBaseUrl', 'Desktop product-window gate must support an external Station upstream for applet-specific real-product gates');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'waitForRequiredUpstreamUrls', 'Desktop product-window gate must wait for required product-mode upstream requests after render evidence');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_POST_REQUIRED_URLS_WAIT_MS', 'Desktop product-window gate must support post-required observation time for reconnect evidence');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'PEERS_APPLET_PRODUCT_WINDOW_E2E_LIFECYCLE_EVIDENCE', 'Desktop product-window gate must separate lifecycle evidence from render evidence');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'productWindowActorId', 'Desktop product-window gate controlled actor profile must follow the product-window launch actor id');
expectIncludes(files.desktopExecutorWorker, contents.desktopExecutorWorker, 'PEERS_APPLET_PRODUCT_WINDOW_E2E', 'Desktop executor worker must recognize product-window certification mode');
expectIncludes(files.desktopExecutorWorker, contents.desktopExecutorWorker, 'PEERS_DESKTOP_EXECUTOR_WORKER', 'Desktop executor worker must support an explicit override for certification runs');
expectIncludes(files.desktopExecutorWorker, contents.desktopExecutorWorker, 'desktop_executor_worker_enabled', 'Desktop executor worker must centralize product-window certification startup policy');
expectIncludes(files.rustGateway, contents.rustGateway, 'PRODUCT_WINDOW_E2E_LAUNCH_OPTIONS_ENV', 'Desktop Gateway app.getLaunchOptions must support product-window E2E launch options without applet-specific hardcoding');
expectIncludes(files.rustGateway, contents.rustGateway, 'product_window_e2e_launch_options', 'Desktop Gateway app capability must expose guarded product-window launch options');
expectIncludes(files.desktopAppletRuntimePage, contents.desktopAppletRuntimePage, 'getAppletProductWindowLaunchContext', 'AppletRuntimePage must read product-window launch context for controlled E2E close');
expectIncludes(files.desktopAppletRuntimePage, contents.desktopAppletRuntimePage, 'closeAfterRender', 'AppletRuntimePage must support product-window close-after-render evidence mode');
expectIncludes(files.desktopAppletRuntimePage, contents.desktopAppletRuntimePage, 'product-window E2E closing applet after render', 'AppletRuntimePage must log controlled close-after-render execution');
expectIncludes(files.desktopAppletRuntimePage, contents.desktopAppletRuntimePage, 'handleClose();', 'AppletRuntimePage controlled close must reuse the real close path');
expectIncludes(files.desktopTauriAppletsCommands, contents.desktopTauriAppletsCommands, 'PRODUCT_WINDOW_E2E_CLOSE_AFTER_RENDER_ENV', 'Desktop product-window launch context must expose close-after-render evidence mode');
expectIncludes(files.desktopTauriAppletsCommands, contents.desktopTauriAppletsCommands, '"closeAfterRender"', 'Desktop product-window launch context must include closeAfterRender');
expectIncludes(files.rustGateway, contents.rustGateway, 'PRODUCT_WINDOW_E2E_ATELIER_UNSUBSCRIBE_EVIDENCE_ENV', 'Desktop Gateway must support explicit product-window Atelier unsubscribe evidence');
expectIncludes(files.rustGateway, contents.rustGateway, 'record_product_window_e2e_atelier_unsubscribe', 'Desktop Gateway must record product-window unsubscribe evidence after topic unsubscribe');
expectIncludes(files.rustGateway, contents.rustGateway, '"atelier.projection.unsubscribe"', 'Desktop Gateway unsubscribe evidence must use a stable event name');
expectIncludes(files.rustGateway, contents.rustGateway, 'PRODUCT_WINDOW_E2E_ATELIER_RENDERED_PROJECTION_EVIDENCE_ENV', 'Desktop Gateway must support explicit product-window rendered projection evidence');
expectIncludes(files.rustGateway, contents.rustGateway, 'record_product_window_e2e_atelier_rendered_projection', 'Desktop Gateway must record rendered projection evidence from applet telemetry');
expectIncludes(files.rustGateway, contents.rustGateway, '"atelier.projection.rendered"', 'Desktop Gateway rendered projection evidence must use a stable event name');
expectIncludes(files.appletSdkLynxAdapter, contents.appletSdkLynxAdapter, "method: 'events.subscribe'", 'Lynx SDK event receiver must consume the host-event long-poll channel');
expectIncludes(files.appletSdkLynxAdapter, contents.appletSdkLynxAdapter, 'events.subscribe` without params', 'Lynx SDK must document that topic registration and host-event delivery use separate subscribe contracts');
expectIncludes(files.lynxHostElementTest, contents.lynxHostElementTest, 'routes topic event subscriptions to the Desktop Gateway instead of the local long-poll queue', 'Lynx Host tests must lock topic subscribe routing to the Gateway');
expectIncludes(files.lynxHostElementTest, contents.lynxHostElementTest, "params: { topic: 'atelier.projection.event' }", 'Lynx Host tests must prove Atelier projection topic registration is routed with params.topic');
expectIncludes(files.appletSdkIndex, contents.appletSdkIndex, 'pendingEvents', 'Applet SDK must buffer Host events that arrive before local handlers register');
expectIncludes(files.appletSdkIndex, contents.appletSdkIndex, 'MAX_PENDING_EVENTS', 'Applet SDK pending Host event buffer must remain bounded');
expectIncludes(files.appletSdkIndex, contents.appletSdkIndex, 'if (event.topic === topic)', 'Applet SDK must drain pending Host events by topic when handlers register');
expectIncludes(files.officialFrontendController, contents.officialFrontendController, 'lastAppliedProjectionEvent', 'Official Atelier controller must expose the last applied projection event for rendered-state evidence');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, "name: 'atelier.projection.rendered'", 'Official Atelier page must report rendered projection evidence through telemetry');
expectIncludes(files.officialFrontendPage, contents.officialFrontendPage, 'eventBlockIds.every((blockId) => renderedBlockIds.includes(blockId))', 'Official Atelier page must only report rendered projection evidence after event blocks are in rendered state');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'statSync(right).mtimeMs - statSync(left).mtimeMs', 'Desktop product-window gate must select newest macOS .app bundle instead of stale directory order');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'desktopFrontendDist', 'Desktop product-window gate Tauri config override must preserve absolute frontendDist renderer assets');
expectIncludes(files.desktopProductWindowGate, contents.desktopProductWindowGate, 'cwd: path.dirname(executablePath)', 'Desktop product-window gate must launch the packaged executable from Contents/MacOS');
expectIncludes(files.desktopIdentityRuntime, contents.desktopIdentityRuntime, 'window.location.hash = targetHash', 'Desktop product-window launch must trigger hash router navigation');
expectNotIncludes(files.desktopIdentityRuntime, contents.desktopIdentityRuntime, "window.history.replaceState(null, '', targetHash)", 'Desktop product-window launch must not silently replace hash without router notification');
expectIncludes(files.desktopHashRouter, contents.desktopHashRouter, 'onWindowLocationChange', 'Desktop hash router must consume both popstate and hashchange updates');
expectNotIncludes(files.desktopHashRouter, contents.desktopHashRouter, 'onWindowPopState', 'Desktop hash router must not ignore hashchange-only navigation');
expectIncludes(files.desktopBrowserEvents, contents.desktopBrowserEvents, "window.addEventListener('hashchange', handler)", 'Desktop browser event adapter must expose hashchange for hash router navigation');
expectIncludes(files.rustGateway, contents.rustGateway, 'replay_probe_request_matches(&replay_probe_requests, 1, &[2])', 'Desktop Gateway Atelier test must prove reconnect request used persisted cursor');

if (failures.length > 0) {
  console.error('Atelier projection contract gate failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Atelier projection contract gate passed.');
