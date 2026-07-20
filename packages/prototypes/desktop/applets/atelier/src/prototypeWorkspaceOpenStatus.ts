import type { OpenWorkspaceInput, OpenWorkspaceResponse } from './runtime';

export function buildPrototypeWorkspaceOpenRequestKey(input: {
  taskId?: string;
  workspaceUri?: string;
  ideHint?: string;
}): string {
  const taskId = input.taskId?.trim() || 'workspace';
  const workspaceUri = input.workspaceUri?.trim() || 'none';
  const ideHint = input.ideHint?.trim() || 'default';
  return `task:${taskId}|workspace:${workspaceUri}|ide:${ideHint}`;
}

export function shouldApplyPrototypeWorkspaceOpenResponse(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function buildPrototypeWorkspaceOpenResponse(input: OpenWorkspaceInput): OpenWorkspaceResponse {
  return {
    accepted: true,
    opened: false,
    workspaceUri: input.workspaceUri,
    mode: 'prototype_host_intent',
    reason: 'Prototype records a Host-owned workspace open intent without launching an IDE.',
  };
}

export function derivePrototypeWorkspaceOpenStatus(response: OpenWorkspaceResponse): string {
  const state = response.opened ? 'opened' : 'host_intent_accepted';
  return `${response.mode}:${state}`;
}

export function prototypeWorkspaceOpenErrorStatus(error: unknown): string {
  return error instanceof Error ? error.message : 'workspace open unavailable';
}
