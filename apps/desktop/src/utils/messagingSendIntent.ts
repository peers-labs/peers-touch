/**
 * MP-D33 send-intent identity.
 *
 * One user send action owns one send-intent ULID for its whole life: it stays
 * stable across ambiguous IPC answers, composer error restoration and
 * explicit retries of that same action. The Device Messaging Engine admits
 * the intent durably keyed by (sender device, send intent); a repeated call
 * resolves to the same message instead of minting a duplicate. A genuinely
 * new user action must call `newSendIntentId()` again.
 *
 * Canonical 26-char Crockford Base32 ULID (48-bit millisecond timestamp +
 * 80 random bits), implemented locally to avoid a dependency for one
 * encoder.
 */
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const SEND_INTENT_LENGTH = 26;
const TIMESTAMP_LENGTH = 10;

function encodeTimestamp(nowMs: number): string {
  let value = nowMs;
  let out = '';
  for (let index = TIMESTAMP_LENGTH - 1; index >= 0; index -= 1) {
    out = ALPHABET[value % 32] + out;
    value = Math.floor(value / 32);
  }
  return out;
}

export function newSendIntentId(): string {
  const timestamp = encodeTimestamp(Date.now());
  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  // 80 random bits -> 16 five-bit groups. The streaming buffer never
  // exceeds ~12 bits, so 32-bit integer math is sufficient.
  let random = '';
  let buffer = 0;
  let bitCount = 0;
  for (const byte of randomBytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      random += ALPHABET[(buffer >> bitCount) & 0x1f];
    }
  }
  if (bitCount > 0) {
    random += ALPHABET[(buffer << (5 - bitCount)) & 0x1f];
  }
  return (timestamp + random).slice(0, SEND_INTENT_LENGTH);
}
