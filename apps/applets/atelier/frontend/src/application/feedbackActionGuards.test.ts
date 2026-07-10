import { describe, expect, it } from 'vitest';
import {
  ATELIER_FEEDBACK_SUBMIT_FORBIDDEN_ACTIONS,
  ATELIER_FEEDBACK_SUBMIT_OPTIONAL_FIELDS,
  ATELIER_FEEDBACK_SUBMIT_REQUIRED_FIELDS,
  buildAtelierFeedbackSubmitIntent,
  containsForbiddenAtelierFeedbackPayloadActions,
  isAtelierFeedbackSignal,
} from './feedbackActionGuards';

describe('feedback action guards', () => {
  it('builds trimmed Station-owned feedback submit intents', () => {
    expect(ATELIER_FEEDBACK_SUBMIT_REQUIRED_FIELDS).toEqual(['taskId', 'blockId', 'signal']);
    expect(ATELIER_FEEDBACK_SUBMIT_OPTIONAL_FIELDS).toEqual(['comment']);
    expect(buildAtelierFeedbackSubmitIntent({
      taskId: ' task-1 ',
      blockId: ' block-1 ',
      signal: 'positive',
      pendingFeedbackId: '',
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        blockId: 'block-1',
        signal: 'positive',
      },
      submitKey: 'block-1:positive',
    });
  });

  it('blocks empty identity fields and concurrent feedback submissions', () => {
    expect(buildAtelierFeedbackSubmitIntent({ taskId: '', blockId: 'block-1', signal: 'positive', pendingFeedbackId: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierFeedbackSubmitIntent({ taskId: 'task-1', blockId: '', signal: 'positive', pendingFeedbackId: '' })).toEqual({ status: 'blocked' });
    expect(buildAtelierFeedbackSubmitIntent({ taskId: 'task-1', blockId: 'block-1', signal: 'positive', pendingFeedbackId: 'block-0:positive' })).toEqual({ status: 'blocked' });
  });

  it('rejects signals outside the generated feedback taxonomy', () => {
    expect(isAtelierFeedbackSignal('positive')).toBe(true);
    expect(isAtelierFeedbackSignal('negative')).toBe(true);
    expect(isAtelierFeedbackSignal('copy')).toBe(true);
    expect(isAtelierFeedbackSignal('regenerate')).toBe(true);
    expect(buildAtelierFeedbackSubmitIntent({
      taskId: 'task-1',
      blockId: 'block-1',
      signal: 'memory.write',
      pendingFeedbackId: '',
    })).toEqual({ status: 'invalid' });
  });

  it('rejects execution-shaped applet feedback payload actions before service binding', () => {
    expect(ATELIER_FEEDBACK_SUBMIT_FORBIDDEN_ACTIONS).toEqual(['memory.write', 'rerun', 'invoke', 'execute', 'run']);
    expect(containsForbiddenAtelierFeedbackPayloadActions({ 'memory.write': true })).toBe(true);
    expect(containsForbiddenAtelierFeedbackPayloadActions({ rerun: { taskId: 'task-1' } })).toBe(true);
    expect(buildAtelierFeedbackSubmitIntent({
      taskId: 'task-1',
      blockId: 'block-1',
      signal: 'regenerate',
      pendingFeedbackId: '',
      extraPayload: { execute: true },
    })).toEqual({ status: 'invalid' });
  });

  it('keeps regenerate as a Station feedback signal, not an applet rerun action', () => {
    expect(buildAtelierFeedbackSubmitIntent({
      taskId: 'task-1',
      blockId: 'block-1',
      signal: 'regenerate',
      pendingFeedbackId: '',
    })).toEqual({
      status: 'ready',
      intent: {
        taskId: 'task-1',
        blockId: 'block-1',
        signal: 'regenerate',
      },
      submitKey: 'block-1:regenerate',
    });
  });
});
