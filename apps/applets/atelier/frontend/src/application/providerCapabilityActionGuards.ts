import {
  ATELIER_PROVIDER_CAPABILITY_READ_ONLY,
  ATELIER_PROVIDER_CAPABILITY_SCOPES,
  ATELIER_PROJECTION_CONTRACT,
} from '../domain/projection.contract.generated';

const PROVIDER_CAPABILITIES_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.provider.capabilities'];

export const ATELIER_PROVIDER_CAPABILITY_FORBIDDEN_ACTIONS = PROVIDER_CAPABILITIES_PAYLOAD.forbiddenActions;
export const ATELIER_PROVIDER_CAPABILITY_ALLOWED_SCOPES = PROVIDER_CAPABILITIES_PAYLOAD.allowedCapabilityScopes;
export const ATELIER_PROVIDER_CAPABILITY_INSERT_READ_ONLY = PROVIDER_CAPABILITIES_PAYLOAD.capabilityReadOnly;

export interface AtelierProviderCapabilityCommandInsertIntent {
  command: string;
}

export interface AtelierProviderCapabilityDiscoveryIntent {
  taskId?: string;
}

export type AtelierProviderCapabilityCommandInsertIntentResult =
  | { status: 'ready'; intent: AtelierProviderCapabilityCommandInsertIntent }
  | { status: 'blocked' }
  | { status: 'invalid' };

export type AtelierProviderCapabilityDiscoveryIntentResult =
  | { status: 'ready'; intent: AtelierProviderCapabilityDiscoveryIntent }
  | { status: 'invalid' };

export function buildAtelierProviderCapabilityDiscoveryIntent(input: {
  taskId: string;
  extraPayload?: Record<string, unknown>;
}): AtelierProviderCapabilityDiscoveryIntentResult {
  if (containsForbiddenAtelierProviderCapabilityPayloadActions(input.extraPayload)) return { status: 'invalid' };
  const taskId = input.taskId.trim();
  return {
    status: 'ready',
    intent: taskId ? { taskId } : {},
  };
}

export function buildAtelierProviderCapabilityCommandInsertIntent(input: {
  command: string;
  scope?: string;
  readOnly?: boolean;
  extraPayload?: Record<string, unknown>;
}): AtelierProviderCapabilityCommandInsertIntentResult {
  const command = input.command.trim();
  if (!command) return { status: 'blocked' };
  if (
    !command.startsWith('/') ||
    (input.scope !== undefined && !isAtelierProviderCapabilityScope(input.scope)) ||
    (input.readOnly !== undefined && input.readOnly !== ATELIER_PROVIDER_CAPABILITY_READ_ONLY) ||
    containsForbiddenAtelierProviderCapabilityPayloadActions(input.extraPayload)
  ) {
    return { status: 'invalid' };
  }
  return {
    status: 'ready',
    intent: { command },
  };
}

export function appendAtelierProviderCapabilityCommand(input: {
  currentComposerText: string;
  command: string;
}): string {
  const existing = input.currentComposerText.trim();
  const command = input.command.trim();
  return existing ? `${existing} ${command} ` : `${command} `;
}

export function containsForbiddenAtelierProviderCapabilityPayloadActions(
  payload: Record<string, unknown> | undefined,
): boolean {
  if (!payload) return false;
  const forbidden = new Set<string>(ATELIER_PROVIDER_CAPABILITY_FORBIDDEN_ACTIONS);
  return Object.keys(payload).some((field) => forbidden.has(field));
}

export function isAtelierProviderCapabilityScope(value: string): value is typeof ATELIER_PROVIDER_CAPABILITY_SCOPES[number] {
  return (ATELIER_PROVIDER_CAPABILITY_SCOPES as readonly string[]).includes(value);
}
