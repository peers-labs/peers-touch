/**
 * Deterministic local safety material for the prototype identity-verification
 * card. Production derives Ed25519 SHA-256 fingerprints and a hashed safety
 * number from real key bundles (apps/desktop SafetyVerificationPanel); the
 * prototype has no crypto stack, so these are stable FNV-1a demo values keyed
 * by identity labels. The card itself always labels the material as local
 * demo data — it must never be mistaken for a real fingerprint.
 */

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiply, kept unsigned.
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/** Stable 64-char lowercase hex fingerprint for one identity label. */
export function demoFingerprint(identity: string): string {
  const parts: string[] = [];
  for (let round = 0; round < 4; round += 1) {
    parts.push(fnv1a32(`${identity}#${round}`).toString(16).padStart(8, '0'));
  }
  return parts.join('');
}

/**
 * Signal-style safety number: 12 groups of 5 digits (60 digits), rendered as
 * 4 rows × 3 groups. Derived from both identity labels so each pair is stable.
 */
export function demoSafetyNumber(localIdentity: string, peerIdentity: string): string {
  const seed = `${localIdentity}→${peerIdentity}`;
  const groups: string[] = [];
  for (let i = 0; i < 12; i += 1) {
    const value = fnv1a32(`${seed}#group${i}`) % 100_000;
    groups.push(value.toString().padStart(5, '0'));
  }
  return groups.join(' ');
}

/** Deterministic QR payload string for the visual scan comparison demo. */
export function demoSafetyQrPayload(localIdentity: string, peerIdentity: string): string {
  return [
    'peers-touch://identity.safety-number.v1',
    `local=${demoFingerprint(localIdentity)}`,
    `peer=${demoFingerprint(peerIdentity)}`,
  ].join('?');
}
