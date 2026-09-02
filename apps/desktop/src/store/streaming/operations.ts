import type { Operation, OperationError, OperationType, PendingApproval, RunState } from './types';

let operationCounter = 0;

export function createOperation(params: {
  sessionKey: string;
  type: OperationType;
  assistantMessageId: string;
  abortController: AbortController;
  streamGeneration?: number;
}): Operation {
  return {
    id: `op-${Date.now()}-${operationCounter++}`,
    sessionKey: params.sessionKey,
    type: params.type,
    status: 'running',
    runState: 'streaming',
    assistantMessageId: params.assistantMessageId,
    abortController: params.abortController,
    streamGeneration: params.streamGeneration,
    startedAt: Date.now(),
  };
}

export function completeOperation(op: Operation): Operation {
  return {
    ...op,
    status: 'completed',
    runState: 'completed',
    endedAt: Date.now(),
  };
}

export function failOperation(op: Operation, error: OperationError): Operation {
  return {
    ...op,
    status: 'failed',
    runState: 'failed',
    error,
    endedAt: Date.now(),
  };
}

export function cancelOperation(op: Operation): Operation {
  op.abortController.abort();
  return {
    ...op,
    status: 'cancelled',
    runState: 'cancelled',
    endedAt: Date.now(),
  };
}

export function parkOperation(op: Operation, approval: PendingApproval): Operation {
  return {
    ...op,
    status: 'waiting_for_approval',
    runState: 'approval_pending',
    pendingApproval: approval,
  };
}

export function resumeOperation(op: Operation): Operation {
  return {
    ...op,
    status: 'running',
    runState: 'streaming',
    pendingApproval: undefined,
  };
}

export function isTerminalState(state: RunState): boolean {
  return state === 'completed'
    || state === 'failed'
    || state === 'cancelled'
    || state === 'interrupted';
}

export function isActiveOperation(op: Operation | undefined): boolean {
  return op != null && !isTerminalState(op.runState);
}
