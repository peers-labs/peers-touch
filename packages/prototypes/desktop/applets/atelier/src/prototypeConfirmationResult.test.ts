import { describe, expect, it } from 'vitest';
import type {
  ConfirmMemoryCandidateResponse,
  ConfirmRerunResponse,
} from './runtime';
import {
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from './projection.contract.generated';
import {
  buildPrototypeConfirmationRequestKey,
  buildPrototypeMemoryConfirmationResponse,
  buildPrototypeRerunConfirmationResponse,
  derivePrototypeMemoryConfirmationStatus,
  derivePrototypeRerunConfirmationStatus,
  prototypeMemoryConfirmationErrorStatus,
  prototypeRerunConfirmationErrorStatus,
  shouldApplyPrototypeConfirmationResponse,
} from './prototypeConfirmationResult';

describe('prototype confirmation responses', () => {
  it('builds memory confirmation as a Station-owned response without writing memory', () => {
    const response = buildPrototypeMemoryConfirmationResponse({
      taskId: 'task-1',
      feedbackId: 'feedback-memory-1',
    });

    expect(response).toEqual({
      accepted: true,
      feedbackId: 'feedback-memory-1',
      memoryId: 'prototype-memory-feedback-memory-1',
      status: 'confirmed',
      source: ATELIER_MEMORY_CONFIRMATION_MODE,
      alreadyDone: false,
    });
    expect(JSON.stringify(response)).not.toMatch(/memory\.write|provider\.invoke|runtime\.execute|shell|input_snapshot/);
  });

  it('builds rerun confirmation as a Station-owned response without rerunning locally', () => {
    const response = buildPrototypeRerunConfirmationResponse({
      taskId: 'task-1',
      feedbackId: 'feedback-rerun-1',
    });

    expect(response).toEqual({
      accepted: true,
      feedbackId: 'feedback-rerun-1',
      taskId: 'task-1',
      rerunTaskId: 'prototype-rerun-feedback-rerun-1',
      status: 'confirmed',
      source: ATELIER_RERUN_CONFIRMATION_MODE,
      alreadyDone: false,
      started: true,
    });
    expect(JSON.stringify(response)).not.toMatch(/provider\.invoke|runtime\.execute|shell|input_snapshot/);
  });
});

describe('derivePrototypeMemoryConfirmationStatus', () => {
  it('shows Station-owned memory confirmation result ids', () => {
    const response: ConfirmMemoryCandidateResponse = {
      accepted: true,
      feedbackId: 'feedback-1',
      memoryId: 'memory-1',
      status: 'confirmed',
      source: ATELIER_MEMORY_CONFIRMATION_MODE,
      alreadyDone: false,
    };
    expect(derivePrototypeMemoryConfirmationStatus(response)).toBe('memory-confirmed:memory-1');
  });
});

describe('derivePrototypeRerunConfirmationStatus', () => {
  it('shows Station-owned rerun task result ids', () => {
    const response: ConfirmRerunResponse = {
      accepted: true,
      feedbackId: 'feedback-1',
      taskId: 'task-1',
      rerunTaskId: 'task-rerun-1',
      status: 'created',
      source: 'prototype.station.feedback.confirm-rerun',
      alreadyDone: false,
      started: true,
    };
    expect(derivePrototypeRerunConfirmationStatus(response)).toBe('rerun-confirmed:task-rerun-1');
  });
});

describe('prototype confirmation error status', () => {
  it('uses Error messages for memory confirmation failures', () => {
    expect(prototypeMemoryConfirmationErrorStatus(new Error('memory candidate rejected'))).toBe('memory candidate rejected');
  });

  it('uses a bounded fallback for unknown memory confirmation failures', () => {
    expect(prototypeMemoryConfirmationErrorStatus('boom')).toBe('memory confirmation unavailable');
  });

  it('uses Error messages for rerun confirmation failures', () => {
    expect(prototypeRerunConfirmationErrorStatus(new Error('rerun rejected'))).toBe('rerun rejected');
  });

  it('uses a bounded fallback for unknown rerun confirmation failures', () => {
    expect(prototypeRerunConfirmationErrorStatus('boom')).toBe('rerun confirmation unavailable');
  });
});

describe('prototype confirmation request ownership', () => {
  it('keys confirmation requests by kind, task, feedback, and block without execution payloads', () => {
    expect(buildPrototypeConfirmationRequestKey({
      kind: 'memory',
      taskId: ' task-1 ',
      feedbackId: ' feedback-1 ',
      blockId: ' block-1 ',
    })).toBe('kind:memory|task:task-1|feedback:feedback-1|block:block-1');
    expect(buildPrototypeConfirmationRequestKey({
      kind: 'rerun',
      taskId: '',
      feedbackId: '',
      blockId: '',
    })).toBe('kind:rerun|task:workspace|feedback:none|block:none');
  });

  it('rejects stale confirmation responses after task, feedback, or kind ownership changes', () => {
    const currentRequestKey = buildPrototypeConfirmationRequestKey({
      kind: 'memory',
      taskId: 'task-2',
      feedbackId: 'feedback-2',
      blockId: 'block-1',
    });
    const staleTaskKey = buildPrototypeConfirmationRequestKey({
      kind: 'memory',
      taskId: 'task-1',
      feedbackId: 'feedback-2',
      blockId: 'block-1',
    });
    const staleKindKey = buildPrototypeConfirmationRequestKey({
      kind: 'rerun',
      taskId: 'task-2',
      feedbackId: 'feedback-2',
      blockId: 'block-1',
    });

    expect(shouldApplyPrototypeConfirmationResponse({
      currentRequestKey,
      responseRequestKey: currentRequestKey,
    })).toBe(true);
    expect(shouldApplyPrototypeConfirmationResponse({
      currentRequestKey,
      responseRequestKey: staleTaskKey,
    })).toBe(false);
    expect(shouldApplyPrototypeConfirmationResponse({
      currentRequestKey,
      responseRequestKey: staleKindKey,
    })).toBe(false);
    expect(shouldApplyPrototypeConfirmationResponse({
      currentRequestKey,
      responseRequestKey: '',
    })).toBe(false);
    expect(`${currentRequestKey} ${staleTaskKey} ${staleKindKey}`).not.toMatch(/memory\.write|provider\.invoke|runtime\.execute|shell|rerun\.execute|input_snapshot/);
  });
});
