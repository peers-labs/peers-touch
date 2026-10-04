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
  assertPrototypeBridgeRuntimeValueHasNoForbiddenCapabilities,
} from './prototypeBridgeRuntimeCallPolicy';
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
}

const DEFAULT_PROJECTION_EVENT_TOPIC = ATELIER_PROJECTION_EVENT_TOPIC;

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
      assertPrototypeBridgeRuntimeValueHasNoForbiddenCapabilities(response, request.method);
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
      if (!host.onEvent) {
        throw Object.assign(
          new Error('Atelier projection event bridge unavailable: host.onEvent missing'),
          { code: 'CONNECTION_CLOSED' },
        );
      }
      let closed = false;
      let topicSubscribed = false;
      const unsubscribeEvent = host.onEvent(projectionEventTopic, (payload) => {
        if (!closed) listener(payload);
      });
      if (typeof unsubscribeEvent !== 'function') {
        closed = true;
        throw new Error('Atelier projection event bridge returned malformed unsubscribe cleanup');
      }
      const unsubscribeTopic = () => {
        if (!topicSubscribed) return;
        topicSubscribed = false;
        void invokeProjectionSubscription(host, 'events.unsubscribe', {
          topic: projectionEventTopic,
        }).catch(() => undefined);
      };
      const closeAfterRejectedSubscribe = (method: 'events.subscribe', error: unknown) => {
        if (closed) return;
        closed = true;
        unsubscribeEvent();
        unsubscribeTopic();
        const rejection = projectionSubscriptionRejection(method, error);
        listener({
          kind: 'atelier.projection.subscription-rejected',
          method,
          ...(rejection.code ? { code: rejection.code } : {}),
          reason: rejection.reason,
        });
      };
      topicSubscribed = true;
      const ready = invokeProjectionSubscription(host, 'events.subscribe', {
        topic: projectionEventTopic,
      }).catch((error: unknown) => {
        closeAfterRejectedSubscribe('events.subscribe', error);
        throw error;
      });
      void ready.catch(() => undefined);
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribeEvent();
        unsubscribeTopic();
      };
      return Object.assign(cleanup, { ready });
    },
  };
}

function throwIfAtelierBridgeErrorEnvelope(method: AtelierRuntimeMethod, response: unknown): void {
  const envelope = atelierBridgeHostErrorEnvelope(response);
  if (!envelope) return;
  throw Object.assign(
    new Error(`Atelier bridge method ${method} failed: ${envelope.code} ${envelope.message}`, {
      cause: response,
    }),
    { code: envelope.code },
  );
}

function normalizeAtelierBridgeHostError(method: AtelierRuntimeMethod, error: unknown): Error {
  const envelope = atelierBridgeHostErrorEnvelope(error) ?? (error instanceof Error ? atelierBridgeHostErrorEnvelope(error) : undefined);
  if (envelope) {
    return Object.assign(
      new Error(`Atelier bridge method ${method} failed: ${envelope.code} ${envelope.message}`, {
        cause: error,
      }),
      { code: envelope.code },
    );
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
  method: 'events.subscribe' | 'events.unsubscribe',
  params: Record<string, unknown>,
): Promise<void> {
  return host.invoke(method, params).then(() => undefined).catch((error: unknown) => {
    console.warn(`Atelier applet bridge ${method} rejected`, {
      reason: projectionSubscriptionRejection(method, error).reason,
    });
    throw error;
  });
}

function projectionSubscriptionRejection(
  method: 'events.subscribe',
  error: unknown,
): { code?: string; reason: string } {
  const record = isRecord(error) ? error : undefined;
  const code = typeof record?.code === 'string'
    ? sanitizeProjectionSubscriptionCode(record.code)
    : undefined;
  const reason = sanitizeProjectionSubscriptionReason(
    error instanceof Error ? error.message : String(error),
  );
  return {
    ...(code ? { code } : {}),
    reason,
  };
}

const forbiddenProjectionSubscriptionReasonPatterns = [
  /provider\.invoke/i,
  /providerInvoke/i,
  /runtime\.execute/i,
  /runtimeExecute/i,
  /shell/i,
  /shellExecute/i,
  /memory\.write/i,
  /input_snapshot/i,
  /run\.execute/i,
];

function sanitizeProjectionSubscriptionReason(reason: string): string {
  if (!reason.trim()) return 'Host projection subscription rejected';
  if (forbiddenProjectionSubscriptionReasonPatterns.some((pattern) => pattern.test(reason))) {
    return 'Host projection subscription rejected';
  }
  return reason;
}

function sanitizeProjectionSubscriptionCode(code: string): string | undefined {
  const normalizedCode = code.trim().toUpperCase();
  if (!normalizedCode) return undefined;
  return Object.prototype.hasOwnProperty.call(
    ATELIER_PROJECTION_CONTRACT.viewSurface.bridgeRuntimeRecoveryCodeKindByCode,
    normalizedCode,
  )
    ? normalizedCode
    : undefined;
}
