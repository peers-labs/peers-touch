import {
  ATELIER_AGENT_FLOW_DESCRIPTORS,
  ATELIER_DIRECT_RUN_MODELS,
  ATELIER_RUN_TARGET_KINDS,
} from './projection.contract.generated';
import type { AgentFlowId, RunTargetKind } from './runtime';

export type PrototypeRunTargetBatchTone = 'success' | 'muted';

export interface PrototypeRunTargetTabView {
  kind: RunTargetKind;
  label: string;
  active: boolean;
}

export interface PrototypeRunTargetModelOptionView {
  model: string;
  picked: boolean;
}

export interface PrototypeRunTargetFlowOptionView {
  id: AgentFlowId;
  label: string;
  description: string;
  picked: boolean;
  batchBadgeLabel: string;
  batchBadgeTone: PrototypeRunTargetBatchTone;
}

export interface PrototypeRunTargetPickerView {
  icon: string;
  activeLabel: string;
  tabs: PrototypeRunTargetTabView[];
  modelOptions: PrototypeRunTargetModelOptionView[];
  flowOptions: PrototypeRunTargetFlowOptionView[];
}

export function buildPrototypeModelSelectionRequestKey(input: {
  taskId?: string;
  model?: string;
}): string {
  const taskId = input.taskId?.trim() || 'workspace';
  const model = input.model?.trim() || 'none';
  return `task:${taskId}|model:${model}`;
}

export function shouldApplyPrototypeModelSelectionSnapshot(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

const RUN_KIND_LABELS: Record<RunTargetKind, string> = {
  model: '⚡ 直接模型',
  agents: '👥 Agents',
};

export function derivePrototypeRunTargetPickerView(input: {
  runKind: RunTargetKind;
  model: string;
  flowId: AgentFlowId;
  tab: RunTargetKind;
}): PrototypeRunTargetPickerView {
  const activeFlow = ATELIER_AGENT_FLOW_DESCRIPTORS.find((flow) => flow.id === input.flowId);
  const activeLabel = input.runKind === 'agents' ? (activeFlow?.label ?? input.flowId) : input.model;

  return {
    icon: input.runKind === 'agents' ? '👥' : '⚡',
    activeLabel,
    tabs: ATELIER_RUN_TARGET_KINDS.map((kind) => ({
      kind,
      label: RUN_KIND_LABELS[kind],
      active: input.tab === kind,
    })),
    modelOptions: ATELIER_DIRECT_RUN_MODELS.map((model) => ({
      model,
      picked: input.runKind === 'model' && model === input.model,
    })),
    flowOptions: ATELIER_AGENT_FLOW_DESCRIPTORS.map((flow) => ({
      id: flow.id,
      label: flow.label,
      description: flow.description,
      picked: input.runKind === 'agents' && flow.id === input.flowId,
      batchBadgeLabel: flow.batch === 1 ? '可切换' : '第二批',
      batchBadgeTone: flow.batch === 1 ? 'success' : 'muted',
    })),
  };
}
