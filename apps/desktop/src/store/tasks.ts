// Task store — writes through the task command API and reads lifecycle only
// from the canonical Home TaskRun projection.

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { api } from '../services/desktop_api';
import type { HomeTaskProjection, HomeWorkProjection } from '../gen/proto/domain/agent/home_pb';
import {
  normalizeHomeTaskRunStatus,
  type TaskRunLifecycleStatus,
} from './home';

export type TaskStatus = TaskRunLifecycleStatus;
export type TaskPriority = 'low' | 'medium' | 'high';
type TaskMutationStatus =
  | 'running'
  | 'paused'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface AgentSubtask {
  id: string;
  title: string;
  status: 'pending' | 'completed' | 'failed';
  completedAt?: number;
}

export interface AgentTask {
  id: string;
  title: string;
  description: string;
  agentId: string;
  status: TaskStatus;
  priority: TaskPriority;
  progress: number;
  subtasks: AgentSubtask[];
  topicKey?: string;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  result?: string;
  error?: string;
}

export interface TaskCreateInput {
  title: string;
  description: string;
  agentId: string;
  priority: TaskPriority;
  topicKey?: string;
}

interface TaskState {
  tasks: AgentTask[];
  activeTaskId: string | null;
  sourcePtid: string;
  sourceRevision: bigint;

  loadTasks: () => Promise<void>;
  createTask: (input: TaskCreateInput) => Promise<void>;
  deleteTask: (taskId: string) => Promise<void>;
  startTask: (taskId: string) => Promise<void>;
  pauseTask: (taskId: string) => Promise<void>;
  cancelTask: (taskId: string) => Promise<void>;
  completeTask: (taskId: string, result?: string) => Promise<void>;
  failTask: (taskId: string, error: string) => Promise<void>;
  addSubtask: (taskId: string, title: string) => Promise<void>;
  completeSubtask: (taskId: string, subtaskId: string) => Promise<void>;
  setActiveTask: (taskId: string | null) => void;
  getTasksForAgent: (agentId: string) => AgentTask[];
  getActiveTasks: () => AgentTask[];
}

function timestampToMillis(
  value: HomeTaskProjection['updatedAt'],
): number {
  if (!value) return 0;
  return Number(value.seconds) * 1_000 + Math.floor(value.nanos / 1_000_000);
}

export function homeTaskProjectionToTask(
  task: HomeTaskProjection,
  projection: HomeWorkProjection,
): AgentTask {
  const status = normalizeHomeTaskRunStatus(task.status);
  const summary = projection.briefItems.find(
    (item) => item.sourceRef === task.taskId,
  )?.summary;
  const updatedAt = timestampToMillis(task.updatedAt);
  return {
    id: task.taskId,
    title: task.title,
    description: '',
    agentId: task.agentId,
    status,
    priority: 'medium',
    progress: task.progressPercent,
    subtasks: [],
    topicKey: task.topicRef || undefined,
    createdAt: updatedAt,
    updatedAt,
    completedAt:
      status === 'completed' || status === 'failed' || status === 'cancelled'
        ? updatedAt
        : undefined,
    result: status === 'completed' ? summary : undefined,
    error: status === 'failed' ? summary : undefined,
  };
}

export const useTaskStore = createDesktopStore<TaskState>('tasks', (set, get) => {
  // Drive a Station status transition then refresh the list from Station truth.
  const transitionStatus = async (
    taskId: string,
    status: TaskMutationStatus,
    extra?: { result?: string; error?: string },
  ) => {
    try {
      await api.updateAgentTaskStatusRemote({
        id: taskId,
        status,
        result: extra?.result,
        error: extra?.error,
      });
      await get().loadTasks();
      log.info('tasks', 'Task status updated', { taskId, status });
    } catch (error) {
      log.error('tasks', 'Failed to update task status', { taskId, status, error });
    }
  };

  return {
    tasks: [],
    activeTaskId: null,
    sourcePtid: '',
    sourceRevision: 0n,

    loadTasks: async () => {
      try {
        const sourcePtid = get().sourcePtid;
        const sourceRevision = get().sourceRevision;
        const projection = await api.getHomeWorkProjection(sourceRevision);
        if (
          projection.ptid === sourcePtid &&
          projection.revision < sourceRevision
        ) {
          log.warn('tasks', 'Ignored stale Station task projection', {
            acceptedRevision: sourceRevision.toString(),
            receivedRevision: projection.revision.toString(),
          });
          return;
        }
        const tasks = projection.activeTasks.map((task) =>
          homeTaskProjectionToTask(task, projection)
        );
        set({
          tasks,
          sourcePtid: projection.ptid,
          sourceRevision: projection.revision,
        });
        log.info('tasks', 'Canonical TaskRuns loaded from Station', {
          count: tasks.length,
          revision: projection.revision.toString(),
        });
      } catch (error) {
        log.error('tasks', 'Failed to load canonical TaskRuns from Station', { error });
      }
    },

    createTask: async (input: TaskCreateInput) => {
      try {
        await api.createAgentTaskRemote({
          title: input.title,
          description: input.description,
          agent_id: input.agentId,
          priority: input.priority,
          topic_key: input.topicKey,
        });
        await get().loadTasks();
      } catch (error) {
        log.error('tasks', 'Failed to create task', { error });
      }
    },

    deleteTask: async (taskId) => {
      try {
        await api.deleteAgentTaskRemote(taskId);
        const activeTaskId = get().activeTaskId === taskId ? null : get().activeTaskId;
        set({ activeTaskId });
        await get().loadTasks();
      } catch (error) {
        log.error('tasks', 'Failed to delete task', { taskId, error });
      }
    },

    startTask: async (taskId) => {
      await transitionStatus(taskId, 'running');
    },

    pauseTask: async (taskId) => {
      await transitionStatus(taskId, 'paused');
    },

    cancelTask: async (taskId) => {
      await transitionStatus(taskId, 'cancelled');
    },

    completeTask: async (taskId, result) => {
      await transitionStatus(taskId, 'completed', { result });
    },

    failTask: async (taskId, error) => {
      await transitionStatus(taskId, 'failed', { error });
    },

    addSubtask: async (taskId, title) => {
      try {
        await api.addAgentSubtaskRemote({ task_id: taskId, title });
        await get().loadTasks();
      } catch (error) {
        log.error('tasks', 'Failed to add subtask', { taskId, error });
      }
    },

    completeSubtask: async (taskId, subtaskId) => {
      try {
        await api.completeAgentSubtaskRemote({ task_id: taskId, subtask_id: subtaskId });
        await get().loadTasks();
      } catch (error) {
        log.error('tasks', 'Failed to complete subtask', { taskId, subtaskId, error });
      }
    },

    setActiveTask: (taskId) => {
      set({ activeTaskId: taskId });
    },

    getTasksForAgent: (agentId) => get().tasks.filter((t) => t.agentId === agentId),

    getActiveTasks: () => get().tasks.filter(
      (task) =>
        task.status === 'running' ||
        task.status === 'pending' ||
        task.status === 'needs_user',
    ),
  };
});
