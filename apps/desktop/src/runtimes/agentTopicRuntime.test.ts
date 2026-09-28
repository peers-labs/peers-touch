import { beforeEach, describe, expect, it, vi } from 'vitest';

const selectedAgent = vi.hoisted(() => ({
  id: 'agent-canonical-id',
  name: 'Agent Display Name',
}));

const agentState = vi.hoisted(() => ({
  agents: [selectedAgent],
  selectedAgent: selectedAgent.name,
}));

const currentSession = vi.hoisted(() => ({
  id: 'current-session',
  key: 'current-session',
  agent_name: selectedAgent.id,
  title: 'Current session',
  message_count: 1,
  created_at: '2026-08-28T00:00:00.000Z',
  updated_at: '2026-08-28T00:00:00.000Z',
}));

const firstTopic = vi.hoisted(() => ({
  id: 'first-topic',
  key: 'first-topic',
  agent_name: selectedAgent.id,
  title: 'First topic',
  message_count: 0,
  created_at: '2026-08-27T00:00:00.000Z',
  updated_at: '2026-08-27T00:00:00.000Z',
  titleState: 'manual' as const,
}));

const loadTopicsForAgent = vi.hoisted(() => vi.fn());
const mergeSessions = vi.hoisted(() => vi.fn());
const bootstrapSession = vi.hoisted(() => vi.fn());
const syncMessages = vi.hoisted(() => vi.fn());
const syncTurnQueue = vi.hoisted(() => vi.fn());
const selectSession = vi.hoisted(() => vi.fn());
const ensureDraftTopic = vi.hoisted(() => vi.fn());

vi.mock('../store/agent', () => ({
  useAgentStore: {
    getState: () => agentState,
    subscribe: vi.fn(),
  },
}));

vi.mock('../store/agentTopics', () => ({
  useAgentTopicStore: {
    getState: () => ({
      loadTopicsForAgent,
      ensureDraftTopic,
      resetProjection: vi.fn(),
      upsertTopics: vi.fn(),
    }),
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => ({
      sessions: [currentSession],
      currentSessionKey: currentSession.key,
      mergeSessions,
      bootstrapSession,
      syncMessages,
      syncTurnQueue,
      selectSession,
      newSession: vi.fn(),
    }),
  },
}));

vi.mock('../store/sessionGroups', () => ({
  useSessionGroupStore: {
    getState: () => ({ loadGroups: vi.fn() }),
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
  },
}));

import { agentTopicRuntime } from './agentTopicRuntime';

describe('agentTopicRuntime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    loadTopicsForAgent.mockResolvedValue([firstTopic]);
    bootstrapSession.mockResolvedValue(undefined);
    syncMessages.mockResolvedValue(undefined);
    syncTurnQueue.mockResolvedValue(undefined);
    selectSession.mockResolvedValue(undefined);
    ensureDraftTopic.mockReturnValue(firstTopic);
  });

  it('preserves and synchronizes the current canonical Agent session during reconcile', async () => {
    await agentTopicRuntime.reconcile?.('test');

    expect(loadTopicsForAgent).toHaveBeenCalledWith(selectedAgent.id, 'test');
    expect(mergeSessions).toHaveBeenCalledWith([firstTopic]);
    expect(bootstrapSession).toHaveBeenCalledOnce();
    expect(syncMessages).toHaveBeenCalledOnce();
    expect(syncTurnQueue).toHaveBeenCalledWith(currentSession.key);
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('does not create a draft when authoritative topic loading fails', async () => {
    loadTopicsForAgent.mockRejectedValueOnce(new Error('station unavailable'));

    await expect(agentTopicRuntime.reconcile?.('retry')).resolves.toBeUndefined();

    expect(mergeSessions).not.toHaveBeenCalled();
    expect(ensureDraftTopic).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
  });
});
