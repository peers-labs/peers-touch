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
}));
const chatState = vi.hoisted(() => ({
  currentSessionKey: 'previous-conversation',
  mergeSessions: vi.fn(),
  selectSession: vi.fn(),
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

import { openAgentChatSession } from './openAgentChatSession';

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
});
