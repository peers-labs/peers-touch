import { create } from '@bufbuild/protobuf';
import { timestampFromDate } from '@bufbuild/protobuf/wkt';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HomeTaskStatus,
  HomeWorkProjectionSchema,
} from '../gen/proto/domain/agent/home_pb';

const getHomeWorkProjection = vi.hoisted(() => vi.fn());

vi.mock('../services/desktop_api', () => ({
  api: {
    getHomeWorkProjection,
  },
}));

vi.mock('../utils/logger', () => ({
  log: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import {
  homeTaskProjectionToTask,
  useTaskStore,
} from './tasks';

function projection(
  revision: bigint,
  taskId: string,
  status: HomeTaskStatus,
) {
  return create(HomeWorkProjectionSchema, {
    ptid: 'ptid:actor-1',
    revision,
    activeTasks: [{
      taskId,
      title: taskId,
      agentId: 'agent-1',
      status,
      updatedAt: timestampFromDate(new Date(Number(revision))),
    }],
  });
}

describe('canonical TaskRun store', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTaskStore.setState({
      tasks: [],
      activeTaskId: null,
      sourcePtid: '',
      sourceRevision: 0n,
    });
  });

  it('maps paused TaskRuns to needs_user and unknown statuses to unavailable', () => {
    const needsUserProjection = projection(
      1n,
      'task-needs-user',
      HomeTaskStatus.NEEDS_USER,
    );
    const unavailableProjection = projection(
      2n,
      'task-unavailable',
      HomeTaskStatus.UNSPECIFIED,
    );

    expect(homeTaskProjectionToTask(
      needsUserProjection.activeTasks[0],
      needsUserProjection,
    ).status).toBe('needs_user');
    expect(homeTaskProjectionToTask(
      unavailableProjection.activeTasks[0],
      unavailableProjection,
    ).status).toBe('unavailable');
  });

  it('keeps the newest Station revision when a stale readback arrives', async () => {
    getHomeWorkProjection
      .mockResolvedValueOnce(projection(9n, 'task-newest', HomeTaskStatus.RUNNING))
      .mockResolvedValueOnce(projection(8n, 'task-stale', HomeTaskStatus.COMPLETED));

    await useTaskStore.getState().loadTasks();
    await useTaskStore.getState().loadTasks();

    expect(getHomeWorkProjection).toHaveBeenNthCalledWith(1, 0n);
    expect(getHomeWorkProjection).toHaveBeenNthCalledWith(2, 9n);
    expect(useTaskStore.getState()).toMatchObject({
      sourceRevision: 9n,
      tasks: [{
        id: 'task-newest',
        status: 'running',
      }],
    });
  });

  it('accepts a lower Station revision after the actor changes', async () => {
    getHomeWorkProjection
      .mockResolvedValueOnce(projection(9n, 'task-actor-1', HomeTaskStatus.RUNNING))
      .mockResolvedValueOnce(create(HomeWorkProjectionSchema, {
        ...projection(1n, 'task-actor-2', HomeTaskStatus.PENDING),
        ptid: 'ptid:actor-2',
      }));

    await useTaskStore.getState().loadTasks();
    await useTaskStore.getState().loadTasks();

    expect(useTaskStore.getState()).toMatchObject({
      sourcePtid: 'ptid:actor-2',
      sourceRevision: 1n,
      tasks: [{
        id: 'task-actor-2',
        status: 'pending',
      }],
    });
  });
});
