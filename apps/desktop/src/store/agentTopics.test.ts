import { beforeEach, describe, expect, it, vi } from 'vitest';

const listAgentSessions = vi.hoisted(() => vi.fn());
const getAgentConversation = vi.hoisted(() => vi.fn());
const updateAgentConversation = vi.hoisted(() => vi.fn());
const deleteSessions = vi.hoisted(() => vi.fn());

vi.mock('../services/desktop_api', () => ({
  api: { getAgentConversation, updateAgentConversation },
}));

vi.mock('../services/chat-service', () => ({
  chatService: {
    listAgentSessions,
    deleteSessions,
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

  it('preserves all topics on batch rejection and preserves concurrent unrelated changes', async () => {
    let reject!: (error: Error) => void;
    deleteSessions.mockReturnValueOnce(new Promise((_, fail) => { reject = fail; }));
    const pending = useAgentTopicStore.getState().deleteTopics([acceptedTopic.key, 'second']);
    useAgentTopicStore.getState().upsertTopics('other', [{
      ...acceptedTopic, id: 'unrelated', key: 'unrelated', agent_name: 'other',
    }]);
    reject(new Error('active dependency'));
    await expect(pending).rejects.toThrow('active dependency');
    expect(useAgentTopicStore.getState().topicsByAgentId['agent-1']).toHaveLength(1);
    expect(useAgentTopicStore.getState().topicsByAgentId.other[0].key).toBe('unrelated');
    expect(deleteSessions).toHaveBeenCalledOnce();
    expect(deleteSessions).toHaveBeenCalledWith([acceptedTopic.key, 'second']);
  });

  it('removes selected topics only after one successful batch command', async () => {
    deleteSessions.mockResolvedValueOnce({ ok: true });
    await useAgentTopicStore.getState().deleteTopics([acceptedTopic.key]);
    expect(useAgentTopicStore.getState().topicsByAgentId['agent-1']).toHaveLength(0);
  });

  it('does not resurrect deleted Agent topics when an older load completes', async () => {
    let accept!: (value: typeof acceptedTopic[]) => void;
    listAgentSessions.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const pending = useAgentTopicStore.getState().loadTopicsForAgent('agent-1', 'deletion-race');
    await vi.waitFor(() => expect(listAgentSessions).toHaveBeenCalledOnce());
    useAgentTopicStore.setState({
      loadErrorsByAgentId: { 'agent-1': {
        message: 'previous failure', reason: 'test', failedAt: '', retryable: true,
      } },
      generatingTitleKeys: { topic: true },
      titleHistoryByKey: { topic: {
        previousTitle: '', generatedTitle: 'old title', generatedAt: '',
      } },
    });
    useAgentTopicStore.getState().discardAgentProjection('agent-1');
    accept([acceptedTopic]);
    await expect(pending).resolves.toEqual([]);
    const state = useAgentTopicStore.getState();
    expect(state.topicsByAgentId['agent-1']).toBeUndefined();
    expect(state.loadingAgentIds['agent-1']).toBeUndefined();
    expect(state.loadErrorsByAgentId['agent-1']).toBeUndefined();
    expect(state.generatingTitleKeys.topic).toBeUndefined();
    expect(state.titleHistoryByKey.topic).toBeUndefined();
    expect(state.activeAgentId).toBe('');
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

  it('commits a composite Topic override without writing an Agent profile', async () => {
    getAgentConversation.mockResolvedValueOnce({ version: 4 });
    updateAgentConversation.mockResolvedValueOnce({});
    await useAgentTopicStore.getState().setTopicModel('topic', 'default', 'cli-two');
    expect(updateAgentConversation).toHaveBeenCalledWith({
      conversation_id: 'topic', expected_version: 4,
      model_name: 'default', provider_id: 'cli-two',
    });
    expect(useAgentTopicStore.getState().getTopicsForAgent('agent-1')[0])
      .toMatchObject({ model_override: 'default', provider_override: 'cli-two' });
  });

  it('preserves the accepted override when authority rejects a mutation', async () => {
    useAgentTopicStore.setState({
      topicsByAgentId: { 'agent-1': [{
        ...acceptedTopic, model_override: 'default', provider_override: 'cli-one',
      }] },
    });
    getAgentConversation.mockResolvedValueOnce({ version: 4 });
    updateAgentConversation.mockRejectedValueOnce(new Error('version conflict'));
    await expect(useAgentTopicStore.getState().setTopicModel('topic', 'default', 'cli-two'))
      .rejects.toThrow('version conflict');
    expect(useAgentTopicStore.getState().getTopicsForAgent('agent-1')[0])
      .toMatchObject({ model_override: 'default', provider_override: 'cli-one' });
  });

  it('rejects incomplete identities before accessing authority', async () => {
    await expect(useAgentTopicStore.getState().setTopicModel('topic', 'default', ''))
      .rejects.toThrow('both Provider and model');
    expect(getAgentConversation).not.toHaveBeenCalled();
  });

  it('rejects a vanished Topic before mutating Station', async () => {
    await expect(useAgentTopicStore.getState().setTopicModel('missing', 'default', 'cli-one'))
      .rejects.toThrow('no longer available');
    expect(getAgentConversation).not.toHaveBeenCalled();
  });

  it('keeps concurrent changes to one Topic behind the same authority mutation', async () => {
    let accept!: (value: object) => void;
    getAgentConversation.mockResolvedValueOnce({ version: 4 });
    updateAgentConversation.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const first = useAgentTopicStore.getState().setTopicModel('topic', 'default', 'cli-one');
    await vi.waitFor(() => expect(updateAgentConversation).toHaveBeenCalledTimes(1));
    await expect(useAgentTopicStore.getState().setTopicModel('topic', 'default', 'cli-two'))
      .rejects.toThrow('already being saved');
    accept({});
    await first;
    expect(useAgentTopicStore.getState().getTopicsForAgent('agent-1')[0])
      .toMatchObject({ model_override: 'default', provider_override: 'cli-one' });
  });
});
