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
  | 'reconciling'
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
  turnId?: string;
  conversationId?: string;
  lastEventSeq?: number;
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
  | 'intervention_request'
  | 'progress'
  | 'image'
  | 'conversation_created'
  | 'error'
  | 'cancelled'
  | 'reconciling'
  | 'catchup_done'
  | 'done';

export interface TextEventPayload {
  text: string;
  turnId?: string;
  conversationId?: string;
}

export interface ThinkingEventPayload {
  text: string;
  turnId?: string;
}

export interface ToolCallEventPayload {
  name: string;
  arguments: string;
  toolCallId?: string;
  turnId?: string;
}

export interface ToolResultEventPayload {
  toolCallId: string;
  result: string;
  turnId?: string;
}

export interface ToolApprovalRequiredPayload {
  approvalId: string;
  toolName: string;
  serverName: string;
  arguments: string;
  source?: string;
}

export interface InterventionRequestPayload {
  messageId: string;
  prompt: string;
  type: 'text' | 'choice' | 'confirm';
  choices?: string[];
  defaultValue?: string;
}

export interface ProgressEventPayload {
  stage: string;
  turnId?: string;
  conversationId?: string;
  agentId?: string;
}

export interface ImageEventPayload {
  url: string;
  turnId?: string;
}

export interface ConversationCreatedPayload {
  conversation_id: string;
}

export interface ErrorEventPayload {
  error: string;
  type?: string;
  turnId?: string;
  conversationId?: string;
}

export interface DoneEventPayload {
  task_id?: string;
  turn?: Record<string, unknown>;
  type?: string;
  suggestions?: string[];
  model?: string;
  seq?: number;
}

export interface CatchupDoneEventPayload {
  type: 'catchup_done';
  seq: number;
  reason?: string;
}

export type TurnStreamEventPayload =
  | TextEventPayload
  | ThinkingEventPayload
  | ToolCallEventPayload
  | ToolResultEventPayload
  | ToolApprovalRequiredPayload
  | InterventionRequestPayload
  | ProgressEventPayload
  | ImageEventPayload
  | ConversationCreatedPayload
  | ErrorEventPayload
  | DoneEventPayload
  | CatchupDoneEventPayload;

export interface TurnStreamEvent {
  event: TurnStreamEventType;
  data: Record<string, unknown>;
}

export interface StreamingAccumulator {
  content: string;
  thinking: string;
  thinkingDone: boolean;
  thinkingStartedAt: number | null;
  thinkingDurationMs: number | null;
  toolCallCount: number;
  images: string[];
  model: string;
  error: OperationError | null;
  isDone: boolean;
  isCancelled: boolean;
  lastEventAt: number;
}

export interface StreamingHandlerOptions {
  throttleMs?: number;
}

export interface RunLifecycleHooks {
  onRunStarted?: (operationId: string) => void;
  onRunCompleted?: (operationId: string, accumulator: StreamingAccumulator) => void;
  onRunFailed?: (operationId: string, error: OperationError) => void;
  onRunCancelled?: (operationId: string) => void;
}
