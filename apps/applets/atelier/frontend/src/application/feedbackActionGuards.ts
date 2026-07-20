import {
  ATELIER_FEEDBACK_SIGNALS,
  ATELIER_PROJECTION_CONTRACT,
  type AtelierFeedbackSignal,
} from '../domain/projection.contract.generated';

const FEEDBACK_SUBMIT_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.feedback.submit'];

export const ATELIER_FEEDBACK_SUBMIT_REQUIRED_FIELDS = FEEDBACK_SUBMIT_PAYLOAD.requiredFields;
export const ATELIER_FEEDBACK_SUBMIT_OPTIONAL_FIELDS = FEEDBACK_SUBMIT_PAYLOAD.optionalFields;
export const ATELIER_FEEDBACK_SUBMIT_FORBIDDEN_ACTIONS = FEEDBACK_SUBMIT_PAYLOAD.forbiddenActions;

export interface AtelierFeedbackSubmitIntent {
  taskId: string;
  blockId: string;
  signal: AtelierFeedbackSignal;
}

export type AtelierFeedbackSubmitIntentResult =
  | { status: 'ready'; intent: AtelierFeedbackSubmitIntent; submitKey: string }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierFeedbackSubmitIntent(input: {
  taskId: string;
  blockId: string;
  signal: AtelierFeedbackSignal | string;
  pendingFeedbackId: string;
  extraPayload?: Record<string, unknown>;
}): AtelierFeedbackSubmitIntentResult {
  const taskId = input.taskId.trim();
  const blockId = input.blockId.trim();
  const signal = input.signal.trim();
  if (!taskId || !blockId || input.pendingFeedbackId) return { status: 'blocked' };
  if (!isAtelierFeedbackSignal(signal) || containsForbiddenAtelierFeedbackPayloadActions(input.extraPayload)) {
    return { status: 'invalid' };
  }
  return {
    status: 'ready',
    intent: { taskId, blockId, signal },
    submitKey: `${blockId}:${signal}`,
  };
}

export function isAtelierFeedbackSignal(value: string): value is AtelierFeedbackSignal {
  return (ATELIER_FEEDBACK_SIGNALS as readonly string[]).includes(value);
}

export function containsForbiddenAtelierFeedbackPayloadActions(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  const forbidden = new Set<string>(ATELIER_FEEDBACK_SUBMIT_FORBIDDEN_ACTIONS);
  return Object.keys(payload).some((field) => forbidden.has(field));
}
