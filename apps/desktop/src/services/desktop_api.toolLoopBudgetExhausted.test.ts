import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentToolLoopBudgetExhaustedError,
} from './desktop_api';

describe('Desktop tool-loop budget typed error mapping', () => {
  it('maps the canonical Station payload to budget inspection', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.toolLoopBudgetExhausted',
      error_type: 'TOOL_LOOP_BUDGET_EXHAUSTED',
      locale_key: 'agent.errors.toolLoopBudgetExhausted',
      retryable: false,
      terminal: true,
      details: {
        turn_id: 'turn-1',
        budget_kind: 'tool_calls',
        limit: '2',
      },
    });

    expect(isAgentToolLoopBudgetExhaustedError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'inspectBudget',
      turnId: 'turn-1',
      budgetKind: 'tool_calls',
      limit: '2',
      label: 'agent.recovery.inspectBudget',
    });
  });

  it('preserves the flat transport details', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.toolLoopBudgetExhausted',
      error_type: 'TOOL_LOOP_BUDGET_EXHAUSTED',
      locale_key: 'agent.errors.toolLoopBudgetExhausted',
      retryable: false,
      terminal: true,
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '2',
    });

    expect(error.typedError?.details).toEqual({
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '2',
    });
    expect(isAgentToolLoopBudgetExhaustedError(error.typedError)).toBe(true);
  });

  it.each([
    ['wrong type', 'OTHER', 'agent.errors.toolLoopBudgetExhausted', false, true, {
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '2',
    }],
    ['wrong locale', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolUnknown', false, true, {
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '2',
    }],
    ['retryable', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolLoopBudgetExhausted', true, true, {
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '2',
    }],
    ['non-terminal', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolLoopBudgetExhausted', false, false, {
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '2',
    }],
    ['empty turn', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolLoopBudgetExhausted', false, true, {
      turn_id: '',
      budget_kind: 'tool_calls',
      limit: '2',
    }],
    ['unknown kind', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolLoopBudgetExhausted', false, true, {
      turn_id: 'turn-1',
      budget_kind: 'other',
      limit: '2',
    }],
    ['zero limit', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolLoopBudgetExhausted', false, true, {
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '0',
    }],
    ['legacy details', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolLoopBudgetExhausted', false, true, {
      reason: 'max_tool_calls_exhausted',
      limit: '2',
      consumed: '2',
    }],
    ['extra detail', 'TOOL_LOOP_BUDGET_EXHAUSTED', 'agent.errors.toolLoopBudgetExhausted', false, true, {
      turn_id: 'turn-1',
      budget_kind: 'tool_calls',
      limit: '2',
      consumed: '2',
    }],
  ])('rejects %s', (
    _case,
    errorType,
    localeKey,
    retryable,
    terminal,
    details,
  ) => {
    const error = agentTurnStreamErrorFromData({
      error: localeKey,
      error_type: errorType,
      locale_key: localeKey,
      retryable,
      terminal,
      details,
    });

    expect(isAgentToolLoopBudgetExhaustedError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
