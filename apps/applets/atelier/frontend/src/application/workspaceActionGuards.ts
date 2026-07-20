import type { AtelierWorkspaceOpenTarget } from '../domain/projection';
import {
  ATELIER_PROJECTION_CONTRACT,
  ATELIER_WORKSPACE_OPEN_URI_SCHEMES,
  ATELIER_WORKSPACE_OPEN_URI_SHAPE,
} from '../domain/projection.contract.generated';

const WORKSPACE_OPEN_PAYLOAD = ATELIER_PROJECTION_CONTRACT.methodPayloads['atelier.workspace.open'];

export const ATELIER_WORKSPACE_OPEN_REQUIRED_FIELDS = WORKSPACE_OPEN_PAYLOAD.requiredFields;
export const ATELIER_WORKSPACE_OPEN_OPTIONAL_FIELDS = WORKSPACE_OPEN_PAYLOAD.optionalFields;
export const ATELIER_WORKSPACE_OPEN_FORBIDDEN_ACTIONS = WORKSPACE_OPEN_PAYLOAD.forbiddenActions;

export interface AtelierWorkspaceOpenIntent {
  taskId: string;
  workspaceUri: string;
  ideHint?: string;
}

export type AtelierWorkspaceOpenIntentResult =
  | { status: 'ready'; intent: AtelierWorkspaceOpenIntent }
  | { status: 'blocked' }
  | { status: 'invalid' };

export function buildAtelierWorkspaceOpenIntent(input: {
  taskId: string;
  target: AtelierWorkspaceOpenTarget | undefined;
  pendingWorkspaceOpenId: string;
  extraPayload?: Record<string, unknown>;
}): AtelierWorkspaceOpenIntentResult {
  const taskId = input.taskId.trim();
  if (!taskId || !input.target || input.pendingWorkspaceOpenId) return { status: 'blocked' };
  if (
    !isCanonicalAtelierWorkspaceOpenTarget(input.target, taskId) ||
    containsForbiddenAtelierWorkspacePayloadActions(input.extraPayload)
  ) {
    return { status: 'invalid' };
  }
  return {
    status: 'ready',
    intent: {
      taskId,
      workspaceUri: input.target.workspaceUri.trim(),
      ...(input.target.ideHint?.trim() ? { ideHint: input.target.ideHint.trim() } : {}),
    },
  };
}

export function containsForbiddenAtelierWorkspacePayloadActions(payload: Record<string, unknown> | undefined): boolean {
  if (!payload) return false;
  const forbidden = new Set<string>(ATELIER_WORKSPACE_OPEN_FORBIDDEN_ACTIONS);
  return Object.keys(payload).some((field) => forbidden.has(field));
}

export function isCanonicalAtelierWorkspaceOpenTarget(target: AtelierWorkspaceOpenTarget, taskId: string): boolean {
  const workspaceId = target.workspaceId.trim();
  if (!workspaceId || typeof target.workspaceUri !== 'string') return false;
  try {
    const uri = new URL(target.workspaceUri.trim());
    const shape = ATELIER_WORKSPACE_OPEN_URI_SHAPE;
    const taskPath = uri.pathname.split('/').filter(Boolean);
    const workspaceParams = uri.searchParams.getAll(shape.workspaceQueryKey);
    return (
      (ATELIER_WORKSPACE_OPEN_URI_SCHEMES as readonly string[]).includes(uri.protocol.slice(0, -1)) &&
      uri.hostname === shape.host &&
      taskPath.length === shape.taskPathSegments &&
      taskPath[0] === taskId &&
      workspaceParams.length === 1 &&
      workspaceParams[0] === workspaceId
    );
  } catch {
    return false;
  }
}
