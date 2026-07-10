import { sdk } from '@peers-touch/applet-sdk';
import type { AtelierProjectionEvent, AtelierProjectionSnapshot } from '../../domain/projection';
import { isAtelierProjectionSnapshot, parseAtelierProjectionEvent } from '../../domain/projection';
import {
  ATELIER_ARTIFACT_BODY_REF_SHAPE,
  ATELIER_ARTIFACT_BODY_KINDS,
  ATELIER_ARTIFACT_SANDBOX_REF_SHAPE,
  ATELIER_ARTIFACT_PREVIEW_OPEN_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES,
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_AGENT_FLOW_IDS,
  ATELIER_DEFAULT_RUN_TARGET_KIND,
  ATELIER_DEFAULT_TASK_INTENT_PRESET,
  ATELIER_MEMORY_CANDIDATE_FEEDS,
  ATELIER_PROJECTION_EVENT_TOPIC,
  ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
  ATELIER_PROVIDER_CAPABILITY_SCOPES,
  ATELIER_RUN_TARGET_KINDS,
  ATELIER_TASK_INTENT_PRESETS,
  ATELIER_WORKSPACE_OPEN_URI_SHAPE,
  ATELIER_WORKSPACE_OPEN_URI_SCHEMES,
  type AtelierAgentFlowId,
  type AtelierFeedbackSignal,
  type AtelierMemoryCandidateFeed,
  type AtelierRecoveryKind,
  type AtelierRunTargetKind,
  type AtelierTaskLifecycleStatus,
} from '../../domain/projection.contract.generated';
import { requestAtelierService } from './serviceClient';

export type AtelierErrorKind = AtelierRecoveryKind;
export type AtelierProviderCapabilityScope = (typeof ATELIER_PROVIDER_CAPABILITY_SCOPES)[number];
export type AtelierArtifactBodyKind = (typeof ATELIER_ARTIFACT_BODY_KINDS)[number];
export type AtelierArtifactPreviewOpenMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_MODES)[number];
export type AtelierArtifactPreviewOpenRendererOwner = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS)[number];
export type AtelierArtifactPreviewOpenRendererMode = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES)[number];
export type AtelierArtifactPreviewOpenRendererStatus = (typeof ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES)[number];
export type AtelierProviderCapabilityReadOnly = typeof ATELIER_PROVIDER_CAPABILITY_READ_ONLY;
const ATELIER_ARTIFACT_PREVIEW_OPEN_REQUIRED_RENDERER_CAPABILITIES =
  ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities;

export interface AtelierProviderCapability {
  id: string;
  label: string;
  description: string;
  slashCommand: string;
  providerKind: string;
  scope: AtelierProviderCapabilityScope;
  readOnly: AtelierProviderCapabilityReadOnly;
}

export type AtelierIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];
export type { AtelierAgentFlowId, AtelierFeedbackSignal, AtelierRunTargetKind } from '../../domain/projection.contract.generated';
export type AtelierCertificationCreateConfig = {
  goal: string;
  intentPreset?: AtelierIntentPreset;
  model?: string;
  runKind?: AtelierRunTargetKind;
    flowId?: AtelierAgentFlowId;
  project?: string;
};

export type AtelierCertificationDecisionConfig = {
  taskId?: string;
  blockId?: string;
  choice: string;
};

export type AtelierCertificationPreviewOpenConfig = {
  taskId?: string;
  artifactId?: string;
};

export interface AtelierProviderCapabilitiesResponse {
  capabilities: AtelierProviderCapability[];
  source: string;
}

export interface SubmitAtelierFeedbackResponse {
  accepted: boolean;
  feedbackId: string;
  memoryCandidate: {
    status: string;
    reason: string;
    requiresConfirmation: boolean;
    confirmationMode: string;
    feeds: AtelierMemoryCandidateFeed[];
  };
  rerunIntent: {
    status: string;
    reason: string;
    requiresConfirmation: boolean;
    confirmationMode: string;
    feeds: AtelierMemoryCandidateFeed[];
  };
}

export interface ConfirmAtelierMemoryCandidateResponse {
  accepted: boolean;
  feedbackId: string;
  memoryId: string;
  status: string;
  source: string;
  alreadyDone: boolean;
}

export interface ConfirmAtelierRerunResponse {
  accepted: boolean;
  feedbackId: string;
  taskId: string;
  rerunTaskId: string;
  status: string;
  source: string;
  alreadyDone: boolean;
  started: boolean;
}

export interface AtelierWorkspaceOpenResponse {
  accepted: boolean;
  opened: boolean;
  workspaceUri: string;
  mode: string;
  reason: string;
}

export interface AtelierArtifactBodyResponse {
  taskId: string;
  artifactId: string;
  bodyRef: string;
  bodyKind: AtelierArtifactBodyKind;
  bodyHash: string;
  bodySize: number;
  text: string;
  truncated: boolean;
  retentionStatus: string;
}

export interface AtelierArtifactPreviewOpenResponse {
  accepted: boolean;
  opened: boolean;
  prepared: boolean;
  taskId: string;
  artifactId: string;
  sandboxRef: string;
  bodyRef: string;
  kind: string;
  mode: AtelierArtifactPreviewOpenMode;
  rendererSessionId: string;
  rendererOwner: AtelierArtifactPreviewOpenRendererOwner;
  rendererMode: AtelierArtifactPreviewOpenRendererMode;
  rendererStatus: AtelierArtifactPreviewOpenRendererStatus;
  rendererCapabilities: string[];
  reason: string;
}

export async function loadAtelierWorkspace(): Promise<AtelierProjectionSnapshot> {
  const response = await requestAtelierService('/v1/workspace', 'GET');
  const snapshot = response.body;
  if (!isAtelierProjectionSnapshot(snapshot)) {
    throw new Error('atelier.error.invalidProjection');
  }
  return snapshot;
}

export async function loadAtelierProviderCapabilities(taskId?: string): Promise<AtelierProviderCapabilitiesResponse> {
  const response = await sdk.invoke<unknown>('atelier.provider.capabilities', taskId ? { taskId } : {});
  if (!isAtelierProviderCapabilitiesResponse(response)) {
    throw new Error('atelier.error.invalidProviderCapabilities');
  }
  return response;
}

export async function submitAtelierFeedback(input: {
  taskId: string;
  blockId: string;
  signal: AtelierFeedbackSignal;
  comment?: string;
}): Promise<SubmitAtelierFeedbackResponse> {
  const response = await sdk.invoke<unknown>('atelier.feedback.submit', input);
  if (!isSubmitAtelierFeedbackResponse(response)) {
    throw new Error('atelier.error.invalidFeedbackResponse');
  }
  return response;
}

export async function confirmAtelierMemoryCandidate(input: {
  taskId: string;
  feedbackId: string;
}): Promise<ConfirmAtelierMemoryCandidateResponse> {
  const response = await sdk.invoke<unknown>('atelier.memory.confirmCandidate', input);
  if (!isConfirmAtelierMemoryCandidateResponse(response, input)) {
    throw new Error('atelier.error.invalidMemoryConfirmationResponse');
  }
  return response;
}

export async function confirmAtelierFeedbackRerun(input: {
  taskId: string;
  feedbackId: string;
}): Promise<ConfirmAtelierRerunResponse> {
  const response = await sdk.invoke<unknown>('atelier.feedback.confirmRerun', input);
  if (!isConfirmAtelierRerunResponse(response, input)) {
    throw new Error('atelier.error.invalidRerunConfirmationResponse');
  }
  return response;
}

export async function openAtelierWorkspace(input: {
  taskId: string;
  workspaceUri: string;
  ideHint?: string;
}): Promise<AtelierWorkspaceOpenResponse> {
  const response = await sdk.invoke<unknown>('atelier.workspace.open', input);
  if (!isAtelierWorkspaceOpenResponse(response, input)) {
    throw new Error('atelier.error.invalidWorkspaceOpenResponse');
  }
  return response;
}

export async function fetchAtelierArtifactBody(input: {
  taskId: string;
  artifactId: string;
  bodyRef: string;
  expectedHash?: string;
  maxBytes?: number;
}): Promise<AtelierArtifactBodyResponse> {
  const response = await sdk.invoke<unknown>('atelier.artifact.body.fetch', input);
  if (!isAtelierArtifactBodyResponse(response, input)) {
    throw new Error('atelier.error.invalidArtifactBodyResponse');
  }
  return response;
}

export async function openAtelierArtifactPreview(input: {
  taskId: string;
  artifactId: string;
  sandboxRef: string;
  bodyRef: string;
  kind?: string;
  mode?: string;
}): Promise<AtelierArtifactPreviewOpenResponse> {
  const response = await sdk.invoke<unknown>('atelier.artifact.preview.open', input);
  if (!isAtelierArtifactPreviewOpenResponse(response, input)) {
    throw new Error('atelier.error.invalidArtifactPreviewOpenResponse');
  }
  return response;
}

export async function createAtelierProjectFromGoal(input: {
  goal: string;
  intentPreset?: AtelierIntentPreset;
  model?: string;
  runKind?: AtelierRunTargetKind;
    flowId?: AtelierAgentFlowId;
  project?: string;
}): Promise<AtelierProjectionSnapshot> {
  const config = await readAtelierLaunchConfig();
  const agentIds = config.agentIds;
  if (agentIds.length === 0) {
    throw new Error('atelier.error.agentIdsRequired');
  }
  const selectedModel = input.model?.trim() || config.model;
  const selectedFlowId = input.flowId ?? config.flowId;
  const runKind: AtelierRunTargetKind = input.runKind ?? ATELIER_DEFAULT_RUN_TARGET_KIND;
  const run: Record<string, unknown> = runKind === 'model'
    ? { kind: 'model', model: selectedModel }
    : { kind: 'agents', agentIds };
  if (runKind !== 'model' && selectedFlowId) {
    run.flowId = selectedFlowId;
  }

  const payload: Record<string, unknown> = {
    goal: input.goal,
    intentPreset: input.intentPreset ?? ATELIER_DEFAULT_TASK_INTENT_PRESET,
    agentIds,
    run,
  };
  const project = input.project ?? config.project;
  if (project) {
    payload.project = project;
  }

  const response = await requestAtelierService('/v1/projects', 'POST', payload);
  const snapshot = response.body;
  if (!isAtelierProjectionSnapshot(snapshot)) {
    throw new Error('atelier.error.invalidProjection');
  }
  return snapshot;
}

export async function readAtelierCertificationCreateConfig(): Promise<AtelierCertificationCreateConfig | null> {
  const source = launchConfigSource(readGlobalAtelierConfig()) ?? launchConfigSource(await readLaunchOptions());
  if (!source || source.certificationMode !== 'product-window-e2e') {
    return null;
  }
  const goal = typeof source.createGoal === 'string' ? source.createGoal.trim() : '';
  if (!goal) {
    return null;
  }
  const config: AtelierCertificationCreateConfig = { goal };
  if (isAtelierIntentPreset(source.intentPreset)) {
    config.intentPreset = source.intentPreset;
  }
  if (isAtelierRunTargetKind(source.runKind)) {
    config.runKind = source.runKind;
  }
  if (isAtelierAgentFlowId(source.flowId)) {
    config.flowId = source.flowId;
  }
  if (typeof source.model === 'string' && source.model.trim().length > 0) {
    config.model = source.model.trim();
  }
  if (typeof source.project === 'string' && source.project.trim().length > 0) {
    config.project = source.project.trim();
  }
  return config;
}

export async function readAtelierCertificationDecisionConfig(): Promise<AtelierCertificationDecisionConfig | null> {
  const source = launchConfigSource(readGlobalAtelierConfig()) ?? launchConfigSource(await readLaunchOptions());
  if (!source || source.certificationMode !== 'product-window-e2e') {
    return null;
  }
  const choice = typeof source.resolveDecisionChoice === 'string' ? source.resolveDecisionChoice.trim() : '';
  if (!choice) {
    return null;
  }
  const config: AtelierCertificationDecisionConfig = { choice };
  if (typeof source.resolveDecisionTaskId === 'string' && source.resolveDecisionTaskId.trim().length > 0) {
    config.taskId = source.resolveDecisionTaskId.trim();
  }
  if (typeof source.resolveDecisionBlockId === 'string' && source.resolveDecisionBlockId.trim().length > 0) {
    config.blockId = source.resolveDecisionBlockId.trim();
  }
  return config;
}

export async function readAtelierCertificationPreviewOpenConfig(): Promise<AtelierCertificationPreviewOpenConfig | null> {
  const source = launchConfigSource(readGlobalAtelierConfig()) ?? launchConfigSource(await readLaunchOptions());
  if (!source || source.certificationMode !== 'product-window-e2e' || source.openArtifactPreview !== true) {
    return null;
  }
  const config: AtelierCertificationPreviewOpenConfig = {};
  if (typeof source.openArtifactPreviewTaskId === 'string' && source.openArtifactPreviewTaskId.trim().length > 0) {
    config.taskId = source.openArtifactPreviewTaskId.trim();
  }
  if (typeof source.openArtifactPreviewArtifactId === 'string' && source.openArtifactPreviewArtifactId.trim().length > 0) {
    config.artifactId = source.openArtifactPreviewArtifactId.trim();
  }
  return config;
}

export async function trackAtelierCreatedProjectRendered(input: {
  taskId: string;
  goal: string;
  taskTitle: string;
  taskCount: number;
  nodeCount: number;
  eventSeq: number;
  runKind: AtelierRunTargetKind;
}): Promise<void> {
  await sdk.telemetry.track({
    name: 'atelier.project.created.rendered',
    properties: input,
  });
}

export async function trackAtelierDecisionResolvedRendered(input: {
  taskId: string;
  blockId: string;
  choice: string;
  taskTitle: string;
  eventSeq: number;
  streamCount: number;
  artifactCount?: number;
  artifactIds?: string[];
  gateCount?: number;
  gateIds?: string[];
  gateStatuses?: string[];
  failedGateCount?: number;
}): Promise<void> {
  await sdk.telemetry.track({
    name: 'atelier.decision.resolved.rendered',
    properties: input,
  });
}

export async function trackAtelierArtifactGateRendered(input: {
  taskId: string;
  taskTitle: string;
  eventSeq: number;
  artifactCount: number;
  artifactIds: string[];
  gateCount: number;
  gateIds: string[];
  gateStatuses: string[];
  failedGateCount: number;
}): Promise<void> {
  await sdk.telemetry.track({
    name: 'atelier.artifact_gate.rendered',
    properties: input,
  });
}

export async function trackAtelierArtifactPreviewOpened(input: {
  taskId: string;
  artifactId: string;
  rendererSessionId: string;
  rendererOwner: AtelierArtifactPreviewOpenRendererOwner;
  rendererMode: AtelierArtifactPreviewOpenRendererMode;
  rendererStatus: AtelierArtifactPreviewOpenRendererStatus;
  rendererCapabilities: string[];
  sandboxRef: string;
  bodyRef: string;
  accepted: boolean;
  prepared: boolean;
  opened: boolean;
}): Promise<void> {
  await sdk.telemetry.track({
    name: 'atelier.artifact.preview.opened',
    properties: input,
  });
}

export async function trackAtelierProjectionSubscriptionDiagnostic(input: {
  stage: string;
  selectedTaskId?: string;
  snapshotSelectedTaskId?: string;
  taskCount?: number;
  hasStreamConfig?: boolean;
  streamConfigKeys?: string[];
  agentId?: string;
  taskId?: string;
  afterEventSeq?: number;
  error?: string;
}): Promise<void> {
  await sdk.telemetry.track({
    name: 'atelier.projection.subscription.diagnostic',
    properties: input,
  });
}

function isAtelierProviderCapabilitiesResponse(value: unknown): value is AtelierProviderCapabilitiesResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as { capabilities?: unknown; source?: unknown };
  return (
    isNonEmptyString(record.source) &&
    Array.isArray(record.capabilities) &&
    record.capabilities.every(isAtelierProviderCapability)
  );
}

function isAtelierProviderCapability(value: unknown): value is AtelierProviderCapability {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.id) &&
    isNonEmptyString(record.label) &&
    isNonEmptyString(record.description) &&
    isNonEmptyString(record.slashCommand) &&
    record.slashCommand.startsWith('/') &&
    isNonEmptyString(record.providerKind) &&
      isAtelierProviderCapabilityScope(record.scope) &&
      record.readOnly === ATELIER_PROVIDER_CAPABILITY_READ_ONLY
  );
}

function isAtelierProviderCapabilityScope(value: unknown): value is string {
  const scopes = ATELIER_PROVIDER_CAPABILITY_SCOPES as readonly string[];
  return typeof value === 'string' && scopes.includes(value);
}

function isSubmitAtelierFeedbackResponse(value: unknown): value is SubmitAtelierFeedbackResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.accepted === true &&
    isNonEmptyString(record.feedbackId) &&
    isFeedbackPolicyHint(record.memoryCandidate) &&
    isFeedbackPolicyHint(record.rerunIntent)
  );
}

function isConfirmAtelierMemoryCandidateResponse(
  value: unknown,
  input: { feedbackId: string },
): value is ConfirmAtelierMemoryCandidateResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.accepted === true &&
    isNonEmptyString(record.feedbackId) &&
    record.feedbackId === input.feedbackId &&
    isNonEmptyString(record.memoryId) &&
    isNonEmptyString(record.status) &&
    isNonEmptyString(record.source) &&
    typeof record.alreadyDone === 'boolean'
  );
}

function isConfirmAtelierRerunResponse(
  value: unknown,
  input: { taskId: string; feedbackId: string },
): value is ConfirmAtelierRerunResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.accepted === true &&
    isNonEmptyString(record.feedbackId) &&
    record.feedbackId === input.feedbackId &&
    isNonEmptyString(record.taskId) &&
    record.taskId === input.taskId &&
    isNonEmptyString(record.rerunTaskId) &&
    isNonEmptyString(record.status) &&
    isNonEmptyString(record.source) &&
    typeof record.alreadyDone === 'boolean' &&
    typeof record.started === 'boolean'
  );
}

function isAtelierWorkspaceOpenResponse(
  value: unknown,
  input: { workspaceUri: string },
): value is AtelierWorkspaceOpenResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.accepted === true &&
    typeof record.opened === 'boolean' &&
    isAtelierWorkspaceUri(record.workspaceUri) &&
    record.workspaceUri === input.workspaceUri &&
    isNonEmptyString(record.mode) &&
    isNonEmptyString(record.reason)
  );
}

function isAtelierWorkspaceUri(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const uri = new URL(value);
    const shape = ATELIER_WORKSPACE_OPEN_URI_SHAPE;
    const taskPath = uri.pathname.split('/').filter(Boolean);
    const workspaceParams = uri.searchParams.getAll(shape.workspaceQueryKey);
    return (
      isAtelierWorkspaceOpenUriScheme(uri.protocol.slice(0, -1)) &&
      uri.hostname === shape.host &&
      taskPath.length === shape.taskPathSegments &&
      taskPath[0].length > 0 &&
      workspaceParams.length === 1 &&
      workspaceParams[0].length > 0
    );
  } catch {
    return false;
  }
}

function isAtelierArtifactBodyRef(value: unknown): value is string {
  return isAtelierArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE);
}

function isAtelierArtifactSandboxRef(value: unknown): value is string {
  return isAtelierArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE);
}

function isAtelierArtifactRef(
  value: unknown,
  shape: { scheme: string; pathSegments: number; terminalSegment: string },
): value is string {
  if (typeof value !== 'string') return false;
  if (/\s/.test(value)) return false;
  try {
    const uri = new URL(value);
    const path = uri.pathname.split('/').filter(Boolean);
    return (
      uri.protocol.slice(0, -1) === shape.scheme &&
      isNonEmptyString(uri.hostname) &&
      path.length === shape.pathSegments &&
      path[path.length - 1] === shape.terminalSegment &&
      path.slice(0, -1).every(isNonEmptyString)
    );
  } catch {
    return false;
  }
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isAtelierArtifactBodyResponse(
  value: unknown,
  request?: {
    taskId: string;
    artifactId: string;
    bodyRef: string;
    expectedHash?: string;
  },
): value is AtelierArtifactBodyResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.taskId) &&
    (request === undefined || record.taskId === request.taskId) &&
    isNonEmptyString(record.artifactId) &&
    (request === undefined || record.artifactId === request.artifactId) &&
    isAtelierArtifactBodyRef(record.bodyRef) &&
    (request === undefined || record.bodyRef === request.bodyRef) &&
    isAtelierArtifactBodyKind(record.bodyKind) &&
    isNonEmptyString(record.bodyHash) &&
    (request?.expectedHash === undefined || record.bodyHash === request.expectedHash) &&
    isNonNegativeFiniteNumber(record.bodySize) &&
    typeof record.text === 'string' &&
    typeof record.truncated === 'boolean' &&
    isNonEmptyString(record.retentionStatus)
  );
}

function isAtelierArtifactBodyKind(value: unknown): value is string {
  const bodyKinds = ATELIER_ARTIFACT_BODY_KINDS as readonly string[];
  return typeof value === 'string' && bodyKinds.includes(value);
}

function isAtelierArtifactPreviewOpenResponse(
  value: unknown,
  request?: {
    taskId: string;
    artifactId: string;
    sandboxRef: string;
    bodyRef: string;
  },
): value is AtelierArtifactPreviewOpenResponse {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    record.accepted === true &&
    typeof record.opened === 'boolean' &&
    isNonEmptyString(record.taskId) &&
    (request === undefined || record.taskId === request.taskId) &&
    isNonEmptyString(record.artifactId) &&
    (request === undefined || record.artifactId === request.artifactId) &&
    isAtelierArtifactSandboxRef(record.sandboxRef) &&
    (request === undefined || record.sandboxRef === request.sandboxRef) &&
    isAtelierArtifactBodyRef(record.bodyRef) &&
    (request === undefined || record.bodyRef === request.bodyRef) &&
    isNonEmptyString(record.kind) &&
      isAtelierArtifactPreviewOpenMode(record.mode) &&
    record.prepared === true &&
    isNonEmptyString(record.rendererSessionId) &&
    record.rendererSessionId.startsWith('atelier-preview:') &&
      isAtelierArtifactPreviewOpenRendererOwner(record.rendererOwner) &&
      isAtelierArtifactPreviewOpenRendererMode(record.rendererMode) &&
      isAtelierArtifactPreviewOpenRendererStatus(record.rendererStatus) &&
    Array.isArray(record.rendererCapabilities) &&
    record.rendererCapabilities.every(isNonEmptyString) &&
    hasRequiredAtelierArtifactPreviewRendererCapabilities(record.rendererCapabilities) &&
    isNonEmptyString(record.reason)
  );
}

function isAtelierArtifactPreviewOpenMode(value: unknown): value is string {
  const modes = ATELIER_ARTIFACT_PREVIEW_OPEN_MODES as readonly string[];
  return typeof value === 'string' && modes.includes(value);
}

function isAtelierArtifactPreviewOpenRendererOwner(value: unknown): value is string {
  const owners = ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS as readonly string[];
  return typeof value === 'string' && owners.includes(value);
}

function isAtelierArtifactPreviewOpenRendererMode(value: unknown): value is string {
  const modes = ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES as readonly string[];
  return typeof value === 'string' && modes.includes(value);
}

function isAtelierArtifactPreviewOpenRendererStatus(value: unknown): value is string {
  const statuses = ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES as readonly string[];
  return typeof value === 'string' && statuses.includes(value);
}

function hasRequiredAtelierArtifactPreviewRendererCapabilities(value: string[]): boolean {
  return ATELIER_ARTIFACT_PREVIEW_OPEN_REQUIRED_RENDERER_CAPABILITIES.every((capability) => value.includes(capability));
}

function isFeedbackPolicyHint(value: unknown): value is SubmitAtelierFeedbackResponse['memoryCandidate'] {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    isNonEmptyString(record.status) &&
    isNonEmptyString(record.reason) &&
    typeof record.requiresConfirmation === 'boolean' &&
    isNonEmptyString(record.confirmationMode) &&
    Array.isArray(record.feeds) &&
    record.feeds.every(isAtelierMemoryCandidateFeed)
  );
}

function isAtelierMemoryCandidateFeed(value: unknown): value is AtelierMemoryCandidateFeed {
  const feeds = ATELIER_MEMORY_CANDIDATE_FEEDS as readonly string[];
  return typeof value === 'string' && feeds.includes(value);
}


function isAtelierWorkspaceOpenUriScheme(value: unknown): value is string {
  const schemes = ATELIER_WORKSPACE_OPEN_URI_SCHEMES as readonly string[];
  return typeof value === 'string' && schemes.includes(value);
}
export async function sendAtelierMessage(input: {
  taskId: string;
  text: string;
}): Promise<AtelierProjectionSnapshot> {
  const response = await requestAtelierService('/v1/messages', 'POST', input);
  const snapshot = response.body;
  if (!isAtelierProjectionSnapshot(snapshot)) {
    throw new Error('atelier.error.invalidProjection');
  }
  return snapshot;
}

export async function resolveAtelierDecision(input: {
  taskId: string;
  blockId: string;
  choice: string;
}): Promise<AtelierProjectionSnapshot> {
  const response = await requestAtelierService('/v1/escalations:resolve', 'POST', input);
  const snapshot = response.body;
  if (!isAtelierProjectionSnapshot(snapshot)) {
    throw new Error('atelier.error.invalidProjection');
  }
  return snapshot;
}

export async function setAtelierTaskStatus(input: {
  taskId: string;
  status: AtelierTaskLifecycleStatus;
}): Promise<AtelierProjectionSnapshot> {
  const response = await requestAtelierService(`/v1/tasks/${encodeURIComponent(input.taskId)}/status`, 'PATCH', { status: input.status });
  const snapshot = response.body;
  if (!isAtelierProjectionSnapshot(snapshot)) {
    throw new Error('atelier.error.invalidProjection');
  }
  return snapshot;
}

export async function purgeAtelierTask(input: { taskId: string }): Promise<AtelierProjectionSnapshot> {
  const response = await requestAtelierService(`/v1/tasks/${encodeURIComponent(input.taskId)}`, 'DELETE');
  const snapshot = response.body;
  if (!isAtelierProjectionSnapshot(snapshot)) {
    throw new Error('atelier.error.invalidProjection');
  }
  return snapshot;
}

export async function subscribeAtelierProjectionEvents(
  snapshot: AtelierProjectionSnapshot | null,
  selectedTaskId: string,
  handler: (event: AtelierProjectionEvent) => void,
  onMalformedEvent?: (payload: unknown) => void,
): Promise<() => void> {
  const streamConfig = await readProjectionStreamConfig(snapshot, selectedTaskId);
  void trackAtelierProjectionSubscriptionDiagnostic({
    stage: 'client.stream-config',
    selectedTaskId,
    snapshotSelectedTaskId: snapshot?.selectedTaskId,
    taskCount: snapshot?.workspace.tasks.length ?? 0,
    hasStreamConfig: Boolean(streamConfig),
    streamConfigKeys: streamConfig ? Object.keys(streamConfig).sort() : [],
    agentId: typeof streamConfig?.agentId === 'string' ? streamConfig.agentId : undefined,
    taskId: typeof streamConfig?.taskId === 'string' ? streamConfig.taskId : undefined,
    afterEventSeq: typeof streamConfig?.afterEventSeq === 'number' ? streamConfig.afterEventSeq : undefined,
    }).catch(() => undefined);
    const unsubscribeLocal = sdk.events.on(ATELIER_PROJECTION_EVENT_TOPIC, (payload) => {
      const event = parseAtelierProjectionEvent(payload);
      if (event) {
        handler(event);
        return;
      }
      onMalformedEvent?.(payload);
    });

  try {
      await sdk.events.subscribe(ATELIER_PROJECTION_EVENT_TOPIC);
    if (streamConfig) {
      void trackAtelierProjectionSubscriptionDiagnostic({
        stage: 'client.invoke-stream-subscribe',
        selectedTaskId,
        snapshotSelectedTaskId: snapshot?.selectedTaskId,
        taskCount: snapshot?.workspace.tasks.length ?? 0,
        hasStreamConfig: true,
        streamConfigKeys: Object.keys(streamConfig).sort(),
        agentId: typeof streamConfig.agentId === 'string' ? streamConfig.agentId : undefined,
        taskId: typeof streamConfig.taskId === 'string' ? streamConfig.taskId : undefined,
        afterEventSeq: typeof streamConfig.afterEventSeq === 'number' ? streamConfig.afterEventSeq : undefined,
      }).catch(() => undefined);
      await sdk.invoke(ATELIER_PROJECTION_SUBSCRIPTION_METHOD, streamConfig);
    }
  } catch (error) {
    void trackAtelierProjectionSubscriptionDiagnostic({
      stage: 'client.subscribe-rejected',
      selectedTaskId,
      snapshotSelectedTaskId: snapshot?.selectedTaskId,
      taskCount: snapshot?.workspace.tasks.length ?? 0,
      hasStreamConfig: Boolean(streamConfig),
      streamConfigKeys: streamConfig ? Object.keys(streamConfig).sort() : [],
      agentId: typeof streamConfig?.agentId === 'string' ? streamConfig.agentId : undefined,
      taskId: typeof streamConfig?.taskId === 'string' ? streamConfig.taskId : undefined,
      afterEventSeq: typeof streamConfig?.afterEventSeq === 'number' ? streamConfig.afterEventSeq : undefined,
      error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
      unsubscribeLocal();
    safeUnsubscribeAtelierProjectionEventTopic();
    throw error;
  }

  return () => {
    unsubscribeLocal();
    safeUnsubscribeAtelierProjectionEventTopic();
  };
}

function safeUnsubscribeAtelierProjectionEventTopic(): void {
  void sdk.events.unsubscribe(ATELIER_PROJECTION_EVENT_TOPIC).catch((error: unknown) => {
    console.warn('Atelier official projection event topic unsubscribe rejected', error);
  });
}

export function normalizeAtelierError(error: unknown): string {
  if (error instanceof Error) {
    if (error.message.startsWith('atelier.error.')) {
      return error.message;
    }
    const normalizedMessage = error.message.toLowerCase();
    if (
      normalizedMessage.includes('permission_denied') ||
      normalizedMessage.includes('unauthorized') ||
      normalizedMessage.includes('forbidden')
    ) {
      return 'atelier.error.authDenied';
    }
    if (
      normalizedMessage.includes('network') ||
      normalizedMessage.includes('disconnected') ||
      normalizedMessage.includes('timeout')
    ) {
      return 'atelier.error.disconnected';
    }
  }
  return 'atelier.error.loadFailed';
}

export function classifyAtelierError(error: unknown): { key: string; kind: AtelierErrorKind } {
  const key = normalizeAtelierError(error);
  switch (key) {
    case 'atelier.error.authDenied':
      return { key, kind: 'auth-denied' };
    case 'atelier.error.disconnected':
      return { key, kind: 'disconnected' };
    case 'atelier.error.invalidProjection':
      return { key, kind: 'invalid-projection' };
    case 'atelier.error.agentIdsRequired':
      return { key, kind: 'agent-ids-required' };
    default:
      return { key, kind: 'error' };
  }
}

async function readProjectionStreamConfig(
  snapshot: AtelierProjectionSnapshot | null,
  selectedTaskId: string,
): Promise<Record<string, unknown> | null> {
  const fromGlobal = projectionConfigFromUnknown(readGlobalAtelierConfig(), snapshot, selectedTaskId);
  if (fromGlobal) return fromGlobal;

  return projectionConfigFromUnknown(await readLaunchOptions(), snapshot, selectedTaskId);
}

async function readAtelierLaunchConfig(): Promise<{
  agentIds: string[];
  flowId?: AtelierAgentFlowId;
  model?: string;
  project?: string;
}> {
  const source = launchConfigSource(readGlobalAtelierConfig()) ?? launchConfigSource(await readLaunchOptions());
  const agentIds = source ? agentIdsFromSource(source) : [];
  const config: {
    agentIds: string[];
    flowId?: AtelierAgentFlowId;
    model?: string;
    project?: string;
  } = { agentIds };
  if (source && isAtelierAgentFlowId(source.flowId)) {
    config.flowId = source.flowId;
  }
  if (source && typeof source.model === 'string' && source.model.length > 0) {
    config.model = source.model;
  }
  if (source && typeof source.project === 'string' && source.project.length > 0) {
    config.project = source.project;
  }
  return config;
}

function isAtelierAgentFlowId(value: unknown): value is AtelierAgentFlowId {
  const flowIds = ATELIER_AGENT_FLOW_IDS as readonly string[];
  return typeof value === 'string' && flowIds.includes(value);
}

function isAtelierRunTargetKind(value: unknown): value is AtelierRunTargetKind {
  const runKinds = ATELIER_RUN_TARGET_KINDS as readonly string[];
  return typeof value === 'string' && runKinds.includes(value);
}

function isAtelierIntentPreset(value: unknown): value is AtelierIntentPreset {
  const presets = ATELIER_TASK_INTENT_PRESETS as readonly string[];
  return typeof value === 'string' && presets.includes(value);
}

async function readLaunchOptions(): Promise<unknown> {
  try {
    return await sdk.app.getLaunchOptions();
  } catch {
    return null;
  }
}

function readGlobalAtelierConfig(): unknown {
  return (globalThis as { __ATELIER_PROJECTION_STREAM__?: unknown }).__ATELIER_PROJECTION_STREAM__;
}

type ProjectionAgentIdSource = (typeof ATELIER_PROJECTION_CONTRACT.eventSubscription.agentIdSourcePriority)[number];
type ProjectionTaskIdSource = (typeof ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority)[number];

type ProjectionTaskIdResolverInput = {
  source: Record<string, unknown>;
  snapshot: AtelierProjectionSnapshot | null;
  selectedTaskId: string;
};

const projectionAgentIdResolvers = {
  agentId: (source: Record<string, unknown>) =>
    typeof source.agentId === 'string' && source.agentId.length > 0 ? source.agentId : '',
  'agentIds[0]': (source: Record<string, unknown>) => agentIdsFromSource(source)[0] ?? '',
} satisfies Record<ProjectionAgentIdSource, (source: Record<string, unknown>) => string>;

const projectionTaskIdResolvers = {
  certificationCreatedSelectedTaskId: ({ source, snapshot }: ProjectionTaskIdResolverInput) =>
    source.certificationMode === 'product-window-e2e' &&
    typeof source.createGoal === 'string' &&
    source.createGoal.trim().length > 0 &&
    snapshot?.selectedTaskId
      ? snapshot.selectedTaskId
      : '',
  explicitTaskId: ({ source }: ProjectionTaskIdResolverInput) =>
    typeof source.taskId === 'string' && source.taskId.length > 0 ? source.taskId : '',
  controllerSelectedTaskId: ({ selectedTaskId }: ProjectionTaskIdResolverInput) => selectedTaskId,
  snapshotSelectedTaskId: ({ snapshot }: ProjectionTaskIdResolverInput) => snapshot?.selectedTaskId ?? '',
  snapshotFirstTaskId: ({ snapshot }: ProjectionTaskIdResolverInput) => snapshot?.workspace.tasks[0]?.id ?? '',
} satisfies Record<ProjectionTaskIdSource, (input: ProjectionTaskIdResolverInput) => string>;

function projectionConfigFromUnknown(
  value: unknown,
  snapshot: AtelierProjectionSnapshot | null,
  selectedTaskId: string,
): Record<string, unknown> | null {
  const source = launchConfigSource(value);
  if (!source) return null;
  const agentId = projectionAgentIdFromSource(source);
  if (!agentId) return null;

  const config: Record<string, unknown> = { agentId };
  const taskId = projectionTaskIdFromSource(source, snapshot, selectedTaskId);
  if (taskId) {
    config.taskId = taskId;
  }
  if (typeof source.afterEventSeq === 'number' && Number.isFinite(source.afterEventSeq)) {
    config.afterEventSeq = source.afterEventSeq;
  } else {
    const afterEventSeq = projectionAfterEventSeqFromSnapshot(snapshot, taskId);
    if (afterEventSeq > 0) {
      config.afterEventSeq = afterEventSeq;
    }
  }
  return config;
}

function projectionAgentIdFromSource(source: Record<string, unknown>): string {
    for (const sourceKey of ATELIER_PROJECTION_CONTRACT.eventSubscription.agentIdSourcePriority) {
      const agentId = projectionAgentIdResolvers[sourceKey](source);
      if (agentId) return agentId;
  }
    return '';
}

function projectionTaskIdFromSource(
  source: Record<string, unknown>,
  snapshot: AtelierProjectionSnapshot | null,
  selectedTaskId: string,
): string {
    const input = { source, snapshot, selectedTaskId };
    for (const sourceKey of ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority) {
      const taskId = projectionTaskIdResolvers[sourceKey](input);
      if (taskId) return taskId;
  }
    return '';
}

function projectionAfterEventSeqFromSnapshot(snapshot: AtelierProjectionSnapshot | null, taskId: string): number {
  if (!snapshot || !taskId) {
    return 0;
  }
  const nextEventSeq = snapshot.workspace.replay?.[taskId]?.nextEventSeq;
  return typeof nextEventSeq === 'number' && Number.isFinite(nextEventSeq) && nextEventSeq > 0 ? nextEventSeq : 0;
}

function launchConfigSource(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  return isRecord(value.query) ? value.query : value;
}

function agentIdsFromSource(source: Record<string, unknown>): string[] {
  if (Array.isArray(source.agentIds)) {
    return source.agentIds.filter((item): item is string => typeof item === 'string' && item.length > 0);
  }
  if (typeof source.agentId === 'string' && source.agentId.length > 0) {
    return [source.agentId];
  }
  return [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
