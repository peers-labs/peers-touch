import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const checkOnly = process.argv.includes('--check');

const contractPath = path.join(repoRoot, 'apps/applets/atelier/contracts/atelier-projection.contract.json');
const schemaPath = path.join(repoRoot, 'apps/applets/atelier/contracts/atelier-projection.schema.generated.json');
const tsPaths = [
  path.join(repoRoot, 'apps/applets/atelier/frontend/src/domain/projection.contract.generated.ts'),
  path.join(repoRoot, 'packages/prototypes/desktop/applets/atelier/src/projection.contract.generated.ts'),
];

const contract = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
validateContract(contract);

const schema = buildSchema(contract);
const tsSource = buildTypeScript(contract);

const outputs = [
  [schemaPath, JSON.stringify(schema, null, 2) + '\n'],
  ...tsPaths.map((tsPath) => [tsPath, tsSource]),
];

let stale = false;
for (const [targetPath, content] of outputs) {
  const current = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
  if (current !== content) {
    stale = true;
    if (!checkOnly) {
      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      fs.writeFileSync(targetPath, content);
    }
  }
}

if (checkOnly && stale) {
  console.error('Atelier projection generated contract files are stale. Run `pnpm run atelier:projection-codegen`.');
  process.exit(1);
}

console.log(`${checkOnly ? 'PASS' : 'WROTE'} Atelier projection contract generated artifacts`);

function validateContract(value) {
  assertString(value.id, 'id');
  assertString(value.appletId, 'appletId');
  assertString(value.service, 'service');
  assertString(value.version, 'version');
  assertString(value.eventTopic, 'eventTopic');
  validateEventSubscription(value.eventSubscription);
  assertStringArray(value.methods, 'methods');
  assertStringArray(value.runtimeMethods, 'runtimeMethods');
  validateMethodIntents(value.methods, value.methodIntents);
  assertString(value.subscriptionMethod, 'subscriptionMethod');
  assertStringArray(value.gatewayActions, 'gatewayActions');
  assertStringArray(value.patchKinds, 'patchKinds');
  assertStringArray(value.snapshotRequiredFields, 'snapshotRequiredFields');
  assertStringArray(value.snapshotOptionalFields, 'snapshotOptionalFields');
  assertStringArray(value.eventRequiredFields, 'eventRequiredFields');
  assertStringArray(value.eventOptionalFields, 'eventOptionalFields');
  assertStringArray(value.replayFields, 'replayFields');
  if (!isRecord(value.methodPayloads)) {
    throw new Error('methodPayloads must be an object');
  }
  validateCreateFromGoalPayload(value.methodPayloads['atelier.project.createFromGoal']);
  validateWorkspaceOpenPayload(value.methodPayloads['atelier.workspace.open']);
  validateArtifactPreviewOpenPayload(value.methodPayloads['atelier.artifact.preview.open']);
  validateTaskLifecycle(value.taskLifecycle, value.methodPayloads);
  validateAgentRoleAuthority(value.agentRoleAuthority);
  validateNegotiationProjection(value.negotiationProjection);
  if (!isRecord(value.streamBlocks)) {
    throw new Error('streamBlocks must be an object');
  }
  assertStringArray(value.streamBlocks.allowedKinds, 'streamBlocks.allowedKinds');
  validateStreamBlockRequiredFields(value.streamBlocks);
  assertStringArray(value.streamBlocks.diffSummaryFields, 'streamBlocks.diffSummaryFields');
  validateViewSurface(value.viewSurface);
  validateProjectSurface(value.projectSurface);
  validateWorkbenchSurface(value.workbenchSurface);
  validateBudgetSurface(value.budgetSurface);
  validateProviderCapabilitiesPayload(value.methodPayloads['atelier.provider.capabilities']);
  if (!isRecord(value.artifactPreview)) {
    throw new Error('artifactPreview must be an object');
  }
  assertStringArray(value.artifactPreview.allowedPreviewHints, 'artifactPreview.allowedPreviewHints');
  assertStringArray(value.artifactPreview.metadataFields, 'artifactPreview.metadataFields');
  assertStringArray(value.artifactPreview.previewTargetFields, 'artifactPreview.previewTargetFields');
  assertStringArray(value.artifactPreview.allowedPreviewTargetModes, 'artifactPreview.allowedPreviewTargetModes');
  assertStringArray(value.artifactPreview.allowedBodyRefSchemes, 'artifactPreview.allowedBodyRefSchemes');
  assertStringArray(value.artifactPreview.allowedSandboxRefSchemes, 'artifactPreview.allowedSandboxRefSchemes');
  validateArtifactRefShape(value.artifactPreview.bodyRefShape, value.artifactPreview.allowedBodyRefSchemes, 'artifactPreview.bodyRefShape');
  validateArtifactRefShape(value.artifactPreview.sandboxRefShape, value.artifactPreview.allowedSandboxRefSchemes, 'artifactPreview.sandboxRefShape');
  assertStringArray(value.artifactPreview.forbiddenBodyFields, 'artifactPreview.forbiddenBodyFields');
}

function validateArtifactRefShape(shape, allowedSchemes, name) {
  if (!isRecord(shape)) {
    throw new Error(`${name} must be an object`);
  }
  assertString(shape.scheme, `${name}.scheme`);
  assertString(shape.terminalSegment, `${name}.terminalSegment`);
  if (!Number.isInteger(shape.pathSegments) || shape.pathSegments < 1) {
    throw new Error(`${name}.pathSegments must be a positive integer`);
  }
  if (!allowedSchemes.includes(shape.scheme)) {
    throw new Error(`${name}.scheme must be included in allowed schemes`);
  }
}

function validateCreateFromGoalPayload(payload) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal must be an object');
  }
  assertStringArray(payload.allowedIntentPresets, 'methodPayloads.atelier.project.createFromGoal.allowedIntentPresets');
  if (!isRecord(payload.intentPresetMapping)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.intentPresetMapping must be an object');
  }
  for (const preset of payload.allowedIntentPresets) {
    const mapping = payload.intentPresetMapping[preset];
    if (!isRecord(mapping)) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.intentPresetMapping.${preset} must be an object`);
    }
    assertString(mapping.providerStrategyPreset, `methodPayloads.atelier.project.createFromGoal.intentPresetMapping.${preset}.providerStrategyPreset`);
    assertString(mapping.gatePlanPreset, `methodPayloads.atelier.project.createFromGoal.intentPresetMapping.${preset}.gatePlanPreset`);
  }
  assertStringArray(payload.allowedRunKinds, 'methodPayloads.atelier.project.createFromGoal.allowedRunKinds');
    assertString(payload.defaultRunKind, 'methodPayloads.atelier.project.createFromGoal.defaultRunKind');
    if (!payload.allowedRunKinds.includes(payload.defaultRunKind)) {
      throw new Error('methodPayloads.atelier.project.createFromGoal.defaultRunKind must be one of allowedRunKinds');
    }
  assertStringArray(payload.allowedDirectRunModels, 'methodPayloads.atelier.project.createFromGoal.allowedDirectRunModels');
    assertString(payload.defaultDirectRunModel, 'methodPayloads.atelier.project.createFromGoal.defaultDirectRunModel');
    if (!payload.allowedDirectRunModels.includes(payload.defaultDirectRunModel)) {
      throw new Error('methodPayloads.atelier.project.createFromGoal.defaultDirectRunModel must be one of allowedDirectRunModels');
    }
  assertStringArray(payload.allowedAgentFlowIds, 'methodPayloads.atelier.project.createFromGoal.allowedAgentFlowIds');
  assertString(payload.defaultAgentFlowId, 'methodPayloads.atelier.project.createFromGoal.defaultAgentFlowId');
  if (!payload.allowedAgentFlowIds.includes(payload.defaultAgentFlowId)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.defaultAgentFlowId must be one of allowedAgentFlowIds');
  }
  validateAgentFlowDescriptors(payload);
}

function validateAgentFlowDescriptors(payload) {
  if (!Array.isArray(payload.agentFlowDescriptors)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors must be an array');
  }
  const descriptorIds = [];
  for (const [index, descriptor] of payload.agentFlowDescriptors.entries()) {
    if (!isRecord(descriptor)) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index} must be an object`);
    }
    assertString(descriptor.id, `methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.id`);
    assertString(descriptor.label, `methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.label`);
    assertString(descriptor.description, `methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.description`);
    if (!Number.isInteger(descriptor.batch) || ![1, 2].includes(descriptor.batch)) {
      throw new Error(`methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors.${index}.batch must be 1 or 2`);
    }
    descriptorIds.push(descriptor.id);
  }
  if (JSON.stringify(descriptorIds) !== JSON.stringify(payload.allowedAgentFlowIds)) {
    throw new Error('methodPayloads.atelier.project.createFromGoal.agentFlowDescriptors ids must match allowedAgentFlowIds order');
  }
}

function validateArtifactPreviewOpenPayload(payload) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.artifact.preview.open must be an object');
  }
  assertStringArray(payload.allowedModes, 'methodPayloads.atelier.artifact.preview.open.allowedModes');
  assertString(payload.defaultMode, 'methodPayloads.atelier.artifact.preview.open.defaultMode');
  if (!payload.allowedModes.includes(payload.defaultMode)) {
    throw new Error('methodPayloads.atelier.artifact.preview.open.defaultMode must be included in allowedModes');
  }
  assertStringArray(payload.allowedRendererOwner, 'methodPayloads.atelier.artifact.preview.open.allowedRendererOwner');
  assertStringArray(payload.allowedRendererMode, 'methodPayloads.atelier.artifact.preview.open.allowedRendererMode');
  assertStringArray(payload.allowedRendererStatus, 'methodPayloads.atelier.artifact.preview.open.allowedRendererStatus');
  assertStringArray(payload.requiredRendererCapabilities, 'methodPayloads.atelier.artifact.preview.open.requiredRendererCapabilities');
  if (!payload.requiredRendererCapabilities.includes('host_visual_renderer_surface')) {
    throw new Error('methodPayloads.atelier.artifact.preview.open.requiredRendererCapabilities must include host_visual_renderer_surface');
  }
}

function validateWorkspaceOpenPayload(payload) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.workspace.open must be an object');
  }
  assertStringArray(payload.allowedUriSchemes, 'methodPayloads.atelier.workspace.open.allowedUriSchemes');
  if (!isRecord(payload.uriShape)) {
    throw new Error('methodPayloads.atelier.workspace.open.uriShape must be an object');
  }
  assertString(payload.uriShape.scheme, 'methodPayloads.atelier.workspace.open.uriShape.scheme');
  assertString(payload.uriShape.host, 'methodPayloads.atelier.workspace.open.uriShape.host');
  assertString(payload.uriShape.workspaceQueryKey, 'methodPayloads.atelier.workspace.open.uriShape.workspaceQueryKey');
  if (!Number.isInteger(payload.uriShape.taskPathSegments) || payload.uriShape.taskPathSegments < 1) {
    throw new Error('methodPayloads.atelier.workspace.open.uriShape.taskPathSegments must be a positive integer');
  }
  if (!payload.allowedUriSchemes.includes(payload.uriShape.scheme)) {
    throw new Error('methodPayloads.atelier.workspace.open.uriShape.scheme must be included in allowedUriSchemes');
  }
}

function validateProviderCapabilitiesPayload(payload) {
  if (!isRecord(payload)) {
    throw new Error('methodPayloads.atelier.provider.capabilities must be an object');
  }
  assertStringArray(payload.allowedCapabilityScopes, 'methodPayloads.atelier.provider.capabilities.allowedCapabilityScopes');
  assertString(payload.capabilityScope, 'methodPayloads.atelier.provider.capabilities.capabilityScope');
  if (!payload.allowedCapabilityScopes.includes(payload.capabilityScope)) {
    throw new Error('methodPayloads.atelier.provider.capabilities.capabilityScope must be included in allowedCapabilityScopes');
  }
  if (payload.capabilityReadOnly !== true) {
    throw new Error('methodPayloads.atelier.provider.capabilities.capabilityReadOnly must be true');
  }
}

function buildSchema(source) {
  const artifactForbidden = Object.fromEntries(source.artifactPreview.forbiddenBodyFields.map((field) => [field, false]));
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'peers.atelier.projection.schema.generated.json',
    title: 'Atelier Projection Contract',
    description: 'Generated from atelier-projection.contract.json. Do not edit by hand.',
    type: 'object',
    required: source.eventRequiredFields,
    additionalProperties: false,
    properties: {
      id: { type: 'string', minLength: 1 },
      seq: { type: 'number', minimum: 0 },
      taskId: { type: 'string' },
      receivedAt: { type: 'string', minLength: 1 },
      patch: { $ref: '#/$defs/patch' },
    },
    $defs: {
      patch: {
        oneOf: source.patchKinds.map((kind) => ({ $ref: `#/$defs/${patchDefName(kind)}` })),
      },
      snapshotPatch: {
        type: 'object',
        required: ['kind', 'snapshot'],
        additionalProperties: false,
        properties: {
          kind: { const: 'snapshot' },
          snapshot: { $ref: '#/$defs/snapshot' },
        },
      },
      taskUpsertPatch: patchSchema('task.upsert', { task: { type: 'object' }, select: { type: 'boolean' } }, ['kind', 'task']),
      taskStatusPatch: patchSchema('task.status', { taskId: { type: 'string' }, status: { enum: source.taskLifecycle.states } }, ['kind', 'taskId', 'status']),
      streamAppendPatch: patchSchema('stream.append', { taskId: { type: 'string' }, blocks: { type: 'array', items: { type: 'object' } } }, ['kind', 'taskId', 'blocks']),
      decisionResolvedPatch: patchSchema('decision.resolved', { taskId: { type: 'string' }, blockId: { type: 'string' }, choice: { type: 'string' } }, ['kind', 'taskId', 'blockId', 'choice']),
      artifactUpsertPatch: patchSchema('artifact.upsert', { taskId: { type: 'string' }, artifact: { $ref: '#/$defs/artifact' } }, ['kind', 'taskId', 'artifact']),
      gateUpsertPatch: patchSchema('gate.upsert', { taskId: { type: 'string' }, gate: { type: 'object' } }, ['kind', 'taskId', 'gate']),
      contextReplacePatch: patchSchema('context.replace', { taskId: { type: 'string' }, context: { type: 'object' } }, ['kind', 'taskId', 'context']),
      todoReplacePatch: patchSchema('todo.replace', { taskId: { type: 'string' }, todos: { type: 'array', items: { type: 'object' } } }, ['kind', 'taskId', 'todos']),
      snapshot: {
        type: 'object',
        required: ['version', 'selectedTaskId', 'workspace'],
        additionalProperties: false,
        properties: {
          version: { const: source.version },
          selectedTaskId: { type: 'string' },
          workspace: { type: 'object' },
        },
      },
      artifact: {
        type: 'object',
        required: ['id'],
        additionalProperties: true,
        properties: {
          id: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string' },
          meta: { type: 'string' },
          previewHint: { enum: source.artifactPreview.allowedPreviewHints },
          bodyRef: { type: 'string' },
          bodyHash: { type: 'string' },
          bodySize: { type: 'string' },
          bodyKind: { type: 'string' },
          paths: { type: 'array', items: { type: 'string' } },
          size: { type: 'string' },
          previewTarget: { $ref: '#/$defs/artifactPreviewTarget' },
          ...artifactForbidden,
        },
      },
      artifactPreviewTarget: {
        type: 'object',
        additionalProperties: false,
        properties: {
          kind: { type: 'string' },
          mode: { type: 'string' },
          label: { type: 'string' },
          sandboxRef: { type: 'string' },
          bodyRef: { type: 'string' },
        },
      },
    },
  };
}

function patchSchema(kind, properties, required) {
  return {
    type: 'object',
    required,
    additionalProperties: false,
    properties: {
      kind: { const: kind },
      ...properties,
    },
  };
}

function validateEventSubscription(eventSubscription) {
  if (!isRecord(eventSubscription)) {
    throw new Error('eventSubscription must be an object');
  }
  assertStringArray(eventSubscription.agentIdSourcePriority, 'eventSubscription.agentIdSourcePriority');
  assertStringArray(eventSubscription.taskIdSourcePriority, 'eventSubscription.taskIdSourcePriority');
  if (JSON.stringify(eventSubscription.agentIdSourcePriority) !== JSON.stringify(['agentId', 'agentIds[0]'])) {
    throw new Error('eventSubscription.agentIdSourcePriority must be agentId, agentIds[0]');
  }
  const expectedTaskIdSourcePriority = [
    'certificationCreatedSelectedTaskId',
    'explicitTaskId',
    'controllerSelectedTaskId',
    'snapshotSelectedTaskId',
    'snapshotFirstTaskId',
  ];
  if (JSON.stringify(eventSubscription.taskIdSourcePriority) !== JSON.stringify(expectedTaskIdSourcePriority)) {
    throw new Error('eventSubscription.taskIdSourcePriority must match the official projection stream task fallback order');
  }
  assertString(eventSubscription.defaultCursorSource, 'eventSubscription.defaultCursorSource');
  if (eventSubscription.defaultCursorSource !== 'workspace.replay[taskId].nextEventSeq') {
    throw new Error('eventSubscription.defaultCursorSource must be workspace.replay[taskId].nextEventSeq');
  }
  assertString(eventSubscription.zeroCursorPolicy, 'eventSubscription.zeroCursorPolicy');
  if (eventSubscription.zeroCursorPolicy !== 'omit') {
    throw new Error('eventSubscription.zeroCursorPolicy must be omit');
  }
}

function patchDefName(kind) {
  return `${kind.replace(/\.([a-z])/g, (_, char) => char.toUpperCase())}Patch`;
}

function buildTypeScript(source) {
  const json = JSON.stringify(
    {
      version: source.version,
      eventTopic: source.eventTopic,
      eventSubscription: source.eventSubscription,
      subscriptionMethod: source.subscriptionMethod,
      methods: source.methods,
      runtimeMethods: source.runtimeMethods,
      methodIntents: source.methodIntents,
      methodPayloads: source.methodPayloads,
      taskLifecycle: source.taskLifecycle,
      agentRoleAuthority: source.agentRoleAuthority,
      negotiationProjection: source.negotiationProjection,
      gatewayActions: source.gatewayActions,
      patchKinds: source.patchKinds,
      replayFields: source.replayFields,
      streamBlocks: source.streamBlocks,
      viewSurface: source.viewSurface,
      projectSurface: source.projectSurface,
      workbenchSurface: source.workbenchSurface,
      budgetSurface: source.budgetSurface,
      artifactPreview: source.artifactPreview,
    },
    null,
    2,
  );
  const projectSurfaceExports = `export const ATELIER_PROJECT_SURFACE = ATELIER_PROJECTION_CONTRACT.projectSurface;\nexport const ATELIER_PROJECT_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.projectStates;\nexport const ATELIER_MILESTONE_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.milestoneStates;\nexport const ATELIER_TASK_GRAPH_NODE_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.taskGraphNodeStates;\nexport const ATELIER_TASK_GRAPH_PARALLEL_POLICIES = ATELIER_PROJECTION_CONTRACT.projectSurface.taskGraphParallelPolicies;\nexport const ATELIER_DEPENDENCY_EDGE_TYPES = ATELIER_PROJECTION_CONTRACT.projectSurface.dependencyEdgeTypes;\nexport const ATELIER_BLOCKER_SEVERITIES = ATELIER_PROJECTION_CONTRACT.projectSurface.blockerSeverities;\nexport const ATELIER_BLOCKER_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.blockerStates;\nexport const ATELIER_RESIDUAL_RISK_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.residualRiskStates;\nexport const ATELIER_MEMORY_CANDIDATE_TYPES = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateTypes;\nexport const ATELIER_MEMORY_CANDIDATE_SCOPES = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateScopes;\nexport const ATELIER_MEMORY_CANDIDATE_FEEDS = ATELIER_PROJECTION_CONTRACT.projectSurface.memoryCandidateFeeds;\nexport type AtelierMemoryCandidateFeed = typeof ATELIER_MEMORY_CANDIDATE_FEEDS[number];\nexport const ATELIER_POLICY_RULE_SCOPES = ATELIER_PROJECTION_CONTRACT.projectSurface.policyRuleScopes;\nexport const ATELIER_DEFECT_SOURCES = ATELIER_PROJECTION_CONTRACT.projectSurface.defectSources;\nexport const ATELIER_DEFECT_STATES = ATELIER_PROJECTION_CONTRACT.projectSurface.defectStates;\nexport const ATELIER_PROJECTION_DISPLAY_LIMITS = ATELIER_PROJECTION_CONTRACT.projectSurface.projectionDisplayLimits;\n`;
    const workbenchSurfaceExports = `export const ATELIER_RECOVERY_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.kinds;\nexport type AtelierRecoveryKind = typeof ATELIER_RECOVERY_KINDS[number];\nexport const ATELIER_WORKBENCH_SURFACE = ATELIER_PROJECTION_CONTRACT.workbenchSurface;\nexport const ATELIER_TASK_INTENT_PRESETS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.taskIntentPresets;\nexport const ATELIER_DEFAULT_TASK_INTENT_PRESET = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultTaskIntentPreset;\nexport const ATELIER_RUN_TARGET_KINDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedRunKinds;\nexport type AtelierRunTargetKind = typeof ATELIER_RUN_TARGET_KINDS[number];\nexport const ATELIER_DEFAULT_RUN_TARGET_KIND = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultRunKind;\nexport const ATELIER_DIRECT_RUN_MODELS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedDirectRunModels;\nexport type AtelierDirectRunModel = typeof ATELIER_DIRECT_RUN_MODELS[number];\nexport const ATELIER_DEFAULT_DIRECT_RUN_MODEL = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultDirectRunModel;\nexport const ATELIER_AGENT_FLOW_IDS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].allowedAgentFlowIds;\nexport type AtelierAgentFlowId = typeof ATELIER_AGENT_FLOW_IDS[number];\nexport const ATELIER_DEFAULT_AGENT_FLOW_ID = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].defaultAgentFlowId;\nexport const ATELIER_AGENT_FLOW_DESCRIPTORS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].agentFlowDescriptors;\nexport type AtelierAgentFlowDescriptor = typeof ATELIER_AGENT_FLOW_DESCRIPTORS[number];\nexport const ATELIER_FEEDBACK_SIGNALS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.submit'].allowedSignals;\nexport type AtelierFeedbackSignal = typeof ATELIER_FEEDBACK_SIGNALS[number];\nexport const ATELIER_MEMORY_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.memory.confirmCandidate'].allowedConfirmationMode;\nexport const ATELIER_RERUN_CONFIRMATION_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.confirmRerun'].allowedConfirmationMode;\nexport const ATELIER_WORKSPACE_OPEN_URI_SCHEMES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].allowedUriSchemes;\nexport const ATELIER_WORKSPACE_OPEN_URI_SHAPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'].uriShape;\nexport const ATELIER_PROVIDER_CAPABILITY_SCOPES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].allowedCapabilityScopes;\nexport const ATELIER_PROVIDER_CAPABILITY_READ_ONLY = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityReadOnly;\nexport const ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.project.createFromGoal'].intentPresetMapping;\nexport const ATELIER_TODO_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.todoStatuses;\nexport const ATELIER_CONTEXT_FILE_GROUPS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.contextFileGroups;\nexport const ATELIER_DEFAULT_CONTEXT_FILE_GROUP = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultContextFileGroup;\nexport const ATELIER_TASK_ORGANIZER_MODES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.taskOrganizerModes;\nexport type AtelierTaskOrganizerMode = typeof ATELIER_TASK_ORGANIZER_MODES[number]['id'];\nexport const ATELIER_DEFAULT_TASK_ORGANIZER_MODE = ATELIER_PROJECTION_CONTRACT.workbenchSurface.defaultTaskOrganizerMode;\nexport const ATELIER_ARTIFACT_KINDS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.artifactKinds;\nexport const ATELIER_ARTIFACT_BODY_KINDS = ATELIER_PROJECTION_CONTRACT.workbenchSurface.artifactBodyKinds;\nexport const ATELIER_GATE_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.gateStatuses;\nexport const ATELIER_GATE_CHECK_STATUSES = ATELIER_PROJECTION_CONTRACT.workbenchSurface.gateCheckStatuses;\n`;
  const budgetSurfaceExports = `export const ATELIER_BUDGET_SURFACE = ATELIER_PROJECTION_CONTRACT.budgetSurface;\nexport const ATELIER_BUDGET_STATUSES = ATELIER_PROJECTION_CONTRACT.budgetSurface.budgetStatuses;\n`;
  const providerCapabilityExports = `export const ATELIER_PROVIDER_CAPABILITY_SCOPE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'].capabilityScope;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_DEFAULT_MODE = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].defaultMode;\n`;
  return `// Generated from apps/applets/atelier/contracts/atelier-projection.contract.json.\n// Do not edit by hand. Run \`pnpm run atelier:projection-codegen\`.\n\nexport const ATELIER_PROJECTION_CONTRACT = ${json} as const;\n\nexport type AtelierProjectionVersion = typeof ATELIER_PROJECTION_CONTRACT.version;\nexport type AtelierProjectionPatchKind = typeof ATELIER_PROJECTION_CONTRACT.patchKinds[number];\nexport type AtelierArtifactPreviewHint = typeof ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewHints[number];\nexport type AtelierTaskLifecycleStatus = typeof ATELIER_PROJECTION_CONTRACT.taskLifecycle.states[number];\nexport type AtelierViewStatus = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.statuses[number];\nexport type AtelierEventStreamState = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.eventStreamStates[number];\nexport type AtelierTypedRecoveryKind = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.typedRecoveryKinds[number];\nexport type AtelierStatusNoticeKind = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.statusNoticeKinds[number];\nexport type AtelierRecoveryTone = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.tones[number];\nexport type AtelierPrototypeRecoverySeverity = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSeverityByStatus[AtelierViewStatus];\nexport type AtelierPrototypeRecoverySymbol = typeof ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSymbolByStatus[AtelierViewStatus];\nexport type AtelierBudgetStatus = typeof ATELIER_PROJECTION_CONTRACT.budgetSurface.budgetStatuses[number];\nexport type AtelierAgentRole = typeof ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles[number];\n\nexport const ATELIER_PROJECTION_EVENT_TOPIC = ATELIER_PROJECTION_CONTRACT.eventTopic;\nexport const ATELIER_PROJECTION_SUBSCRIPTION_METHOD = ATELIER_PROJECTION_CONTRACT.subscriptionMethod;\nexport const ATELIER_METHOD_INTENTS = ATELIER_PROJECTION_CONTRACT.methodIntents;\nexport const ATELIER_TASK_LIFECYCLE = ATELIER_PROJECTION_CONTRACT.taskLifecycle;\nexport const ATELIER_TASK_LIFECYCLE_STATES = ATELIER_PROJECTION_CONTRACT.taskLifecycle.states;\nexport const ATELIER_AGENT_ROLE_AUTHORITY = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority;\nexport const ATELIER_AGENT_ROLES = ATELIER_PROJECTION_CONTRACT.agentRoleAuthority.roles;\nexport const ATELIER_STREAM_BLOCK_KINDS = ATELIER_PROJECTION_CONTRACT.streamBlocks.allowedKinds;\nexport const ATELIER_STREAM_BLOCK_REQUIRED_FIELDS_BY_KIND = ATELIER_PROJECTION_CONTRACT.streamBlocks.requiredFieldsByKind;\nexport const ATELIER_DIFF_STREAM_SUMMARY_FIELDS = ATELIER_PROJECTION_CONTRACT.streamBlocks.diffSummaryFields;\nexport const ATELIER_VIEW_SURFACE = ATELIER_PROJECTION_CONTRACT.viewSurface;\nexport const ATELIER_VIEW_STATUSES = ATELIER_PROJECTION_CONTRACT.viewSurface.statuses;\nexport const ATELIER_EVENT_STREAM_STATES = ATELIER_PROJECTION_CONTRACT.viewSurface.eventStreamStates;\nexport const ATELIER_TYPED_RECOVERY_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.typedRecoveryKinds;\nexport const ATELIER_STATUS_NOTICE_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.statusNoticeKinds;\nexport const ATELIER_EMPTY_CTA_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.emptyCtaStatus;\nexport const ATELIER_RECONCILING_EVENT_STREAM_STATE = ATELIER_PROJECTION_CONTRACT.viewSurface.reconcilingEventStreamState;\nexport const ATELIER_DEGRADED_EVENT_STREAM_STATES = ATELIER_PROJECTION_CONTRACT.viewSurface.degradedEventStreamStates;\nexport const ATELIER_RECOVERY_TONES = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.tones;\nexport const ATELIER_RECOVERY_TONE_BY_KIND = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.toneByKind;\nexport const ATELIER_RECOVERY_RETRYABLE_KINDS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.retryableKinds;\nexport const ATELIER_PROTOTYPE_RECOVERY_SEVERITY_BY_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSeverityByStatus;\nexport const ATELIER_PROTOTYPE_RECOVERY_SYMBOL_BY_STATUS = ATELIER_PROJECTION_CONTRACT.viewSurface.recovery.prototypeSymbolByStatus;\n${projectSurfaceExports}${workbenchSurfaceExports}${budgetSurfaceExports}${providerCapabilityExports}export const ATELIER_ARTIFACT_PREVIEW_HINTS = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewHints;\nexport const ATELIER_ARTIFACT_METADATA_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.metadataFields;\nexport const ATELIER_ARTIFACT_PREVIEW_TARGET_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.previewTargetFields;\nexport const ATELIER_ARTIFACT_PREVIEW_TARGET_MODES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedPreviewTargetModes;\nexport const ATELIER_ARTIFACT_BODY_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedBodyRefSchemes;\nexport const ATELIER_ARTIFACT_PREVIEW_TARGET_SANDBOX_REF_SCHEMES = ATELIER_PROJECTION_CONTRACT.artifactPreview.allowedSandboxRefSchemes;\nexport const ATELIER_ARTIFACT_BODY_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.bodyRefShape;\nexport const ATELIER_ARTIFACT_SANDBOX_REF_SHAPE = ATELIER_PROJECTION_CONTRACT.artifactPreview.sandboxRefShape;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedModes;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererOwner;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererMode;\nexport const ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].allowedRendererStatus;\nexport const ATELIER_ARTIFACT_FORBIDDEN_BODY_FIELDS = ATELIER_PROJECTION_CONTRACT.artifactPreview.forbiddenBodyFields;\n`;
}

function validateAgentRoleAuthority(agentRoleAuthority) {
  if (!isRecord(agentRoleAuthority)) {
    throw new Error('agentRoleAuthority must be an object');
  }
  const requiredRoles = ['goal_owner', 'architect', 'planner', 'risk', 'supervisor', 'executor', 'verifier', 'integrator', 'historian'];
  assertStringArray(agentRoleAuthority.roles, 'agentRoleAuthority.roles');
  if (JSON.stringify(agentRoleAuthority.roles) !== JSON.stringify(requiredRoles)) {
    throw new Error('agentRoleAuthority.roles must match the canonical Atelier agent roles');
  }
  const expectedRoleSets = {
    terminalSignoffRoles: ['goal_owner'],
    hardVetoRoles: ['risk'],
    acceptanceVetoRoles: ['verifier'],
    progressControlRoles: ['supervisor'],
    judgmentForbiddenRoles: ['executor'],
    mergeRoles: ['integrator'],
    memoryRecordRoles: ['historian'],
  };
  for (const [field, expected] of Object.entries(expectedRoleSets)) {
    assertStringArray(agentRoleAuthority[field], `agentRoleAuthority.${field}`);
    if (JSON.stringify(agentRoleAuthority[field]) !== JSON.stringify(expected)) {
      throw new Error(`agentRoleAuthority.${field} must be ${expected.join(', ')}`);
    }
    for (const role of agentRoleAuthority[field]) {
      if (!agentRoleAuthority.roles.includes(role)) {
        throw new Error(`agentRoleAuthority.${field}.${role} must be a canonical role`);
      }
    }
  }
  assertString(agentRoleAuthority.executionOwner, 'agentRoleAuthority.executionOwner');
  if (agentRoleAuthority.executionOwner !== 'station') {
    throw new Error('agentRoleAuthority.executionOwner must be station');
  }
  if (agentRoleAuthority.appletMayExecuteAuthority !== false) {
    throw new Error('agentRoleAuthority.appletMayExecuteAuthority must be false');
  }
}

function validateNegotiationProjection(negotiationProjection) {
  if (!isRecord(negotiationProjection)) {
    throw new Error('negotiationProjection must be an object');
  }
  const requiredStances = ['proposal', 'objection', 'counter', 'signoff'];
  assertStringArray(negotiationProjection.voiceStances, 'negotiationProjection.voiceStances');
  if (JSON.stringify(negotiationProjection.voiceStances) !== JSON.stringify(requiredStances)) {
    throw new Error('negotiationProjection.voiceStances must match the canonical voice stance taxonomy');
  }
  assertStringArray(negotiationProjection.requiredVoiceFields, 'negotiationProjection.requiredVoiceFields');
  if (JSON.stringify(negotiationProjection.requiredVoiceFields) !== JSON.stringify(['role', 'stance', 'text'])) {
    throw new Error('negotiationProjection.requiredVoiceFields must be role, stance, text');
  }
  assertStringArray(negotiationProjection.optionalVoiceFields, 'negotiationProjection.optionalVoiceFields');
  if (JSON.stringify(negotiationProjection.optionalVoiceFields) !== JSON.stringify(['evidenceRef', 'sessionId', 'roundId', 'voiceId', 'objectionId'])) {
    throw new Error('negotiationProjection.optionalVoiceFields must match the canonical optional voice trace fields');
  }
  assertStringArray(negotiationProjection.evidenceRequiredStances, 'negotiationProjection.evidenceRequiredStances');
  if (JSON.stringify(negotiationProjection.evidenceRequiredStances) !== JSON.stringify(['objection'])) {
    throw new Error('negotiationProjection.evidenceRequiredStances must be objection');
  }
  assertString(negotiationProjection.noEvidenceObjectionDisposition, 'negotiationProjection.noEvidenceObjectionDisposition');
  if (negotiationProjection.noEvidenceObjectionDisposition !== 'concern') {
    throw new Error('negotiationProjection.noEvidenceObjectionDisposition must be concern');
  }
  assertString(negotiationProjection.consensusOwner, 'negotiationProjection.consensusOwner');
  if (negotiationProjection.consensusOwner !== 'station') {
    throw new Error('negotiationProjection.consensusOwner must be station');
  }
  if (negotiationProjection.appletMayResolveConsensus !== false) {
    throw new Error('negotiationProjection.appletMayResolveConsensus must be false');
  }
  const expectedForbiddenActions = [
    'agent.invoke',
    'atelier.agent',
    'orchestration.start',
    'negotiation.run',
    'provider.invoke',
    'runtime.invokeProvider',
    'runtime.execute',
    'gate.rerun',
    'taskGraph.diff.apply',
  ];
  assertStringArray(negotiationProjection.forbiddenActions, 'negotiationProjection.forbiddenActions');
  if (JSON.stringify(negotiationProjection.forbiddenActions) !== JSON.stringify(expectedForbiddenActions)) {
    throw new Error('negotiationProjection.forbiddenActions must match the canonical read-only forbidden surface');
  }
}

function validateStreamBlockRequiredFields(streamBlocks) {
  if (!isRecord(streamBlocks.requiredFieldsByKind)) {
    throw new Error('streamBlocks.requiredFieldsByKind must be an object');
  }
  for (const kind of streamBlocks.allowedKinds) {
    assertStringArray(streamBlocks.requiredFieldsByKind[kind], `streamBlocks.requiredFieldsByKind.${kind}`);
  }
}

function validateViewSurface(viewSurface) {
  if (!isRecord(viewSurface)) {
    throw new Error('viewSurface must be an object');
  }
  assertStringArray(viewSurface.statuses, 'viewSurface.statuses');
  const requiredStatuses = ['loading', 'empty', 'ready', 'reconciling', 'degraded', 'disconnected', 'auth-denied', 'error'];
  if (JSON.stringify(viewSurface.statuses) !== JSON.stringify(requiredStatuses)) {
    throw new Error('viewSurface.statuses must match the canonical projection surface status taxonomy');
  }
  assertStringArray(viewSurface.eventStreamStates, 'viewSurface.eventStreamStates');
  const requiredEventStreamStates = ['idle', 'subscribing', 'live', 'degraded'];
  if (JSON.stringify(viewSurface.eventStreamStates) !== JSON.stringify(requiredEventStreamStates)) {
    throw new Error('viewSurface.eventStreamStates must match the canonical projection event stream states');
  }
  assertStringArray(viewSurface.typedRecoveryKinds, 'viewSurface.typedRecoveryKinds');
  const requiredTypedRecoveryKinds = ['auth-denied', 'disconnected'];
  if (JSON.stringify(viewSurface.typedRecoveryKinds) !== JSON.stringify(requiredTypedRecoveryKinds)) {
    throw new Error('viewSurface.typedRecoveryKinds must be auth-denied, disconnected');
  }
  assertStringArray(viewSurface.statusNoticeKinds, 'viewSurface.statusNoticeKinds');
  const requiredStatusNoticeKinds = ['reconciling', 'degraded'];
  if (JSON.stringify(viewSurface.statusNoticeKinds) !== JSON.stringify(requiredStatusNoticeKinds)) {
    throw new Error('viewSurface.statusNoticeKinds must be reconciling, degraded');
  }
  for (const status of viewSurface.statusNoticeKinds) {
    if (!viewSurface.statuses.includes(status)) {
      throw new Error(`viewSurface.statusNoticeKinds.${status} must be a view status`);
    }
  }
  assertString(viewSurface.emptyCtaStatus, 'viewSurface.emptyCtaStatus');
  if (viewSurface.emptyCtaStatus !== 'empty') {
    throw new Error('viewSurface.emptyCtaStatus must be empty');
  }
  assertString(viewSurface.reconcilingEventStreamState, 'viewSurface.reconcilingEventStreamState');
  if (viewSurface.reconcilingEventStreamState !== 'subscribing') {
    throw new Error('viewSurface.reconcilingEventStreamState must be subscribing');
  }
  assertStringArray(viewSurface.degradedEventStreamStates, 'viewSurface.degradedEventStreamStates');
  if (JSON.stringify(viewSurface.degradedEventStreamStates) !== JSON.stringify(['degraded'])) {
    throw new Error('viewSurface.degradedEventStreamStates must be degraded');
  }
  if (!isRecord(viewSurface.recovery)) {
    throw new Error('viewSurface.recovery must be an object');
  }
  assertStringArray(viewSurface.recovery.tones, 'viewSurface.recovery.tones');
  const allowedTones = new Set(viewSurface.recovery.tones);
  const requiredTones = ['warning', 'danger'];
  if (JSON.stringify(viewSurface.recovery.tones) !== JSON.stringify(requiredTones)) {
    throw new Error('viewSurface.recovery.tones must be warning, danger');
  }
  assertStringArray(viewSurface.recovery.kinds, 'viewSurface.recovery.kinds');
  validateStringMap(viewSurface.recovery.toneByKind, allowedTones, 'viewSurface.recovery.toneByKind');
  if (JSON.stringify(Object.keys(viewSurface.recovery.toneByKind)) !== JSON.stringify(viewSurface.recovery.kinds)) {
    throw new Error('viewSurface.recovery.kinds must match toneByKind keys');
  }
  assertStringArray(viewSurface.recovery.retryableKinds, 'viewSurface.recovery.retryableKinds');
  for (const kind of viewSurface.recovery.retryableKinds) {
    if (!Object.hasOwn(viewSurface.recovery.toneByKind, kind)) {
      throw new Error(`viewSurface.recovery.retryableKinds.${kind} must have a toneByKind entry`);
    }
  }
  validateStatusMap(viewSurface.recovery.statusSeverityByStatus, viewSurface.statuses, 'viewSurface.recovery.statusSeverityByStatus');
  validateStatusMap(viewSurface.recovery.prototypeSeverityByStatus, viewSurface.statuses, 'viewSurface.recovery.prototypeSeverityByStatus');
  validateStatusMap(viewSurface.recovery.prototypeSymbolByStatus, viewSurface.statuses, 'viewSurface.recovery.prototypeSymbolByStatus');
}

function validateProjectSurface(projectSurface) {
  if (!isRecord(projectSurface)) {
    throw new Error('projectSurface must be an object');
  }
  for (const field of [
    'blockerSeverities',
    'blockerStates',
    'residualRiskStates',
    'dependencyEdgeTypes',
    'taskGraphParallelPolicies',
    'projectStates',
    'milestoneStates',
    'taskGraphNodeStates',
    'memoryCandidateTypes',
    'memoryCandidateScopes',
    'memoryCandidateFeeds',
    'policyRuleScopes',
    'defectSources',
    'defectStates',
  ]) {
    assertStringArray(projectSurface[field], `projectSurface.${field}`);
  }
  if (!isRecord(projectSurface.projectionDisplayLimits)) {
    throw new Error('projectSurface.projectionDisplayLimits must be an object');
  }
  for (const field of [
    'projectHealthItems',
    'projectHealthMilestones',
    'milestoneRefs',
    'taskGraphNodes',
    'taskGraphRootIds',
    'taskGraphEdges',
    'taskGraphNodeRefs',
    'legacyTodos',
    'providerCapabilities',
    'negotiationVoices',
    'diffPaths',
    'contextFileRefs',
    'contextOtherRefs',
    'sidePanelArtifacts',
    'artifactPaths',
    'safeTextPreviewLines',
    'gateItems',
    'gateChecks',
    'gateArtifactRefs',
  ]) {
    const value = projectSurface.projectionDisplayLimits[field];
    if (!Number.isInteger(value) || value <= 0) {
      throw new Error(`projectSurface.projectionDisplayLimits.${field} must be a positive integer`);
    }
  }
}

function validateWorkbenchSurface(workbenchSurface) {
  if (!isRecord(workbenchSurface)) {
    throw new Error('workbenchSurface must be an object');
  }
  for (const field of [
    'taskIntentPresets',
    'todoStatuses',
    'contextFileGroups',
    'artifactKinds',
    'artifactBodyKinds',
    'gateStatuses',
    'gateCheckStatuses',
  ]) {
    assertStringArray(workbenchSurface[field], `workbenchSurface.${field}`);
  }
  assertString(workbenchSurface.defaultTaskIntentPreset, 'workbenchSurface.defaultTaskIntentPreset');
  if (!workbenchSurface.taskIntentPresets.includes(workbenchSurface.defaultTaskIntentPreset)) {
    throw new Error('workbenchSurface.defaultTaskIntentPreset must be one of taskIntentPresets');
  }
  assertString(workbenchSurface.defaultContextFileGroup, 'workbenchSurface.defaultContextFileGroup');
  if (!workbenchSurface.contextFileGroups.includes(workbenchSurface.defaultContextFileGroup)) {
    throw new Error('workbenchSurface.defaultContextFileGroup must be one of contextFileGroups');
  }
  if (!Array.isArray(workbenchSurface.taskOrganizerModes)) {
    throw new Error('workbenchSurface.taskOrganizerModes must be an array');
  }
  const expectedOrganizerModes = ['folders', 'flat-list', 'kanban', 'dag'];
  const actualOrganizerModes = [];
  for (const [index, mode] of workbenchSurface.taskOrganizerModes.entries()) {
    if (!isRecord(mode)) {
      throw new Error(`workbenchSurface.taskOrganizerModes.${index} must be an object`);
    }
    assertString(mode.id, `workbenchSurface.taskOrganizerModes.${index}.id`);
    if (typeof mode.ready !== 'boolean') {
      throw new Error(`workbenchSurface.taskOrganizerModes.${index}.ready must be a boolean`);
    }
    actualOrganizerModes.push(mode.id);
  }
  if (JSON.stringify(actualOrganizerModes) !== JSON.stringify(expectedOrganizerModes)) {
    throw new Error('workbenchSurface.taskOrganizerModes must be folders, flat-list, kanban, dag');
  }
  const readyOrganizerModes = workbenchSurface.taskOrganizerModes.filter((mode) => mode.ready).map((mode) => mode.id);
  if (JSON.stringify(readyOrganizerModes) !== JSON.stringify(['folders', 'flat-list'])) {
    throw new Error('workbenchSurface.taskOrganizerModes ready modes must be folders, flat-list');
  }
  assertString(workbenchSurface.defaultTaskOrganizerMode, 'workbenchSurface.defaultTaskOrganizerMode');
  if (!actualOrganizerModes.includes(workbenchSurface.defaultTaskOrganizerMode)) {
    throw new Error('workbenchSurface.defaultTaskOrganizerMode must be one of taskOrganizerModes ids');
  }
}

function validateBudgetSurface(budgetSurface) {
  if (!isRecord(budgetSurface)) {
    throw new Error('budgetSurface must be an object');
  }
  assertStringArray(budgetSurface.budgetStatuses, 'budgetSurface.budgetStatuses');
  const requiredStatuses = ['ok', 'warning', 'danger', 'blocked'];
  if (JSON.stringify(budgetSurface.budgetStatuses) !== JSON.stringify(requiredStatuses)) {
    throw new Error('budgetSurface.budgetStatuses must be ok, warning, danger, blocked');
  }
}

function validateTaskLifecycle(taskLifecycle, methodPayloads) {
  if (!isRecord(taskLifecycle)) {
    throw new Error('taskLifecycle must be an object');
  }
  assertString(taskLifecycle.field, 'taskLifecycle.field');
  if (taskLifecycle.field !== 'status') {
    throw new Error('taskLifecycle.field must be status');
  }
  assertString(taskLifecycle.domain, 'taskLifecycle.domain');
  if (taskLifecycle.domain !== 'workbench_lifecycle') {
    throw new Error('taskLifecycle.domain must be workbench_lifecycle');
  }
  assertString(taskLifecycle.orthogonalTo, 'taskLifecycle.orthogonalTo');
  if (taskLifecycle.orthogonalTo !== 'execution_state') {
    throw new Error('taskLifecycle.orthogonalTo must be execution_state');
  }
  assertStringArray(taskLifecycle.states, 'taskLifecycle.states');
  const requiredStates = ['active', 'archived', 'deleted'];
  if (JSON.stringify(taskLifecycle.states) !== JSON.stringify(requiredStates)) {
    throw new Error('taskLifecycle.states must be active, archived, deleted');
  }
  if (!Array.isArray(taskLifecycle.transitions) || taskLifecycle.transitions.length === 0) {
    throw new Error('taskLifecycle.transitions must be a non-empty array');
  }
  for (const [index, transition] of taskLifecycle.transitions.entries()) {
    if (!isRecord(transition)) {
      throw new Error(`taskLifecycle.transitions.${index} must be an object`);
    }
    if (!taskLifecycle.states.includes(transition.from)) {
      throw new Error(`taskLifecycle.transitions.${index}.from must be a taskLifecycle state`);
    }
    if (!taskLifecycle.states.includes(transition.to)) {
      throw new Error(`taskLifecycle.transitions.${index}.to must be a taskLifecycle state`);
    }
    if (transition.reversible !== true) {
      throw new Error(`taskLifecycle.transitions.${index}.reversible must be true`);
    }
  }
  assertString(taskLifecycle.purgeRequiresStatus, 'taskLifecycle.purgeRequiresStatus');
  if (taskLifecycle.purgeRequiresStatus !== 'deleted') {
    throw new Error('taskLifecycle.purgeRequiresStatus must be deleted');
  }
  assertStringArray(taskLifecycle.forbiddenExecutionStatusValues, 'taskLifecycle.forbiddenExecutionStatusValues');

  const setStatusPayload = methodPayloads['atelier.task.setStatus'];
  if (!isRecord(setStatusPayload)) {
    throw new Error('methodPayloads.atelier.task.setStatus must be an object');
  }
  assertStringArray(setStatusPayload.allowedStatus, 'methodPayloads.atelier.task.setStatus.allowedStatus');
  if (JSON.stringify(setStatusPayload.allowedStatus) !== JSON.stringify(taskLifecycle.states)) {
    throw new Error('methodPayloads.atelier.task.setStatus.allowedStatus must match taskLifecycle.states');
  }

  const purgePayload = methodPayloads['atelier.task.purge'];
  if (!isRecord(purgePayload)) {
    throw new Error('methodPayloads.atelier.task.purge must be an object');
  }
  assertString(purgePayload.requiresStatus, 'methodPayloads.atelier.task.purge.requiresStatus');
  if (purgePayload.requiresStatus !== taskLifecycle.purgeRequiresStatus) {
    throw new Error('methodPayloads.atelier.task.purge.requiresStatus must match taskLifecycle.purgeRequiresStatus');
  }
}

function validateMethodIntents(methods, methodIntents) {
  if (!isRecord(methodIntents)) {
    throw new Error('methodIntents must be an object');
  }
  const allowedOwners = new Set(['station', 'desktop_host']);
  const allowedSideEffects = new Set(['none', 'host_ui', 'station_transaction']);
  for (const method of methods) {
    const intent = methodIntents[method];
    if (!isRecord(intent)) {
      throw new Error(`methodIntents.${method} must be an object`);
    }
    if (!allowedOwners.has(intent.intentOwner)) {
      throw new Error(`methodIntents.${method}.intentOwner must be station or desktop_host`);
    }
    assertString(intent.intentKind, `methodIntents.${method}.intentKind`);
    if (!allowedSideEffects.has(intent.sideEffectClass)) {
      throw new Error(`methodIntents.${method}.sideEffectClass must be none, host_ui, or station_transaction`);
    }
    if (intent.executionForbidden !== true) {
      throw new Error(`methodIntents.${method}.executionForbidden must be true`);
    }
  }
}

function assertString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} must be a non-empty string`);
  }
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || item.length === 0)) {
    throw new Error(`${label} must be a string array`);
  }
}

function validateStatusMap(value, statuses, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const status of statuses) {
    assertString(value[status], `${label}.${status}`);
  }
}

function validateStringMap(value, allowedValues, label) {
  if (!isRecord(value)) {
    throw new Error(`${label} must be an object`);
  }
  for (const [key, mapValue] of Object.entries(value)) {
    assertString(mapValue, `${label}.${key}`);
    if (!allowedValues.has(mapValue)) {
      throw new Error(`${label}.${key} must be one of ${Array.from(allowedValues).join(', ')}`);
    }
  }
}

function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
