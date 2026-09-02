/**
 * Cross-platform agent chat cache.
 *
 * Station is the single source of truth for agent conversations, messages,
 * turns and thinking. This module is a rebuildable, cursor-based local replica
 * shared by Desktop and Mobile through the `@peers-touch/client-storage`
 * kernel. It contains NO framework, NO Tauri, NO DOM dependency — platforms
 * supply a `PlatformStorageAdapter` and a `StationAgentFetcher`.
 *
 * Invariants:
 *  - The cache is a derived replica. It may be wiped and re-synced from seq 0.
 *  - Message ordering is authoritative by Station `seq` (monotonic per conversation).
 *  - Live streaming continues to flow through the existing SSE/stream path;
 *    the repository simply upserts completed messages by `message_id`/`seq`.
 *  - A failed sync never blanks already-cached history.
 */

import type { DomainCacheRepository } from '@peers-touch/client-storage';

export type AgentRole = 'system' | 'user' | 'assistant' | 'tool';

export interface CachedAgentAttachment {
  readonly attachmentId: string;
  readonly objectRef: string;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly checksum: string;
  readonly filename: string;
  readonly authorizationScope: string;
  readonly expiresAt: string;
  readonly extractedContentRef: string;
}

export interface CachedAgentConversation {
  readonly conversationId: string;
  readonly agentId: string;
  readonly ptid: string;
  readonly title: string;
  readonly description?: string;
  readonly providerId?: string;
  readonly modelName?: string;
  readonly status: string;
  readonly parentId?: string;
  readonly activeBranchMessageId: string;
  readonly queuedTurnCount: number;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CachedAgentMessage {
  readonly messageId: string;
  readonly conversationId: string;
  readonly turnId?: string;
  readonly modelName?: string;
  readonly role: AgentRole;
  readonly status?: string;
  readonly content: string;
  readonly seq: number;
  readonly branchId?: string;
  readonly replacesMessageId?: string;
  readonly reasoningJson?: string;
  readonly toolCallsJson?: string;
  readonly metadataJson?: string;
  readonly attachments?: readonly CachedAgentAttachment[];
  readonly reconciliationSource?: 'station-list' | 'station-snapshot';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CachedAgentTurnEvent {
  readonly eventSeq: number;
  readonly conversationId: string;
  readonly turnId: string;
  readonly eventType: string;
  readonly payload: unknown;
  readonly createdAt: string;
}

export interface CachedConversationPage {
  readonly messages: readonly CachedAgentMessage[];
  readonly nextSinceSeq: number;
  readonly hasMore: boolean;
}

export interface StationConversationListResult {
  readonly conversations: readonly CachedAgentConversation[];
}

export interface StationMessagesResult {
  readonly messages: readonly CachedAgentMessage[];
  readonly turnEvents?: readonly CachedAgentTurnEvent[];
}

export interface StationAgentFetcher {
  listConversations(agentId: string): Promise<StationConversationListResult>;
  listMessages(conversationId: string, afterSeq: number): Promise<StationMessagesResult>;
}

export interface AgentChatCache {
  listConversations(agentId: string): Promise<readonly CachedAgentConversation[]>;
  getMessages(conversationId: string): Promise<readonly CachedAgentMessage[]>;
  getTurnEvents(conversationId: string): Promise<readonly CachedAgentTurnEvent[]>;
  syncConversation(conversationId: string): Promise<readonly CachedAgentMessage[]>;
  upsertMessage(message: CachedAgentMessage): Promise<void>;
  clearConversation(conversationId: string): Promise<void>;
}

export function createAgentChatCache(deps: {
  conversationRepo: DomainCacheRepository<Record<string, CachedAgentConversation>>;
  messageRepo: DomainCacheRepository<Record<string, CachedAgentMessage[]>>;
  turnEventRepo: DomainCacheRepository<Record<string, CachedAgentTurnEvent[]>>;
  cursorRepo: DomainCacheRepository<number>;
  fetcher: StationAgentFetcher;
}): AgentChatCache {
  const { conversationRepo, messageRepo, turnEventRepo, cursorRepo, fetcher } = deps;

  async function readConversationBundle(agentId: string): Promise<Record<string, CachedAgentConversation>> {
    return (await conversationRepo.readValue(agentId)) ?? {};
  }

  async function readMessages(conversationId: string): Promise<CachedAgentMessage[]> {
    const map = (await messageRepo.readValue(conversationId)) ?? {};
    return map[conversationId] ? [...map[conversationId]] : [];
  }

  async function writeMessages(conversationId: string, messages: readonly CachedAgentMessage[]): Promise<void> {
    const map = (await messageRepo.readValue(conversationId)) ?? {};
    map[conversationId] = mergeAgentMessages(messages, map[conversationId] ?? []);
    await messageRepo.write(conversationId, map);
  }

  async function readTurnEvents(conversationId: string): Promise<CachedAgentTurnEvent[]> {
    const map = (await turnEventRepo.readValue(conversationId)) ?? {};
    return map[conversationId] ? [...map[conversationId]] : [];
  }

  async function writeTurnEvents(conversationId: string, events: readonly CachedAgentTurnEvent[]): Promise<void> {
    const map = (await turnEventRepo.readValue(conversationId)) ?? {};
    map[conversationId] = mergeTurnEvents(events, map[conversationId] ?? []);
    await turnEventRepo.write(conversationId, map);
  }

  async function readCursor(conversationId: string): Promise<number> {
    return (await cursorRepo.readValue(conversationId)) ?? 0;
  }

  async function writeCursor(conversationId: string, cursor: number): Promise<void> {
    await cursorRepo.write(conversationId, cursor);
  }

  async function syncConversation(conversationId: string): Promise<readonly CachedAgentMessage[]> {
    const since = await readCursor(conversationId);
    const result = await fetcher.listMessages(conversationId, since);
    if (result.messages.length > 0) {
      await writeMessages(conversationId, result.messages);
      const highest = result.messages.reduce((max, message) => Math.max(max, message.seq), since);
      await writeCursor(conversationId, highest);
    }
    if (result.turnEvents && result.turnEvents.length > 0) {
      await writeTurnEvents(conversationId, result.turnEvents);
    }
    return readMessages(conversationId);
  }

  return {
    async listConversations(agentId: string): Promise<readonly CachedAgentConversation[]> {
      const cached = await readConversationBundle(agentId);
      try {
        const result = await fetcher.listConversations(agentId);
        const next: Record<string, CachedAgentConversation> = {};
        for (const conversation of result.conversations) {
          next[conversation.conversationId] = conversation;
        }
        await conversationRepo.write(agentId, next);
        return Object.values(next).sort(compareConversationByUpdatedAt);
      } catch {
        return Object.values(cached).sort(compareConversationByUpdatedAt);
      }
    },

    async getMessages(conversationId: string): Promise<readonly CachedAgentMessage[]> {
      const cached = await readMessages(conversationId);
      void syncConversation(conversationId).catch(() => {
        // Background reconcile failure does not blank cached history.
      });
      return cached;
    },

    async getTurnEvents(conversationId: string): Promise<readonly CachedAgentTurnEvent[]> {
      return readTurnEvents(conversationId);
    },

    syncConversation,

    async upsertMessage(message: CachedAgentMessage): Promise<void> {
      await writeMessages(message.conversationId, [message]);
      const since = await readCursor(message.conversationId);
      if (message.seq > since) await writeCursor(message.conversationId, message.seq);
    },

    async clearConversation(conversationId: string): Promise<void> {
      await Promise.all([
        messageRepo.remove(conversationId),
        turnEventRepo.remove(conversationId),
        cursorRepo.remove(conversationId),
      ]);
    },
  };
}

export function mergeAgentMessages(
  incoming: readonly CachedAgentMessage[],
  existing: readonly CachedAgentMessage[],
): CachedAgentMessage[] {
  const byId = new Map<string, CachedAgentMessage>();
  for (const message of existing) byId.set(message.messageId, message);
  for (const message of incoming) {
    const current = byId.get(message.messageId);
    byId.set(message.messageId, current ? reconcileMessage(current, message) : message);
  }
  return [...byId.values()].sort(compareMessageBySeq);
}

export function mergeTurnEvents(
  incoming: readonly CachedAgentTurnEvent[],
  existing: readonly CachedAgentTurnEvent[],
): CachedAgentTurnEvent[] {
  const bySeq = new Map<number, CachedAgentTurnEvent>();
  for (const event of existing) bySeq.set(event.eventSeq, event);
  for (const event of incoming) bySeq.set(event.eventSeq, event);
  return [...bySeq.values()].sort((a, b) => a.eventSeq - b.eventSeq);
}

function reconcileMessage(
  current: CachedAgentMessage,
  incoming: CachedAgentMessage,
): CachedAgentMessage {
  const currentUpdatedAt = Date.parse(current.updatedAt);
  const incomingUpdatedAt = Date.parse(incoming.updatedAt);
  const currentAuthority =
    current.reconciliationSource === 'station-snapshot' ? 1 : 0;
  const incomingAuthority =
    incoming.reconciliationSource === 'station-snapshot' ? 1 : 0;
  const incomingIsNewer = incoming.seq > current.seq
    || (
      incoming.seq === current.seq
      && (
        incomingAuthority > currentAuthority
        || (
          incomingAuthority === currentAuthority
          && (
            !Number.isFinite(currentUpdatedAt)
            || !Number.isFinite(incomingUpdatedAt)
            || incomingUpdatedAt >= currentUpdatedAt
          )
        )
      )
    );
  const authoritative = incomingIsNewer ? incoming : current;
  const fallback = incomingIsNewer ? current : incoming;
  return {
    ...fallback,
    ...authoritative,
    content: authoritative.content,
    reasoningJson: authoritative.reasoningJson ?? fallback.reasoningJson,
    toolCallsJson: authoritative.toolCallsJson ?? fallback.toolCallsJson,
  };
}

function compareMessageBySeq(a: CachedAgentMessage, b: CachedAgentMessage): number {
  if (a.seq !== b.seq) return a.seq - b.seq;
  return a.messageId.localeCompare(b.messageId);
}

function compareConversationByUpdatedAt(
  a: CachedAgentConversation,
  b: CachedAgentConversation,
): number {
  const delta = Date.parse(b.updatedAt) - Date.parse(a.updatedAt);
  if (Number.isFinite(delta) && delta !== 0) return delta;
  return a.conversationId.localeCompare(b.conversationId);
}
