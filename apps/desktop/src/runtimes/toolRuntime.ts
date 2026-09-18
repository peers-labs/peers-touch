import type { RuntimeDescriptor } from '../kernel/runtime';
import { isBrowserGatewayRuntime } from '../kernel/gateway';
import {
  ToolCallStatus as AgentToolCallStatus,
  ToolExecutionOwner,
  type TurnDiagnosticToolFact,
} from '../gen/proto/domain/agent/agent_pb';
import {
  api,
  type AgentCapabilitySessionList,
  type AgentTypedErrorPayload,
  type AgentToolDecisionIntentInput,
  type AgentToolDecisionIntentResponse,
  type StreamEvent,
} from '../services/desktop_api';
import type { DelegationTaskInfo, ToolCallInfo, ToolCallStatus } from '../store/chat';
import { log } from '../utils/logger';

export interface ToolProjection {
  toolCallId: string;
  turnId: string;
  toolName: string;
  arguments: string;
  serverName?: string;
  source?: string;
  status: ToolCallStatus;
  pending: boolean;
  result?: string;
  error?: string;
  progress?: string;
  progressPct?: number;
  approvalId?: string;
  decisionId?: string;
  decisionRevision: number;
  payloadHash?: string;
  expiresAt?: string;
  approvalActor?: string;
  decidedAt?: string;
  executionOwner?: ToolExecutionOwner;
  approvalPolicy?: string;
  manifestId?: string;
  manifestVersion?: string;
  bindingId?: string;
  bindingRevision?: number;
  readinessSnapshotId?: string;
  targetDeviceId?: string;
  decisionErrorCode?: string;
  decisionOutcome?: AgentTypedErrorPayload;
  delegationResults?: DelegationTaskInfo[];
}

export type ToolProjectionState = Readonly<Record<string, ToolProjection>>;

export interface ToolDecisionAttempt {
  readonly input: AgentToolDecisionIntentInput;
  readonly response: AgentToolDecisionIntentResponse;
}

type Listener = () => void;

const CLIENT_EXECUTOR_UNAVAILABLE = 'CLIENT_EXECUTOR_UNAVAILABLE';
const EXECUTOR_UNAVAILABLE_DECISION_ERROR_CODE =
  'TOOL_APPROVAL_DECISION_ERROR_CODE_EXECUTOR_UNAVAILABLE';
const EXECUTOR_UNAVAILABLE_LOCALE_KEY = 'agent.errors.executorUnavailable';
const TOOL_RECONCILE_INTERVAL_MS = 60_000;

function stringValue(data: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function numberValue(data: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'number' && Number.isSafeInteger(value)) return value;
    if (typeof value === 'string' && /^\d+$/.test(value)) {
      const parsed = Number(value);
      if (Number.isSafeInteger(parsed)) return parsed;
    }
  }
  return 0;
}

function booleanValue(data: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = data[key];
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1' || value === 1) return true;
    if (value === 'false' || value === '0' || value === 0) return false;
  }
  return false;
}

function decisionOutcomeError(
  outcome: AgentTypedErrorPayload | null | undefined,
): string | undefined {
  return (
    outcome?.error_type === CLIENT_EXECUTOR_UNAVAILABLE
      ? EXECUTOR_UNAVAILABLE_LOCALE_KEY
      : outcome?.locale_key?.trim()
  )
    || (
      outcome?.error_type === 'TOOL_APPROVAL_DENIED'
        ? 'agent.errors.toolApprovalDenied'
        : undefined
    )
    || (
      outcome?.error_type === 'TOOL_APPROVAL_EXPIRED'
        ? 'agent.errors.toolApprovalExpired'
        : undefined
    )
    || outcome?.error?.trim()
    || undefined;
}

function isExecutorUnavailableProjection(
  projection: ToolProjection,
): boolean {
  return projection.decisionOutcome?.error_type === CLIENT_EXECUTOR_UNAVAILABLE
    || projection.decisionErrorCode === EXECUTOR_UNAVAILABLE_DECISION_ERROR_CODE;
}

interface ExecutorRecoveryTarget {
  targetDeviceId: string;
  capabilityId: string;
}

function executorRecoveryTarget(
  projection: ToolProjection,
): ExecutorRecoveryTarget | null {
  const details = projection.decisionOutcome?.details;
  const targetDeviceId = details?.target_device_id?.trim();
  const capabilityId = details?.capability_id?.trim();
  if (!targetDeviceId || !capabilityId) return null;
  return { targetDeviceId, capabilityId };
}

function hasExecutorRecoveryTarget(
  capabilitySessions: AgentCapabilitySessionList,
  target: ExecutorRecoveryTarget,
): boolean {
  return capabilitySessions.sessions.some(
    (session) =>
      session.device_id === target.targetDeviceId
      && session.typed_capabilities.some(
        (capability) => capability.capability_id === target.capabilityId,
      ),
  );
}

function projectionIdentity(data: Record<string, unknown>) {
  return {
    toolCallId: stringValue(data, 'toolCallId', 'tool_call_id', 'id'),
    turnId: stringValue(data, 'turnId', 'turn_id'),
  };
}

function sameDecisionIdentity(
  current: ToolProjection,
  decisionId: string,
  revision: number,
  payloadHash: string,
): boolean {
  if (revision !== current.decisionRevision) return false;
  if (current.decisionId && current.decisionId !== decisionId) return false;
  if (current.payloadHash && payloadHash && current.payloadHash !== payloadHash) return false;
  return true;
}

function arrayValue(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

function delegationStatus(value: unknown): DelegationTaskInfo['status'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'delegation_status_completed') return 'completed';
  if (normalized === 'failed' || normalized === 'delegation_status_failed') return 'failed';
  if (normalized === 'timeout' || normalized === 'delegation_status_timeout') return 'timeout';
  return 'unknown';
}

function parseDelegationResults(value: string): DelegationTaskInfo[] {
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object') return [];
    const record = parsed as Record<string, unknown>;
    const items = Array.isArray(parsed) ? parsed : record.subtask_results || record.results || [];
    if (!Array.isArray(items)) return [];
    return items
      .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
      .map((item) => ({
        taskId: String(item.TaskID || item.task_id || item.taskId || ''),
        parentTurnId: item.ParentTurnID || item.parent_turn_id || item.parentTurnId
          ? String(item.ParentTurnID || item.parent_turn_id || item.parentTurnId)
          : undefined,
        taskDescription: String(
          item.TaskDescription ||
          item.task_description ||
          item.taskDescription ||
          item.Description ||
          item.description ||
          '',
        ),
        childToolset: arrayValue(item.ChildToolset || item.child_toolset || item.childToolset),
        status: delegationStatus(item.Status || item.status),
        resultSummary: String(
          item.ResultSummary || item.result_summary || item.resultSummary || item.result || '',
        ),
        toolIterations: Number(
          item.ToolIterations ?? item.tool_iterations ?? item.toolIterations ?? 0,
        ),
        startedAt: item.StartedAt || item.started_at || item.startedAt
          ? String(item.StartedAt || item.started_at || item.startedAt)
          : undefined,
        endedAt: item.EndedAt || item.ended_at || item.endedAt
          ? String(item.EndedAt || item.ended_at || item.endedAt)
          : undefined,
      }))
      .filter((item) => item.taskId && item.taskDescription);
  } catch {
    return [];
  }
}

function updateTurnProjections(
  state: ToolProjectionState,
  turnId: string,
  update: (projection: ToolProjection) => ToolProjection,
): ToolProjectionState {
  if (!turnId) return state;
  let changed = false;
  const next = { ...state };
  for (const [toolCallId, projection] of Object.entries(state)) {
    if (projection.turnId !== turnId) continue;
    next[toolCallId] = update(projection);
    changed = true;
  }
  return changed ? next : state;
}

export function reduceToolProjection(
  state: ToolProjectionState,
  event: StreamEvent,
): ToolProjectionState {
  const data = event.data;
  const { toolCallId, turnId } = projectionIdentity(data);
  if (event.event === 'progress') {
    const progress = stringValue(data, 'message', 'stage');
    const progressPct = numberValue(data, 'pct');
    return updateTurnProjections(state, turnId, (projection) => (
      projection.pending ? { ...projection, progress, progressPct } : projection
    ));
  }
  if (event.event === 'error') {
    const error = stringValue(data, 'error', 'localeKey', 'locale_key');
    return updateTurnProjections(state, turnId, (projection) => (
      projection.pending
        ? { ...projection, status: 'error', pending: false, error }
        : projection
    ));
  }
  if (event.event === 'done') {
    return state;
  }
  if (event.event === 'cancelled') {
    return updateTurnProjections(state, turnId, (projection) => (
      projection.pending ? { ...projection, status: 'cancelled', pending: false } : projection
    ));
  }
  if (!toolCallId) return state;

  const current = state[toolCallId];
  if (current && isTerminalToolStatus(current.status)) return state;
  if (event.event === 'tool_call') {
    const next: ToolProjection = {
      ...current,
      toolCallId,
      turnId: turnId || current?.turnId || '',
      toolName: stringValue(data, 'toolName', 'tool_name', 'name') || current?.toolName || '',
      arguments: stringValue(data, 'arguments', 'args') || current?.arguments || '',
      serverName: stringValue(data, 'serverName', 'server_name') || current?.serverName,
      source: stringValue(data, 'source') || current?.source,
      status: 'pending',
      pending: true,
      decisionRevision: current?.decisionRevision ?? 0,
    };
    return { ...state, [toolCallId]: next };
  }

  if (event.event === 'tool_approval_required') {
    const approvalId = stringValue(data, 'approvalId', 'approval_id');
    const decisionId = stringValue(data, 'decisionId', 'decision_id');
    const decisionRevision = numberValue(data, 'decisionRevision', 'decision_revision');
    const payloadHash = stringValue(data, 'payloadHash', 'payload_hash');
    if (!approvalId) return state;
    if (current && decisionRevision < current.decisionRevision) return state;
    if (current &&
      decisionRevision === current.decisionRevision &&
      current.approvalId &&
      current.approvalId !== approvalId) {
      return state;
    }
    const next: ToolProjection = {
      toolCallId,
      turnId: turnId || current?.turnId || '',
      toolName: stringValue(data, 'toolName', 'tool_name', 'name') || current?.toolName || '',
      arguments: stringValue(data, 'arguments', 'args') || current?.arguments || '',
      serverName: stringValue(data, 'serverName', 'server_name') || current?.serverName,
      source: stringValue(data, 'source') || current?.source,
      status: 'approval_required',
      pending: true,
      approvalId,
      decisionId: decisionId || current?.decisionId,
      decisionRevision,
      payloadHash: payloadHash || current?.payloadHash,
      expiresAt:
        stringValue(data, 'expiresAt', 'expires_at')
        || current?.expiresAt,
    };
    return { ...state, [toolCallId]: next };
  }

  if (event.event === 'tool_approval_decision') {
    if (!current) return state;
    const decisionId = stringValue(data, 'decisionId', 'decision_id');
    const decisionRevision = numberValue(data, 'decisionRevision', 'decision_revision');
    const payloadHash = stringValue(data, 'payloadHash', 'payload_hash');
    if (!decisionId || decisionRevision < current.decisionRevision) return state;
    if (decisionRevision === current.decisionRevision &&
      !sameDecisionIdentity(current, decisionId, decisionRevision, payloadHash)) {
      return state;
    }
    const approved = booleanValue(data, 'approved');
    return {
      ...state,
      [toolCallId]: {
        ...current,
        status: approved ? 'approved' : 'denied',
        pending: approved,
        decisionId,
        decisionRevision,
        payloadHash: payloadHash || current.payloadHash,
        approvalActor: stringValue(data, 'actor', 'actorPtid', 'actor_ptid') || undefined,
        decidedAt: stringValue(data, 'decidedAt', 'decided_at') || undefined,
        decisionErrorCode: approved ? undefined : current.decisionErrorCode,
        decisionOutcome: approved ? undefined : current.decisionOutcome,
      },
    };
  }

  if (event.event === 'tool_result') {
    if (!current) return state;
    const error = stringValue(data, 'error', 'errorCode', 'error_code');
    const localizedError = connectorErrorLocaleKey(error) || error;
    const result = stringValue(data, 'content', 'result');
    const delegationResults = current.toolName === 'delegate_task'
      ? parseDelegationResults(result)
      : [];
    return {
      ...state,
      [toolCallId]: {
        ...current,
        status: localizedError ? 'error' : 'success',
        pending: false,
        result,
        error: localizedError || undefined,
        delegationResults: delegationResults.length > 0
          ? delegationResults
          : current.delegationResults,
      },
    };
  }

  return state;
}

function toToolCallInfo(projection: ToolProjection): ToolCallInfo {
  return {
    id: projection.toolCallId,
    name: projection.toolName,
    args: projection.arguments,
    result: projection.result,
    pending: projection.pending,
    status: projection.status,
    progress: projection.progress,
    progressPct: projection.progressPct,
    approvalId: projection.approvalId,
    serverName: projection.serverName,
    source: projection.source,
    approvalActor: projection.approvalActor,
    approvedAt: projection.decidedAt,
    decisionId: projection.decisionId,
    decisionRevision: projection.decisionRevision,
    payloadHash: projection.payloadHash,
    expiresAt: projection.expiresAt,
    executionOwner: projection.executionOwner,
    approvalPolicy: projection.approvalPolicy,
    manifestId: projection.manifestId,
    manifestVersion: projection.manifestVersion,
    bindingId: projection.bindingId,
    bindingRevision: projection.bindingRevision,
    readinessSnapshotId: projection.readinessSnapshotId,
    targetDeviceId: projection.targetDeviceId,
    error:
      projection.error
      || decisionOutcomeError(projection.decisionOutcome)
      || projection.decisionErrorCode,
    delegationResults: projection.delegationResults,
  };
}

export function resolveToolCallProjection(
  source: ToolCallInfo,
  projection: ToolProjection | undefined,
): ToolCallInfo {
  if (!projection) return source;

  const sourceIsTerminal = isTerminalToolStatus(source.status);
  const projectionAddsTypedTerminalOutcome = (
    (
      projection.status === 'denied'
      || projection.status === 'expired'
      || projection.status === 'unknown_side_effect'
    )
    && Boolean(
      projection.error
      || decisionOutcomeError(projection.decisionOutcome)
      || projection.decisionErrorCode,
    )
    && (
      (source.status === projection.status || source.status === 'error')
      || projection.decisionOutcome?.terminal === true
    )
  );
  const projectionRetainsWaitingApproval =
    projection.status === 'approval_required'
    && isExecutorUnavailableProjection(projection);
  if (
    (
      sourceIsTerminal
      && !projectionAddsTypedTerminalOutcome
      && !projectionRetainsWaitingApproval
    )
    || projection.decisionRevision < (source.decisionRevision ?? 0)
  ) {
    return source;
  }
  return { ...source, ...toToolCallInfo(projection) };
}

export interface ToolProjectionMessage {
  readonly turnId?: string;
  readonly toolCalls?: readonly ToolCallInfo[];
}

function toolStatusFromDiagnostic(
  status: AgentToolCallStatus,
): ToolCallStatus | undefined {
  if (status === AgentToolCallStatus.PROPOSED) return 'queued';
  if (status === AgentToolCallStatus.WAITING_APPROVAL) {
    return 'approval_required';
  }
  if (status === AgentToolCallStatus.APPROVED) return 'approved';
  if (
    status === AgentToolCallStatus.CLAIMED
    || status === AgentToolCallStatus.RUNNING
  ) {
    return 'pending';
  }
  if (status === AgentToolCallStatus.SUCCEEDED) return 'success';
  if (status === AgentToolCallStatus.DENIED) return 'denied';
  if (status === AgentToolCallStatus.CANCELLED) return 'cancelled';
  if (status === AgentToolCallStatus.EXPIRED) return 'expired';
  if (status === AgentToolCallStatus.UNKNOWN_SIDE_EFFECT) {
    return 'unknown_side_effect';
  }
  if (status === AgentToolCallStatus.FAILED) return 'error';
  return undefined;
}

function toolStatusRank(status: ToolCallStatus): number {
  if (status === 'queued') return 0;
  if (status === 'pending') return 1;
  if (status === 'approval_required') return 2;
  if (status === 'approved') return 3;
  return 4;
}

function isTerminalToolStatus(
  status: ToolCallStatus | undefined,
): boolean {
  return status === 'success'
    || status === 'error'
    || status === 'denied'
    || status === 'cancelled'
    || status === 'expired'
    || status === 'unknown_side_effect';
}

function diagnosticToolError(
  fact: TurnDiagnosticToolFact,
  source: ToolCallInfo,
): string | undefined {
  if (
    fact.status === AgentToolCallStatus.EXPIRED
    && fact.errorCode === 'TOOL_APPROVAL_EXPIRED'
  ) {
    return 'agent.errors.toolApprovalExpired';
  }
  if (
    fact.status === AgentToolCallStatus.DENIED
    && fact.errorCode === 'TOOL_APPROVAL_DENIED'
  ) {
    return 'agent.errors.toolApprovalDenied';
  }
  if (fact.status === AgentToolCallStatus.UNKNOWN_SIDE_EFFECT) {
    return 'agent.errors.toolUnknownSideEffect';
  }
  return connectorErrorLocaleKey(fact.errorCode) || fact.errorCode || source.error;
}

function connectorErrorLocaleKey(errorCode: string): string | undefined {
  const localeKeys: Record<string, string> = {
    CONNECTOR_OAUTH_EXPIRED: 'agent.errors.connectorOAuthExpired',
    CONNECTOR_SCOPE_DENIED: 'agent.errors.connectorScopeDenied',
    CONNECTOR_RESOURCE_REMOVED: 'agent.errors.connectorResourceRemoved',
    CONNECTOR_MANIFEST_STALE: 'agent.errors.connectorManifestStale',
    CONNECTOR_DISCONNECTED: 'agent.errors.connectorDisconnected',
    CONNECTOR_PROVIDER_REVOKED: 'agent.errors.connectorProviderRevoked',
    CONNECTOR_REVOCATION_UNCONFIRMED: 'agent.errors.connectorRevocationUnconfirmed',
  };
  return localeKeys[errorCode];
}

function sameToolProjection(
  left: ToolProjection,
  right: ToolProjection,
): boolean {
  return left.toolCallId === right.toolCallId
    && left.turnId === right.turnId
    && left.toolName === right.toolName
    && left.arguments === right.arguments
    && left.serverName === right.serverName
    && left.source === right.source
    && left.status === right.status
    && left.pending === right.pending
    && left.result === right.result
    && left.error === right.error
    && left.progress === right.progress
    && left.progressPct === right.progressPct
    && left.approvalId === right.approvalId
    && left.decisionId === right.decisionId
    && left.decisionRevision === right.decisionRevision
    && left.payloadHash === right.payloadHash
    && left.expiresAt === right.expiresAt
    && left.approvalActor === right.approvalActor
    && left.decidedAt === right.decidedAt
    && left.executionOwner === right.executionOwner
    && left.approvalPolicy === right.approvalPolicy
    && left.manifestId === right.manifestId
    && left.manifestVersion === right.manifestVersion
    && left.bindingId === right.bindingId
    && left.bindingRevision === right.bindingRevision
    && left.readinessSnapshotId === right.readinessSnapshotId
    && left.targetDeviceId === right.targetDeviceId
    && left.decisionErrorCode === right.decisionErrorCode
    && left.decisionOutcome === right.decisionOutcome
    && left.delegationResults === right.delegationResults;
}

export function reconcileToolProjectionState(
  state: ToolProjectionState,
  projections: readonly ToolProjection[],
): ToolProjectionState {
  let next = state;

  for (const projection of projections) {
    const current = next[projection.toolCallId];
    const refinesUnclassifiedError = (
      current?.status === 'error'
      && !current.decisionErrorCode
      && isTerminalToolStatus(projection.status)
    );
    if (
      current
      && (
        projection.decisionRevision < current.decisionRevision
        || (
          projection.decisionRevision === current.decisionRevision
          && !refinesUnclassifiedError
          && (
            toolStatusRank(projection.status) < toolStatusRank(current.status)
            || (
              isTerminalToolStatus(current.status)
              && projection.status !== current.status
            )
          )
        )
      )
    ) {
      continue;
    }

    const reconciled = current
      ? {
          ...current,
          ...projection,
          result: projection.result ?? current.result,
          error: projection.error ?? current.error,
          progress: projection.progress ?? current.progress,
          progressPct: projection.progressPct ?? current.progressPct,
          payloadHash: projection.payloadHash ?? current.payloadHash,
          expiresAt: projection.expiresAt ?? current.expiresAt,
          approvalActor: projection.approvalActor ?? current.approvalActor,
          decidedAt: projection.decidedAt ?? current.decidedAt,
          executionOwner:
            projection.executionOwner ?? current.executionOwner,
          approvalPolicy:
            projection.approvalPolicy ?? current.approvalPolicy,
          manifestId: projection.manifestId ?? current.manifestId,
          manifestVersion:
            projection.manifestVersion ?? current.manifestVersion,
          bindingId: projection.bindingId ?? current.bindingId,
          bindingRevision:
            projection.bindingRevision ?? current.bindingRevision,
          readinessSnapshotId:
            projection.readinessSnapshotId ?? current.readinessSnapshotId,
          targetDeviceId:
            projection.targetDeviceId ?? current.targetDeviceId,
          decisionErrorCode:
            projection.decisionErrorCode ?? current.decisionErrorCode,
          decisionOutcome:
            projection.decisionOutcome ?? current.decisionOutcome,
          delegationResults:
            projection.delegationResults ?? current.delegationResults,
        }
      : projection;
    if (current && sameToolProjection(current, reconciled)) continue;
    next = {
      ...next,
      [projection.toolCallId]: reconciled,
    };
  }

  return next;
}

function projectionFromDiagnostic(
  fact: TurnDiagnosticToolFact,
  source: ToolCallInfo,
  turnId: string,
): ToolProjection | undefined {
  const status = toolStatusFromDiagnostic(fact.status);
  if (!fact.toolCallId || !status) return undefined;

  const decisionRevision = Number(fact.decisionRevision);
  return {
    toolCallId: fact.toolCallId,
    turnId,
    toolName: fact.toolName || source.name,
    arguments: fact.redactedArguments || source.args || '',
    status,
    pending:
      status === 'queued'
      || status === 'pending'
      || status === 'approval_required'
      || status === 'approved',
    result: source.result,
    error: diagnosticToolError(fact, source),
    decisionErrorCode: fact.errorCode || undefined,
    approvalId: fact.approvalId || source.approvalId,
    decisionId: fact.decisionId || source.decisionId,
    decisionRevision: Number.isSafeInteger(decisionRevision)
      ? decisionRevision
      : 0,
    payloadHash: source.payloadHash,
    expiresAt: source.expiresAt,
    executionOwner: fact.executionOwner,
    approvalPolicy: fact.approvalPolicy || source.approvalPolicy,
    manifestId: fact.manifestId || source.manifestId,
    manifestVersion: fact.manifestVersion || source.manifestVersion,
    bindingId: fact.bindingId || source.bindingId,
    bindingRevision: Number(fact.bindingRevision) || source.bindingRevision,
    readinessSnapshotId:
      fact.readinessSnapshotId || source.readinessSnapshotId,
    targetDeviceId: fact.targetDeviceId || source.targetDeviceId,
  };
}

class ToolRuntime implements RuntimeDescriptor {
  readonly id = 'agent-tool';
  readonly scope = 'session' as const;

  private state: ToolProjectionState = {};
  private listeners = new Set<Listener>();
  private actorId: string | null = null;
  private installed = false;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private pendingDecisions = new Map<string, Promise<AgentToolDecisionIntentResponse>>();
  private pendingExecutorReconnects = new Map<string, Promise<void>>();
  private decisionIntentIds = new Map<string, string>();
  private decisionAttempts = new Map<string, ToolDecisionAttempt>();

  install(): void {
    if (this.installed) return;
    this.installed = true;
    this.reconcileTimer = setInterval(() => {
      void this.reconcile('periodic').catch((error) => {
        log.warn('toolRuntime', 'Periodic ToolCall reconciliation failed', {
          error: String(error),
        });
      });
    }, TOOL_RECONCILE_INTERVAL_MS);
  }

  teardown(): void {
    if (!this.installed) return;
    this.installed = false;
    if (this.reconcileTimer !== null) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
    this.actorId = null;
    this.pendingDecisions.clear();
    this.pendingExecutorReconnects.clear();
    this.decisionIntentIds.clear();
    this.decisionAttempts.clear();
    this.replaceState({});
  }

  async bootstrap(actorId: string | null): Promise<void> {
    if (this.actorId === actorId) return;
    this.actorId = actorId;
    this.pendingDecisions.clear();
    this.pendingExecutorReconnects.clear();
    this.decisionIntentIds.clear();
    this.decisionAttempts.clear();
    this.replaceState({});
  }

  getSnapshot = (): ToolProjectionState => this.state;

  async reconcile(reason: string): Promise<void> {
    const tracked = Object.values(this.state).filter(
      (projection) =>
        projection.pending || projection.status === 'unknown_side_effect',
    );
    if (tracked.length === 0) return;
    log.info('toolRuntime', 'Reconciling Station ToolCall projections', {
      reason,
      count: tracked.length,
    });
    await this.reconcileMessages(tracked.map((projection) => ({
      turnId: projection.turnId,
      toolCalls: [toToolCallInfo(projection)],
    })));
  }

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getProjection(toolCallId: string): ToolProjection | undefined {
    return this.state[toolCallId];
  }

  getDecisionAttempt(toolCallId: string): ToolDecisionAttempt | undefined {
    return this.decisionAttempts.get(toolCallId);
  }

  consume(event: StreamEvent): boolean {
    const next = reduceToolProjection(this.state, event);
    if (next === this.state) return false;
    this.replaceState(next);
    if (event.event === 'tool_approval_required') {
      const { toolCallId } = projectionIdentity(event.data);
      const proposal = next[toolCallId];
      if (proposal?.turnId) {
        void this.reconcileMessages([{
          turnId: proposal.turnId,
          toolCalls: [toToolCallInfo(proposal)],
        }]).catch((error) => {
          log.warn(
            'toolRuntime',
            'Failed to hydrate ToolCall proposal from Station diagnostics',
            { turnId: proposal.turnId, toolCallId, error: String(error) },
          );
        });
      }
    }
    return true;
  }

  async reconcileMessages(
    messages: readonly ToolProjectionMessage[],
  ): Promise<boolean> {
    const toolCallsByTurn = new Map<string, Map<string, ToolCallInfo>>();
    for (const message of messages) {
      if (!message.turnId || !message.toolCalls?.length) continue;
      const unresolved = message.toolCalls.filter((toolCall) => {
        const current = this.state[toolCall.id];
        return (
          !current
          || current.pending
          || current.status === 'unknown_side_effect'
          || (current.status === 'error' && !current.decisionErrorCode)
        );
      });
      if (unresolved.length === 0) continue;
      toolCallsByTurn.set(
        message.turnId,
        new Map(unresolved.map((toolCall) => [toolCall.id, toolCall])),
      );
    }

    const reconciled = (
      await Promise.all(
        Array.from(toolCallsByTurn.entries()).map(
          async ([turnId, visibleToolCalls]) => {
            try {
              const diagnostics = await api.exportAgentTurnDiagnostics(turnId);
              return (diagnostics.replay?.toolCalls ?? [])
                .map((fact) => {
                  const source = visibleToolCalls.get(fact.toolCallId);
                  return source
                    ? projectionFromDiagnostic(fact, source, turnId)
                    : undefined;
                })
                .filter(
                  (projection): projection is ToolProjection =>
                    projection !== undefined,
                );
            } catch (error) {
              log.warn(
                'toolRuntime',
                'Failed to reconcile Station ToolCall projection',
                { turnId, error: String(error) },
              );
              return [];
            }
          },
        ),
      )
    ).flat();

    const next = reconcileToolProjectionState(this.state, reconciled);
    if (next === this.state) return false;
    this.replaceState(next);
    return true;
  }

  reduceToolCalls(existing: ToolCallInfo[] | undefined, event: StreamEvent): ToolCallInfo[] | undefined {
    const { toolCallId, turnId } = projectionIdentity(event.data);
    if (toolCallId && !this.state[toolCallId]) {
      const persisted = existing?.find((toolCall) => toolCall.id === toolCallId);
      if (persisted) {
        this.state = {
          ...this.state,
          [toolCallId]: {
            toolCallId,
            turnId,
            toolName: persisted.name,
            arguments: persisted.args || '',
            serverName: persisted.serverName,
            source: persisted.source,
            status: persisted.status || (persisted.pending ? 'pending' : 'success'),
            pending: persisted.pending ?? false,
            result: persisted.result,
            error: persisted.error,
            progress: persisted.progress,
            progressPct: persisted.progressPct,
            approvalId: persisted.approvalId,
            decisionId: persisted.decisionId,
            decisionRevision: persisted.decisionRevision ?? 0,
            payloadHash: persisted.payloadHash,
            expiresAt: persisted.expiresAt,
            approvalActor: persisted.approvalActor,
            decidedAt: persisted.approvedAt,
            executionOwner: persisted.executionOwner,
            approvalPolicy: persisted.approvalPolicy,
            manifestId: persisted.manifestId,
            manifestVersion: persisted.manifestVersion,
            bindingId: persisted.bindingId,
            bindingRevision: persisted.bindingRevision,
            readinessSnapshotId: persisted.readinessSnapshotId,
            targetDeviceId: persisted.targetDeviceId,
            delegationResults: persisted.delegationResults,
          },
        };
      }
    }
    this.consume(event);
    return this.projectToolCalls(existing, event);
  }

  projectToolCalls(existing: ToolCallInfo[] | undefined, event: StreamEvent): ToolCallInfo[] | undefined {
    const { toolCallId, turnId } = projectionIdentity(event.data);
    const projections = toolCallId
      ? [this.state[toolCallId]].filter((item): item is ToolProjection => Boolean(item))
      : Object.values(this.state).filter((item) => turnId && item.turnId === turnId);
    if (projections.length === 0) return existing;

    const next = [...(existing ?? [])];
    for (const projection of projections) {
      const projected = toToolCallInfo(projection);
      const index = next.findIndex((toolCall) => toolCall.id === projection.toolCallId);
      if (index < 0) {
        next.push(projected);
      } else {
        next[index] = { ...next[index], ...projected };
      }
    }
    return next;
  }

  submitDecision(toolCallId: string, approved: boolean): Promise<AgentToolDecisionIntentResponse> {
    const projection = this.state[toolCallId];
    if (!projection?.approvalId ||
      projection.status !== 'approval_required') {
      return Promise.reject(new Error('agent.toolDecisionUnavailable'));
    }
    if (approved && isExecutorUnavailableProjection(projection)) {
      return Promise.reject(new Error(EXECUTOR_UNAVAILABLE_LOCALE_KEY));
    }

    const actionKey = `${toolCallId}:${projection.decisionRevision}:${approved}`;
    const decisionId = projection.decisionId ||
      this.decisionIntentIds.get(actionKey) ||
      crypto.randomUUID();
    this.decisionIntentIds.set(actionKey, decisionId);
    const pending = this.pendingDecisions.get(actionKey);
    if (pending) return pending;

    const input: AgentToolDecisionIntentInput = {
      approval_id: projection.approvalId,
      tool_call_id: projection.toolCallId,
      decision_id: decisionId,
      expected_revision: projection.decisionRevision,
      approved,
      idempotency_key: decisionId,
    };
    const request = api.submitAgentToolDecision(input)
      .then((response) => {
        this.decisionAttempts.set(toolCallId, { input, response });
        const outcomeError = decisionOutcomeError(response.outcome_error);
        if (!response.accepted) {
          const expired =
            response.error_code
            === 'TOOL_APPROVAL_DECISION_ERROR_CODE_EXPIRED';
          this.patch(toolCallId, {
            ...(expired ? { status: 'expired' as const, pending: false } : {}),
            error: outcomeError || response.error_code,
            decisionErrorCode:
              outcomeError || response.error_code,
            decisionOutcome: response.outcome_error ?? undefined,
          });
          return response;
        }
        this.consume({
          event: 'tool_approval_decision',
          data: {
            approvalId: response.approval_id,
            toolCallId: response.tool_call_id,
            decisionId: response.decision_id,
            decisionRevision: response.decision_revision,
            approved: response.approved,
            idempotencyKey: response.idempotency_key,
            payloadHash: response.payload_hash,
          },
        });
        if (response.outcome_error) {
          this.patch(toolCallId, {
            error: outcomeError,
            decisionErrorCode: outcomeError,
            decisionOutcome: response.outcome_error,
          });
        }
        return response;
      })
      .catch((error: unknown) => {
        this.patch(toolCallId, {
          decisionErrorCode: error instanceof Error ? error.message : 'agent.toolDecisionFailed',
        });
        throw error;
      })
      .finally(() => {
        this.pendingDecisions.delete(actionKey);
      });
    this.pendingDecisions.set(actionKey, request);
    return request;
  }

  reconnectExecutor(toolCallId: string): Promise<void> {
    const projection = this.state[toolCallId];
    const recoveryTarget = projection
      ? executorRecoveryTarget(projection)
      : null;
    if (
      !projection
      || projection.status !== 'approval_required'
      || !isExecutorUnavailableProjection(projection)
      || !recoveryTarget
    ) {
      return Promise.reject(new Error('agent.toolExecutorRecoveryUnavailable'));
    }

    const recoveryKey = `${toolCallId}:${projection.decisionRevision}`;
    const pending = this.pendingExecutorReconnects.get(recoveryKey);
    if (pending) return pending;

    const decisionRevision = projection.decisionRevision;
    const ensureLocalSupervisor = isBrowserGatewayRuntime()
      ? Promise.resolve()
      : api.startAgentClientExecutorSupervisor().then(() => undefined);
    const request = ensureLocalSupervisor
      .then(() => api.listAgentCapabilitySessions())
      .then((capabilitySessions) => {
        if (!hasExecutorRecoveryTarget(capabilitySessions, recoveryTarget)) {
          throw new Error(EXECUTOR_UNAVAILABLE_LOCALE_KEY);
        }
        const current = this.state[toolCallId];
        const currentTarget = current
          ? executorRecoveryTarget(current)
          : null;
        if (
          !current
          || current.decisionRevision !== decisionRevision
          || !isExecutorUnavailableProjection(current)
          || !currentTarget
          || currentTarget.targetDeviceId !== recoveryTarget.targetDeviceId
          || currentTarget.capabilityId !== recoveryTarget.capabilityId
        ) {
          return;
        }
        this.decisionIntentIds.delete(`${toolCallId}:${decisionRevision}:true`);
        this.decisionAttempts.delete(toolCallId);
        this.patch(toolCallId, {
          error: undefined,
          decisionErrorCode: undefined,
          decisionOutcome: undefined,
        });
      })
      .finally(() => {
        this.pendingExecutorReconnects.delete(recoveryKey);
      });
    this.pendingExecutorReconnects.set(recoveryKey, request);
    return request;
  }

  reset(): void {
    this.pendingDecisions.clear();
    this.pendingExecutorReconnects.clear();
    this.decisionIntentIds.clear();
    this.decisionAttempts.clear();
    this.replaceState({});
  }

  private patch(toolCallId: string, patch: Partial<ToolProjection>): void {
    const current = this.state[toolCallId];
    if (!current) return;
    this.replaceState({
      ...this.state,
      [toolCallId]: { ...current, ...patch },
    });
  }

  private replaceState(next: ToolProjectionState): void {
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }
}

export const toolRuntime = new ToolRuntime();
export const submitAgentToolDecision = (
  toolCallId: string,
  approved: boolean,
): Promise<AgentToolDecisionIntentResponse> => toolRuntime.submitDecision(toolCallId, approved);
export const reconnectAgentToolExecutor = (toolCallId: string): Promise<void> =>
  toolRuntime.reconnectExecutor(toolCallId);

export function logToolDecisionFailure(toolCallId: string, error: unknown): void {
  log.error('toolRuntime', 'Failed to submit Station tool decision intent', {
    toolCallId,
    error: error instanceof Error ? error.message : String(error),
  });
}

export function logToolRecoveryFailure(toolCallId: string, error: unknown): void {
  log.error('toolRuntime', 'Failed to request ToolCall recovery', {
    toolCallId,
    error: error instanceof Error ? error.message : String(error),
  });
}
