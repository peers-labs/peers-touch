// Safety number derivation for friend chat.
//
// Inspired by Signal's safety-number / fingerprint format: combine
// both parties' long-term identity-key fingerprints in a stable
// canonical order, run an iterated hash, and chunk the digest into
// human-comparable decimal groups. Reading the 12 groups of 5
// digits aloud takes ~30 seconds and conclusively rules out a MITM
// because any adversary swapping either side's identity key would
// produce a completely different number.
//
// Why iterated hash? It makes brute-forcing a fingerprint collision
// against a target safety number computationally expensive even
// with truncated output, mirroring the rationale for Signal's 5200
// SHA-512 iterations. Our identity keys are Ed25519 (32 bytes); we
// re-hash with SHA-256 because that's what the rest of the desktop
// crypto stack already uses (`identity_fingerprint_hex` →
// `Sha256::digest(verifying_key.as_bytes())`). Keeping the local
// hash family aligned avoids dragging another primitive into the
// JS bundle just for this UI surface.
//
// Output: 60 decimal digits in 12 space-separated groups of 5.
// Lossless round-trip is *not* required — the safety number is a
// human-comparable derivative, not a transport-level credential.

const SAFETY_NUMBER_ITERATIONS = 5_200;
const SAFETY_NUMBER_GROUPS = 12;
const SAFETY_NUMBER_GROUP_SIZE = 5;

/** Serialise a hex fingerprint to its raw byte form. Tolerates
 *  upper/lower case + leading "0x". Returns null on parse error. */
function hexToBytes(hex: string): Uint8Array | null {
  let h = (hex || '').trim().toLowerCase();
  if (h.startsWith('0x')) h = h.slice(2);
  if (h.length === 0 || h.length % 2 !== 0) return null;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) {
    const v = parseInt(h.slice(i * 2, i * 2 + 2), 16);
    if (Number.isNaN(v)) return null;
    out[i] = v;
  }
  return out;
}

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // SubtleCrypto accepts BufferSource. Newer TS lib.dom narrows
  // Uint8Array's backing buffer to `ArrayBuffer | SharedArrayBuffer`
  // which `BufferSource` doesn't admit; copy into a freshly-owned
  // ArrayBuffer to drop the SAB possibility from the type.
  const owned = new ArrayBuffer(data.byteLength);
  new Uint8Array(owned).set(data);
  const buf = await crypto.subtle.digest('SHA-256', owned);
  return new Uint8Array(buf);
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

/** Lexicographic byte compare. */
function bytesLessOrEqual(a: Uint8Array, b: Uint8Array): boolean {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return a.length <= b.length;
}

/** Convert the first N bytes of `digest` into a fixed-width decimal
 *  string by interpreting each 5-byte chunk as a big-endian uint40
 *  modulo 10^5. Same algorithm Signal uses for its safety-number
 *  groups; produces uniformly-distributed 5-digit groups without
 *  base conversion gymnastics. */
function digestToDecimalGroups(digest: Uint8Array): string[] {
  const groups: string[] = [];
  for (let g = 0; g < SAFETY_NUMBER_GROUPS; g++) {
    const off = g * 5;
    // Big-endian uint40 from 5 bytes — JS numbers safely hold up
    // to 2^53, so a 40-bit value (max 2^40 ≈ 1.1e12) fits clean.
    const v =
      digest[off] * 2 ** 32 +
      digest[off + 1] * 2 ** 24 +
      digest[off + 2] * 2 ** 16 +
      digest[off + 3] * 2 ** 8 +
      digest[off + 4];
    const mod = v % 100000;
    groups.push(mod.toString().padStart(SAFETY_NUMBER_GROUP_SIZE, '0'));
  }
  return groups;
}

/** Derive the 12-group safety number from a (localFingerprint,
 *  peerFingerprint) pair. The pair is sorted lexicographically
 *  before hashing so both sides converge on the same number
 *  regardless of who initiated the chat. */
export async function deriveSafetyNumber(
  localFingerprintHex: string,
  peerFingerprintHex: string,
): Promise<string> {
  const a = hexToBytes(localFingerprintHex);
  const b = hexToBytes(peerFingerprintHex);
  if (!a || !b) {
    return ''; // caller renders an empty placeholder
  }
  const [first, second] = bytesLessOrEqual(a, b) ? [a, b] : [b, a];
  // Iteration loop: H(prev || first || second). The seed is
  // first || second so the first iteration's input is well-defined.
  let acc = concat(first, second);
  for (let i = 0; i < SAFETY_NUMBER_ITERATIONS; i++) {
    acc = await sha256(concat(acc, concat(first, second)));
  }
  // We need 12 * 5 = 60 bytes of derived material; SHA-256 only
  // gives us 32, so we squeeze a second block by hashing the
  // accumulator with a domain-separation tag.
  const block1 = acc;
  const tag = new TextEncoder().encode('peers-touch-safety-number/v1');
  const block2 = await sha256(concat(acc, tag));
  const stream = concat(block1, block2);
  return digestToDecimalGroups(stream).join(' ');
}

/** Reverse-engineer the QR-encoded payload back into the (local,
 *  peer) fingerprint pair so the receiving side can compare. The
 *  payload is `peers-touch:safety/v1?l=<hex>&p=<hex>` so a stray
 *  scan in another QR app surfaces a recognisable URL. */
export function buildSafetyQrPayload(
  localDid: string,
  localFingerprintHex: string,
  peerPtid: string,
  peerFingerprintHex: string,
): string {
  // Encoding peer DID + peer fp lets the *peer* (when they scan
  // OUR QR) verify they're looking at the right contact. The local
  // side included for symmetry — they scan our QR and see their
  // own DID + the fp we hold for them.
  const params = new URLSearchParams({
    l_did: localDid,
    l_fp: (localFingerprintHex || '').toLowerCase(),
    p_did: peerPtid,
    p_fp: (peerFingerprintHex || '').toLowerCase(),
  });
  return `peers-touch:safety/v1?${params.toString()}`;
}
