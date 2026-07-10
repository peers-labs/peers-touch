import { describe, expect, it } from 'vitest';
import type { SubmitFeedbackResponse } from './runtime';
import {
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from './projection.contract.generated';
import {
  buildPrototypeFeedbackRequestKey,
  buildPrototypeFeedbackResponse,
  derivePrototypeFeedbackPolicyView,
  shouldApplyPrototypeFeedbackResponse,
} from './prototypeFeedbackPolicy';

function response(partial: Partial<SubmitFeedbackResponse>): SubmitFeedbackResponse {
  return {
    accepted: true,
    feedbackId: 'feedback-1',
    memoryCandidate: {
      status: 'not_applicable',
      reason: 'not applicable',
      requiresConfirmation: false,
      confirmationMode: 'not_required',
      feeds: [],
    },
    rerunIntent: {
      status: 'not_requested',
      reason: 'not requested',
      requiresConfirmation: false,
      confirmationMode: 'not_required',
      feeds: [],
    },
    ...partial,
  };
}

describe('derivePrototypeFeedbackPolicyView', () => {
  it('builds positive feedback as a weak Station memory candidate without writing memory', () => {
    expect(buildPrototypeFeedbackResponse({
      signal: 'positive',
      feedbackId: 'feedback-1',
    })).toEqual({
      accepted: true,
      feedbackId: 'feedback-1',
      memoryCandidate: {
        status: 'candidate',
        reason: 'prototype records only a weak memory candidate signal',
        requiresConfirmation: true,
        confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
        feeds: ['planner', 'verifier'],
      },
      rerunIntent: {
        status: 'not_requested',
        reason: 'signal does not request rerun',
        requiresConfirmation: false,
        confirmationMode: 'not_required',
        feeds: [],
      },
    });
  });

  it('builds negative feedback with risk feed routing but no execution payloads', () => {
    const response = buildPrototypeFeedbackResponse({
      signal: 'negative',
      feedbackId: 'feedback-2',
    });

    expect(response.memoryCandidate.feeds).toEqual(['planner', 'risk', 'verifier']);
    expect(JSON.stringify(response)).not.toMatch(/memory\.write|provider\.invoke|runtime\.execute|shell|input_snapshot/);
  });

  it('builds regenerate feedback as a Station rerun review intent without rerunning locally', () => {
    expect(buildPrototypeFeedbackResponse({
      signal: 'regenerate',
      feedbackId: 'feedback-3',
    })).toMatchObject({
      accepted: true,
      feedbackId: 'feedback-3',
      memoryCandidate: {
        status: 'not_applicable',
        requiresConfirmation: false,
        confirmationMode: 'not_required',
      },
      rerunIntent: {
        status: 'intent_recorded',
        requiresConfirmation: true,
        confirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
      },
    });
  });

  it('builds neutral feedback as acknowledgement only', () => {
    expect(buildPrototypeFeedbackResponse({
      signal: 'neutral',
      feedbackId: 'feedback-4',
    })).toMatchObject({
      accepted: true,
      feedbackId: 'feedback-4',
      memoryCandidate: {
        status: 'not_applicable',
        requiresConfirmation: false,
      },
      rerunIntent: {
        status: 'not_requested',
        requiresConfirmation: false,
      },
    });
  });

  it('uses generated memory confirmation mode for positive memory candidates', () => {
    expect(derivePrototypeFeedbackPolicyView({
      signal: 'positive',
      response: response({
        memoryCandidate: {
          status: 'candidate',
          reason: 'remember useful context',
          requiresConfirmation: true,
          confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
          feeds: ['planner'],
        },
      }),
    })).toEqual({
      policy: 'candidate',
      statusText: 'positive:candidate · Station memory confirmation required',
      requiresMemoryConfirmation: true,
      requiresRerunConfirmation: false,
    });
  });

  it('uses generated rerun confirmation mode for regenerate feedback', () => {
    expect(derivePrototypeFeedbackPolicyView({
      signal: 'regenerate',
      response: response({
        rerunIntent: {
          status: 'intent_recorded',
          reason: 'review rerun',
          requiresConfirmation: true,
          confirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
          feeds: [],
        },
      }),
    })).toEqual({
      policy: 'intent_recorded',
      statusText: 'regenerate:intent_recorded · Station rerun review required',
      requiresMemoryConfirmation: false,
      requiresRerunConfirmation: true,
    });
  });

  it('does not show confirmation affordances when confirmation mode does not match generated modes', () => {
    expect(derivePrototypeFeedbackPolicyView({
      signal: 'negative',
      response: response({
        memoryCandidate: {
          status: 'candidate',
          reason: 'bad mode',
          requiresConfirmation: true,
          confirmationMode: 'local_memory_write',
          feeds: ['risk'],
        },
      }),
    })).toEqual({
      policy: 'candidate',
      statusText: 'negative:candidate',
      requiresMemoryConfirmation: false,
      requiresRerunConfirmation: false,
    });
  });

  it('keeps neutral feedback acknowledged without memory or rerun confirmation', () => {
    expect(derivePrototypeFeedbackPolicyView({
      signal: 'neutral',
      response: response({}),
    })).toEqual({
      policy: 'acknowledged',
      statusText: 'neutral:acknowledged',
      requiresMemoryConfirmation: false,
      requiresRerunConfirmation: false,
    });
  });

  it('keys feedback submission by task, block, and signal without execution payloads', () => {
    expect(buildPrototypeFeedbackRequestKey({
      taskId: ' task-1 ',
      blockId: ' block-1 ',
      signal: 'positive',
    })).toBe('task:task-1|block:block-1|signal:positive');
    expect(buildPrototypeFeedbackRequestKey({})).toBe('task:workspace|block:none|signal:none');
    expect(buildPrototypeFeedbackRequestKey({
      taskId: '',
      blockId: '',
      signal: 'regenerate',
    })).toBe('task:workspace|block:none|signal:regenerate');
  });

  it('rejects stale feedback responses after task or signal ownership changes', () => {
    const currentRequestKey = buildPrototypeFeedbackRequestKey({
      taskId: 'task-2',
      blockId: 'block-1',
      signal: 'positive',
    });
    const staleTaskKey = buildPrototypeFeedbackRequestKey({
      taskId: 'task-1',
      blockId: 'block-1',
      signal: 'positive',
    });
    const staleSignalKey = buildPrototypeFeedbackRequestKey({
      taskId: 'task-2',
      blockId: 'block-1',
      signal: 'negative',
    });

    expect(shouldApplyPrototypeFeedbackResponse({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeFeedbackResponse({
      currentRequestKey,
      responseRequestKey: staleTaskKey,
    })).toBe(false);
    expect(shouldApplyPrototypeFeedbackResponse({
      currentRequestKey,
      responseRequestKey: staleSignalKey,
    })).toBe(false);
    expect(shouldApplyPrototypeFeedbackResponse({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleTaskKey} ${staleSignalKey}`).not.toMatch(/memory\.write|provider\.invoke|runtime\.execute|shell|input_snapshot/);
  });
});
