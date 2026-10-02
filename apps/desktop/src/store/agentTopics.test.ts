import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAgentSessions = vi.hoisted(() => vi.fn());

vi.mock('../services/chat-service', () => ({
  chatService: {
    listAgentSessions,
  },
}));

vi.mock('../i18n/index', () => ({
  resolveI18nValue: (value: string) => value,
}));

vi.mock('./agent', () => ({
  useAgentStore: {
    getState: () => ({ agents: [], selectedAgent: '' }),
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
  },
}));

import { useAgentTopicStore } from './agentTopics';

const acceptedTopic = {
  id: 'topic',
  key: 'topic',
  agent_name: 'agent-1',
  title: 'Accepted topic',
  message_count: 1,
  created_at: '2026-09-28T00:00:00.000Z',
  updated_at: '2026-09-28T00:00:00.000Z',
  titleState: 'manual' as const,
};

describe('agentTopics authoritative load failure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAgentTopicStore.getState().resetProjection();
    useAgentTopicStore.setState({
      topicsByAgentId: { 'agent-1': [acceptedTopic] },
    });
  });

  it('preserves accepted topics and exposes a retryable per-Agent error', async () => {
    const unavailableError = new Error('station unavailable');
    listAgentSessions.mockRejectedValueOnce(unavailableError);

    await expect(
      useAgentTopicStore.getState().loadTopicsForAgent('agent-1', 'test'),
    ).rejects.toThrow('station unavailable');

    expect(useAgentTopicStore.getState().topicsByAgentId['agent-1']).toEqual([
      acceptedTopic,
    ]);
    expect(useAgentTopicStore.getState().loadErrorsByAgentId['agent-1'])
      .toMatchObject({
        message: 'station unavailable',
        reason: 'test',
        retryable: true,
      });
  });
});
