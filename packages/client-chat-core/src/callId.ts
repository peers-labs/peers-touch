const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export function createCallId(now = Date.now()): string {
  if (!Number.isSafeInteger(now) || now < 0 || now > 0xffff_ffff_ffff) {
    throw new Error('call ID timestamp must fit the ULID 48-bit time field');
  }

  let timestamp = BigInt(now);
  let timePart = '';
  for (let index = 0; index < 10; index += 1) {
    timePart = CROCKFORD_BASE32[Number(timestamp & 31n)] + timePart;
    timestamp >>= 5n;
  }

  const randomBytes = new Uint8Array(10);
  crypto.getRandomValues(randomBytes);
  let randomness = 0n;
  for (const byte of randomBytes) {
    randomness = (randomness << 8n) | BigInt(byte);
  }
  let randomPart = '';
  for (let index = 0; index < 16; index += 1) {
    randomPart = CROCKFORD_BASE32[Number(randomness & 31n)] + randomPart;
    randomness >>= 5n;
  }

  return timePart + randomPart;
}
