import { describe, expect, it } from 'vitest';
import {
  ATELIER_MEMORY_CONFIRM_FORBIDDEN_ACTIONS,
  ATELIER_MEMORY_CONFIRM_REQUIRED_FIELDS,
  ATELIER_RERUN_CONFIRM_FORBIDDEN_ACTIONS,
  ATELIER_RERUN_CONFIRM_REQUIRED_FIELDS,
  buildAtelierMemoryConfirmIntent,
  buildAtelierRerunConfirmIntent,
  containsForbiddenAtelierConfirmationPayloadActions,
} from './confirmationActionGuards';
import {
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from '../domain/projection.contract.generated';

describe('confirmation action guards', () => {
  it('builds trimmed Station-owned memory confirmation intents', () => {
    expect(ATELIER_MEMORY_CONFIRM_REQUIRED_FIELDS).toEqual(['taskId', 'feedbackId']);
    expect(buildAtelierMemoryConfirmIntent({
      taskId: ' task-1 ',
      feedbackId: ' feedback-1 ',
      pending: false,
      confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        feedbackId: 'feedback-1',
      },
    });
  });

  it('blocks empty memory confirmation identity fields and concurrent submissions', () => {
    expect(buildAtelierMemoryConfirmIntent({ taskId: '', feedbackId: 'feedback-1', pending: false, confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE })).toEqual({ status: 'blocked' });
    expect(buildAtelierMemoryConfirmIntent({ taskId: 'task-1', feedbackId: '', pending: false, confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE })).toEqual({ status: 'blocked' });
    expect(buildAtelierMemoryConfirmIntent({ taskId: 'task-1', feedbackId: 'feedback-1', pending: true, confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE })).toEqual({ status: 'blocked' });
  });

  it('rejects memory confirmation mode mismatch and applet memory-write payloads', () => {
    expect(ATELIER_MEMORY_CONFIRM_FORBIDDEN_ACTIONS).toEqual(['memory.write', 'invoke', 'execute', 'run']);
    expect(containsForbiddenAtelierConfirmationPayloadActions({
      payload: { 'memory.write': true },
      forbiddenActions: ATELIER_MEMORY_CONFIRM_FORBIDDEN_ACTIONS,
    })).toBe(true);
    expect(buildAtelierMemoryConfirmIntent({
      taskId: 'task-1',
      feedbackId: 'feedback-1',
      pending: false,
      confirmationMode: 'memory.write',
    })).toEqual({ status: 'invalid' });
    expect(buildAtelierMemoryConfirmIntent({
      taskId: 'task-1',
      feedbackId: 'feedback-1',
      pending: false,
      confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
      extraPayload: { execute: true },
    })).toEqual({ status: 'invalid' });
  });

  it('builds trimmed Station-owned rerun confirmation intents', () => {
    expect(ATELIER_RERUN_CONFIRM_REQUIRED_FIELDS).toEqual(['taskId', 'feedbackId']);
    expect(buildAtelierRerunConfirmIntent({
      taskId: ' task-1 ',
      feedbackId: ' feedback-1 ',
      pending: false,
      confirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        feedbackId: 'feedback-1',
      },
    });
  });

  it('rejects rerun confirmation mode mismatch and applet rerun payloads', () => {
    expect(ATELIER_RERUN_CONFIRM_FORBIDDEN_ACTIONS).toEqual(['rerun', 'invoke', 'execute', 'run']);
    expect(containsForbiddenAtelierConfirmationPayloadActions({
      payload: { rerun: true },
      forbiddenActions: ATELIER_RERUN_CONFIRM_FORBIDDEN_ACTIONS,
    })).toBe(true);
    expect(buildAtelierRerunConfirmIntent({
      taskId: 'task-1',
      feedbackId: 'feedback-1',
      pending: false,
      confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
    })).toEqual({ status: 'invalid' });
    expect(buildAtelierRerunConfirmIntent({
      taskId: 'task-1',
      feedbackId: 'feedback-1',
      pending: false,
      confirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
      extraPayload: { run: true },
    })).toEqual({ status: 'invalid' });
  });
});
