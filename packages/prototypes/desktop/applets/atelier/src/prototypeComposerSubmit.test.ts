import { describe, expect, it } from 'vitest';
import {
  buildPrototypeComposerSubmitRequestKey,
  buildPrototypeComposerSubmitIntent,
  buildPrototypeRunTarget,
  shouldApplyPrototypeComposerSubmitSnapshot,
} from './prototypeComposerSubmit';

describe('buildPrototypeComposerSubmitIntent', () => {
  it('keys composer submit snapshots by kind, task/text, and run metadata without execution payloads', () => {
    expect(buildPrototypeComposerSubmitRequestKey({
      kind: 'create',
      text: ' build dashboard ',
      runKind: 'agents',
      model: ' claude-sonnet ',
      flowId: ' roundtable ',
    })).toBe('kind:create|task:workspace|text:build dashboard|run:agents|model:claude-sonnet|flow:roundtable');
    expect(buildPrototypeComposerSubmitRequestKey({
      kind: 'message',
      taskId: ' task-1 ',
      text: ' /implement next guard ',
    })).toBe('kind:message|task:task-1|text:/implement next guard|run:none|model:none|flow:none');
  });

  it('rejects stale composer submit snapshots after task, text, or run ownership changes', () => {
    const currentRequestKey = buildPrototypeComposerSubmitRequestKey({
      kind: 'create',
      text: 'build dashboard',
      runKind: 'agents',
      model: 'claude-sonnet',
      flowId: 'roundtable',
    });
    const staleTextKey = buildPrototypeComposerSubmitRequestKey({
      kind: 'create',
      text: 'build report',
      runKind: 'agents',
      model: 'claude-sonnet',
      flowId: 'roundtable',
    });
    const staleKindKey = buildPrototypeComposerSubmitRequestKey({
      kind: 'message',
      taskId: 'task-1',
      text: 'build dashboard',
    });

    expect(shouldApplyPrototypeComposerSubmitSnapshot({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeComposerSubmitSnapshot({
      currentRequestKey,
      responseRequestKey: staleTextKey,
    })).toBe(false);
    expect(shouldApplyPrototypeComposerSubmitSnapshot({
      currentRequestKey,
      responseRequestKey: staleKindKey,
    })).toBe(false);
    expect(shouldApplyPrototypeComposerSubmitSnapshot({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleTextKey} ${staleKindKey}`).not.toMatch(
      /provider\.invoke|runtime\.execute|shell|memory\.write|input_snapshot|run\.execute|file\.write/,
    );
  });

  it('routes goal composer submissions to create-from-goal with user-entered text', () => {
    expect(buildPrototypeComposerSubmitIntent({
      composerMode: 'goal',
      draft: '  build the Atelier acceptance dashboard  ',
      selectedTaskId: 'task-1',
    })).toEqual({
      status: 'create',
      goal: 'build the Atelier acceptance dashboard',
    });
  });

  it('routes empty task selection to create-from-goal instead of text-only message send', () => {
    expect(buildPrototypeComposerSubmitIntent({
      composerMode: 'message',
      draft: 'start a fresh task',
      selectedTaskId: '',
    })).toEqual({
      status: 'create',
      goal: 'start a fresh task',
    });
  });

  it('routes selected message composer submissions to text-only message intents', () => {
    expect(buildPrototypeComposerSubmitIntent({
      composerMode: 'message',
      draft: '  /implement the next guard  ',
      selectedTaskId: ' task-1 ',
    })).toEqual({
      status: 'message',
      taskId: 'task-1',
      text: '/implement the next guard',
    });
  });

  it('blocks empty submissions before any create or message intent is built', () => {
    expect(buildPrototypeComposerSubmitIntent({
      composerMode: 'goal',
      draft: '   ',
      selectedTaskId: '',
    })).toEqual({ status: 'invalid' });
  });
});

describe('buildPrototypeRunTarget', () => {
  it('keeps model run target as Station-owned model metadata', () => {
    expect(buildPrototypeRunTarget({
      runKind: 'model',
      model: 'claude-sonnet',
      flowId: 'expert-hierarchy',
    })).toEqual({
      kind: 'model',
      model: 'claude-sonnet',
    });
  });

  it('keeps agents run target as Station-owned flow metadata', () => {
    expect(buildPrototypeRunTarget({
      runKind: 'agents',
      model: 'claude-sonnet',
      flowId: 'roundtable',
    })).toEqual({
      kind: 'agents',
      model: 'claude-sonnet',
      flowId: 'roundtable',
    });
  });
});
