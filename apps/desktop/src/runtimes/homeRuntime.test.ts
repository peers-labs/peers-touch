import { create } from '@bufbuild/protobuf';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HomeWorkKind,
  HomeWorkProjectionSchema,
} from '../gen/proto/domain/agent/home_pb';

const getHomeWorkProjection = vi.hoisted(() => vi.fn());
const submitHomeChatCommand = vi.hoisted(() => vi.fn());
const submitHomeTaskCommand = vi.hoisted(() => vi.fn());
const setAgentSurface = vi.hoisted(() => vi.fn());
const setSelectedAgent = vi.hoisted(() => vi.fn());
const selectSession = vi.hoisted(() => vi.fn());
const setActiveTask = vi.hoisted(() => vi.fn());
const applyProjection = vi.hoisted(() => vi.fn());
const beginLoad = vi.hoisted(() => vi.fn());
const failLoad = vi.hoisted(() => vi.fn());
const reset = vi.hoisted(() => vi.fn());

const agentState = {
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
  api: {
    getHomeWorkProjection,
    submitHomeChatCommand,
    submitHomeTaskCommand,
  },
}));

vi.mock('../store/agent', () => ({
  useAgentStore: {
    getState: () => agentState,
  },
}));

vi.mock('../store/chat', () => ({
  useChatStore: {
    getState: () => ({ selectSession }),
  },
}));

vi.mock('../store/tasks', () => ({
  useTaskStore: {
    getState: () => ({ setActiveTask }),
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
  submitHomeChat,
  submitHomeTask,
} from './homeRuntime';

describe('homeRuntime', () => {
  beforeEach(() => {
    homeRuntime.teardown();
    vi.clearAllMocks();
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
    expect(getHomeWorkProjection).toHaveBeenCalledWith(0n);
    expect(applyProjection).toHaveBeenCalledWith(
      expect.objectContaining({ ptid: 'ptid:actor-1', revision: 7n }),
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

  it('submits Home Chat with the projected Agent revision and readiness', async () => {
    submitHomeChatCommand.mockResolvedValue({
      conversationId: 'conversation-1',
      turnId: 'turn-1',
      projectionRevision: 8n,
    });

    const work = await submitHomeChat({
      agentId: 'agent-1',
      agentName: 'researcher',
      displayName: 'Researcher',
      avatarRef: '',
      readinessSnapshotId: 'readiness-1',
      agentVersion: 3n,
      providerId: 'provider-1',
      modelId: 'model-1',
    }, 'Compare recovery models', 'home-chat-key');

    expect(submitHomeChatCommand).toHaveBeenCalledWith(expect.objectContaining({
      agentId: 'agent-1',
      input: 'Compare recovery models',
      clientIdempotencyKey: 'home-chat-key',
      expectedAgentVersion: 3n,
      readinessSnapshotId: 'readiness-1',
    }));
    expect(work.workId).toBe('conversation-1');
  });

  it('selects the exact task after Station accepts Task mode', async () => {
    submitHomeTaskCommand.mockResolvedValue({
      taskId: 'task-1',
      projectionRevision: 8n,
    });

    const taskId = await submitHomeTask({
      agentId: 'agent-1',
      agentName: 'researcher',
      displayName: 'Researcher',
      avatarRef: '',
      readinessSnapshotId: 'readiness-1',
      agentVersion: 3n,
      providerId: 'provider-1',
      modelId: 'model-1',
    }, 'Prepare the launch brief', 'home-task-key');

    expect(taskId).toBe('task-1');
    expect(setActiveTask).toHaveBeenCalledWith('task-1');
  });
});
