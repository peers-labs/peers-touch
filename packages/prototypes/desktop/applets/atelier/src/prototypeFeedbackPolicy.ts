import type { AtelierFeedbackSignal, SubmitFeedbackResponse } from './runtime';
import {
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from './projection.contract.generated';

export interface PrototypeFeedbackPolicyView {
  policy: string;
  statusText: string;
  requiresMemoryConfirmation: boolean;
  requiresRerunConfirmation: boolean;
}

export function buildPrototypeFeedbackRequestKey(input: {
  taskId?: string;
  blockId?: string;
  signal?: AtelierFeedbackSignal;
}): string {
  const taskId = input.taskId?.trim() || 'workspace';
  const blockId = input.blockId?.trim() || 'none';
  const signal = input.signal ?? 'none';
  return `task:${taskId}|block:${blockId}|signal:${signal}`;
}

export function shouldApplyPrototypeFeedbackResponse(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function buildPrototypeFeedbackResponse(input: {
  signal: AtelierFeedbackSignal;
  feedbackId: string;
}): SubmitFeedbackResponse {
  const signal = input.signal;
  return {
    accepted: true,
    feedbackId: input.feedbackId,
    memoryCandidate:
      signal === 'positive' || signal === 'negative'
        ? {
            status: 'candidate',
            reason: 'prototype records only a weak memory candidate signal',
            requiresConfirmation: true,
            confirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
            feeds: signal === 'negative' ? ['planner', 'risk', 'verifier'] : ['planner', 'verifier'],
          }
        : {
            status: 'not_applicable',
            reason: 'signal does not create a memory candidate',
            requiresConfirmation: false,
            confirmationMode: 'not_required',
            feeds: [],
          },
    rerunIntent:
      signal === 'regenerate'
        ? {
            status: 'intent_recorded',
            reason: 'prototype records rerun intent and waits for Station rerun review confirmation',
            requiresConfirmation: true,
            confirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
            feeds: [],
          }
        : {
            status: 'not_requested',
            reason: 'signal does not request rerun',
            requiresConfirmation: false,
            confirmationMode: 'not_required',
            feeds: [],
          },
  };
}

export function derivePrototypeFeedbackPolicyView(input: {
  signal: AtelierFeedbackSignal;
  response: SubmitFeedbackResponse;
}): PrototypeFeedbackPolicyView {
  const { signal, response } = input;
  const policy =
    signal === 'regenerate'
      ? response.rerunIntent.status
      : signal === 'positive' || signal === 'negative'
        ? response.memoryCandidate.status
        : 'acknowledged';
  const requiresMemoryConfirmation =
    response.memoryCandidate.requiresConfirmation &&
    response.memoryCandidate.confirmationMode === ATELIER_MEMORY_CONFIRMATION_MODE;
  const requiresRerunConfirmation =
    response.rerunIntent.requiresConfirmation &&
    response.rerunIntent.confirmationMode === ATELIER_RERUN_CONFIRMATION_MODE;
  const confirmation =
    requiresMemoryConfirmation
      ? ' · Station memory confirmation required'
      : requiresRerunConfirmation
        ? ' · Station rerun review required'
        : '';
  return {
    policy,
    statusText: `${signal}:${policy}${confirmation}`,
    requiresMemoryConfirmation,
    requiresRerunConfirmation,
  };
}
