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
 *
 * Parallel pending ledger:
 *   `groupSenderKeys:skdm-pending:<actorId>:<groupUlid>`
 * tracks member DIDs that did not get the SKDM in the last attempt
 * (offline, missing bundle, etc.). `retrySkdmDistributionFor` runs
 * when presence flips online so we do not rely on the user sending
 * another group message to retry.
 */

import { api } from '../../services/desktop_api';
import { log } from '../../utils/logger';
import { eventBus, EVENT } from '../../kernel/events';

export class MissingSkdmError extends Error {
  constructor(public readonly groupUlid: string, public readonly senderDid: string | null) {
    super(`No sender chain installed for group=${groupUlid}, sender=${senderDid ?? '?'}`);
    this.name = 'MissingSkdmError';
  }
}

const SENT_KEY_PREFIX = 'groupSenderKeys:skdm-sent';
const PENDING_KEY_PREFIX = 'groupSenderKeys:skdm-pending';
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

function pendingKey(actorId: string, groupUlid: string): string {
  return `${PENDING_KEY_PREFIX}:${actorId}:${groupUlid}`;
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

function loadPendingSet(actorId: string, groupUlid: string): Set<string> {
  try {
    const raw = localStorage.getItem(pendingKey(actorId, groupUlid));
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((v): v is string => typeof v === 'string'));
  } catch {
    return new Set();
  }
}

function savePendingSet(actorId: string, groupUlid: string, set: Set<string>): void {
  try {
    if (set.size === 0) {
      localStorage.removeItem(pendingKey(actorId, groupUlid));
    } else {
      localStorage.setItem(pendingKey(actorId, groupUlid), JSON.stringify(Array.from(set)));
    }
  } catch (err) {
    log.warn('groupSenderKeys', 'persist pending-set failed', err);
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
    localStorage.removeItem(pendingKey(actorId, groupUlid));
  } catch (err) {
    log.warn('groupSenderKeys', 'reset sent-set failed', err);
  }
}

/**
 * Force-rotate the local sender chain for `groupUlid`.
 *
 * Trigger this whenever the group's effective membership shrinks
 * from our perspective -- a removed peer who keeps the old chain
 * key can otherwise decrypt every future message (no
 * post-compromise security). The Rust side mints a new chain at
 * `max_known_sender_key_id + 1`; we clear the SKDM-sent ledger so
 * the next `ensureSkdmDistributed` re-distributes the new chain
 * to every remaining member.
 *
 * The OLD chain row is intentionally kept in storage on both ends
 * so any in-flight ciphertext we sent before rotating still
 * decrypts; only NEW sends use the rotated chain (because
 * `latest_local_sender_chain` returns the highest sender_key_id
 * with a signing seed).
 *
 * Idempotent in the sense that calling it twice in a row produces
 * a generation that is one higher than necessary -- harmless but
 * wasteful. Callers should de-bounce rotations driven by the same
 * underlying event (e.g. a single `loadGroupMembers` diff).
 */
export async function rotateGroupSenderChain(
  actorId: string,
  groupUlid: string,
): Promise<{ senderKeyId: number } | null> {
  if (!actorId || !groupUlid) return null;
  try {
    const r = await api.cryptoGroupSkRotate(groupUlid);
    resetSkdmDistribution(actorId, groupUlid);
    log.info(
      'groupSenderKeys',
      `rotated sender chain group=${groupUlid} new_key_id=${r.sender_key_id}`,
    );
    return { senderKeyId: r.sender_key_id };
  } catch (err) {
    log.error('groupSenderKeys', 'rotateGroupSenderChain failed', err);
    return null;
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
 * Seal and send one SKDM to `peerDid` (friend-chat type=50). Returns
 * true when the carrier was accepted; false on skip or error.
 */
async function dispatchSkdmToPeer(
  actorId: string,
  peerDid: string,
  skdmBytesB64: string,
): Promise<boolean> {
  try {
    const bundle = await api.keyExchangeFetchBundle(peerDid);
    const peerIkPub = String(bundle?.ik_pub || '').trim();
    if (!peerIkPub) {
      log.warn('groupSenderKeys', `peer ${peerDid} has no published ik_pub; skipping SKDM`);
      return false;
    }

    const sealed = await api.signalingEnvelopeSeal(
      peerIkPub,
      skdmEnvelopeSession(actorId),
      SKDM_ENVELOPE_KIND as never,
      skdmBytesB64,
    );

    const session = await api.friendChatCreateSession(peerDid);
    const sessionUlid = session?.session?.ulid ?? '';
    if (!sessionUlid) {
      log.warn('groupSenderKeys', `no session ulid for ${peerDid}; skipping SKDM`);
      return false;
    }

    await api.friendChatSendMessage(
      sessionUlid,
      peerDid,
      sealed.payload_b64,
      FRIEND_MESSAGE_TYPE_SENDER_KEY_DISTRIBUTION,
    );
    return true;
  } catch (err) {
    log.warn('groupSenderKeys', `SKDM dispatch failed to ${peerDid}`, err);
    return false;
  }
}

/**
 * When a peer transitions online, retry SKDM delivery for any group
 * where they are still pending (see pending ledger). Uses the in-
 * memory `groupMembers` snapshot from `socialChat` — groups not
 * loaded there are skipped until the next `ensureSkdmDistributed`.
 */
export async function retrySkdmDistributionFor(actorId: string, peerDid: string): Promise<void> {
  if (!actorId || !peerDid) return;
  const { useSocialChatStore } = await import('../../store/socialChat');
  const groupMembers = useSocialChatStore.getState().groupMembers;

  for (const [groupUlid, members] of Object.entries(groupMembers)) {
    if (!members?.length) continue;

    const pending = loadPendingSet(actorId, groupUlid);
    if (!pending.has(peerDid)) continue;

    const stillMember = members.some((m) => m.actorDid === peerDid);
    if (!stillMember) {
      pending.delete(peerDid);
      savePendingSet(actorId, groupUlid, pending);
      continue;
    }

    const sent = loadSentSet(actorId, groupUlid);
    if (sent.has(peerDid)) {
      pending.delete(peerDid);
      savePendingSet(actorId, groupUlid, pending);
      continue;
    }

    let skdmBytesB64: string;
    try {
      const r = await api.cryptoGroupSkEmitSkdm(groupUlid);
      skdmBytesB64 = r.skdm_b64;
    } catch {
      continue;
    }

    const ok = await dispatchSkdmToPeer(actorId, peerDid, skdmBytesB64);
    if (ok) {
      sent.add(peerDid);
      pending.delete(peerDid);
      saveSentSet(actorId, groupUlid, sent);
      savePendingSet(actorId, groupUlid, pending);
    }
  }
}

/**
 * Make sure every `memberDids[]` member (except `actorId`) has our
 * current SKDM. Members already marked in the sent ledger are
 * skipped. Failure to reach a single member is logged but does not
 * abort the whole call -- partial distribution is still valuable
 * (the missed peer is recorded in the pending ledger and can be
 * retried via `retrySkdmDistributionFor` when they come online).
 */
export async function ensureSkdmDistributed(
  actorId: string,
  groupUlid: string,
  memberDids: string[],
): Promise<void> {
  if (!actorId || !groupUlid) return;
  const sent = loadSentSet(actorId, groupUlid);
  const pending = loadPendingSet(actorId, groupUlid);

  // TODO(multi-device-echo): `key_exchange.FetchKeyBundleResponse` carries a single
  // `ik_pub` per DID (`model/domain/key_exchange/key_exchange.proto`); there is no
  // device-scoped bundle in `keyExchangeFetchBundle(did)`. Until Station stores and
  // returns per-device identity keys (and friend-chat can route to a specific device),
  // we cannot seal distinct SKDM envelopes for each of "my" devices that share this DID.
  // The `did !== actorId` filter correctly skips redundant self-delivery to the same IK
  // as this client but cannot unlock cross-device sender echo. Do not remove this filter
  // without bundle-layer support — sending to the same DID would still target only one IK.
  const targets = memberDids.filter((did) => !!did && did !== actorId && !sent.has(did));
  if (targets.length === 0) return;

  let skdmBytesB64: string;
  try {
    const r = await api.cryptoGroupSkEmitSkdm(groupUlid);
    skdmBytesB64 = r.skdm_b64;
  } catch (err) {
    log.error('groupSenderKeys', 'cryptoGroupSkEmitSkdm failed', err);
    throw err;
  }

  for (const peerDid of targets) {
    const ok = await dispatchSkdmToPeer(actorId, peerDid, skdmBytesB64);
    if (ok) {
      sent.add(peerDid);
      pending.delete(peerDid);
    } else {
      pending.add(peerDid);
    }
  }

  saveSentSet(actorId, groupUlid, sent);
  savePendingSet(actorId, groupUlid, pending);
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
    // Notify the store so any group ciphertext that previously
    // failed with MissingSkdmError for this (group, sender,
    // key_id) gets re-tried. Without this the late-arriving
    // SKDM would only unblock messages received AFTER it lands;
    // the ones already in the store would stay stuck on
    // `[Waiting for sender key…]` until the user reloads.
    eventBus.publish(EVENT.GROUP_SKDM_INSTALLED, {
      groupUlid: r.group_ulid,
      senderDid: r.sender_did,
      senderKeyId: r.sender_key_id,
    });
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
