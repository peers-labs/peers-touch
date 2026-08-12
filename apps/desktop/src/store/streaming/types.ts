import type { ErrorResolutionAction } from '../chat';

export type OperationType = 'sendMessage' | 'regenerate' | 'retry' | 'branch';

export type OperationStatus =
  | 'running'
  | 'waiting_for_approval'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type RunState =
  | 'idle'
  | 'streaming'
  | 'approval_pending'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface OperationError {
  message: string;
  detail?: string;
  resolution?: ErrorResolutionAction;
  providerId?: string;
}

export interface Operation {
  id: string;
  sessionKey: string;
  type: OperationType;
  status: OperationStatus;
  runState: RunState;
  assistantMessageId: string;
  abortController: AbortController;
  startedAt: number;
  endedAt?: number;
  error?: OperationError;
  pendingApproval?: PendingApproval;
}

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  serverName: string;
  arguments: string;
  source?: string;
}

export type TurnStreamEventType =
  | 'text'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'local_tool_request'
  | 'tool_approval_required'
  | 'tool_approval_decision'
  | 'progress'
  | 'image'
  | 'conversation_created'
  | 'error'
  | 'done';

export interface TurnStreamEvent {
  event: TurnStreamEventType;
  data: Record<string, unknown>;
}

export interface StreamingAccumulator {
  content: string;
  thinking: string;
  thinkingDone: boolean;
  toolCallCount: number;
  images: string[];
  model: string;
  error: OperationError | null;
  isDone: boolean;
  lastEventAt: number;
}
