export type TaskState = 'queued' | 'running' | 'progress' | 'completed' | 'failed' | 'cancelled';

export interface TaskHandle {
  taskId: string;
  requestId: string;
  state: TaskState;
}

export interface TaskSnapshot<TOutput = unknown> extends TaskHandle {
  progress?: number;
  output?: TOutput;
  error?: string;
  updatedAt: string;
}

export interface TaskEvent<TPayload = unknown> {
  taskId: string;
  requestId: string;
  state: TaskState;
  payload?: TPayload;
  sequence: number;
  timestamp: string;
}

export interface NetworkTaskInput {
  taskType: 'network' | 'network.request';
  input: {
    request?: {
      service: string;
      path: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
      headers?: Record<string, string>;
      body?: unknown;
    };
    service?: string;
    path?: string;
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
    headers?: Record<string, string>;
    body?: unknown;
  };
  stream?: boolean;
  completeAfterMs?: number;
}

export interface AgentTaskInput {
  taskType: 'agent' | 'agent.stream';
  input: {
    request?: {
      message?: string;
      agentSessionId?: string;
      metadata?: Record<string, unknown>;
    };
    message?: string;
    agentSessionId?: string;
    metadata?: Record<string, unknown>;
  };
  stream?: boolean;
  completeAfterMs?: number;
}

export interface GenericTaskInput<TInput = unknown> {
  taskType: Exclude<string, 'network' | 'network.request' | 'agent' | 'agent.stream'>;
  input: TInput;
  stream?: boolean;
  completeAfterMs?: number;
}

export type TaskStartInput<TInput = unknown> =
  | NetworkTaskInput
  | AgentTaskInput
  | GenericTaskInput<TInput>;

export type AppletRoute = `applet:${string}`;
export type HostPageRoute = 'applets' | 'search' | 'chat' | 'agent' | 'notes' | 'settings';
export type NavigationTarget = AppletRoute | HostPageRoute;

export type AppletLaunchOptions = Record<string, unknown>;

export interface OpenAppletInput {
  appletId: string;
  launchParams?: Record<string, unknown>;
}

export interface NavigateToInput {
  page: NavigationTarget;
}

export interface RedirectToInput {
  page: NavigationTarget;
}

export type ToastType = 'success' | 'info' | 'warning' | 'error' | 'loading';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  durationMs?: number;
}

export interface LoadingOptions {
  message?: string;
  durationMs?: number;
}

export interface ModalOptions {
  title?: string;
  content?: string;
  confirmText?: string;
  cancelText?: string;
}

export interface ModalResult {
  confirmed: boolean;
  cancelled: boolean;
}

export interface ActionSheetItem {
  label: string;
  value?: unknown;
  disabled?: boolean;
  destructive?: boolean;
}

export interface ActionSheetOptions {
  title?: string;
  items: Array<string | ActionSheetItem>;
}

export interface ActionSheetResult {
  selectedIndex: number;
  selectedItem: string | ActionSheetItem | null;
  cancelled: boolean;
}

export interface NavigationBarOptions {
  title?: string;
}

export interface SkillSpec {
  id: string;
  title?: string;
  description?: string;
  inputSchema: string | Record<string, unknown>;
  streaming?: boolean;
  display?: Record<string, unknown>;
  executor?: {
    type: 'network';
    request: {
      service: string;
      path: string;
      method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'HEAD';
      headers?: Record<string, string>;
      body?: unknown;
    };
  } | {
    type: 'agent';
    request?: {
      message?: string;
      agentSessionId?: string;
      metadata?: Record<string, unknown>;
    };
  };
}

export interface SkillDescriptor extends SkillSpec {
  enabled: boolean;
}

export interface SkillInvokeOptions {
  stream?: boolean;
  requestId?: string;
}

export interface SkillInvokeRequest<TInput = unknown> {
  skillId: string;
  input: TInput;
  options?: SkillInvokeOptions;
}

export interface SkillInvokeResult<TOutput = unknown> {
  ok: boolean;
  skillId: string;
  requestId: string;
  output?: TOutput;
  error?: string;
}

export interface SkillStreamEvent<TPayload = unknown> {
  skillId: string;
  requestId: string;
  type: 'progress' | 'partial' | 'tool_call' | 'tool_result' | 'final' | 'error';
  payload?: TPayload;
  sequence: number;
}

export interface AgentSessionInput {
  purpose?: string;
  metadata?: Record<string, unknown>;
}

export interface AgentSession {
  agentSessionId: string;
  requestId: string;
  createdAt: string;
}

export interface AgentMessageInput {
  agentSessionId?: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface AgentMessageResult {
  requestId: string;
  messageId: string;
  content: string;
}

export interface AgentStreamEvent<TPayload = unknown> {
  requestId: string;
  type: 'thinking' | 'tool_call' | 'tool_result' | 'partial' | 'final' | 'error';
  payload?: TPayload;
  sequence: number;
}

export interface GenerateInput {
  prompt: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateResult {
  requestId: string;
  content: string;
}

export interface ChatInput {
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>;
  metadata?: Record<string, unknown>;
}

export interface ChatResult {
  requestId: string;
  message: { role: 'assistant'; content: string };
}

export interface TelemetryEvent {
  name: string;
  properties?: Record<string, unknown>;
  timestamp?: string;
}

export interface DiagnosticError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface PerformanceMark {
  name: string;
  value?: number;
  timestamp?: string;
}
