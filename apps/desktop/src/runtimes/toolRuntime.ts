import type { RuntimeDescriptor } from '../kernel/runtime';
import {
  api,
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
  approvalActor?: string;
  decidedAt?: string;
  decisionErrorCode?: string;
  delegationResults?: DelegationTaskInfo[];
}

export type ToolProjectionState = Readonly<Record<string, ToolProjection>>;

type Listener = () => void;

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
    return updateTurnProjections(state, turnId, (projection) => (
      projection.pending ? { ...projection, status: 'success', pending: false } : projection
    ));
  }
  if (event.event === 'cancelled') {
    return updateTurnProjections(state, turnId, (projection) => (
      projection.pending ? { ...projection, status: 'cancelled', pending: false } : projection
    ));
  }
  if (!toolCallId) return state;

  const current = state[toolCallId];
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
        decisionErrorCode: undefined,
      },
    };
  }

  if (event.event === 'tool_result') {
    if (!current) return state;
    const error = stringValue(data, 'error', 'errorCode', 'error_code');
    const result = stringValue(data, 'content', 'result');
    const delegationResults = current.toolName === 'delegate_task'
      ? parseDelegationResults(result)
      : [];
    return {
      ...state,
      [toolCallId]: {
        ...current,
        status: error ? 'error' : 'success',
        pending: false,
        result,
        error: error || undefined,
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
    error: projection.error || projection.decisionErrorCode,
    delegationResults: projection.delegationResults,
  };
}

class ToolRuntime implements RuntimeDescriptor {
  readonly id = 'agent-tool';
  readonly scope = 'session' as const;

  private state: ToolProjectionState = {};
  private listeners = new Set<Listener>();
  private actorId: string | null = null;
  private installed = false;
  private pendingDecisions = new Map<string, Promise<AgentToolDecisionIntentResponse>>();
  private decisionIntentIds = new Map<string, string>();

  install(): void {
    if (this.installed) return;
    this.installed = true;
  }

  teardown(): void {
    if (!this.installed) return;
    this.installed = false;
    this.actorId = null;
    this.pendingDecisions.clear();
    this.decisionIntentIds.clear();
    this.replaceState({});
  }

  async bootstrap(actorId: string | null): Promise<void> {
    if (this.actorId === actorId) return;
    this.actorId = actorId;
    this.pendingDecisions.clear();
    this.decisionIntentIds.clear();
    this.replaceState({});
  }

  getSnapshot = (): ToolProjectionState => this.state;

  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getProjection(toolCallId: string): ToolProjection | undefined {
    return this.state[toolCallId];
  }

  consume(event: StreamEvent): boolean {
    const next = reduceToolProjection(this.state, event);
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
            approvalActor: persisted.approvalActor,
            decidedAt: persisted.approvedAt,
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
        if (!response.accepted) {
          this.patch(toolCallId, { decisionErrorCode: response.error_code });
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

  reset(): void {
    this.pendingDecisions.clear();
    this.decisionIntentIds.clear();
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

export function logToolDecisionFailure(toolCallId: string, error: unknown): void {
  log.error('toolRuntime', 'Failed to submit Station tool decision intent', {
    toolCallId,
    error: error instanceof Error ? error.message : String(error),
  });
}
