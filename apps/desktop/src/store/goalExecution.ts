import type {
  HomeTaskProjection,
  HomeTaskStatus,
  HomeWorkProjection,
} from '../gen/proto/domain/agent/home_pb';
import type { TaskSurface } from '../gen/proto/domain/agent/orchestration_pb';
import { createDesktopStore } from './createDesktopStore';

export interface GoalExecutionView {
  goalId: string;
  nodeId: string;
  taskId: string;
  stepId: string;
  attemptId: string;
  attempt: number;
  agentId: string;
  workspaceId: string;
  title: string;
  status: HomeTaskStatus;
  progressPercent: number;
  surface: TaskSurface;
}

interface GoalExecutionState {
  executions: GoalExecutionView[];
  selectedTaskId: string | null;
  applyProjection: (projection: HomeWorkProjection) => void;
  selectTask: (taskId: string) => void;
  reset: () => void;
}

function isCanonicalGoalExecution(
  task: HomeTaskProjection,
): boolean {
  return Boolean(
    task.goalId
    && task.goalNodeId
    && task.taskId
    && task.stepId
    && task.attemptId
    && task.attempt > 0,
  );
}

export function normalizeGoalExecutions(
  projection: HomeWorkProjection,
): GoalExecutionView[] {
  return projection.activeTasks
    .filter(isCanonicalGoalExecution)
    .map((task) => ({
      goalId: task.goalId,
      nodeId: task.goalNodeId,
      taskId: task.taskId,
      stepId: task.stepId,
      attemptId: task.attemptId,
      attempt: task.attempt,
      agentId: task.agentId,
      workspaceId: task.workspaceId,
      title: task.title,
      status: task.status,
      progressPercent: task.progressPercent,
      surface: task.surface,
    }));
}

export const useGoalExecutionStore =
  createDesktopStore<GoalExecutionState>('goalExecution', (set) => ({
    executions: [],
    selectedTaskId: null,

    applyProjection: (projection) => set((state) => {
      const executions = normalizeGoalExecutions(projection);
      const selectedTaskId = executions.some(
        (execution) => execution.taskId === state.selectedTaskId,
      )
        ? state.selectedTaskId
        : null;
      return { executions, selectedTaskId };
    }),

    selectTask: (taskId) => set((state) => ({
      selectedTaskId: state.executions.some(
        (execution) => execution.taskId === taskId,
      )
        ? taskId
        : state.selectedTaskId,
    })),

    reset: () => set({
      executions: [],
      selectedTaskId: null,
    }),
  }));
