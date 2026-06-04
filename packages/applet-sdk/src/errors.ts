// Typed error codes for applet SDK bridge operations.

export enum AppletErrorCode {
  BridgeUnavailable = 20001,
  MethodNotFound = 20002,
  PermissionDenied = 20003,
  Timeout = 20004,
  InternalError = 20005,
  NetworkError = 30001,
  StorageError = 30002,
}

export class AppletError extends Error {
  constructor(
    public code: AppletErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppletError';
  }
}
