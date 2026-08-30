import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import {
  buildChatEncryptedMessagePayload,
  CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
  encryptedChatTransportMessageType,
  type ChatAttachmentLike,
} from '@peers-touch/client-chat-core';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScope } from '../auth/mobileAuthIdentity';
import type { ChatAttachmentInput } from './socialApi';
import { EncryptedMessageSchema } from '../../gen/proto/domain/chat/friend_chat_pb';
import { ChatEncryptedMessagePayloadSchema, GroupMessageAttachmentSchema, type ChatEncryptedMessagePayload } from '../../gen/proto/domain/chat/group_chat_pb';
import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import { ensureMobileKeyBundlePublished, fetchKeyBundles, openSignalingEnvelopeFromSender, sealSignalingEnvelopeForPeer } from '../group/groupKeyExchange';

const FRIEND_MESSAGE_ENVELOPE_KIND = 'FRIEND_CHAT_MESSAGE';
const FRIEND_MESSAGE_ENVELOPE_VERSION = 1;

interface FriendMessageSealedEnvelope {
  recipientPtid: string;
  deviceId: string;
  ikPub: string;
  payloadB64: string;
}

interface FriendMessageEnvelope {
  version: number;
  kind: typeof FRIEND_MESSAGE_ENVELOPE_KIND;
  sessionUlid: string;
  envelopes: FriendMessageSealedEnvelope[];
}

export async function encryptFriendChatPayload(
  session: MobileAuthSession,
  sessionUlid: string,
  peerPtid: string,
  payload: ChatEncryptedMessagePayload,
): Promise<Uint8Array> {
  const plaintextBytes = toBinary(ChatEncryptedMessagePayloadSchema, payload);
  const currentPtid = actorPtidForSession(session);
  await ensureMobileKeyBundlePublished(session);
  const envelopes = await sealPayloadForAudience(session, sessionUlid, plaintextBytes, [currentPtid, peerPtid]);
  if (!envelopes.length) throw new Error('mobile.friend.e2eeMissingKeyBundle');
  const envelopeBytes = new TextEncoder().encode(JSON.stringify({
    version: FRIEND_MESSAGE_ENVELOPE_VERSION,
    kind: FRIEND_MESSAGE_ENVELOPE_KIND,
    sessionUlid,
    envelopes,
  } satisfies FriendMessageEnvelope));
  return toBinary(EncryptedMessageSchema, create(EncryptedMessageSchema, {
    version: 0,
    counter: 1,
    ciphertext: envelopeBytes,
  }));
}

export async function decryptFriendChatPayload(
  session: MobileAuthSession,
  input: {
    sessionUlid: string;
    senderPtid: string;
    currentUserPtid: string;
    encryptedPayload: Uint8Array;
  },
): Promise<ChatEncryptedMessagePayload | null> {
  const envelope = parseFriendMessageEnvelope(friendEnvelopeBytes(input.encryptedPayload));
  if (!envelope || envelope.kind !== FRIEND_MESSAGE_ENVELOPE_KIND || envelope.sessionUlid !== input.sessionUlid) return null;

  const sealedCandidates = envelope.envelopes.filter((item) => item.recipientPtid === input.currentUserPtid);
  for (const candidate of sealedCandidates) {
    const plaintextBytes = await openSignalingEnvelopeFromSender(session, {
      senderPtid: input.senderPtid,
      sessionUlid: friendEnvelopeSession(input.sessionUlid),
      kind: FRIEND_MESSAGE_ENVELOPE_KIND,
      sealedBytes: base64ToBytes(candidate.payloadB64),
    });
    if (!plaintextBytes?.byteLength) continue;
    try {
      return fromBinary(ChatEncryptedMessagePayloadSchema, plaintextBytes);
    } catch {
      return null;
    }
  }
  return null;
}

export function createFriendEncryptedChatPayload(input: {
  text?: string;
  attachments?: ChatAttachmentInput[];
  messageType?: number;
}): ChatEncryptedMessagePayload {
  const payload = buildChatEncryptedMessagePayload(input);
  return create(ChatEncryptedMessagePayloadSchema, {
    version: CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
    text: payload.text,
    messageType: payload.messageType ?? encryptedChatTransportMessageType(),
    attachments: payload.attachments.map(friendPayloadAttachment),
  });
}

async function sealPayloadForAudience(
  session: MobileAuthSession,
  sessionUlid: string,
  plaintextBytes: Uint8Array,
  recipientPtids: string[],
): Promise<FriendMessageSealedEnvelope[]> {
  const envelopes: FriendMessageSealedEnvelope[] = [];
  const uniquePtids = Array.from(new Set(recipientPtids.map((ptid) => ptid.trim()).filter(Boolean)));
  for (const recipientPtid of uniquePtids) {
    const bundles = await fetchKeyBundles(session, recipientPtid).catch(() => []);
    for (const bundle of bundles) {
      const ikPub = String(bundle.ikPub || (bundle as Record<string, unknown>).ik_pub || '').trim();
      if (!ikPub) continue;
      const sealedBytes = await sealSignalingEnvelopeForPeer(session, {
        peerIkPub: ikPub,
        sessionUlid: friendEnvelopeSession(sessionUlid),
        kind: FRIEND_MESSAGE_ENVELOPE_KIND,
        plaintextBytes,
      });
      envelopes.push({
        recipientPtid,
        deviceId: String(bundle.deviceId || (bundle as Record<string, unknown>).device_id || ikPub),
        ikPub,
        payloadB64: bytesToBase64(sealedBytes),
      });
    }
  }
  return envelopes;
}

function friendPayloadAttachment(attachment: ChatAttachmentLike) {
  const size = positiveBigInt(attachment.size);
  const plaintextSize = positiveBigInt(attachment.plaintextSize ?? attachment.plaintext_size ?? attachment.size);
  const ciphertextSize = positiveBigInt(attachment.ciphertextSize ?? attachment.ciphertext_size ?? attachment.size);
  const suite = attachment.encryptionSuite ?? attachment.encryption_suite ?? '';
  const mediaEncryption = attachment.mediaEncryption ?? attachment.media_encryption ?? (suite
    ? create(EncryptedMediaDescriptorSchema, {
      encrypted: true,
      version: CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
      suite,
      keyB64: attachment.encryptionKeyB64 ?? attachment.encryption_key_b64 ?? '',
      nonceB64: attachment.encryptionNonceB64 ?? attachment.encryption_nonce_b64 ?? '',
      plaintextSha256B64: attachment.plaintextSha256B64 ?? attachment.plaintext_sha256_b64 ?? '',
      ciphertextSha256B64: attachment.ciphertextSha256B64 ?? attachment.ciphertext_sha256_b64 ?? '',
      plaintextSize,
      ciphertextSize,
      chunking: attachment.chunking ?? '',
      chunkSize: positiveNumber(attachment.chunkSize ?? attachment.chunk_size),
      chunkCount: positiveNumber(attachment.chunkCount ?? attachment.chunk_count),
      tagSize: positiveNumber(attachment.tagSize ?? attachment.tag_size),
      nonceStrategy: attachment.nonceStrategy ?? attachment.nonce_strategy ?? '',
    })
    : undefined);
  return create(GroupMessageAttachmentSchema, {
    cid: attachment.cid ?? '',
    filename: attachment.filename ?? '',
    mimeType: attachment.mimeType ?? attachment.mime_type ?? '',
    size,
    thumbnailCid: attachment.thumbnailCid ?? attachment.thumbnail_cid ?? '',
    visibility: attachment.visibility ?? '',
    mediaEncryption,
  });
}

function parseFriendMessageEnvelope(bytes: Uint8Array): FriendMessageEnvelope | null {
  try {
    const record = JSON.parse(new TextDecoder().decode(bytes)) as Partial<FriendMessageEnvelope>;
    if (record.version !== FRIEND_MESSAGE_ENVELOPE_VERSION || !Array.isArray(record.envelopes)) return null;
    return {
      version: record.version,
      kind: record.kind as typeof FRIEND_MESSAGE_ENVELOPE_KIND,
      sessionUlid: String(record.sessionUlid ?? ''),
      envelopes: record.envelopes.map((item) => ({
        recipientPtid: String(item.recipientPtid ?? ''),
        deviceId: String(item.deviceId ?? ''),
        ikPub: String(item.ikPub ?? ''),
        payloadB64: String(item.payloadB64 ?? ''),
      })).filter((item) => item.recipientPtid && item.payloadB64),
    };
  } catch {
    return null;
  }
}

function friendEnvelopeBytes(encryptedPayload: Uint8Array): Uint8Array {
  try {
    const frame = fromBinary(EncryptedMessageSchema, encryptedPayload);
    if (frame.ciphertext?.byteLength) return frame.ciphertext;
  } catch {
    // Legacy mobile builds briefly carried the audience envelope directly.
  }
  return encryptedPayload;
}

function friendEnvelopeSession(sessionUlid: string): string {
  return `friend-message:${sessionUlid}`;
}

function actorPtidForSession(session: MobileAuthSession): string {
  return mobileAuthScope(session).ptid;
}

function positiveBigInt(value: unknown): bigint {
  const numberValue = Number(value ?? 0);
  return BigInt(Number.isFinite(numberValue) && numberValue > 0 ? Math.floor(numberValue) : 0);
}

function positiveNumber(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return window.btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
