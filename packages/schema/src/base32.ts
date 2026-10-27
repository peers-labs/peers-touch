import { SchemaError } from './errors';

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32(bytes: Uint8Array): string {
  let result = '', buffer = 0, bits = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      result += alphabet[(buffer >>> bits) & 31];
    }
    buffer &= (1 << bits) - 1;
  }
  if (bits) result += alphabet[(buffer << (5 - bits)) & 31];
  return result;
}

export function unbase32(value: string): Uint8Array {
  if (!value || !/^[A-Z2-7]+$/.test(value)) throw new SchemaError('INVALID_LINK');
  const bytes: number[] = [];
  let buffer = 0, bits = 0;
  for (const character of value) {
    buffer = (buffer << 5) | alphabet.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 255);
    }
    buffer &= (1 << bits) - 1;
  }
  const result = Uint8Array.from(bytes);
  if (base32(result) !== value) throw new SchemaError('INVALID_LINK');
  return result;
}
