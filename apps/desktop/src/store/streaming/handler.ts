import type { ChatMessage, ToolCallInfo, ToolCallStatus, KnowledgeChunkInfo, DelegationTaskInfo, ErrorResolutionAction } from '../chat';
import type { TurnStreamEvent, StreamingAccumulator } from './types';
import { useInterventionStore } from '../intervention';
import type { InterventionType } from '../intervention';

let tempCounter = 0;
function tempId(): string {
  return `temp-${Date.now()}-${tempCounter++}`;
}

function s(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

export function reduceStreamEvent(msg: ChatMessage, event: TurnStreamEvent): ChatMessage {
  const d = event.data;
  switch (event.event) {
    case 'text':
      return { ...msg, content: msg.content + s(d.content), loading: true, lastEventAt: Date.now() };

    case 'tool_call': {
      const existing = msg.toolCalls || [];
      return {
        ...msg,
        toolCalls: [...existing, {
          id: s(d.id) || tempId(),
          name: s(d.name),
          args: s(d.args),
          pending: true,
          status: 'pending' as ToolCallStatus,
          serverName: s(d.serverName) || s(d.server_name),
          source: s(d.source),
        }],
        lastEventAt: Date.now(),
      };
    }

    case 'tool_result': {
      const isDelegate = s(d.name) === 'delegate_task';
      const delegationResults = isDelegate
        ? parseDelegationResults(s(d.content) || s(d.result))
        : [];
      const calls = (msg.toolCalls || []).map((tc) =>
        (tc.id === s(d.id) || tc.name === s(d.name)) && tc.pending
          ? {
            ...tc,
            result: s(d.content),
            pending: false,
            status: 'success' as ToolCallStatus,
            delegationResults: delegationResults.length > 0 ? delegationResults : tc.delegationResults,
          }
          : tc,
      );
      return {
        ...msg,
        toolCalls: calls,
        delegationResults: delegationResults.length > 0 ? delegationResults : msg.delegationResults,
        lastEventAt: Date.now(),
      };
    }

    case 'tool_approval_required': {
      const existing = msg.toolCalls || [];
      const approvalId = s(d.approvalId) || s(d.id) || tempId();
      const nextCall: ToolCallInfo = {
        id: s(d.id) || s(d.toolCallId) || approvalId,
        name: s(d.name) || s(d.toolName) || 'local_mcp',
        args: s(d.args) || s(d.arguments),
        pending: true,
        status: 'approval_required',
        approvalId,
        serverName: s(d.serverName),
        source: s(d.source),
      };
      const replaced = existing.some((tc) => tc.id === nextCall.id || tc.approvalId === approvalId);
      return {
        ...msg,
        toolCalls: replaced
          ? existing.map((tc) => (tc.id === nextCall.id || tc.approvalId === approvalId ? { ...tc, ...nextCall } : tc))
          : [...existing, nextCall],
        lastEventAt: Date.now(),
      };
    }

    case 'tool_approval_decision': {
      const approved = s(d.approved) === 'true' || s(d.approved) === '1';
      const calls = (msg.toolCalls || []).map((tc) =>
        tc.approvalId === s(d.approvalId) || tc.id === s(d.id)
          ? {
            ...tc,
            pending: approved,
            status: (approved ? 'approved' : 'denied') as ToolCallStatus,
            approvalActor: s(d.actor),
            approvedAt: s(d.decidedAt),
          }
          : tc,
      );
      return { ...msg, toolCalls: calls, lastEventAt: Date.now() };
    }

    case 'image': {
      const imgs = msg.images || [];
      return { ...msg, images: [...imgs, s(d.url)] };
    }

    case 'intervention_request': {
      const interventionType = (s(d.type) || 'text') as InterventionType;
      const choices = Array.isArray(d.choices) ? d.choices.map((c: unknown) => String(c)) : undefined;
      // Lazy require to avoid circular dependency chain: chat -> streaming -> handler -> chat
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const chatModule = require('../chat') as { useChatStore: { getState: () => { currentSessionKey: string } } };
      const sessionKey = chatModule.useChatStore.getState().currentSessionKey;
      useInterventionStore.getState().requestIntervention({
        sessionKey,
        messageId: msg.id,
        prompt: s(d.prompt),
        type: interventionType,
        choices,
        defaultValue: d.defaultValue != null ? s(d.defaultValue) : undefined,
      });
      return { ...msg, lastEventAt: Date.now() };
    }

    case 'thinking':
      return {
        ...msg,
        thinking: (msg.thinking || '') + s(d.content),
        thinkingDone: !!d.done,
        lastEventAt: Date.now(),
      };

    case 'progress': {
      if (s(d.stage) === 'knowledge_retrieved' && d.result) {
        return {
          ...msg,
          knowledgeChunks: parseKnowledgeChunks(s(d.result)),
          lastEventAt: Date.now(),
        };
      }
      const progCalls = (msg.toolCalls || []).map((tc) =>
        tc.pending
          ? { ...tc, progress: s(d.message) || tc.progress, progressPct: d.pct != null ? Number(d.pct) : tc.progressPct }
          : tc,
      );
      return { ...msg, toolCalls: progCalls, lastEventAt: Date.now() };
    }

    case 'error': {
      const errMsg = s(d.error) || 'Unknown error';
      const errCalls = (msg.toolCalls || []).map((tc) =>
        tc.pending ? { ...tc, result: `Error: ${errMsg}`, pending: false, status: 'error' as ToolCallStatus } : tc,
      );
      return {
        ...msg,
        toolCalls: errCalls,
        error: errMsg,
        errorDetail: s(d.detail),
        resolution: (d.resolution && typeof d.resolution === 'object' ? d.resolution as ErrorResolutionAction : null),
        providerId: s(d.providerId),
        loading: false,
      };
    }

    case 'done': {
      const doneCalls = (msg.toolCalls || []).map((tc) =>
        tc.pending ? { ...tc, pending: false, status: 'success' as ToolCallStatus } : tc,
      );
      return {
        ...msg,
        toolCalls: doneCalls,
        loading: false,
        model: s(d.model) || msg.model,
        processDuration: Math.round((Date.now() - msg.timestamp) / 1000),
        followUpSuggestions: Array.isArray(d.suggestions) ? d.suggestions as string[] : undefined,
      };
    }

    default:
      return msg;
  }
}

export function isTerminalEvent(event: TurnStreamEvent): boolean {
  return event.event === 'done' || event.event === 'error';
}

export function isApprovalEvent(event: TurnStreamEvent): boolean {
  return event.event === 'tool_approval_required';
}

export function createStreamingAccumulator(): StreamingAccumulator {
  return {
    content: '',
    thinking: '',
    thinkingDone: false,
    thinkingStartedAt: null,
    thinkingDurationMs: null,
    toolCallCount: 0,
    images: [],
    model: '',
    error: null,
    isDone: false,
    lastEventAt: 0,
  };
}

export function accumulateEvent(acc: StreamingAccumulator, event: TurnStreamEvent): StreamingAccumulator {
  const d = event.data;
  switch (event.event) {
    case 'text':
      return { ...acc, content: acc.content + s(d.content), lastEventAt: Date.now() };
    case 'thinking': {
      const now = Date.now();
      const startedAt = acc.thinkingStartedAt ?? now;
      const done = !!d.done;
      const durationMs = done ? now - startedAt : null;
      return { ...acc, thinking: acc.thinking + s(d.content), thinkingDone: done, thinkingStartedAt: startedAt, thinkingDurationMs: durationMs, lastEventAt: now };
    }
    case 'tool_call':
      return { ...acc, toolCallCount: acc.toolCallCount + 1, lastEventAt: Date.now() };
    case 'image':
      return { ...acc, images: [...acc.images, s(d.url)], lastEventAt: Date.now() };
    case 'error':
      return { ...acc, error: { message: s(d.error), detail: s(d.detail), providerId: s(d.providerId) }, lastEventAt: Date.now() };
    case 'done':
      return { ...acc, isDone: true, model: s(d.model) || acc.model, lastEventAt: Date.now() };
    default:
      return { ...acc, lastEventAt: Date.now() };
  }
}

function parseKnowledgeChunks(value: string): KnowledgeChunkInfo[] {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return [];
    return parsed.map((item: Record<string, unknown>) => ({
      chunkId: String(item.ChunkID || item.chunkId || ''),
      resourceId: String(item.ResourceID || item.resourceId || ''),
      resourceTitle: String(item.ResourceTitle || item.resourceTitle || ''),
      source: String(item.Source || item.source || ''),
      chunkIndex: Number(item.ChunkIndex ?? item.chunkIndex ?? 0),
      score: Number(item.Score ?? item.score ?? 0),
      contentPreview: String(item.ContentPreview || item.contentPreview || ''),
    })).filter((item: KnowledgeChunkInfo) => item.chunkId && item.resourceId);
  } catch {
    return [];
  }
}

function parseDelegationResults(value: string): DelegationTaskInfo[] {
  try {
    const data = JSON.parse(value);
    if (!data) return [];
    const items = Array.isArray(data) ? data : (data.subtask_results || data.results || []);
    if (!Array.isArray(items)) return [];
    return items.map((item: Record<string, unknown>) => ({
      taskId: String(item.TaskID || item.task_id || item.taskId || ''),
      parentTurnId: item.ParentTurnID || item.parent_turn_id || item.parentTurnId ? String(item.ParentTurnID || item.parent_turn_id || item.parentTurnId) : undefined,
      taskDescription: String(item.TaskDescription || item.task_description || item.taskDescription || item.Description || item.description || ''),
      childToolset: arrayField(item.ChildToolset || item.child_toolset || item.childToolset),
      status: normalizeDelegationStatus(item.Status || item.status),
      resultSummary: String(item.ResultSummary || item.result_summary || item.resultSummary || item.result || ''),
      toolIterations: Number(item.ToolIterations ?? item.tool_iterations ?? item.toolIterations ?? 0),
      startedAt: item.StartedAt || item.started_at || item.startedAt ? String(item.StartedAt || item.started_at || item.startedAt) : undefined,
      endedAt: item.EndedAt || item.ended_at || item.endedAt ? String(item.EndedAt || item.ended_at || item.endedAt) : undefined,
    })).filter((item: DelegationTaskInfo) => item.taskId && item.taskDescription);
  } catch {
    return [];
  }
}

function arrayField(value: unknown): string[] {
  return Array.isArray(value) ? value.map((v) => String(v).trim()).filter(Boolean) : [];
}

function normalizeDelegationStatus(value: unknown): DelegationTaskInfo['status'] {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'completed' || normalized === 'delegation_status_completed') return 'completed';
  if (normalized === 'failed' || normalized === 'delegation_status_failed') return 'failed';
  if (normalized === 'timeout' || normalized === 'delegation_status_timeout') return 'timeout';
  return 'unknown';
}
