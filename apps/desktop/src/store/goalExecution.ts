import {
  HomeTaskStatus,
  type HomeTaskProjection,
  type HomeWorkProjection,
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

export interface GoalResultView extends GoalExecutionView {
  summary: string;
  artifactId: string;
}

interface GoalExecutionState {
  executions: GoalExecutionView[];
  results: GoalResultView[];
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
    .filter((task) =>
      isCanonicalGoalExecution(task)
      && task.status !== HomeTaskStatus.COMPLETED
      && task.status !== HomeTaskStatus.FAILED
      && task.status !== HomeTaskStatus.CANCELLED
    )
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

export function normalizeGoalResults(
  projection: HomeWorkProjection,
): GoalResultView[] {
  const summaries = new Map(
    projection.briefItems
      .filter((item) => item.briefId.startsWith('goal-result:'))
      .map((item) => [item.sourceRef, item]),
  );
  return projection.activeTasks
    .filter((task) =>
      isCanonicalGoalExecution(task)
      && (
        task.status === HomeTaskStatus.COMPLETED
        || task.status === HomeTaskStatus.FAILED
      )
    )
    .map((task) => {
      const brief = summaries.get(task.taskId);
      const briefId = brief?.briefId ?? '';
      const artifactId = briefId.startsWith('goal-result:task:')
        ? ''
        : briefId.replace(/^goal-result:/, '');
      return {
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
        summary: brief?.summary ?? '',
        artifactId,
      };
    });
}

export const useGoalExecutionStore =
  createDesktopStore<GoalExecutionState>('goalExecution', (set) => ({
    executions: [],
    results: [],
    selectedTaskId: null,

    applyProjection: (projection) => set((state) => {
      const executions = normalizeGoalExecutions(projection);
      const results = normalizeGoalResults(projection);
      const selectedTaskId = executions.some(
        (execution) => execution.taskId === state.selectedTaskId,
      )
        ? state.selectedTaskId
        : null;
      return { executions, results, selectedTaskId };
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
      results: [],
      selectedTaskId: null,
    }),
  }));
