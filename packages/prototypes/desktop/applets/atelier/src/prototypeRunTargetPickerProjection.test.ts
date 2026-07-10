import { describe, expect, it } from 'vitest';
import {
  ATELIER_AGENT_FLOW_DESCRIPTORS,
  ATELIER_DIRECT_RUN_MODELS,
  ATELIER_RUN_TARGET_KINDS,
} from './projection.contract.generated';
import {
  buildPrototypeModelSelectionRequestKey,
  derivePrototypeRunTargetPickerView,
  shouldApplyPrototypeModelSelectionSnapshot,
} from './prototypeRunTargetPickerProjection';
import type { AgentFlowId } from './runtime';

describe('derivePrototypeRunTargetPickerView', () => {
  it('keys model selection snapshots by selected task and model without execution payloads', () => {
    expect(buildPrototypeModelSelectionRequestKey({
      taskId: ' task-1 ',
      model: ' claude-sonnet ',
    })).toBe('task:task-1|model:claude-sonnet');
    expect(buildPrototypeModelSelectionRequestKey({})).toBe('task:workspace|model:none');
  });

  it('rejects stale model selection snapshots after task or model ownership changes', () => {
    const currentRequestKey = buildPrototypeModelSelectionRequestKey({
      taskId: 'task-2',
      model: 'claude-sonnet',
    });
    const staleTaskKey = buildPrototypeModelSelectionRequestKey({
      taskId: 'task-1',
      model: 'claude-sonnet',
    });
    const staleModelKey = buildPrototypeModelSelectionRequestKey({
      taskId: 'task-2',
      model: 'gpt-4.1',
    });

    expect(shouldApplyPrototypeModelSelectionSnapshot({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeModelSelectionSnapshot({
      currentRequestKey,
      responseRequestKey: staleTaskKey,
    })).toBe(false);
    expect(shouldApplyPrototypeModelSelectionSnapshot({
      currentRequestKey,
      responseRequestKey: staleModelKey,
    })).toBe(false);
    expect(shouldApplyPrototypeModelSelectionSnapshot({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleTaskKey} ${staleModelKey}`).not.toMatch(
      /provider\.invoke|runtime\.execute|model\.run|shell|memory\.write|input_snapshot|run\.execute/,
    );
  });

  it('derives active agents label from generated Station flow descriptors', () => {
    const flow = ATELIER_AGENT_FLOW_DESCRIPTORS[0];

    expect(derivePrototypeRunTargetPickerView({
      runKind: 'agents',
      model: ATELIER_DIRECT_RUN_MODELS[0],
      flowId: flow.id,
      tab: 'agents',
    })).toMatchObject({
      icon: '👥',
      activeLabel: flow.label,
    });
  });

  it('falls back to projected flow id when a descriptor is missing', () => {
    expect(derivePrototypeRunTargetPickerView({
      runKind: 'agents',
      model: ATELIER_DIRECT_RUN_MODELS[0],
      flowId: 'future-flow' as AgentFlowId,
      tab: 'agents',
    })).toMatchObject({
      activeLabel: 'future-flow',
    });
  });

  it('renders generated run target tabs without local execution semantics', () => {
    const view = derivePrototypeRunTargetPickerView({
      runKind: 'model',
      model: ATELIER_DIRECT_RUN_MODELS[0],
      flowId: ATELIER_AGENT_FLOW_DESCRIPTORS[0].id,
      tab: 'model',
    });

    expect(view.tabs.map((tab) => tab.kind)).toEqual([...ATELIER_RUN_TARGET_KINDS]);
    expect(view.tabs.find((tab) => tab.kind === 'model')).toMatchObject({
      label: '⚡ 直接模型',
      active: true,
    });
    expect(view.tabs.find((tab) => tab.kind === 'agents')).toMatchObject({
      label: '👥 Agents',
      active: false,
    });
  });

  it('marks generated direct model options as picked metadata only', () => {
    const model = ATELIER_DIRECT_RUN_MODELS[0];

    expect(derivePrototypeRunTargetPickerView({
      runKind: 'model',
      model,
      flowId: ATELIER_AGENT_FLOW_DESCRIPTORS[0].id,
      tab: 'model',
    }).modelOptions).toContainEqual({
      model,
      picked: true,
    });
  });

  it('marks generated agent flow options and batch badges as display-only metadata', () => {
    const flow = ATELIER_AGENT_FLOW_DESCRIPTORS.find((candidate) => candidate.batch !== 1)
      ?? ATELIER_AGENT_FLOW_DESCRIPTORS[0];

    expect(derivePrototypeRunTargetPickerView({
      runKind: 'agents',
      model: ATELIER_DIRECT_RUN_MODELS[0],
      flowId: flow.id,
      tab: 'agents',
    }).flowOptions.find((option) => option.id === flow.id)).toMatchObject({
      id: flow.id,
      label: flow.label,
      description: flow.description,
      picked: true,
      batchBadgeLabel: flow.batch === 1 ? '可切换' : '第二批',
      batchBadgeTone: flow.batch === 1 ? 'success' : 'muted',
    });
  });
});
