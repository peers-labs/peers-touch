export const REDACTED_VALUE = '[redacted]';

export function isSecretLikeKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return normalized.includes('api_key')
    || normalized.includes('apikey')
    || normalized.includes('authorization')
    || normalized.includes('bearer')
    || normalized.includes('secret')
    || normalized.includes('password')
    || normalized.includes('private_key')
    || normalized.includes('credential')
    || normalized === 'token'
    || normalized.endsWith('_token')
    || normalized.includes('access_token')
    || normalized.includes('refresh_token')
    || normalized.includes('session_token');
}

export function redactJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactJsonValue);
  if (!value || typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  Object.entries(value as Record<string, unknown>).forEach(([key, item]) => {
    out[key] = isSecretLikeKey(key) ? REDACTED_VALUE : redactJsonValue(item);
  });
  return out;
}

export function redactMaybeJsonText(value?: string): string | undefined {
  if (!value) return value;
  try {
    return JSON.stringify(redactJsonValue(JSON.parse(value)));
  } catch {
    return value;
  }
}
