import type { AgentFlowId, AtelierRunTarget, RunTargetKind } from './runtime';

export type PrototypeComposerMode = 'message' | 'goal';

export type PrototypeComposerSubmitIntent =
  | {
      status: 'invalid';
    }
  | {
      status: 'message';
      taskId: string;
      text: string;
    }
  | {
      status: 'create';
      goal: string;
    };

export function buildPrototypeComposerSubmitRequestKey(input: {
  kind: 'create' | 'message';
  taskId?: string;
  text?: string;
  runKind?: RunTargetKind;
  model?: string;
  flowId?: AgentFlowId;
}): string {
  const taskId = input.taskId?.trim() || 'workspace';
  const text = input.text?.trim() || 'none';
  const runKind = input.runKind?.trim() || 'none';
  const model = input.model?.trim() || 'none';
  const flowId = input.flowId?.trim() || 'none';
  return `kind:${input.kind}|task:${taskId}|text:${text}|run:${runKind}|model:${model}|flow:${flowId}`;
}

export function shouldApplyPrototypeComposerSubmitSnapshot(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function buildPrototypeComposerSubmitIntent(input: {
  composerMode: PrototypeComposerMode;
  draft: string;
  selectedTaskId: string;
}): PrototypeComposerSubmitIntent {
  const text = input.draft.trim();
  if (!text) return { status: 'invalid' };
  const selectedTaskId = input.selectedTaskId.trim();
  if (input.composerMode === 'goal' || !selectedTaskId) {
    return { status: 'create', goal: text };
  }
  return {
    status: 'message',
    taskId: selectedTaskId,
    text,
  };
}

export function buildPrototypeRunTarget(input: {
  runKind: RunTargetKind;
  model: string;
  flowId: AgentFlowId;
}): AtelierRunTarget {
  if (input.runKind === 'model') {
    return { kind: 'model', model: input.model };
  }
  return { kind: 'agents', model: input.model, flowId: input.flowId };
}
