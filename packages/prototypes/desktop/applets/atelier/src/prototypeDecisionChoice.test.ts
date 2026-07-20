import { describe, expect, it } from 'vitest';
import {
  buildPrototypeDecisionChoiceRequestKey,
  buildPrototypeDecisionChoiceIntent,
  buildPrototypeDecisionResolveProjection,
  derivePrototypeDecisionCardView,
  shouldApplyPrototypeDecisionChoiceSnapshot,
} from './prototypeDecisionChoice';
import type { AtelierState } from './types';

function state(input: Partial<AtelierState> = {}): AtelierState {
  return {
    budgetSpent: 0,
    budgetCap: 100,
    model: 'claude-sonnet',
    tasks: [],
    selectedTaskId: 'task-1',
    stream: {},
    todos: {},
    context: {},
    artifacts: {},
    gates: {},
    ...input,
  };
}

describe('buildPrototypeDecisionChoiceIntent', () => {
  it('keys decision choice snapshot requests by task, block, and choice without execution payloads', () => {
    expect(buildPrototypeDecisionChoiceRequestKey({
      taskId: ' task-1 ',
      blockId: ' decision-1 ',
      choice: ' Continue ',
    })).toBe('task:task-1|block:decision-1|choice:Continue');
    expect(buildPrototypeDecisionChoiceRequestKey({})).toBe('task:workspace|block:none|choice:none');
  });

  it('rejects stale decision choice snapshots after task, block, or choice ownership changes', () => {
    const currentRequestKey = buildPrototypeDecisionChoiceRequestKey({
      taskId: 'task-2',
      blockId: 'decision-2',
      choice: 'Continue',
    });
    const staleTaskKey = buildPrototypeDecisionChoiceRequestKey({
      taskId: 'task-1',
      blockId: 'decision-2',
      choice: 'Continue',
    });
    const staleChoiceKey = buildPrototypeDecisionChoiceRequestKey({
      taskId: 'task-2',
      blockId: 'decision-2',
      choice: 'Cancel',
    });

    expect(shouldApplyPrototypeDecisionChoiceSnapshot({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeDecisionChoiceSnapshot({
      currentRequestKey,
      responseRequestKey: staleTaskKey,
    })).toBe(false);
    expect(shouldApplyPrototypeDecisionChoiceSnapshot({
      currentRequestKey,
      responseRequestKey: staleChoiceKey,
    })).toBe(false);
    expect(shouldApplyPrototypeDecisionChoiceSnapshot({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleTaskKey} ${staleChoiceKey}`).not.toMatch(
      /provider\.invoke|runtime\.execute|gate\.rerun|taskGraph\.diff\.apply|input_snapshot|memory\.write/,
    );
  });

  it('builds trimmed Station-owned human decision resolve intents', () => {
    expect(buildPrototypeDecisionChoiceIntent({
      taskId: ' task-1 ',
      blockId: ' decision-1 ',
      choice: ' Continue ',
    })).toEqual({
      status: 'resolve',
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: 'Continue',
    });
  });

  it('blocks empty task identity before resolving a decision', () => {
    expect(buildPrototypeDecisionChoiceIntent({
      taskId: ' ',
      blockId: 'decision-1',
      choice: 'Continue',
    })).toEqual({ status: 'invalid' });
  });

  it('blocks empty decision block identity before resolving a decision', () => {
    expect(buildPrototypeDecisionChoiceIntent({
      taskId: 'task-1',
      blockId: ' ',
      choice: 'Continue',
    })).toEqual({ status: 'invalid' });
  });

  it('blocks empty choices before resolving a decision', () => {
    expect(buildPrototypeDecisionChoiceIntent({
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: ' ',
    })).toEqual({ status: 'invalid' });
  });

  it('keeps resume-shaped option text as human choice data, not an applet action', () => {
    expect(buildPrototypeDecisionChoiceIntent({
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: 'resume',
    })).toEqual({
      status: 'resolve',
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: 'resume',
    });
  });

  it('marks the recommended option primary before the human chooses', () => {
    expect(derivePrototypeDecisionCardView({
      options: [
        { text: 'Continue', recommended: true },
        { text: 'Cancel' },
      ],
    }).optionViews).toEqual([
      {
        text: 'Continue',
        picked: false,
        primary: true,
        disabled: false,
        clickable: true,
        prefix: '',
      },
      {
        text: 'Cancel',
        picked: false,
        primary: false,
        disabled: false,
        clickable: true,
        prefix: '',
      },
    ]);
  });

  it('keeps the chosen option active and disables the other projected choices', () => {
    expect(derivePrototypeDecisionCardView({
      chosen: 'Cancel',
      options: [
        { text: 'Continue', recommended: true },
        { text: 'Cancel' },
      ],
    })).toEqual({
      chosenLabel: 'Cancel',
      optionViews: [
        {
          text: 'Continue',
          picked: false,
          primary: false,
          disabled: true,
          clickable: false,
          prefix: '',
        },
        {
          text: 'Cancel',
          picked: true,
          primary: true,
          disabled: false,
          clickable: true,
          prefix: '✓ ',
        },
      ],
    });
  });

  it('treats resume-shaped option text as display data without execution affordances', () => {
    const view = derivePrototypeDecisionCardView({
      chosen: 'resume',
      options: [
        { text: 'resume', recommended: true },
        { text: 'Cancel' },
      ],
    });

    expect(view.chosenLabel).toBe('resume');
    expect(view.optionViews[0]).toMatchObject({
      text: 'resume',
      picked: true,
      primary: true,
      clickable: true,
    });
    expect(JSON.stringify(view)).not.toMatch(/provider\.invoke|runtime\.execute|gate\.rerun|taskGraph\.diff\.apply/);
  });

  it('projects a trimmed human decision choice onto only the matching DecisionCard block', () => {
    const next = buildPrototypeDecisionResolveProjection({
      state: state({
        stream: {
          'task-1': [
            {
              kind: 'decision',
              id: 'decision-1',
              question: 'Continue?',
              spentSoFar: '$1',
              options: [{ text: 'Continue' }, { text: 'Cancel' }],
              rollbackImpact: 'low',
            },
            {
              kind: 'decision',
              id: 'decision-2',
              question: 'Other?',
              spentSoFar: '$2',
              options: [{ text: 'Approve' }],
              rollbackImpact: 'medium',
            },
          ],
        },
      }),
      taskId: ' task-1 ',
      blockId: ' decision-1 ',
      choice: ' Continue ',
    });

    expect(next.stream['task-1'][0]).toMatchObject({
      kind: 'decision',
      id: 'decision-1',
      chosen: 'Continue',
    });
    expect(next.stream['task-1'][1]).not.toHaveProperty('chosen');
  });

  it('keeps invalid decision projection input as a no-op state update', () => {
    const current = state({
      stream: {
        'task-1': [
          {
            kind: 'decision',
            id: 'decision-1',
            question: 'Continue?',
            spentSoFar: '$1',
            options: [{ text: 'Continue' }],
            rollbackImpact: 'low',
          },
        ],
      },
    });

    expect(buildPrototypeDecisionResolveProjection({
      state: current,
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: '   ',
    })).toBe(current);
  });

  it('keeps resume-shaped resolved choices as projection data without execution payloads', () => {
    const next = buildPrototypeDecisionResolveProjection({
      state: state({
        stream: {
          'task-1': [
            {
              kind: 'decision',
              id: 'decision-1',
              question: 'Resume?',
              spentSoFar: '$1',
              options: [{ text: 'resume' }],
              rollbackImpact: 'low',
            },
          ],
        },
      }),
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: 'resume',
    });

    expect(next.stream['task-1'][0]).toMatchObject({ chosen: 'resume' });
    expect(JSON.stringify(next.stream['task-1'])).not.toMatch(
      /provider\.invoke|runtime\.execute|gate\.rerun|taskGraph\.diff\.apply|input_snapshot|memory\.write/,
    );
  });
});
