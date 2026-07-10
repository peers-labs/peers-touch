import type {
  ConfirmMemoryCandidateInput,
  ConfirmMemoryCandidateResponse,
  ConfirmRerunInput,
  ConfirmRerunResponse,
} from './runtime';
import {
  ATELIER_MEMORY_CONFIRMATION_MODE,
  ATELIER_RERUN_CONFIRMATION_MODE,
} from './projection.contract.generated';

export type PrototypeConfirmationRequestKind = 'memory' | 'rerun';

export function buildPrototypeConfirmationRequestKey(input: {
  kind: PrototypeConfirmationRequestKind;
  taskId?: string;
  feedbackId?: string;
  blockId?: string;
}): string {
  const taskId = input.taskId?.trim() || 'workspace';
  const feedbackId = input.feedbackId?.trim() || 'none';
  const blockId = input.blockId?.trim() || 'none';
  return `kind:${input.kind}|task:${taskId}|feedback:${feedbackId}|block:${blockId}`;
}

export function shouldApplyPrototypeConfirmationResponse(input: {
  currentRequestKey: string;
  responseRequestKey: string;
}): boolean {
  return Boolean(input.responseRequestKey) && input.currentRequestKey === input.responseRequestKey;
}

export function buildPrototypeMemoryConfirmationResponse(
  input: ConfirmMemoryCandidateInput,
): ConfirmMemoryCandidateResponse {
  return {
    accepted: true,
    feedbackId: input.feedbackId,
    memoryId: `prototype-memory-${input.feedbackId}`,
    status: 'confirmed',
    source: ATELIER_MEMORY_CONFIRMATION_MODE,
    alreadyDone: false,
  };
}

export function buildPrototypeRerunConfirmationResponse(input: ConfirmRerunInput): ConfirmRerunResponse {
  return {
    accepted: true,
    feedbackId: input.feedbackId,
    taskId: input.taskId,
    rerunTaskId: `prototype-rerun-${input.feedbackId}`,
    status: 'confirmed',
    source: ATELIER_RERUN_CONFIRMATION_MODE,
    alreadyDone: false,
    started: true,
  };
}

export function derivePrototypeMemoryConfirmationStatus(response: ConfirmMemoryCandidateResponse): string {
  return `memory-confirmed:${response.memoryId}`;
}

export function derivePrototypeRerunConfirmationStatus(response: ConfirmRerunResponse): string {
  return `rerun-confirmed:${response.rerunTaskId}`;
}

export function prototypeMemoryConfirmationErrorStatus(error: unknown): string {
  return error instanceof Error ? error.message : 'memory confirmation unavailable';
}

export function prototypeRerunConfirmationErrorStatus(error: unknown): string {
  return error instanceof Error ? error.message : 'rerun confirmation unavailable';
}
