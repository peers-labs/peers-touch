import {
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from '../domain/projection.contract.generated';

const MEMORY_CONFIRM_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.memory.confirmCandidate'];
const RERUN_CONFIRM_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.confirmRerun'];

export const ATELIER_MEMORY_CONFIRM_REQUIRED_FIELDS = MEMORY_CONFIRM_PAYLOAD.requiredFields;
export const ATELIER_MEMORY_CONFIRM_FORBIDDEN_ACTIONS = MEMORY_CONFIRM_PAYLOAD.forbiddenActions;
export const ATELIER_RERUN_CONFIRM_REQUIRED_FIELDS = RERUN_CONFIRM_PAYLOAD.requiredFields;
export const ATELIER_RERUN_CONFIRM_FORBIDDEN_ACTIONS = RERUN_CONFIRM_PAYLOAD.forbiddenActions;

export interface AtelierConfirmationIntent {
  taskId: string;
  feedbackId: string;
}

export type AtelierConfirmationIntentResult =
  | { status: 'ready'; intent: AtelierConfirmationIntent }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierMemoryConfirmIntent(input: {
  taskId: string;
  feedbackId: string;
  pending: boolean;
  confirmationMode: string;
  extraPayload?: Record<string, unknown>;
}): AtelierConfirmationIntentResult {
  return buildAtelierConfirmationIntent({
    taskId: input.taskId,
    feedbackId: input.feedbackId,
    pending: input.pending,
    confirmationMode: input.confirmationMode,
    expectedConfirmationMode: ATELIER_MEMORY_CONFIRMATION_MODE,
    forbiddenActions: ATELIER_MEMORY_CONFIRM_FORBIDDEN_ACTIONS,
    extraPayload: input.extraPayload,
  });
}

export function buildAtelierRerunConfirmIntent(input: {
  taskId: string;
  feedbackId: string;
  pending: boolean;
  confirmationMode: string;
  extraPayload?: Record<string, unknown>;
}): AtelierConfirmationIntentResult {
  return buildAtelierConfirmationIntent({
    taskId: input.taskId,
    feedbackId: input.feedbackId,
    pending: input.pending,
    confirmationMode: input.confirmationMode,
    expectedConfirmationMode: ATELIER_RERUN_CONFIRMATION_MODE,
    forbiddenActions: ATELIER_RERUN_CONFIRM_FORBIDDEN_ACTIONS,
    extraPayload: input.extraPayload,
  });
}

export function containsForbiddenAtelierConfirmationPayloadActions(input: {
  payload: Record<string, unknown> | undefined;
  forbiddenActions: readonly string[];
}): boolean {
  if (!input.payload) return false;
  const forbidden = new Set<string>(input.forbiddenActions);
  return Object.keys(input.payload).some((field) => forbidden.has(field));
}

function buildAtelierConfirmationIntent(input: {
  taskId: string;
  feedbackId: string;
  pending: boolean;
  confirmationMode: string;
  expectedConfirmationMode: string;
  forbiddenActions: readonly string[];
  extraPayload?: Record<string, unknown>;
}): AtelierConfirmationIntentResult {
  const taskId = input.taskId.trim();
  const feedbackId = input.feedbackId.trim();
  if (!taskId || !feedbackId || input.pending) return { status: 'blocked' };
  if (
    input.confirmationMode !== input.expectedConfirmationMode ||
    containsForbiddenAtelierConfirmationPayloadActions({
      payload: input.extraPayload,
      forbiddenActions: input.forbiddenActions,
    })
  ) {
    return { status: 'invalid' };
  }
  return {
    status: 'ready',
    intent: { taskId, feedbackId },
  };
}
