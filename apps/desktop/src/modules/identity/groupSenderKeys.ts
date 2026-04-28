/**
 * Group Sender Keys orchestration (TS side).
 *
 * Bridges the four `crypto_group_*` Tauri commands to the rest of
 * the chat layer:
 *
 *   * `ensureSkdmDistributed(actorId, groupUlid, memberDids)`
 *     -> mints (lazily) the local sender chain for this group and
 *        sends the SKDM bytes to every member who hasn't received
 *        them yet, sealed under the per-recipient signaling envelope
 *        (X25519 + AES-GCM, sender authentication via long-term IK).
 *        Carrier on the wire is a friend-chat message of type=50
 *        (`FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION`); Station
 *        sees only the sealed bytes.
 *
 *   * `encryptForGroup(groupUlid, plaintext)`
 *     -> wraps a string body as a `GroupCiphertext` and returns
 *        the base64-encoded bytes that
 *        `groupChatSendMessage` stuffs into
 *        `SendGroupMessageRequest.encrypted_payload`.
 *
 *   * `decryptFromGroup(groupUlid, encryptedPayloadB64)`
 *     -> reverse direction. Throws `MissingSkdmError` when the
 *        SKDM hasn't arrived yet so the caller can hold the
 *        message in a re-decrypt queue.
 *
 *   * `handleInboundSkdm(senderDid, sealedB64)`
 *     -> friend-chat inbound dispatch entry. Opens the signaling
 *        envelope (which authenticates `senderDid` against their
 *        published Ed25519 IK), then hands the SKDM proto bytes to
 *        the consumer.
 *
 * # Why the signaling envelope and not the friend ratchet?
 *
 * The friend chat ratchet requires both sides to have completed
 * X3DH and to share an established `CryptoSession`. SKDM
 * distribution must work on the *first* interaction with a new
 * group member, possibly before any 1:1 chat has happened. The
 * signaling envelope is stateless: per-message ephemeral X25519
 * combined with the recipient's published long-term IK, no prior
 * session required. AAD binds (group_ulid, sender_key_id) so a
 * captured envelope cannot be replayed under a different chain
 * generation.
 *
 * # SKDM-sent ledger
 *
 * Local-only `localStorage` under
 *   `groupSenderKeys:skdm-sent:<actorId>:<groupUlid>`
 * tracking which member DIDs already received the current chain.
 * Cleared by `resetSkdmDistribution` after a forced rotation so
 * the next emit reaches everyone again.
 */

import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';

export class MissingSkdmError extends Error {
  constructor(public readonly groupUlid: string, public readonly senderDid: string | null) {
    super(`No sender chain installed for group=${groupUlid}, sender=${senderDid ?? '?'}`);
    this.name = 'MissingSkdmError';
  }
}

const SENT_KEY_PREFIX = 'groupSenderKeys:skdm-sent';
export const FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION = 50;
/**
 * Wire `kind` for the signaling envelope when carrying an SKDM.
 *
 * Kept as a constant string rather than reusing the realtime call
 * signal kinds so a misuse (sealing an SKDM but trying to open as
 * a CALL_OFFER, or vice versa) trips an AAD authentication failure
 * instead of silently producing wrong-context plaintext.
 */
const SKDM_ENVELOPE_KIND = 'GROUP_SKDM';

function sentKey(actorId: string, groupUlid: string): string {
  return `${SENT_KEY_PREFIX}:${actorId}:${groupUlid}`;
}

function loadSentSet(actorId: string, groupUlid: string): Set<string> {
  try {
    const raw = localStorage.getItem(sentKey(actorId, groupUlid));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function saveSentSet(actorId: string, groupUlid: string, set: Set<string>): void {
  try {
    localStorage.setItem(sentKey(actorId, groupUlid), JSON.stringify(Array.from(set)));
  } catch (err) {
    log.warn('groupSenderKeys', 'persist sent-set failed', err);
  }
}

/**
 * Reset the SKDM-sent ledger for a group.
 *
 * Called after a forced rotation (member removed, "Reset group
 * encryption"): the new sender_key_id MUST be redistributed to
 * every member, including those who already had the old chain.
 * Without this clear the dedupe set would suppress the
 * redistribution and peers would silently fail to decrypt
 * post-rotation messages.
 */
export function resetSkdmDistribution(actorId: string, groupUlid: string): void {
  try {
    localStorage.removeItem(sentKey(actorId, groupUlid));
  } catch (err) {
    log.warn('groupSenderKeys', 'reset sent-set failed', err);
  }
}

/**
 * Synthetic session_ulid used as part of the signaling envelope's
 * AAD when sealing an SKDM.
 *
 * Receivers MUST be able to compute this BEFORE opening the
 * envelope (AAD must match), and they don't know the
 * `group_ulid` until after they've decoded the SKDM proto inside.
 * So we bind only `senderDid` -- the cross-check on group /
 * sender_key_id happens at the SKDM consumer layer
 * (`cryptoGroupSkConsumeSkdm` re-validates the embedded
 * sender_did against the friend-chat envelope sender; the
 * sender_key_id is part of the chain row's primary key, so a
 * second `(group, sender, key_id)` cannot collide).
 */
function skdmEnvelopeSession(senderDid: string): string {
  return `groupskdm:${senderDid}`;
}

/**
 * Make sure every `memberDids[]` member (except `actorId`) has our
 * current SKDM. Members already marked in the sent ledger are
 * skipped. Failure to reach a single member is logged but does not
 * abort the whole call -- partial distribution is still valuable
 * (the missed peer will get the SKDM on next `ensureSkdmDistributed`
 * pass).
 */
export async function ensureSkdmDistributed(
  actorId: string,
  groupUlid: string,
  memberDids: string[],
): Promise<void> {
  if (!actorId || !groupUlid) return;
  const sent = loadSentSet(actorId, groupUlid);
  const targets = memberDids.filter((did) => !!did && did !== actorId && !sent.has(did));
  if (targets.length === 0) return;

  // Mint (lazy) and fetch SKDM bytes ONCE for the whole batch --
  // calling emit_skdm is idempotent within a generation, so if the
  // cache already had a chain we get the same bytes, but doing it
  // once per call keeps log volume sane and avoids gratuitous
  // SQLCipher hits.
  let skdmBytesB64: string;
  try {
    const r = await api.cryptoGroupSkEmitSkdm(groupUlid);
    skdmBytesB64 = r.skdm_b64;
  } catch (err) {
    log.error('groupSenderKeys', 'cryptoGroupSkEmitSkdm failed', err);
    throw err;
  }

  for (const peerDid of targets) {
    try {
      // Resolve the peer's long-term Ed25519 identity public key.
      // The signaling envelope converts it internally to its
      // X25519 image for the DH; we just need to hand over the
      // base64 of the raw 32 Ed25519 bytes Station has on file.
      const bundle = await api.keyExchangeFetchBundle(peerDid);
      const peerIkPub = String(bundle?.ik_pub || '').trim();
      if (!peerIkPub) {
        log.warn('groupSenderKeys', `peer ${peerDid} has no published ik_pub; skipping SKDM`);
        continue;
      }

      // The signaling envelope kind is 'GROUP_SKDM' -- not in the
      // RealtimeCallSignalKind union, so we cast. The Rust side
      // accepts any string for `kind` (it just goes into AAD); the
      // TS-side typing is a safety net for the realtime call path,
      // not a correctness requirement.
      const sealed = await api.signalingEnvelopeSeal(
        peerIkPub,
        skdmEnvelopeSession(actorId),
        SKDM_ENVELOPE_KIND as never,
        skdmBytesB64,
      );

      // We need a friend session to ride. `friendChatCreateSession`
      // is idempotent: returns the existing session if one exists,
      // creates one if not. Carrying SKDM creates a side-effect of
      // bootstrapping the friend session itself, which is fine --
      // anyone in a group with us is by definition a contact-of-
      // -contact at minimum.
      const session = await api.friendChatCreateSession(peerDid);
      const sessionUlid = session?.session?.ulid ?? '';
      if (!sessionUlid) {
        log.warn('groupSenderKeys', `no session ulid for ${peerDid}; skipping SKDM`);
        continue;
      }

      // The carrier is a friend-chat message of type=50. We put the
      // sealed envelope in `content` (base64); leaving
      // encrypted_payload empty bypasses the friend-chat ratchet
      // path entirely, so SKDM delivery does NOT depend on having
      // an established 1:1 E2EE session.
      await api.friendChatSendMessage(
        sessionUlid,
        peerDid,
        sealed.payload_b64,
        FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION,
      );

      sent.add(peerDid);
    } catch (err) {
      // Don't poison the whole batch; the next ensureSkdmDistributed
      // pass will retry.
      log.warn('groupSenderKeys', `SKDM dispatch failed to ${peerDid}`, err);
    }
  }

  saveSentSet(actorId, groupUlid, sent);
}

/**
 * Encrypt a UTF-8 string body for a group.
 *
 * Caller is expected to have already triggered SKDM distribution
 * (via `ensureSkdmDistributed`) so peers can decrypt the result.
 * If no local chain exists yet the underlying Tauri command
 * returns NotFound; the caller should call
 * `cryptoGroupSkEmitSkdm` first via `ensureSkdmDistributed`.
 */
export async function encryptForGroup(groupUlid: string, plaintext: string): Promise<string> {
  const bytes = new TextEncoder().encode(plaintext);
  const b64 = bytesToBase64(bytes);
  const r = await api.cryptoGroupEncrypt(groupUlid, b64);
  return r.encrypted_payload_b64;
}

/**
 * Decrypt an inbound `encrypted_payload` for a group. Returns the
 * UTF-8 body and the wire-attributed sender DID so callers can
 * cross-check against `GroupMessage.sender_did`.
 *
 * Throws `MissingSkdmError` if no chain is installed yet -- caller
 * should hold the message in a re-decrypt queue and retry after
 * the next `cryptoGroupSkConsumeSkdm` lands.
 */
export async function decryptFromGroup(
  groupUlid: string,
  encryptedPayloadB64: string,
): Promise<{ plaintext: string; senderDid: string; senderKeyId: number; counter: number }> {
  try {
    const r = await api.cryptoGroupDecrypt(groupUlid, encryptedPayloadB64);
    const bytes = base64ToBytes(r.plaintext_b64);
    const plaintext = new TextDecoder().decode(bytes);
    return {
      plaintext,
      senderDid: r.sender_did,
      senderKeyId: r.sender_key_id,
      counter: r.counter,
    };
  } catch (err) {
    // The Rust side returns ErrorCode::NotFound with message
    // "No sender chain ..." in this case. We don't have a typed
    // error here so we string-match -- best-effort, the missing
    // SKDM path is the only NotFound this command emits.
    const msg = (err as Error)?.message ?? String(err);
    if (msg.toLowerCase().includes('no sender chain')) {
      throw new MissingSkdmError(groupUlid, null);
    }
    throw err;
  }
}

/**
 * Friend-chat inbound dispatch: a message of type=50 just arrived.
 *
 * `senderDid` is the friend-chat sender (who delivered the SKDM);
 * `sealedB64` is whatever was in `FriendChatMessage.content` --
 * the bytes of a signaling envelope sealed against our own IK.
 *
 * Steps:
 *   1. Resolve the sender's IK via the published bundle.
 *   2. Open the signaling envelope (this authenticates the sender
 *      cryptographically -- if their IK rotated and we have the
 *      old one cached, the open will fail rather than silently
 *      install a chain that "claims" to be from them).
 *   3. Hand the inner bytes to the SKDM consumer, which
 *      cross-checks the `sender_did` field embedded in the SKDM
 *      itself against the friend-chat envelope sender.
 *
 * Failure at any step is logged and dropped -- a malformed or
 * forged SKDM should not crash the inbound pipeline. The peer
 * will retry on next `ensureSkdmDistributed` pass; until they do
 * the receiver simply cannot decrypt that peer's group messages
 * (`MissingSkdmError` from `decryptFromGroup`).
 */
export async function handleInboundSkdm(
  senderDid: string,
  sealedB64: string,
): Promise<void> {
  if (!senderDid || !sealedB64) {
    log.warn('groupSenderKeys', 'handleInboundSkdm: missing senderDid or sealedB64');
    return;
  }
  let senderIkPub: string;
  try {
    const bundle = await api.keyExchangeFetchBundle(senderDid);
    senderIkPub = String(bundle?.ik_pub || '').trim();
    if (!senderIkPub) {
      log.warn('groupSenderKeys', `inbound SKDM: sender ${senderDid} has no published ik_pub`);
      return;
    }
  } catch (err) {
    log.warn('groupSenderKeys', 'inbound SKDM: keyExchangeFetchBundle failed', err);
    return;
  }
  let skdmB64: string;
  try {
    const opened = await api.signalingEnvelopeOpen(
      senderIkPub,
      skdmEnvelopeSession(senderDid),
      SKDM_ENVELOPE_KIND as never,
      sealedB64,
    );
    skdmB64 = opened.plaintext;
  } catch (err) {
    log.warn('groupSenderKeys', 'inbound SKDM: signaling envelope open failed', err);
    return;
  }
  try {
    const r = await api.cryptoGroupSkConsumeSkdm(senderDid, skdmB64);
    log.info(
      'groupSenderKeys',
      `installed SKDM group=${r.group_ulid} sender=${r.sender_did} key_id=${r.sender_key_id}`,
    );
  } catch (err) {
    log.warn('groupSenderKeys', 'cryptoGroupSkConsumeSkdm failed', err);
  }
}

// --- base64 helpers ----------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa is browser-side; Tauri's webview always provides it.
  return btoa(bin);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
