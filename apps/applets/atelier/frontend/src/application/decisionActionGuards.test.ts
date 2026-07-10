import { describe, expect, it } from 'vitest';
import {
  ATELIER_DECISION_RESOLVE_FORBIDDEN_ACTIONS,
  ATELIER_DECISION_RESOLVE_REQUIRED_FIELDS,
  buildAtelierDecisionResolveIntent,
  containsForbiddenAtelierDecisionPayloadActions,
} from './decisionActionGuards';

describe('decision action guards', () => {
  it('builds trimmed Station-owned human decision intents', () => {
    expect(ATELIER_DECISION_RESOLVE_REQUIRED_FIELDS).toEqual(['taskId', 'blockId', 'choice']);
    expect(buildAtelierDecisionResolveIntent({
      taskId: ' task-1 ',
      blockId: ' decision-1 ',
      choice: ' accept-risk ',
      pendingBlockId: '',
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        blockId: 'decision-1',
        choice: 'accept-risk',
      },
    });
  });

  it('blocks empty identity fields, empty choice, and concurrent decision submissions', () => {
    expect(buildAtelierDecisionResolveIntent({ taskId: '', blockId: 'decision-1', choice: 'accept', pendingBlockId: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierDecisionResolveIntent({ taskId: 'task-1', blockId: '', choice: 'accept', pendingBlockId: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierDecisionResolveIntent({ taskId: 'task-1', blockId: 'decision-1', choice: '   ', pendingBlockId: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierDecisionResolveIntent({ taskId: 'task-1', blockId: 'decision-1', choice: 'accept', pendingBlockId: 'decision-0' })).toEqual({ status: 'blocked' });
  });

  it('rejects execution-shaped applet payload actions before service binding', () => {
    expect(ATELIER_DECISION_RESOLVE_FORBIDDEN_ACTIONS).toEqual(expect.arrayContaining([
      'resume',
      'rerun',
      'execute',
      'provider.invoke',
      'taskGraph.diff.apply',
      'memory.write',
      'input_snapshot.write',
    ]));
    expect(containsForbiddenAtelierDecisionPayloadActions({ resume: true })).toBe(true);
    expect(containsForbiddenAtelierDecisionPayloadActions({ 'provider.invoke': { provider: 'codex' } })).toBe(true);
    expect(buildAtelierDecisionResolveIntent({
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: 'accept',
      pendingBlockId: '',
      extraPayload: { execute: true },
    })).toEqual({ status: 'invalid' });
  });

  it('keeps resume-like choices as Station human decisions, not applet execution actions', () => {
    expect(buildAtelierDecisionResolveIntent({
      taskId: 'task-1',
      blockId: 'decision-1',
      choice: 'resume',
      pendingBlockId: '',
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        blockId: 'decision-1',
        choice: 'resume',
      },
    });
  });
});
