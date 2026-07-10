import { ATELIER_PROJECTION_CONTRACT } from '../domain/projection.contract.generated';

const MESSAGE_SEND_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.message.send'];

export const ATELIER_MESSAGE_SEND_REQUIRED_FIELDS = MESSAGE_SEND_PAYLOAD.requiredFields;
export const ATELIER_MESSAGE_SEND_FORBIDDEN_APPLET_FIELDS = MESSAGE_SEND_PAYLOAD.forbiddenAppletFields;
export const ATELIER_MESSAGE_SEND_FORBIDDEN_ACTIONS = MESSAGE_SEND_PAYLOAD.forbiddenActions;

export interface AtelierMessageSendIntent {
  taskId: string;
  text: string;
}

export type AtelierMessageSendIntentResult =
  | { status: 'ready'; intent: AtelierMessageSendIntent }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierMessageSendIntent(input: {
  taskId: string;
  text: string;
  pending: boolean;
  extraPayload?: Record<string, unknown>;
}): AtelierMessageSendIntentResult {
  const taskId = input.taskId.trim();
  const text = input.text.trim();
  if (!taskId || !text || input.pending) return { status: 'blocked' };
  if (containsForbiddenAtelierMessagePayloadFields(input.extraPayload)) return { status: 'invalid' };
  return {
    status: 'ready',
    intent: { taskId, text },
  };
}

export function containsForbiddenAtelierMessagePayloadFields(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  const forbidden = new Set<string>(ATELIER_MESSAGE_SEND_FORBIDDEN_APPLET_FIELDS);
  return Object.keys(payload).some((field) => forbidden.has(field));
}
