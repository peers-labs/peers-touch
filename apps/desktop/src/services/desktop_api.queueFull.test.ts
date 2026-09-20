import { describe, expect, it } from 'vitest';

import {
  agentTurnStreamErrorFromData,
  isAgentQueueFullError,
} from './desktop_api';

describe('Desktop queue-full typed error mapping', () => {
  it('maps only the canonical Station contract to edit-queue', () => {
    const error = agentTurnStreamErrorFromData({
      error: 'agent.errors.queueFull',
      error_type: 'ADMISSION_QUEUE_FULL',
      locale_key: 'agent.errors.queueFull',
      retryable: true,
      terminal: true,
      details: {
        conversation_id: 'conversation-1',
        capacity: '8',
      },
    });

    expect(isAgentQueueFullError(error.typedError)).toBe(true);
    expect(error.resolution).toEqual({
      type: 'editQueue',
      conversationId: 'conversation-1',
      capacity: 8,
      label: 'agent.recovery.editQueue',
    });
  });

  it.each([
    ['wrong type', 'OTHER_ERROR', 'agent.errors.queueFull', true, true, {
      conversation_id: 'conversation-1',
      capacity: '8',
    }],
    ['wrong locale', 'ADMISSION_QUEUE_FULL', 'agent.errors.forbiddenActor', true, true, {
      conversation_id: 'conversation-1',
      capacity: '8',
    }],
    ['non-retryable', 'ADMISSION_QUEUE_FULL', 'agent.errors.queueFull', false, true, {
      conversation_id: 'conversation-1',
      capacity: '8',
    }],
    ['non-terminal', 'ADMISSION_QUEUE_FULL', 'agent.errors.queueFull', true, false, {
      conversation_id: 'conversation-1',
      capacity: '8',
    }],
    ['empty conversation', 'ADMISSION_QUEUE_FULL', 'agent.errors.queueFull', true, true, {
      conversation_id: ' ',
      capacity: '8',
    }],
    ['zero capacity', 'ADMISSION_QUEUE_FULL', 'agent.errors.queueFull', true, true, {
      conversation_id: 'conversation-1',
      capacity: '0',
    }],
    ['fractional capacity', 'ADMISSION_QUEUE_FULL', 'agent.errors.queueFull', true, true, {
      conversation_id: 'conversation-1',
      capacity: '8.5',
    }],
    ['extra detail', 'ADMISSION_QUEUE_FULL', 'agent.errors.queueFull', true, true, {
      conversation_id: 'conversation-1',
      capacity: '8',
      queue_entry_id: 'queue-1',
    }],
  ])('rejects %s from local recovery mapping', (
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

    expect(isAgentQueueFullError(error.typedError)).toBe(false);
    expect(error.resolution).toBeUndefined();
  });
});
