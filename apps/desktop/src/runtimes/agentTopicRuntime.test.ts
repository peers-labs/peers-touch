import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
const subscribe = vi.hoisted(() => vi.fn());

vi.mock('../store/agent', () => ({
  useAgentStore: {
    getState: () => agentState,
    subscribe,
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
    agentState.agents = [selectedAgent];
    agentState.selectedAgent = selectedAgent.name;
    loadTopicsForAgent.mockResolvedValue([firstTopic]);
    bootstrapSession.mockResolvedValue(undefined);
    syncMessages.mockResolvedValue(undefined);
    syncTurnQueue.mockResolvedValue(undefined);
    selectSession.mockResolvedValue(undefined);
    ensureDraftTopic.mockReturnValue(firstTopic);
  });

  afterEach(() => {
    agentTopicRuntime.teardown?.();
  });

  it('preserves and synchronizes the current canonical Agent session during reconcile', async () => {
    await agentTopicRuntime.reconcile?.('test');

    expect(loadTopicsForAgent).toHaveBeenCalledWith(selectedAgent.id, 'test');
    expect(mergeSessions).toHaveBeenCalledWith([firstTopic]);
    expect(bootstrapSession).not.toHaveBeenCalled();
    expect(syncMessages).toHaveBeenCalledOnce();
    expect(syncTurnQueue).toHaveBeenCalledWith(currentSession.key);
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('bootstraps the cached history only on cold entry', async () => {
    await agentTopicRuntime.bootstrap('actor');
    expect(bootstrapSession).toHaveBeenCalledOnce();
    expect(syncMessages).toHaveBeenCalledOnce();
  });

  it('coalesces concurrent topic reconciliation into one authoritative history read', async () => {
    let accept!: (topics: typeof firstTopic[]) => void;
    loadTopicsForAgent.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const first = agentTopicRuntime.reconcile?.('periodic');
    const second = agentTopicRuntime.reconcile?.('agent-selection');
    accept([firstTopic]);
    await Promise.all([first, second]);
    expect(loadTopicsForAgent).toHaveBeenCalledOnce();
    expect(syncMessages).toHaveBeenCalledOnce();
    expect(bootstrapSession).not.toHaveBeenCalled();
  });

  it('does not create a draft when authoritative topic loading fails', async () => {
    const unavailableError = new Error('station unavailable');
    loadTopicsForAgent.mockRejectedValueOnce(unavailableError);

    await expect(agentTopicRuntime.reconcile?.('retry')).resolves.toBeUndefined();

    expect(mergeSessions).not.toHaveBeenCalled();
    expect(ensureDraftTopic).not.toHaveBeenCalled();
    expect(selectSession).not.toHaveBeenCalled();
  });

  it('does not reload history when selected Agent metadata changes', () => {
    agentTopicRuntime.install?.();
    const listener = subscribe.mock.calls[0][0];
    listener(
      { ...agentState, agents: [{ ...selectedAgent, title: 'Updated by Station' }] },
      agentState,
    );
    expect(loadTopicsForAgent).not.toHaveBeenCalled();
  });

  it('discards a pending topic read after runtime teardown', async () => {
    let accept!: (topics: typeof firstTopic[]) => void;
    loadTopicsForAgent.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const pending = agentTopicRuntime.reconcile?.('periodic');
    agentTopicRuntime.teardown?.();
    accept([firstTopic]);
    await pending;
    expect(mergeSessions).not.toHaveBeenCalled();
    expect(syncMessages).not.toHaveBeenCalled();
  });

  it('discards a pending topic read after the selected Agent changes', async () => {
    let accept!: (topics: typeof firstTopic[]) => void;
    loadTopicsForAgent.mockReturnValueOnce(new Promise((resolve) => { accept = resolve; }));
    const pending = agentTopicRuntime.reconcile?.('periodic');
    agentState.selectedAgent = 'another Agent';
    accept([firstTopic]);
    await pending;
    expect(mergeSessions).not.toHaveBeenCalled();
    expect(syncMessages).not.toHaveBeenCalled();
  });
});
