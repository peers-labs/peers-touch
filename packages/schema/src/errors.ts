export type SchemaErrorCode =
  | 'INVALID_LINK' | 'UNREGISTERED_ACTION' | 'PAYLOAD_TOO_LARGE'
  | 'PAYLOAD_TOO_DENSE' | 'UNSAFE_STYLE' | 'AVATAR_UNAVAILABLE'
  | 'BACKGROUND_UNKNOWN' | 'RENDER_FAILED' | 'ABORTED';

export class SchemaError extends Error {
  constructor(readonly code: SchemaErrorCode) {
    // Never include input, fragments or decoder messages in diagnostics.
    super(code);
    this.name = 'SchemaError';
  }
}
