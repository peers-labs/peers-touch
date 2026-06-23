import { create } from 'zustand';
import { chatService, type Message } from '../services/chat-service';
import type { AgentTopic } from './agentTopics';
import { log } from '../utils/logger';

export interface AgentMessageSearchResult {
  id: string;
  topicKey: string;
  topicTitle: string;
  messageId: string;
  role: string;
  snippet: string;
  createdAt: string;
}

interface AgentSearchState {
  query: string;
  searching: boolean;
  results: AgentMessageSearchResult[];
  lastError?: string;
  searchAgentMessages: (query: string, topics: AgentTopic[]) => Promise<void>;
  resetSearch: () => void;
}

const MAX_TOPICS_TO_SCAN = 50;
const MAX_RESULTS = 40;
const SNIPPET_RADIUS = 48;

function buildSnippet(content: string, query: string): string {
  const lowerContent = content.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const matchIndex = lowerContent.indexOf(lowerQuery);
  if (matchIndex < 0) return content.slice(0, SNIPPET_RADIUS * 2);
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + query.length + SNIPPET_RADIUS);
  const prefix = start > 0 ? '...' : '';
  const suffix = end < content.length ? '...' : '';
  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function matchMessages(query: string, topic: AgentTopic, messages: Message[]): AgentMessageSearchResult[] {
  const lowerQuery = query.toLowerCase();
  return messages
    .filter((message) => message.content.toLowerCase().includes(lowerQuery))
    .map((message) => ({
      id: `${topic.key}:${message.id}`,
      topicKey: topic.key,
      topicTitle: topic.title,
      messageId: message.id,
      role: message.role,
      snippet: buildSnippet(message.content, query),
      createdAt: message.created_at,
    }));
}

export const useAgentSearchStore = create<AgentSearchState>((set) => ({
  query: '',
  searching: false,
  results: [],

  searchAgentMessages: async (query: string, topics: AgentTopic[]) => {
    const normalized = query.trim();
    set({ query: normalized, lastError: undefined });
    if (normalized.length < 2) {
      set({ searching: false, results: [] });
      return;
    }

    set({ searching: true, results: [] });
    try {
      const scannedTopics = topics.slice(0, MAX_TOPICS_TO_SCAN);
      const settled = await Promise.allSettled(
        scannedTopics.map(async (topic) => {
          const messages = await chatService.getMessages(topic.key);
          return matchMessages(normalized, topic, messages);
        }),
      );
      const results = settled
        .flatMap((item) => (item.status === 'fulfilled' ? item.value : []))
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
        .slice(0, MAX_RESULTS);
      set({ searching: false, results });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error('agentSearch', 'failed to search agent messages', { query: normalized, error: message });
      set({ searching: false, results: [], lastError: message });
    }
  },

  resetSearch: () => set({ query: '', searching: false, results: [], lastError: undefined }),
}));
