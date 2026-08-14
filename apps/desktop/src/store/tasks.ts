// Task store — manages agent task lifecycle and persistence.
//
// v1 persists to localStorage. Station integration deferred to M11.

import { createDesktopStore } from './createDesktopStore';
import { log } from '../utils/logger';

const STORAGE_KEY = 'peers-ai-agent-tasks';

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

  loadTasks: () => void;
  createTask: (input: TaskCreateInput) => string;
  updateTask: (taskId: string, updates: Partial<AgentTask>) => void;
  deleteTask: (taskId: string) => void;
  startTask: (taskId: string) => void;
  pauseTask: (taskId: string) => void;
  cancelTask: (taskId: string) => void;
  completeTask: (taskId: string, result?: string) => void;
  failTask: (taskId: string, error: string) => void;
  addSubtask: (taskId: string, title: string) => void;
  completeSubtask: (taskId: string, subtaskId: string) => void;
  setActiveTask: (taskId: string | null) => void;
  getTasksForAgent: (agentId: string) => AgentTask[];
  getActiveTasks: () => AgentTask[];
}

function generateId(): string {
  return `task_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function generateSubtaskId(): string {
  return `sub_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function persistTasks(tasks: AgentTask[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
  } catch (error) {
    log.error('tasks', 'Failed to persist tasks to localStorage', { error });
  }
}

function loadFromStorage(): AgentTask[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as AgentTask[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch (error) {
    log.error('tasks', 'Failed to load tasks from localStorage', { error });
    return [];
  }
}

function computeProgress(subtasks: AgentSubtask[]): number {
  if (subtasks.length === 0) return 0;
  const completed = subtasks.filter((s) => s.status === 'completed').length;
  return Math.round((completed / subtasks.length) * 100);
}

export const useTaskStore = createDesktopStore<TaskState>('tasks', (set, get) => ({
  tasks: [],
  activeTaskId: null,

  loadTasks: () => {
    const tasks = loadFromStorage();
    set({ tasks });
    log.info('tasks', 'Tasks loaded from storage', { count: tasks.length });
  },

  createTask: (input: TaskCreateInput) => {
    const now = Date.now();
    const task: AgentTask = {
      id: generateId(),
      title: input.title,
      description: input.description,
      agentId: input.agentId,
      status: 'pending',
      priority: input.priority,
      progress: 0,
      subtasks: [],
      topicKey: input.topicKey,
      createdAt: now,
      updatedAt: now,
    };
    const next = [...get().tasks, task];
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Task created', { id: task.id, title: task.title, agentId: task.agentId });
    return task.id;
  },

  updateTask: (taskId, updates) => {
    const next = get().tasks.map((t) =>
      t.id === taskId ? { ...t, ...updates, updatedAt: Date.now() } : t,
    );
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Task updated', { taskId, updates: Object.keys(updates) });
  },

  deleteTask: (taskId) => {
    const next = get().tasks.filter((t) => t.id !== taskId);
    const activeTaskId = get().activeTaskId === taskId ? null : get().activeTaskId;
    set({ tasks: next, activeTaskId });
    persistTasks(next);
    log.info('tasks', 'Task deleted', { taskId });
  },

  startTask: (taskId) => {
    const next = get().tasks.map((t) =>
      t.id === taskId ? { ...t, status: 'running' as const, updatedAt: Date.now() } : t,
    );
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Task started', { taskId });
  },

  pauseTask: (taskId) => {
    const next = get().tasks.map((t) =>
      t.id === taskId ? { ...t, status: 'paused' as const, updatedAt: Date.now() } : t,
    );
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Task paused', { taskId });
  },

  cancelTask: (taskId) => {
    const next = get().tasks.map((t) =>
      t.id === taskId ? { ...t, status: 'cancelled' as const, updatedAt: Date.now() } : t,
    );
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Task cancelled', { taskId });
  },

  completeTask: (taskId, result) => {
    const now = Date.now();
    const next = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'completed' as const, progress: 100, result, completedAt: now, updatedAt: now }
        : t,
    );
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Task completed', { taskId });
  },

  failTask: (taskId, error) => {
    const now = Date.now();
    const next = get().tasks.map((t) =>
      t.id === taskId
        ? { ...t, status: 'failed' as const, error, updatedAt: now }
        : t,
    );
    set({ tasks: next });
    persistTasks(next);
    log.error('tasks', 'Task failed', { taskId, error });
  },

  addSubtask: (taskId, title) => {
    const subtask: AgentSubtask = {
      id: generateSubtaskId(),
      title,
      status: 'pending',
    };
    const next = get().tasks.map((t) => {
      if (t.id !== taskId) return t;
      const subtasks = [...t.subtasks, subtask];
      return { ...t, subtasks, progress: computeProgress(subtasks), updatedAt: Date.now() };
    });
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Subtask added', { taskId, subtaskId: subtask.id });
  },

  completeSubtask: (taskId, subtaskId) => {
    const now = Date.now();
    const next = get().tasks.map((t) => {
      if (t.id !== taskId) return t;
      const subtasks = t.subtasks.map((s) =>
        s.id === subtaskId ? { ...s, status: 'completed' as const, completedAt: now } : s,
      );
      return { ...t, subtasks, progress: computeProgress(subtasks), updatedAt: now };
    });
    set({ tasks: next });
    persistTasks(next);
    log.info('tasks', 'Subtask completed', { taskId, subtaskId });
  },

  setActiveTask: (taskId) => {
    set({ activeTaskId: taskId });
  },

  getTasksForAgent: (agentId) => {
    return get().tasks.filter((t) => t.agentId === agentId);
  },

  getActiveTasks: () => {
    return get().tasks.filter((t) => t.status === 'running' || t.status === 'pending');
  },
}));
