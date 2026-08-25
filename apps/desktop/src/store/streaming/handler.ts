import type { ChatMessage, KnowledgeChunkInfo, ErrorResolutionAction } from '../chat';
import type { TurnStreamEvent, StreamingAccumulator } from './types';
import { useInterventionStore } from '../intervention';
import type { InterventionType } from '../intervention';

function s(v: unknown): string {
  return typeof v === 'string' ? v : v != null ? String(v) : '';
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
      return { ...msg, lastEventAt: Date.now() };
    }

    case 'error': {
      const errMsg = s(d.error) || 'Unknown error';
      return {
        ...msg,
        error: errMsg,
        errorDetail: s(d.detail),
        resolution: (d.resolution && typeof d.resolution === 'object' ? d.resolution as ErrorResolutionAction : null),
        providerId: s(d.providerId),
        loading: false,
      };
    }

    case 'cancelled':
      return {
        ...msg,
        cancelled: true,
        loading: false,
        lastEventAt: Date.now(),
      };

    case 'reconciling':
      return {
        ...msg,
        loading: true,
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

    case 'snapshot':
      return {
        ...msg,
        content: s(d.text) || msg.content,
        cancelled: s(d.status) === 'cancelled',
        error: s(d.status) === 'failed' ? s(d.terminal_reason) || msg.error : msg.error,
        loading: s(d.status) === 'running',
        lastEventAt: Date.now(),
      };

    case 'catchup_done':
      return {
        ...msg,
        lastEventAt: Date.now(),
      };

    case 'done': {
      return {
        ...msg,
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
  return event.event === 'done'
    || event.event === 'error'
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
    case 'cancelled':
      return { ...acc, isCancelled: true, lastEventAt: Date.now() };
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
