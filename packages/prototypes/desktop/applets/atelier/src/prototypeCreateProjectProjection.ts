import {
  ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING,
  ATELIER_DEFAULT_TASK_INTENT_PRESET,
  ATELIER_TASK_INTENT_PRESETS,
} from './projection.contract.generated';
import type { AtelierState, Block, TaskIntentPreset } from './types';

export type PrototypeCreateProjectRunKind = 'model' | 'agents';
export type PrototypeCreateProjectIntentPreset = (typeof ATELIER_TASK_INTENT_PRESETS)[number];

export interface PrototypeCreateProjectIntentPresetMetadata {
  intentPreset: PrototypeCreateProjectIntentPreset;
  providerStrategyPreset: string;
  gatePlanPreset: string;
}

export function prototypeCreateProjectIntentPresetMetadata(
  intentPreset: PrototypeCreateProjectIntentPreset = ATELIER_DEFAULT_TASK_INTENT_PRESET,
): PrototypeCreateProjectIntentPresetMetadata {
  const mapping =
    ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[intentPreset] ??
    ATELIER_CREATE_FROM_GOAL_INTENT_PRESET_MAPPING[ATELIER_DEFAULT_TASK_INTENT_PRESET];
  return {
    intentPreset,
    providerStrategyPreset: mapping.providerStrategyPreset,
    gatePlanPreset: mapping.gatePlanPreset,
  };
}

export function prototypeCreateProjectWorkspaceUri(taskId: string, project: string): string {
  return `pt-workspace://task/${encodeURIComponent(taskId)}?workspace=${encodeURIComponent(project)}`;
}

export function prototypeCreateProjectAcknowledgement(runKind: PrototypeCreateProjectRunKind): string {
  return runKind === 'agents'
    ? '已收到目标。我会通过 peers-touch agent 编排层创建协作运行，并把计划、证据、产物和需要你拍板的事项投影到这里。'
    : '已收到目标。我会按当前模型直接推进，并把产物与验收结果投影到这里。';
}

export function buildPrototypeCreateProjectProjection(input: {
  state: AtelierState;
  taskId: string;
  now: string;
  goal: string;
  project?: string;
  intentPreset?: TaskIntentPreset;
  runKind: PrototypeCreateProjectRunKind;
}): { state: AtelierState; selectedTaskId: string } {
  const title = input.goal.trim() || '新任务';
  const project = input.project ?? 'peers-touch';
  const preset = prototypeCreateProjectIntentPresetMetadata(input.intentPreset);

  return {
    selectedTaskId: input.taskId,
    state: {
      ...input.state,
      selectedTaskId: input.taskId,
      tasks: [
        {
          id: input.taskId,
          project,
          title,
          status: 'active',
          running: true,
          intentPreset: preset.intentPreset,
          providerStrategyPreset: preset.providerStrategyPreset,
          gatePlanPreset: preset.gatePlanPreset,
          workspaceOpenTarget: {
            workspaceId: project,
            workspaceUri: prototypeCreateProjectWorkspaceUri(input.taskId, project),
            label: project,
            ideHint: 'vscode',
          },
        },
        ...input.state.tasks,
      ],
      stream: {
        ...input.state.stream,
        [input.taskId]: [
          prototypeCreateProjectUserBlock(input.taskId, title, input.now),
          prototypeCreateProjectAgentBlock(
            `${input.taskId}-ack`,
            prototypeCreateProjectAcknowledgement(input.runKind),
            input.now,
          ),
        ],
      },
      todos: { ...input.state.todos, [input.taskId]: [] },
      artifacts: { ...input.state.artifacts, [input.taskId]: [] },
      gates: { ...input.state.gates, [input.taskId]: [] },
      context: {
        ...input.state.context,
        [input.taskId]: { usedPct: 8, files: [] },
      },
    },
  };
}

function prototypeCreateProjectUserBlock(id: string, text: string, at: string): Block {
  return { kind: 'user', id, text, at };
}

function prototypeCreateProjectAgentBlock(id: string, text: string, at: string): Block {
  return { kind: 'agent', id, text, at, done: true };
}
