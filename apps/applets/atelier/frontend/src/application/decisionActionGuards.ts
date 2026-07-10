import { ATELIER_PROJECTION_CONTRACT } from '../domain/projection.contract.generated';

const DECISION_RESOLVE_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.escalation.resolve'];

export const ATELIER_DECISION_RESOLVE_REQUIRED_FIELDS = DECISION_RESOLVE_PAYLOAD.requiredFields;
export const ATELIER_DECISION_RESOLVE_FORBIDDEN_ACTIONS = DECISION_RESOLVE_PAYLOAD.forbiddenActions;

export interface AtelierDecisionResolveIntent {
  taskId: string;
  blockId: string;
  choice: string;
}

export type AtelierDecisionResolveIntentResult =
  | { status: 'ready'; intent: AtelierDecisionResolveIntent }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierDecisionResolveIntent(input: {
  taskId: string;
  blockId: string;
  choice: string;
  pendingBlockId: string;
  extraPayload?: Record<string, unknown>;
}): AtelierDecisionResolveIntentResult {
  const taskId = input.taskId.trim();
  const blockId = input.blockId.trim();
  const choice = input.choice.trim();
  if (!taskId || !blockId || !choice || input.pendingBlockId) return { status: 'blocked' };
  if (containsForbiddenAtelierDecisionPayloadActions(input.extraPayload)) return { status: 'invalid' };
  return {
    status: 'ready',
    intent: { taskId, blockId, choice },
  };
}

export function containsForbiddenAtelierDecisionPayloadActions(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  const forbidden = new Set<string>(ATELIER_DECISION_RESOLVE_FORBIDDEN_ACTIONS);
  return Object.keys(payload).some((field) => forbidden.has(field));
}
