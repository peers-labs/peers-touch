export type ToolApprovalPolicy = 'auto' | 'ask' | 'deny';

export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  approvalPolicy: ToolApprovalPolicy;
}

export interface ToolExecutionRequest {
  turnId: string;
  callId: string;
  toolName: string;
  arguments: string;
  agentId: string;
  conversationId: string;
}

export interface ToolExecutionResult {
  turnId: string;
  callId: string;
  content: string;
  isError: boolean;
}

export interface ToolExecutor {
  name: string;
  execute(args: Record<string, unknown>, meta: ToolExecutionRequest): Promise<ToolExecutionResult>;
}

export type ToolCallStatus = 'pending_approval' | 'executing' | 'completed' | 'denied' | 'timed_out' | 'error';

export interface PendingToolCall {
  request: ToolExecutionRequest;
  status: ToolCallStatus;
  startedAt: number;
  result?: ToolExecutionResult;
}
