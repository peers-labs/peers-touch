/**
 * Conversation view models for the Agent prototype.
 *
 * The vocabulary mirrors the production ChatMessage / ToolCallInfo /
 * TurnAttribution contracts (store/chat.ts + messages/*) but stays local:
 * the prototype proves peers-ui completeness, not Station wiring.
 */

export type MessageStatus =
  | 'queued'
  | 'streaming'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type ToolKind =
  | 'shell'
  | 'file-write'
  | 'file-read'
  | 'web-fetch'
  | 'todo'
  | 'clarification'
  | 'delegation';

export type ToolStatus =
  | 'running'
  | 'approval_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TerminalLineView {
  id: string;
  stream: 'stdin' | 'stdout' | 'stderr' | 'system';
  text: string;
}

export interface AttachmentView {
  id: string;
  name: string;
  kind: 'image' | 'file';
  sizeLabel: string;
}

export interface ClarificationView {
  prompt: string;
  choices: string[];
  answer?: string;
}

export interface ToolCallView {
  id: string;
  kind: ToolKind;
  title: string;
  status: ToolStatus;
  /** shell execution */
  command?: string;
  cwd?: string;
  exitCode?: number;
  durationMs?: number;
  lines?: TerminalLineView[];
  stdoutTruncated?: boolean;
  stderrTruncated?: boolean;
  /** file operations */
  changeType?: string;
  path?: string;
  beforeDigest?: string;
  afterDigest?: string;
  diffBefore?: string;
  diffAfter?: string;
  diffTruncated?: boolean;
  /** clarification */
  clarification?: ClarificationView;
  /** delegation */
  delegationSummary?: string;
  /** failure / cancellation */
  errorType?: string;
  errorText?: string;
  resolutionLabel?: string;
}

export type AttributionKind =
  | 'skill'
  | 'profile'
  | 'memory'
  | 'knowledge'
  | 'attachment'
  | 'tool';

export type AttributionState = 'included' | 'truncated' | 'omitted' | 'denied';

export interface AttributionView {
  id: string;
  kind: AttributionKind;
  label: string;
  state: AttributionState;
}

export interface TypedErrorView {
  errorType: string;
  text: string;
  resolutionLabel: string;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  status: MessageStatus;
  content?: string;
  timestamp: string;
  model?: string;
  /** User turn merged into the still-open Turn. */
  amended?: boolean;
  thinking?: string;
  thinkingDone?: boolean;
  queuePosition?: number;
  attachments?: AttachmentView[];
  tools?: ToolCallView[];
  attribution?: AttributionView[];
  typedError?: TypedErrorView;
  followUps?: string[];
  turnId: string;
}
