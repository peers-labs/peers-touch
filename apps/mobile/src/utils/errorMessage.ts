export function readableErrorMessage(value: unknown, fallback = 'request_failed'): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Error) return value.message || fallback;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    const nested = record.message ?? record.msg ?? record.detail ?? record.error ?? record.reason ?? record.code;
    if (nested !== undefined && nested !== value) return readableErrorMessage(nested, fallback);
    try {
      return JSON.stringify(value);
    } catch {
      return fallback;
    }
  }
  return fallback;
}
