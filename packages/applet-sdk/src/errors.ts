import type { AppletErrorCode as ContractAppletErrorCode } from '@peers-touch/applet-contract';

export enum AppletErrorCode {
  BridgeUnavailable = 'RUNTIME_LOAD_FAILED',
  MethodNotFound = 'CAPABILITY_NOT_FOUND',
  PermissionDenied = 'PERMISSION_DENIED',
  Timeout = 'CAPABILITY_FAILED',
  InternalError = 'CAPABILITY_FAILED',
  NetworkError = 'CAPABILITY_FAILED',
  StorageError = 'CAPABILITY_FAILED',
}

export type AppletErrorCodeValue = ContractAppletErrorCode | AppletErrorCode;

export class AppletError extends Error {
  constructor(
    public code: AppletErrorCodeValue,
    message: string,
    public details?: Record<string, unknown>,
    public requestId?: string,
  ) {
    super(message);
    this.name = 'AppletError';
  }
}
