import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Agent } from './desktop_api';

const agentState = vi.hoisted(() => ({
  selectedAgent: 'previous-agent',
  setAgentSurface: vi.fn(),
  setSelectedAgent: vi.fn((name: string) => {
    agentState.selectedAgent = name;
  }),
}));
const topicState = vi.hoisted(() => ({
  topics: [] as Array<Record<string, unknown>>,
  getTopicsForAgent: vi.fn(() => topicState.topics),
  loadTopicsForAgent: vi.fn(),
  createDraftTopic: vi.fn(),
  ensureDraftTopic: vi.fn(),
  upsertTopics: vi.fn(),
}));
const chatState = vi.hoisted(() => ({
  currentSessionKey: 'previous-conversation',
  mergeSessions: vi.fn(),
  selectSession: vi.fn(),
}));
const agentApi = vi.hoisted(() => ({
  createAgentConversation: vi.fn(),
}));

vi.mock('../services/desktop_api', () => ({
  api: agentApi,
}));

vi.mock('../store/agent', () => ({
  useAgentStore: {
    getState: () => agentState,
  },
}));

vi.mock('../store/agentTopics', () => ({
  useAgentTopicStore: {
    getState: () => topicState,
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => chatState,
  },
}));

import {
  createStationAgentTopic,
  openAgentChatSession,
} from './openAgentChatSession';

const agent = {
  id: 'agent-2',
  name: 'agent-two',
  title: 'Agent Two',
} as Agent;
const draft = {
  id: 'agent-draft:agent-2:test',
  key: 'agent-draft:agent-2:test',
  agent_name: agent.name,
  title: agent.title,
};

describe('openAgentChatSession load failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    agentState.selectedAgent = 'previous-agent';
    topicState.topics = [];
    topicState.loadTopicsForAgent.mockRejectedValue(
      new Error('station unavailable'),
    );
    topicState.ensureDraftTopic.mockReturnValue(draft);
    chatState.currentSessionKey = 'previous-conversation';
    chatState.selectSession.mockResolvedValue(undefined);
    agentApi.createAgentConversation.mockResolvedValue({
      conversation_id: 'conversation-new',
      agent_id: agent.id,
      ptid: 'ptid:actor-1',
      title: 'New Chat',
      status: 'active',
      active_branch_message_id: '',
      queued_turn_count: 0,
      version: 1,
      created_at: '2026-10-20T00:00:00Z',
      updated_at: '2026-10-20T00:00:00Z',
    });
  });

  it('moves the selected Agent to a local draft instead of showing another Agent session', async () => {
    await expect(
      openAgentChatSession(agent, { reason: 'test' }),
    ).rejects.toThrow('station unavailable');

    expect(topicState.ensureDraftTopic).toHaveBeenCalledWith(
      agent.id,
      agent.name,
      agent.title,
    );
    expect(chatState.mergeSessions).toHaveBeenCalledWith([draft]);
    expect(chatState.selectSession).toHaveBeenCalledWith(draft.key, draft);
  });

  it('keeps an accepted topic when a forced refresh fails', async () => {
    const accepted = {
      ...draft,
      id: 'topic',
      key: 'topic',
    };
    topicState.topics = [accepted];

    await expect(
      openAgentChatSession(agent, { forceReload: true, reason: 'retry' }),
    ).rejects.toThrow('station unavailable');

    expect(topicState.ensureDraftTopic).not.toHaveBeenCalled();
    expect(chatState.mergeSessions).toHaveBeenCalledWith([accepted]);
    expect(chatState.selectSession).toHaveBeenCalledWith(
      accepted.key,
      accepted,
    );
  });

  it('creates /clear topics through Station before selecting them', async () => {
    const topic = await createStationAgentTopic(agent, 'New Chat');

    expect(agentApi.createAgentConversation).toHaveBeenCalledWith({
      agent_id: agent.id,
      title: 'New Chat',
    });
    expect(topic.key).toBe('conversation-new');
    expect(topicState.upsertTopics).toHaveBeenCalledWith(agent.id, [topic]);
    expect(chatState.mergeSessions).toHaveBeenCalledWith([topic]);
    expect(chatState.selectSession).toHaveBeenCalledWith(topic.key, topic);
  });
});
