import type {
  BudgetNotice,
  ChatMessage,
  KnowledgeChunkInfo,
  ErrorResolutionAction,
} from '../chat';
import type { TurnStreamEvent, StreamingAccumulator } from './types';
import { useInterventionStore } from '../intervention';
import type { InterventionType } from '../intervention';
import {
  AGENT_TOOL_LOOP_BUDGET_EXHAUSTED_ERROR_TYPE,
  isAgentLifecycleInterruptedError,
  isAgentToolLoopBudgetExhaustedError,
  projectAgentTurnErrorPayload,
  projectAgentTurnOutcomeErrorPayload,
  projectAgentTypedErrorPayload,
  resolveAgentTypedErrorAction,
} from '../../services/desktop_api';

function s(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
}

export const BUDGET_ERROR_TYPE =
  AGENT_TOOL_LOOP_BUDGET_EXHAUSTED_ERROR_TYPE;

export function terminalReasonFromStreamData(
  data: Record<string, unknown>,
): string {
  return s(
    data.terminal_reason
    || data.terminalReason
    || data.reason
    || data.error,
  );
}

export function projectAgentTypedError(
  data: Record<string, unknown>,
): ChatMessage['typedError'] {
  return projectAgentTypedErrorPayload(data);
}

function cancellationTypedError(
  data: Record<string, unknown>,
): ChatMessage['typedError'] {
  return projectAgentTurnOutcomeErrorPayload(data);
}

export function projectBudgetNotice(data: Record<string, unknown>): BudgetNotice | undefined {
  const typedError = projectAgentTurnErrorPayload(data);
  if (!isAgentToolLoopBudgetExhaustedError(typedError)) return undefined;

  return {
    kind: typedError.details.budget_kind,
    turnId: typedError.details.turn_id,
    limit: typedError.details.limit,
    localeKey: typedError.locale_key,
  };
}

export function reduceStreamEvent(msg: ChatMessage, event: TurnStreamEvent): ChatMessage {
  const d = event.data;
  switch (event.event) {
    case 'text':
      return { ...msg, content: msg.content + s(d.content), loading: true, lastEventAt: Date.now() };

    case 'tool_call':
    case 'tool_result':
    case 'tool_approval_required':
    case 'tool_approval_decision':
      return { ...msg, lastEventAt: Date.now() };

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
      const typedError = projectAgentTurnOutcomeErrorPayload(d);
      if (typedError?.terminal === false) {
        return {
          ...msg,
          error: typedError.locale_key,
          typedError,
          resolution: resolveAgentTypedErrorAction(typedError) ?? null,
          loading: true,
          cancelled: false,
          terminalStatus: undefined,
          lastEventAt: Date.now(),
        };
      }
      return { ...msg, lastEventAt: Date.now() };
    }

    case 'budget_exhausted':
    case 'error': {
      const errMsg = s(d.error) || 'Unknown error';
      const budgetNotice = projectBudgetNotice(d);
      const typedError = event.event === 'error'
        ? projectAgentTurnErrorPayload(d)
        : projectAgentTypedError(d);
      const outcomeError = event.event === 'error'
        ? projectAgentTurnOutcomeErrorPayload(d)
        : undefined;
      const interruptedError = event.event === 'error'
        && isAgentLifecycleInterruptedError(outcomeError)
        ? outcomeError
        : undefined;
      const interrupted = Boolean(interruptedError);
      const suppliedResolution = d.resolution && typeof d.resolution === 'object'
        ? d.resolution as ErrorResolutionAction
        : null;
      const mappedResolution = resolveAgentTypedErrorAction(typedError);
      const resolution = (
        mappedResolution?.type === 'recover' && !interrupted
          ? null
          : mappedResolution
      )
        ?? (suppliedResolution?.type === 'recover' ? null : suppliedResolution);
      return {
        ...msg,
        error: budgetNotice?.localeKey || typedError?.locale_key || errMsg,
        typedError: typedError ?? msg.typedError,
        budgetNotice: budgetNotice ?? msg.budgetNotice,
        terminalStatus: interrupted ? 'interrupted' : 'failed',
        errorDetail: interrupted
          ? terminalReasonFromStreamData(d) || interruptedError?.details.reason_code
          : s(d.detail),
        resolution,
        providerId: s(d.providerId),
        loading: false,
      };
    }

    case 'cancelled': {
      const typedError = cancellationTypedError(d);
      return {
        ...msg,
        error: typedError?.locale_key ?? msg.error,
        typedError: typedError ?? msg.typedError,
        errorDetail: terminalReasonFromStreamData(d) || msg.errorDetail,
        resolution: null,
        cancelled: true,
        terminalStatus: 'cancelled',
        loading: false,
        lastEventAt: Date.now(),
      };
    }

    case 'connection_lost':
    case 'reconnecting':
    case 'replaying':
    case 'reconciling':
    case 'connected':
      return {
        ...msg,
        loading: true,
        lastEventAt: Date.now(),
      };

    case 'recovery_failed':
      return {
        ...msg,
        error: 'chat.agentTurnRecovery.recoveryFailed',
        loading: false,
        lastEventAt: Date.now(),
      };

    case 'queued': {
      const admission = d.admission && typeof d.admission === 'object'
        ? d.admission as Record<string, unknown>
        : {};
      const rawQueueEntry = admission.queueEntry || admission.queue_entry;
      const queueEntry = rawQueueEntry && typeof rawQueueEntry === 'object'
        ? rawQueueEntry as Record<string, unknown>
        : {};
      return {
        ...msg,
        queued: true,
        queueEntryId: s(queueEntry.queueEntryId || queueEntry.queue_entry_id),
        queuePosition: Number(queueEntry.queuePosition || queueEntry.queue_position || 0),
        loading: false,
        lastEventAt: Date.now(),
      };
    }

    case 'admission_replayed':
      return {
        ...msg,
        loading: false,
        lastEventAt: Date.now(),
      };

    case 'snapshot': {
      const status = s(d.status).toLowerCase();
      const terminalReason = terminalReasonFromStreamData(d);
      const budgetNotice = projectBudgetNotice(d);
      const hasSnapshotText = typeof d.text === 'string';
      const projectedError = projectAgentTurnErrorPayload(d);
      const cancelledError = (
        status === 'cancelled'
        && msg.typedError?.error_type === 'LIFECYCLE_CANCELLED'
      )
        ? msg.typedError
        : undefined;
      const interruptedError = status === 'interrupted'
        ? isAgentLifecycleInterruptedError(projectedError)
          ? projectedError
          : isAgentLifecycleInterruptedError(msg.typedError)
            ? msg.typedError
            : undefined
        : undefined;
      const terminalStatus = ['completed', 'failed', 'cancelled', 'interrupted'].includes(status)
        ? status as NonNullable<ChatMessage['terminalStatus']>
        : msg.terminalStatus;
      return {
        ...msg,
        content: hasSnapshotText ? d.text as string : msg.content,
        cancelled: status === 'cancelled',
        error:
          status === 'interrupted'
            ? interruptedError?.locale_key || terminalReason || msg.error
            : status === 'failed'
              ? terminalReason || msg.error
              : status === 'cancelled'
                ? cancelledError?.locale_key
                : status === 'completed'
                  ? undefined
                  : msg.error,
        typedError:
          status === 'cancelled'
            ? cancelledError
            : status === 'interrupted'
              ? interruptedError
              : msg.typedError,
        errorDetail:
          status === 'failed' || status === 'cancelled' || status === 'interrupted'
            ? terminalReason || msg.errorDetail
            : msg.errorDetail,
        resolution:
          status === 'cancelled'
            ? null
            : status === 'interrupted'
              ? resolveAgentTypedErrorAction(interruptedError) ?? null
              : msg.resolution,
        budgetNotice: budgetNotice ?? msg.budgetNotice,
        terminalStatus,
        loading: status === 'running',
        lastEventAt: Date.now(),
      };
    }

    case 'catchup_done':
      return {
        ...msg,
        lastEventAt: Date.now(),
      };

    case 'done': {
      return {
        ...msg,
        loading: false,
        terminalStatus: 'completed',
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
  if (
    event.event === 'error'
    && projectAgentTurnOutcomeErrorPayload(event.data)?.terminal === false
  ) {
    return false;
  }
  return event.event === 'done'
    || event.event === 'error'
    || event.event === 'budget_exhausted'
    || event.event === 'cancelled'
    || event.event === 'queued'
    || event.event === 'admission_replayed';
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
    isCancelled: false,
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
    case 'cancelled': {
      const typedError = cancellationTypedError(d);
      return {
        ...acc,
        error: typedError
          ? {
              message: typedError.locale_key,
              detail: s(d.reason || d.error) || undefined,
            }
          : acc.error,
        isCancelled: true,
        lastEventAt: Date.now(),
      };
    }
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
