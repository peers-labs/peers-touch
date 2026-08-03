import { createAgentChatCache, type AgentChatCache, type CachedAgentConversation, type CachedAgentMessage } from '@peers-touch/client-chat-core';
import { createDesktopClientStorageRuntime } from './desktopClientStorage';
import { api } from '../services/desktop_api';

let cacheInstance: AgentChatCache | null = null;

export function getDesktopAgentChatCache(): AgentChatCache {
  if (cacheInstance) return cacheInstance;

  const runtime = createDesktopClientStorageRuntime({});
  cacheInstance = createAgentChatCache({
    conversationRepo: runtime.repositories.agentConversations as never,
    messageRepo: runtime.repositories.agentMessages as never,
    turnEventRepo: runtime.repositories.agentTurnEvents as never,
    cursorRepo: runtime.repositories.agentCursor,
    fetcher: {
      async listConversations(agentId: string) {
        const conversations = await api.listAgentConversations(agentId, { pageSize: 200 });
        return { conversations: conversations.map(toCachedConversation) };
      },
      async listMessages(conversationId: string, afterSeq: number) {
        const result = await api.listAgentConversationMessages({
          conversation_id: conversationId,
          after_seq: afterSeq,
          limit: 200,
        });
        return { messages: result.messages.map(toCachedMessage) };
      },
    },
  });
  return cacheInstance;
}

function toCachedConversation(conversation: {
  conversation_id: string;
  agent_id: string;
  user_id?: string;
  title: string;
  description?: string;
  provider_id?: string;
  model_name?: string;
  status: string;
  parent_id?: string;
  created_at: string;
  updated_at: string;
}): CachedAgentConversation {
  return {
    conversationId: conversation.conversation_id,
    agentId: conversation.agent_id,
    userId: conversation.user_id,
    title: conversation.title,
    description: conversation.description,
    providerId: conversation.provider_id,
    modelName: conversation.model_name,
    status: conversation.status,
    parentId: conversation.parent_id,
    createdAt: conversation.created_at,
    updatedAt: conversation.updated_at,
  };
}

function toCachedMessage(message: {
  message_id: string;
  conversation_id: string;
  turn_id?: string;
  model_name?: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  seq: number;
  branch_id?: string;
  replaces_message_id?: string;
  reasoning_json?: string;
  tool_calls_json?: string;
  created_at: string;
  updated_at: string;
}): CachedAgentMessage {
  return {
    messageId: message.message_id,
    conversationId: message.conversation_id,
    turnId: message.turn_id,
    modelName: message.model_name,
    role: message.role,
    content: message.content,
    seq: message.seq,
    branchId: message.branch_id,
    replacesMessageId: message.replaces_message_id,
    reasoningJson: message.reasoning_json,
    toolCallsJson: message.tool_calls_json,
    createdAt: message.created_at,
    updatedAt: message.updated_at,
  };
}
