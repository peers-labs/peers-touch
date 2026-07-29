import type { AtelierState } from './types';

export type PrototypeDecisionChoiceIntent =
  | {
      status: 'invalid';
    }
  | {
      status: 'resolve';
      taskId: string;
      blockId: string;
      choice: string;
    };

export interface PrototypeDecisionOptionView {
  text: string;
  picked: boolean;
  primary: boolean;
  disabled: boolean;
  clickable: boolean;
  prefix: string;
}

export interface PrototypeDecisionCardView {
  optionViews: PrototypeDecisionOptionView[];
  chosenLabel?: string;
}

export function buildPrototypeDecisionChoiceRequestKey(input: {
  taskId?: string;
  blockId?: string;
  choice?: string;
}): string {
  const taskId = input.taskId?.trim() || 'workspace';
  const blockId = input.blockId?.trim() || 'none';
  const choice = input.choice?.trim() || 'none';
  return `task:${taskId}|block:${blockId}|choice:${choice}`;
}

export function shouldApplyPrototypeDecisionChoiceSnapshot(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function buildPrototypeDecisionChoiceIntent(input: {
  taskId: string;
  blockId: string;
  choice: string;
}): PrototypeDecisionChoiceIntent {
  const taskId = input.taskId.trim();
  const blockId = input.blockId.trim();
  const choice = input.choice.trim();
  if (!taskId || !blockId || !choice) return { status: 'invalid' };
  return {
    status: 'resolve',
    taskId,
    blockId,
    choice,
  };
}

export function derivePrototypeDecisionCardView(input: {
  options: { text: string; recommended?: boolean }[];
  chosen?: string;
}): PrototypeDecisionCardView {
  const chosen = input.chosen?.trim();
  const optionViews = input.options.map((option) => {
    const picked = Boolean(chosen && chosen === option.text);
    const primary = picked || Boolean(option.recommended && !chosen);
    const disabled = Boolean(chosen && !picked);
    return {
      text: option.text,
      picked,
      primary,
      disabled,
      clickable: !disabled,
      prefix: picked ? '✓ ' : '',
    };
  });

  return {
    optionViews,
    chosenLabel: chosen || undefined,
  };
}

export function buildPrototypeDecisionResolveProjection(input: {
  state: AtelierState;
  taskId: string;
  blockId: string;
  choice: string;
}): AtelierState {
  const taskId = input.taskId.trim();
  const blockId = input.blockId.trim();
  const choice = input.choice.trim();
  if (!taskId || !blockId || !choice) return input.state;

  return {
    ...input.state,
    stream: {
      ...input.state.stream,
      [taskId]: (input.state.stream[taskId] ?? []).map((block) =>
        block.kind === 'decision' && block.id === blockId
          ? { ...block, chosen: choice }
          : block,
      ),
    },
  };
}
