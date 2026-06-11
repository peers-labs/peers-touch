import type { CapabilityMethod } from './capability.js';

export const APPLET_BRIDGE_PROTOCOL = 'peers-touch.applet.bridge' as const;

export type AppletErrorCode =
  | 'APPLET_NOT_FOUND'
  | 'INVALID_MANIFEST'
  | 'UNSUPPORTED_PLATFORM'
  | 'UNSUPPORTED_RUNTIME'
  | 'INVALID_SESSION'
  | 'PERMISSION_DENIED'
  | 'INVALID_PARAMS'
  | 'CAPABILITY_NOT_FOUND'
  | 'CAPABILITY_FAILED'
  | 'INTEGRITY_CHECK_FAILED'
  | 'RUNTIME_LOAD_FAILED'
  | 'POLICY_DENIED'
  | 'SERVICE_NOT_FOUND'
  | 'TASK_CANCELLED'
  | 'QUOTA_EXCEEDED';

export const APPLET_ERROR_CODES_SCHEMA = Object.freeze([
  'APPLET_NOT_FOUND',
  'INVALID_MANIFEST',
  'UNSUPPORTED_PLATFORM',
  'UNSUPPORTED_RUNTIME',
  'INVALID_SESSION',
  'PERMISSION_DENIED',
  'INVALID_PARAMS',
  'CAPABILITY_NOT_FOUND',
  'CAPABILITY_FAILED',
  'INTEGRITY_CHECK_FAILED',
  'RUNTIME_LOAD_FAILED',
  'POLICY_DENIED',
  'SERVICE_NOT_FOUND',
  'TASK_CANCELLED',
  'QUOTA_EXCEEDED',
] as const satisfies readonly AppletErrorCode[]);

export interface AppletError {
  code: AppletErrorCode;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface BridgeEnvelope {
  protocol: typeof APPLET_BRIDGE_PROTOCOL;
  appletId: string;
  sessionId: string;
  requestId: string;
}

export interface BridgeInvokeRequest extends BridgeEnvelope {
  kind: 'invoke';
  method: CapabilityMethod;
  params?: unknown;
}

export interface BridgeInvokeResponse<T = unknown> extends BridgeEnvelope {
  kind: 'response';
  ok: boolean;
  result?: T;
  error?: AppletError;
}

export type BridgeEventName =
  | 'ready'
  | 'show'
  | 'hide'
  | 'pause'
  | 'resume'
  | 'destroy'
  | 'themeChanged'
  | 'networkChanged'
  | 'skill.stream'
  | 'task.event'
  | 'agent.stream'
  | string;

export interface BridgeEventEnvelope<TPayload = unknown> extends BridgeEnvelope {
  kind: 'event';
  event: BridgeEventName;
  payload?: TPayload;
}

export type BridgeMessage = BridgeInvokeRequest | BridgeInvokeResponse | BridgeEventEnvelope;

export function createInvalidSessionResponse(input: BridgeEnvelope): BridgeInvokeResponse<never> {
  return {
    ...input,
    kind: 'response',
    ok: false,
    error: {
      code: 'INVALID_SESSION',
      message: 'Applet session is no longer valid',
      requestId: input.requestId,
    },
  };
}
