// Task store — manages agent task lifecycle. Station-backed (O3): create /
// status transitions (start/pause/cancel/complete/fail) / delete / subtasks
// persist to Station via the agent task API; the list is refreshed from Station
// truth after each mutation. Replaces the prior localStorage store.

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';
import { api, type StationAgentTaskRow } from '../services/desktop_api';

export type TaskStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type TaskPriority = 'low' | 'medium' | 'high';

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

// Maps a Station task row (snake_case) into the UI AgentTask shape.
function rowToTask(row: StationAgentTaskRow): AgentTask {
  return {
    id: row.id,
    title: row.title,
    description: row.description || '',
    agentId: row.agent_id,
    status: row.status as TaskStatus,
    priority: (row.priority || 'medium') as TaskPriority,
    progress: row.progress || 0,
    subtasks: (row.subtasks || []).map((s) => ({
      id: s.id,
      title: s.title,
      status: s.status as AgentSubtask['status'],
      completedAt: s.completed_at,
    })),
    topicKey: row.topic_key || undefined,
    createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(),
    completedAt: row.completed_at ? new Date(row.completed_at).getTime() : undefined,
    result: row.result || undefined,
    error: row.error || undefined,
  };
}

export const useTaskStore = createDesktopStore<TaskState>('tasks', (set, get) => {
  // Drive a Station status transition then refresh the list from Station truth.
  const transitionStatus = async (
    taskId: string,
    status: TaskStatus,
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

    loadTasks: async () => {
      try {
        const rows = await api.listAgentTasksRemote();
        set({ tasks: rows.map(rowToTask) });
        log.info('tasks', 'Tasks loaded from Station', { count: rows.length });
      } catch (error) {
        log.error('tasks', 'Failed to load tasks from Station', { error });
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

    getActiveTasks: () => get().tasks.filter((t) => t.status === 'running' || t.status === 'pending'),
  };
});
