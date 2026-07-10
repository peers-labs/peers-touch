import type {
  AtelierProjectionSnapshot,
  AtelierRuntimeCall,
  AtelierRuntimeMethod,
  AtelierRuntimeResponseByMethod,
} from './projection';
import {
  assertAtelierProjectionSnapshot,
} from './projection';
import type { AtelierRuntimeBridge } from './bridgeRuntime';
import {
  ATELIER_ARTIFACT_BODY_REF_SHAPE,
  ATELIER_ARTIFACT_BODY_KINDS,
  ATELIER_ARTIFACT_SANDBOX_REF_SHAPE,
  ATELIER_ARTIFACT_PREVIEW_OPEN_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS,
  ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES,
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_MEMORY_CANDIDATE_FEEDS,
  ATELIER_PROJECTION_EVENT_TOPIC,
  ATELIER_PROJECTION_SUBSCRIPTION_METHOD,
  ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
  ATELIER_PROVIDER_CAPABILITY_SCOPES,
  ATELIER_WORKSPACE_OPEN_URI_SHAPE,
  ATELIER_WORKSPACE_OPEN_URI_SCHEMES,
} from './projection.contract.generated';

export interface AtelierAppletBridgeHost {
  invoke<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
  onEvent?(topic: string, handler: (payload: unknown) => void): () => void;
}

export interface CreateAppletSdkAtelierBridgeOptions {
  projectionEventTopic?: string;
  projectionStream?: {
    agentId: string;
    taskId?: string;
    afterEventSeq?: number;
  };
  initialSnapshot?: AtelierProjectionSnapshot;
}

const DEFAULT_PROJECTION_EVENT_TOPIC = ATELIER_PROJECTION_EVENT_TOPIC;
type ProjectionTaskIdSource = (typeof ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority)[number];

type ProjectionTaskIdResolverInput = {
  explicitTaskId?: string;
  initialSnapshot?: AtelierProjectionSnapshot;
};

const projectionTaskIdResolvers = {
  certificationCreatedSelectedTaskId: () => undefined,
  explicitTaskId: ({ explicitTaskId }: ProjectionTaskIdResolverInput) => explicitTaskId,
  controllerSelectedTaskId: () => undefined,
  snapshotSelectedTaskId: ({ initialSnapshot }: ProjectionTaskIdResolverInput) => initialSnapshot?.selectedTaskId,
  snapshotFirstTaskId: ({ initialSnapshot }: ProjectionTaskIdResolverInput) => initialSnapshot?.workspace.tasks[0]?.id,
} satisfies Record<ProjectionTaskIdSource, (input: ProjectionTaskIdResolverInput) => string | undefined>;

/**
 * Adapts the applet-sdk host shape to Atelier's projection runtime bridge.
 * The applet stays ignorant of Tauri/Station transport details.
 */
export function createAppletSdkAtelierBridge(
  host: AtelierAppletBridgeHost,
  options: CreateAppletSdkAtelierBridgeOptions = {},
): AtelierRuntimeBridge {
  const projectionEventTopic = options.projectionEventTopic ?? DEFAULT_PROJECTION_EVENT_TOPIC;

  return {
    async call<M extends AtelierRuntimeMethod>(
      request: AtelierRuntimeCall<M>,
    ): Promise<AtelierRuntimeResponseByMethod[M]> {
      const response = await host.invoke<AtelierRuntimeResponseByMethod[M]>(
        request.method,
        request.payload as Record<string, unknown>,
      ).catch((error: unknown) => {
        throw normalizeAtelierBridgeHostError(request.method, error);
      });
      throwIfAtelierBridgeErrorEnvelope(request.method, response);
      const nonSnapshotResponse = assertNonSnapshotRuntimeResponse(request.method, response, request.payload);
      if (nonSnapshotResponse !== undefined) return nonSnapshotResponse as AtelierRuntimeResponseByMethod[M];
      try {
        return assertAtelierProjectionSnapshot(response) as AtelierRuntimeResponseByMethod[M];
      } catch (error) {
        throw new Error(`Atelier bridge method ${request.method} did not return a valid projection snapshot`, {
          cause: error,
        });
      }
    },
    subscribeProjection(listener) {
      if (!host.onEvent) return () => {};
      let closed = false;
      let unsubscribeEvent: (() => void) | undefined;
      const closeAfterRejectedSubscribe = (method: 'events.subscribe' | typeof ATELIER_PROJECTION_SUBSCRIPTION_METHOD, error: unknown) => {
        if (closed) return;
        closed = true;
        unsubscribeEvent?.();
        listener({
          kind: 'atelier.projection.subscription-rejected',
          method,
          reason: error instanceof Error ? error.message : String(error),
          });
        };
        unsubscribeEvent = host.onEvent(projectionEventTopic, (payload) => {
          if (!closed) listener(payload);
        });
      invokeProjectionSubscription(host, 'events.subscribe', { topic: projectionEventTopic }).catch((error: unknown) => {
        closeAfterRejectedSubscribe('events.subscribe', error);
      });
      if (options.projectionStream) {
          const taskId = projectionTaskIdFromSubscription({
            explicitTaskId: options.projectionStream.taskId,
            initialSnapshot: options.initialSnapshot,
          });
        const afterEventSeq = options.projectionStream.afterEventSeq ?? projectionAfterEventSeqFromSnapshot(options.initialSnapshot, taskId);
        invokeProjectionSubscription(host, ATELIER_PROJECTION_SUBSCRIPTION_METHOD, compactProjectionStreamPayload({
          agentId: options.projectionStream.agentId,
          taskId,
          afterEventSeq,
        })).catch((error: unknown) => {
          closeAfterRejectedSubscribe(ATELIER_PROJECTION_SUBSCRIPTION_METHOD, error);
        });
      }
      return () => {
        closed = true;
        unsubscribeEvent?.();
        void invokeProjectionSubscription(host, 'events.unsubscribe', { topic: projectionEventTopic }).catch(() => undefined);
      };
    },
  };
}

function throwIfAtelierBridgeErrorEnvelope(method: AtelierRuntimeMethod, response: unknown): void {
  const envelope = atelierBridgeHostErrorEnvelope(response);
  if (!envelope) return;
  throw new Error(`Atelier bridge method ${method} failed: ${envelope.code} ${envelope.message}`, {
    cause: response,
  });
}

function normalizeAtelierBridgeHostError(method: AtelierRuntimeMethod, error: unknown): Error {
  const envelope = atelierBridgeHostErrorEnvelope(error) ?? (error instanceof Error ? atelierBridgeHostErrorEnvelope(error) : undefined);
  if (envelope) {
    return new Error(`Atelier bridge method ${method} failed: ${envelope.code} ${envelope.message}`, {
      cause: error,
    });
  }
  if (error instanceof Error) return error;
  return new Error(`Atelier bridge method ${method} failed: ${String(error)}`, {
    cause: error,
  });
}

function atelierBridgeHostErrorEnvelope(value: unknown): { code: string; message: string } | undefined {
  const record = isRecord(value) ? value : undefined;
  const envelope = isRecord(record?.error) ? record.error : record;
  const code = envelope && isNonEmptyString(envelope.code) ? envelope.code.trim() : undefined;
  const message = envelope && isNonEmptyString(envelope.message) ? envelope.message.trim() : undefined;
  if (!code && !message) return undefined;
  return {
    code: code ?? 'CAPABILITY_FAILED',
    message: message ?? code ?? 'Host bridge request failed',
  };
}

function assertNonSnapshotRuntimeResponse(
  method: AtelierRuntimeMethod,
  response: unknown,
  payload: unknown,
): AtelierRuntimeResponseByMethod[AtelierRuntimeMethod] | undefined {
  switch (method) {
    case 'atelier.provider.capabilities':
      return assertResponse(method, response, isProviderCapabilitiesResponse);
    case 'atelier.feedback.submit':
      return assertResponse(method, response, isFeedbackSubmitResponse);
    case 'atelier.memory.confirmCandidate':
      return assertResponse(method, response, (value) => isMemoryConfirmationResponse(value, payload));
    case 'atelier.feedback.confirmRerun':
      return assertResponse(method, response, (value) => isRerunConfirmationResponse(value, payload));
    case 'atelier.workspace.open':
      return assertResponse(method, response, (value) => isWorkspaceOpenResponse(value, payload));
    case 'atelier.artifact.body.fetch':
      return assertResponse(method, response, (value) => isArtifactBodyFetchResponse(value, payload));
    case 'atelier.artifact.preview.open':
      return assertResponse(method, response, (value) => isArtifactPreviewOpenResponse(value, payload));
    default:
      return undefined;
  }
}

function assertResponse(
  method: AtelierRuntimeMethod,
  response: unknown,
  guard: (response: unknown) => boolean,
): AtelierRuntimeResponseByMethod[AtelierRuntimeMethod] {
  if (guard(response)) return response as AtelierRuntimeResponseByMethod[AtelierRuntimeMethod];
  throw new Error(`Atelier bridge method ${method} did not return a valid typed response`);
}

function isProviderCapabilitiesResponse(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.source) &&
    Array.isArray(value.capabilities) &&
    value.capabilities.every(isProviderCapability)
  );
}

function isProviderCapability(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.id) &&
    isNonEmptyString(value.label) &&
    isNonEmptyString(value.description) &&
    isNonEmptyString(value.slashCommand) &&
    value.slashCommand.startsWith('/') &&
    isNonEmptyString(value.providerKind) &&
      isProviderCapabilityScope(value.scope) &&
      value.readOnly === ATELIER_PROVIDER_CAPABILITY_READ_ONLY
  );
}

function isProviderCapabilityScope(value: unknown): boolean {
  const scopes = ATELIER_PROVIDER_CAPABILITY_SCOPES as readonly string[];
  return typeof value === 'string' && scopes.includes(value);
}

function isFeedbackSubmitResponse(value: unknown): boolean {
  return (
    isRecord(value) &&
    value.accepted === true &&
    isNonEmptyString(value.feedbackId) &&
    isFeedbackPolicyHint(value.memoryCandidate) &&
    isFeedbackPolicyHint(value.rerunIntent)
  );
}

function isFeedbackPolicyHint(value: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.reason) &&
    typeof value.requiresConfirmation === 'boolean' &&
    isNonEmptyString(value.confirmationMode) &&
    Array.isArray(value.feeds) &&
    value.feeds.every(isFeedbackFeed)
  );
}

function isFeedbackFeed(value: unknown): boolean {
  const feeds = ATELIER_MEMORY_CANDIDATE_FEEDS as readonly string[];
  return typeof value === 'string' && feeds.includes(value);
}

function isMemoryConfirmationResponse(value: unknown, payload?: unknown): boolean {
  return (
    isRecord(value) &&
    value.accepted === true &&
    isNonEmptyString(value.feedbackId) &&
    matchesRequestField(payload, 'feedbackId', value.feedbackId) &&
    isNonEmptyString(value.memoryId) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.source) &&
    typeof value.alreadyDone === 'boolean'
  );
}

function isRerunConfirmationResponse(value: unknown, payload?: unknown): boolean {
  return (
    isRecord(value) &&
    value.accepted === true &&
    isNonEmptyString(value.feedbackId) &&
    matchesRequestField(payload, 'feedbackId', value.feedbackId) &&
    isNonEmptyString(value.taskId) &&
    matchesRequestField(payload, 'taskId', value.taskId) &&
    isNonEmptyString(value.rerunTaskId) &&
    isNonEmptyString(value.status) &&
    isNonEmptyString(value.source) &&
    typeof value.alreadyDone === 'boolean' &&
    typeof value.started === 'boolean'
  );
}

function isWorkspaceOpenResponse(value: unknown, payload?: unknown): boolean {
  return (
    isRecord(value) &&
    value.accepted === true &&
    typeof value.opened === 'boolean' &&
    isWorkspaceUri(value.workspaceUri) &&
    matchesRequestField(payload, 'workspaceUri', value.workspaceUri) &&
    isNonEmptyString(value.mode) &&
    isNonEmptyString(value.reason)
  );
}

function isArtifactBodyFetchResponse(value: unknown, payload?: unknown): boolean {
  return (
    isRecord(value) &&
    isNonEmptyString(value.taskId) &&
    matchesRequestField(payload, 'taskId', value.taskId) &&
    isNonEmptyString(value.artifactId) &&
    matchesRequestField(payload, 'artifactId', value.artifactId) &&
    isArtifactBodyRef(value.bodyRef) &&
    matchesRequestField(payload, 'bodyRef', value.bodyRef) &&
    isArtifactBodyKind(value.bodyKind) &&
    isNonEmptyString(value.bodyHash) &&
    matchesOptionalRequestField(payload, 'expectedHash', value.bodyHash) &&
    isNonNegativeFiniteNumber(value.bodySize) &&
    typeof value.text === 'string' &&
    typeof value.truncated === 'boolean' &&
    isNonEmptyString(value.retentionStatus)
  );
}

function isArtifactPreviewOpenResponse(value: unknown, payload?: unknown): boolean {
  return (
    isRecord(value) &&
    value.accepted === true &&
    typeof value.opened === 'boolean' &&
    value.prepared === true &&
    isNonEmptyString(value.taskId) &&
    matchesRequestField(payload, 'taskId', value.taskId) &&
    isNonEmptyString(value.artifactId) &&
    matchesRequestField(payload, 'artifactId', value.artifactId) &&
    isSandboxRef(value.sandboxRef) &&
    matchesRequestField(payload, 'sandboxRef', value.sandboxRef) &&
    isArtifactBodyRef(value.bodyRef) &&
    matchesRequestField(payload, 'bodyRef', value.bodyRef) &&
    isNonEmptyString(value.kind) &&
      isArtifactPreviewOpenMode(value.mode) &&
    isNonEmptyString(value.rendererSessionId) &&
    value.rendererSessionId.startsWith('atelier-preview:') &&
      isArtifactPreviewOpenRendererOwner(value.rendererOwner) &&
      isArtifactPreviewOpenRendererMode(value.rendererMode) &&
      isArtifactPreviewOpenRendererStatus(value.rendererStatus) &&
    Array.isArray(value.rendererCapabilities) &&
    value.rendererCapabilities.every(isNonEmptyString) &&
    hasRequiredArtifactPreviewRendererCapabilities(value.rendererCapabilities) &&
    isNonEmptyString(value.reason)
  );
}

function hasRequiredArtifactPreviewRendererCapabilities(value: string[]): boolean {
  return ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.artifact.preview.open'].requiredRendererCapabilities.every((capability) =>
    value.includes(capability),
  );
}

function isArtifactPreviewOpenMode(value: unknown): boolean {
  const modes = ATELIER_ARTIFACT_PREVIEW_OPEN_MODES as readonly string[];
  return typeof value === 'string' && modes.includes(value);
}

function isArtifactPreviewOpenRendererOwner(value: unknown): boolean {
  const owners = ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_OWNERS as readonly string[];
  return typeof value === 'string' && owners.includes(value);
}

function isArtifactPreviewOpenRendererMode(value: unknown): boolean {
  const modes = ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_MODES as readonly string[];
  return typeof value === 'string' && modes.includes(value);
}

function isArtifactPreviewOpenRendererStatus(value: unknown): boolean {
  const statuses = ATELIER_ARTIFACT_PREVIEW_OPEN_RENDERER_STATUSES as readonly string[];
  return typeof value === 'string' && statuses.includes(value);
}

function matchesRequestField(payload: unknown, field: string, value: unknown): boolean {
  if (!isRecord(payload)) return false;
  return payload[field] === value;
}

function matchesOptionalRequestField(payload: unknown, field: string, value: unknown): boolean {
  if (!isRecord(payload) || payload[field] === undefined) return true;
  return payload[field] === value;
}

function isWorkspaceUri(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  try {
    const uri = new URL(value);
    const shape = ATELIER_WORKSPACE_OPEN_URI_SHAPE;
    const taskPath = uri.pathname.split('/').filter(Boolean);
    const workspaceParams = uri.searchParams.getAll(shape.workspaceQueryKey);
    return (
      isWorkspaceOpenUriScheme(uri.protocol.slice(0, -1)) &&
      uri.hostname === shape.host &&
      taskPath.length === shape.taskPathSegments &&
      isNonEmptyString(taskPath[0]) &&
      workspaceParams.length === 1 &&
      isNonEmptyString(workspaceParams[0])
    );
  } catch {
    return false;
  }
}

function isWorkspaceOpenUriScheme(value: unknown): boolean {
  const schemes = ATELIER_WORKSPACE_OPEN_URI_SCHEMES as readonly string[];
  return typeof value === 'string' && schemes.includes(value);
}

function isArtifactBodyRef(value: unknown): boolean {
  return isArtifactRef(value, ATELIER_ARTIFACT_BODY_REF_SHAPE);
}

function isSandboxRef(value: unknown): boolean {
  return isArtifactRef(value, ATELIER_ARTIFACT_SANDBOX_REF_SHAPE);
}

function isArtifactRef(value: unknown, shape: { scheme: string; pathSegments: number; terminalSegment: string }): boolean {
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

function isArtifactBodyKind(value: unknown): boolean {
  const bodyKinds = ATELIER_ARTIFACT_BODY_KINDS as readonly string[];
  return typeof value === 'string' && bodyKinds.includes(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function invokeProjectionSubscription(
  host: AtelierAppletBridgeHost,
  method: 'events.subscribe' | typeof ATELIER_PROJECTION_SUBSCRIPTION_METHOD | 'events.unsubscribe',
  params: Record<string, unknown>,
): Promise<void> {
  return host.invoke(method, params).then(() => undefined).catch((error: unknown) => {
    console.warn(`Atelier applet bridge ${method} rejected`, error);
    throw error;
  });
}

function projectionTaskIdFromSubscription(input: ProjectionTaskIdResolverInput): string | undefined {
  for (const sourceKey of ATELIER_PROJECTION_CONTRACT.eventSubscription.taskIdSourcePriority) {
    const taskId = projectionTaskIdResolvers[sourceKey](input);
    if (taskId) return taskId;
  }
  return undefined;
}

function compactProjectionStreamPayload(input: {
  agentId: string;
  taskId?: string;
  afterEventSeq?: number;
}): { agentId: string; taskId?: string; afterEventSeq?: number } {
  const payload: { agentId: string; taskId?: string; afterEventSeq?: number } = {
    agentId: input.agentId,
  };
  if (input.taskId) payload.taskId = input.taskId;
  if (typeof input.afterEventSeq === 'number' && Number.isFinite(input.afterEventSeq) && input.afterEventSeq > 0) {
    payload.afterEventSeq = input.afterEventSeq;
  }
  return payload;
}

function projectionAfterEventSeqFromSnapshot(
  snapshot: AtelierProjectionSnapshot | undefined,
  taskId: string | undefined,
): number {
  if (!snapshot || !taskId) return 0;
  const nextEventSeq = snapshot.workspace.replay?.[taskId]?.nextEventSeq;
  return typeof nextEventSeq === 'number' && Number.isFinite(nextEventSeq) && nextEventSeq > 0 ? nextEventSeq : 0;
}
