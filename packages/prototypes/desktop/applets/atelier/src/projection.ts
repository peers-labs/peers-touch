import type { Artifact, AtelierState, Block, GateResult, Task, TaskContext, TaskStatus, TodoItem } from './types';
import type {
  AtelierRunTarget,
  CreateProjectFromGoalInput,
  ResolveDecisionInput,
  SendMessageInput,
  SetTaskStatusInput,
} from './runtime';

export type AtelierProjectionVersion = 'atelier-projection/v0';

export interface AtelierProjectionSnapshot {
  version: AtelierProjectionVersion;
  workspace: AtelierWorkspaceProjection;
  selectedTaskId: string;
}

export interface AtelierWorkspaceProjection {
  budgetSpent: number;
  budgetCap: number;
  model: string;
  tasks: Task[];
  streams: Record<string, Block[]>;
  todos: Record<string, TodoItem[]>;
  contexts: Record<string, TaskContext>;
  artifacts: Record<string, Artifact[]>;
  gates?: Record<string, GateResult[]>;
}

export type AtelierProjectionPatch =
  | { kind: 'snapshot'; snapshot: AtelierProjectionSnapshot }
  | { kind: 'task.upsert'; task: Task; select?: boolean }
  | { kind: 'task.status'; taskId: string; status: TaskStatus }
  | { kind: 'stream.append'; taskId: string; blocks: Block[] }
  | { kind: 'decision.resolved'; taskId: string; blockId: string; choice: string }
  | { kind: 'artifact.upsert'; taskId: string; artifact: Artifact }
  | { kind: 'gate.upsert'; taskId: string; gate: GateResult }
  | { kind: 'context.replace'; taskId: string; context: TaskContext }
  | { kind: 'todo.replace'; taskId: string; todos: TodoItem[] };

export type AtelierRuntimeMethod =
  | 'atelier.workspace.load'
  | 'atelier.project.createFromGoal'
  | 'atelier.message.send'
  | 'atelier.escalation.resolve'
  | 'atelier.task.setStatus'
  | 'atelier.task.purge';

export type AtelierRuntimePayloadByMethod = {
  'atelier.workspace.load': Record<string, never>;
  'atelier.project.createFromGoal': CreateProjectFromGoalInput;
  'atelier.message.send': SendMessageInput;
  'atelier.escalation.resolve': ResolveDecisionInput;
  'atelier.task.setStatus': SetTaskStatusInput;
  'atelier.task.purge': { taskId: string };
};

export interface AtelierRuntimeCall<M extends AtelierRuntimeMethod = AtelierRuntimeMethod> {
  method: M;
  payload: AtelierRuntimePayloadByMethod[M];
}

export interface AtelierProjectionEvent {
  id: string;
  seq: number;
  taskId?: string;
  patch: AtelierProjectionPatch;
  receivedAt: string;
}

export function toProjectionSnapshot(state: AtelierState, selectedTaskId = state.selectedTaskId): AtelierProjectionSnapshot {
  return {
    version: 'atelier-projection/v0',
    selectedTaskId,
    workspace: {
      budgetSpent: state.budgetSpent,
      budgetCap: state.budgetCap,
      model: state.model,
      tasks: state.tasks,
      streams: state.stream,
      todos: state.todos,
      contexts: state.context,
      artifacts: state.artifacts,
      gates: state.gates,
    },
  };
}

export function fromProjectionSnapshot(snapshot: AtelierProjectionSnapshot): { state: AtelierState; selectedTaskId: string } {
  return {
    selectedTaskId: snapshot.selectedTaskId,
    state: {
      budgetSpent: snapshot.workspace.budgetSpent,
      budgetCap: snapshot.workspace.budgetCap,
      model: snapshot.workspace.model,
      tasks: snapshot.workspace.tasks,
      selectedTaskId: snapshot.selectedTaskId,
      stream: snapshot.workspace.streams,
      todos: snapshot.workspace.todos,
      context: snapshot.workspace.contexts,
      artifacts: snapshot.workspace.artifacts,
      gates: snapshot.workspace.gates ?? {},
    },
  };
}

export function runTargetLabel(run: AtelierRunTarget) {
  return run.kind === 'agents' ? run.flowId ?? 'agents' : run.model ?? 'model';
}
