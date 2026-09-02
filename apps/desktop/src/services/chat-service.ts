import {
  api,
  type Session,
  type Message,
} from './desktop_api';

export type { Session, Message };

export class ChatService {
  async listAgentSessions(agentId: string): Promise<Session[]> {
    const conversations = await api.listAgentConversations(agentId, { pageSize: 200 });
    return conversations.map((conversation) => ({
      id: conversation.conversation_id,
      key: conversation.conversation_id,
      agent_name: conversation.agent_id,
      title: conversation.title,
      message_count: 0,
      model_override: conversation.model_name,
      created_at: conversation.created_at,
      updated_at: conversation.updated_at,
      pinned: conversation.meta?.pinned === 'true',
      favorite: conversation.meta?.favorite === 'true',
      version: conversation.version,
      active_branch_message_id: conversation.active_branch_message_id,
    }));
  }

  async deleteSession(key: string): Promise<{ ok: boolean }> {
    const conversation = await api.getAgentConversation(key);
    return api.archiveAgentConversation(key, conversation.version, true);
  }

  async renameSession(key: string, title: string): Promise<{ ok: boolean; title: string }> {
    const conversation = await api.getAgentConversation(key);
    await api.updateAgentConversation({
      conversation_id: key,
      expected_version: conversation.version,
      title,
    });
    return { ok: true, title };
  }

  async smartRenameSession(key: string): Promise<{ ok: boolean; title: string }> {
    const messages = await api.listAgentConversationMessages({ conversation_id: key, limit: 200 });
    const title = messages.messages[messages.messages.length - 1]?.content?.trim().slice(0, 28) || 'New Chat';
    return this.renameSession(key, title);
  }

  async getMessages(sessionKey: string): Promise<Message[]> {
    const result = await api.listAgentConversationMessages({ conversation_id: sessionKey, limit: 200 });
    return result.messages.map((message) => ({
      id: message.message_id,
      role: message.role,
      content: message.content,
      created_at: message.created_at,
      updated_at: message.updated_at,
    }));
  }

}

export const chatService = new ChatService();
