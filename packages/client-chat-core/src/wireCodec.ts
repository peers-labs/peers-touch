export type ClientWireRecord = Record<string, unknown>;

export function clientWireRecord(value: unknown): ClientWireRecord {
  return value && typeof value === 'object'
    ? value as ClientWireRecord
    : {};
}

export function clientWireString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'bigint') {
      return String(value);
    }
  }
  return '';
}

export function clientWireNumber(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function clientWireEnumNumber(
  value: unknown,
  labels: Readonly<Record<string, number>>,
): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    if (/^\d+$/.test(value)) return Number(value);
    return labels[value] ?? 0;
  }
  return 0;
}

export function clientWireTimestampMillis(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  const timestamp = clientWireRecord(value);
  const seconds = timestamp.seconds;
  if (
    typeof seconds !== 'number'
    && typeof seconds !== 'bigint'
    && !(typeof seconds === 'string' && seconds.trim())
  ) {
    return 0;
  }
  const milliseconds = Number(seconds) * 1000
    + Math.floor(clientWireNumber(timestamp.nanos) / 1_000_000);
  return Number.isFinite(milliseconds) ? milliseconds : 0;
}

export function clientWireTimestampIso(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string') return value;
    const milliseconds = clientWireTimestampMillis(value);
    if (milliseconds) return new Date(milliseconds).toISOString();
  }
  return '';
}

export function clientWireBytes(value: unknown): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (Array.isArray(value)) return new Uint8Array(value.map(Number));
  if (typeof value !== 'string' || !value.trim()) return new Uint8Array();
  try {
    const binary = globalThis.atob(value.trim());
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return new Uint8Array();
  }
}
