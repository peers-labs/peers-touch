import {
  streamChat,
  api,
  type Session,
  type Message,
  type StreamEvent,
  type ChatImageInput,
} from './desktop_api';

export type { Session, Message, StreamEvent, ChatImageInput };

export class ChatService {
  async listSessions(): Promise<Session[]> {
    return api.listSessions();
  }

  async listAgentSessions(agentId: string): Promise<Session[]> {
    return api.listAgentSessions(agentId);
  }

  async deleteSession(key: string): Promise<{ ok: boolean }> {
    return api.deleteSession(key);
  }

  async renameSession(key: string, title: string): Promise<{ ok: boolean; title: string }> {
    return api.renameSession(key, title);
  }

  async duplicateSession(key: string): Promise<{ ok: boolean; conversationId: string }> {
    return api.duplicateSession(key);
  }

  async smartRenameSession(key: string): Promise<{ ok: boolean; title: string }> {
    return api.smartRenameSession(key);
  }

  async setSessionModel(key: string, model: string): Promise<{ ok: boolean; model: string }> {
    return api.setSessionModel(key, model);
  }

  async getMessages(sessionKey: string): Promise<Message[]> {
    return api.getMessages(sessionKey);
  }

  async deleteMessage(id: string): Promise<{ ok: boolean }> {
    return api.deleteMessage(id);
  }

  async updateMessage(id: string, content: string): Promise<{ ok: boolean }> {
    return api.updateMessage(id, content);
  }

  async stop(sessionKey: string): Promise<{ ok: boolean; stopped: boolean }> {
    return api.stopChat(sessionKey);
  }

  stream(
    message: string,
    sessionKey: string,
    agentName: string,
    onEvent: (event: StreamEvent) => void,
    onDone: () => void,
    onError: (err: Error) => void,
    images?: ChatImageInput[],
    model?: string,
    providerId?: string,
  ): AbortController {
    return streamChat(message, sessionKey, agentName, onEvent, onDone, onError, images, model, providerId);
  }
}

export const chatService = new ChatService();
