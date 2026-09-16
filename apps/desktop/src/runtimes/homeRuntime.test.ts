import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HomeWorkKind,
  HomeWorkProjectionSchema,
} from '../gen/proto/domain/agent/home_pb';

const getHomeWorkProjection = vi.hoisted(() => vi.fn());
const loadAgents = vi.hoisted(() => vi.fn());
const setAgentSurface = vi.hoisted(() => vi.fn());
const setSelectedAgent = vi.hoisted(() => vi.fn());
const selectSession = vi.hoisted(() => vi.fn());
const applyProjection = vi.hoisted(() => vi.fn());
const beginLoad = vi.hoisted(() => vi.fn());
const failLoad = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());

const agentState = {
  agents: [{ id: 'agent-1', name: 'researcher' }],
  loadAgents,
  setAgentSurface,
  setSelectedAgent,
};

const homeState = {
  projection: null,
  beginLoad,
  applyProjection,
  failLoad,
  reset,
};

vi.mock('../services/desktop_api', () => ({
  api: { getHomeWorkProjection },
}));

vi.mock('../store/agent', () => ({
  useAgentStore: {
    getState: () => agentState,
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../store/agentTopics', () => ({
  useAgentTopicStore: {
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => ({ selectSession }),
  },
}));

vi.mock('../store/home', () => ({
  useHomeStore: {
    getState: () => homeState,
  },
}));

vi.mock('../kernel/events/bus', () => ({
  eventBus: {
    subscribe: vi.fn(() => vi.fn()),
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  homeRuntime,
  openHomeConversation,
} from './homeRuntime';

describe('homeRuntime', () => {
  beforeEach(() => {
    homeRuntime.teardown();
    vi.clearAllMocks();
    loadAgents.mockResolvedValue(undefined);
    selectSession.mockResolvedValue(undefined);
    getHomeWorkProjection.mockResolvedValue(create(HomeWorkProjectionSchema, {
      ptid: 'ptid:actor-1',
      revision: 7n,
    }));
  });

  it('loads the Station projection during actor bootstrap', async () => {
    homeRuntime.install();

    await homeRuntime.bootstrap('ptid:actor-1');

    expect(beginLoad).toHaveBeenCalledOnce();
    expect(loadAgents).toHaveBeenCalledOnce();
    expect(getHomeWorkProjection).toHaveBeenCalledWith(0n);
    expect(applyProjection).toHaveBeenCalledWith(
      expect.objectContaining({ ptid: 'ptid:actor-1', revision: 7n }),
      { 'agent-1': 'researcher' },
    );
  });

  it('opens the exact Station conversation for its owning Agent', async () => {
    await openHomeConversation({
      workId: 'conversation-1',
      kind: HomeWorkKind.CHAT,
      agentId: 'agent-1',
      agentName: 'researcher',
      title: 'Recent work',
      updatedAt: '2026-09-16T00:00:00.000Z',
    });

    expect(setAgentSurface).toHaveBeenCalledWith('researcher', 'chat');
    expect(setSelectedAgent).toHaveBeenCalledWith('researcher');
    expect(selectSession).toHaveBeenCalledWith('conversation-1');
  });
});
