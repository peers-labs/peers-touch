import { MOCK } from './mock';
import type { AtelierState, Block, TaskStatus } from './types';

export interface AtelierRuntimeSnapshot {
  state: AtelierState;
  selectedTaskId: string;
}

export interface AtelierRunTarget {
  kind: 'model' | 'agents';
  model?: string;
  flowId?: string;
  agentIds?: string[];
}

export interface CreateProjectFromGoalInput {
  goal: string;
  project?: string;
  run: AtelierRunTarget;
  agentIds?: string[];
}

export interface SendMessageInput {
  taskId: string;
  text: string;
  run: AtelierRunTarget;
}

export interface ResolveDecisionInput {
  taskId: string;
  blockId: string;
  choice: string;
}

export interface SetTaskStatusInput {
  taskId: string;
  status: TaskStatus;
}

/**
 * Boundary Atelier will keep when it moves from prototype to real applet:
 * UI consumes a projection runtime, while Station/agent orchestration remains
 * the source of truth behind the implementation.
 */
export interface AtelierRuntime {
  getSnapshot(): AtelierRuntimeSnapshot;
  subscribe?(listener: (snapshot: AtelierRuntimeSnapshot) => void): () => void;
  loadWorkspace(): Promise<AtelierRuntimeSnapshot>;
  createProjectFromGoal(input: CreateProjectFromGoalInput): Promise<AtelierRuntimeSnapshot>;
  sendMessage(input: SendMessageInput): Promise<AtelierRuntimeSnapshot>;
  resolveDecision(input: ResolveDecisionInput): Promise<AtelierRuntimeSnapshot>;
  setTaskStatus(input: SetTaskStatusInput): Promise<AtelierRuntimeSnapshot>;
  purgeTask(taskId: string): Promise<AtelierRuntimeSnapshot>;
  setModel(model: string): Promise<AtelierRuntimeSnapshot>;
}

export function createMockAtelierRuntime(seed: AtelierState = MOCK): AtelierRuntime {
  let state = cloneState(seed);
  let selectedTaskId = state.selectedTaskId;

  const snapshot = (): AtelierRuntimeSnapshot => ({
    state: cloneState(state),
    selectedTaskId,
  });

  const replaceState = (next: AtelierState, nextSelectedTaskId = selectedTaskId) => {
    state = next;
    selectedTaskId = nextSelectedTaskId;
    return snapshot();
  };

  return {
    getSnapshot: snapshot,
    async loadWorkspace() {
      return snapshot();
    },
    async createProjectFromGoal(input) {
      const id = `t-${Date.now()}`;
      const title = input.goal.trim() || '新任务';
      const project = input.project ?? 'peers-touch';
      const now = formatTime(new Date());

      return replaceState(
        {
          ...state,
          selectedTaskId: id,
          tasks: [
            { id, project, title, status: 'active', running: true },
            ...state.tasks,
          ],
          stream: {
            ...state.stream,
            [id]: [
              userBlock(id, title, now),
              agentBlock(
                `${id}-ack`,
                input.run.kind === 'agents'
                  ? '已收到目标。我会通过 peers-touch agent 编排层创建协作运行，并把计划、证据、产物和需要你拍板的事项投影到这里。'
                  : '已收到目标。我会按当前模型直接推进，并把产物与验收结果投影到这里。',
                now,
              ),
            ],
          },
          todos: { ...state.todos, [id]: [] },
          artifacts: { ...state.artifacts, [id]: [] },
          gates: { ...state.gates, [id]: [] },
          context: {
            ...state.context,
            [id]: { usedPct: 8, files: [] },
          },
        },
        id,
      );
    },
    async sendMessage(input) {
      const text = input.text.trim();
      if (!text) return snapshot();
      const now = formatTime(new Date());
      const existing = state.stream[input.taskId] ?? [];
      const suffix = Date.now();
      const followUp =
        input.run.kind === 'agents'
          ? '已追加到当前协作上下文，等待 agent 编排层返回下一批 projection event。'
          : '已追加到当前上下文，等待模型返回下一步结果。';

      return replaceState({
        ...state,
        stream: {
          ...state.stream,
          [input.taskId]: [
            ...existing,
            userBlock(`u-${suffix}`, text, now),
            agentBlock(`a-${suffix}`, followUp, now),
          ],
        },
      });
    },
    async resolveDecision(input) {
      return replaceState({
        ...state,
        stream: {
          ...state.stream,
          [input.taskId]: (state.stream[input.taskId] ?? []).map((block) =>
            block.kind === 'decision' && block.id === input.blockId
              ? { ...block, chosen: input.choice }
              : block,
          ),
        },
      });
    },
    async setTaskStatus(input) {
      return replaceState({
        ...state,
        tasks: state.tasks.map((task) =>
          task.id === input.taskId
            ? { ...task, status: input.status, running: input.status === 'active' ? task.running : false }
            : task,
        ),
      });
    },
    async purgeTask(taskId) {
      const tasks = state.tasks.filter((task) => task.id !== taskId);
      const nextSelected = selectedTaskId === taskId ? tasks[0]?.id ?? '' : selectedTaskId;
      const { [taskId]: _stream, ...stream } = state.stream;
      const { [taskId]: _todos, ...todos } = state.todos;
      const { [taskId]: _context, ...context } = state.context;
      const { [taskId]: _artifacts, ...artifacts } = state.artifacts;
      const { [taskId]: _gates, ...gates } = state.gates;

      return replaceState(
        {
          ...state,
          selectedTaskId: nextSelected,
          tasks,
          stream,
          todos,
          context,
          artifacts,
          gates,
        },
        nextSelected,
      );
    },
    async setModel(model) {
      return replaceState({ ...state, model });
    },
  };
}

function cloneState(state: AtelierState): AtelierState {
  return JSON.parse(JSON.stringify(state)) as AtelierState;
}

function userBlock(id: string, text: string, at: string): Block {
  return { kind: 'user', id, text, at };
}

function agentBlock(id: string, text: string, at: string): Block {
  return { kind: 'agent', id, text, at, done: true };
}

function formatTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
}
