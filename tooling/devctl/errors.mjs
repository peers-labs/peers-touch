export const ERROR_CODES = Object.freeze({
  PROFILE_REQUIRED: 'DEVCTL_PROFILE_REQUIRED',
  PROFILE_INVALID: 'DEVCTL_PROFILE_INVALID',
  DEPENDENCY_MISSING: 'DEVCTL_DEPENDENCY_MISSING',
  PORT_CONFLICT: 'DEVCTL_PORT_CONFLICT',
  PROCESS_IDENTITY_MISMATCH: 'DEVCTL_PROCESS_IDENTITY_MISMATCH',
  START_TIMEOUT: 'DEVCTL_START_TIMEOUT',
  UNSUPPORTED_MODE: 'DEVCTL_UNSUPPORTED_MODE',
  CHECK_FAILED: 'DEVCTL_CHECK_FAILED',
});

export class DevctlError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'DevctlError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code, message, details) {
  throw new DevctlError(code, message, details);
}

export function serializeError(error) {
  if (error instanceof DevctlError) {
    return {
      ok: false,
      error: {
        code: error.code,
        message: error.message,
        details: error.details,
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'DEVCTL_INTERNAL_ERROR',
      message: error instanceof Error ? error.message : String(error),
      details: {},
    },
  };
}
