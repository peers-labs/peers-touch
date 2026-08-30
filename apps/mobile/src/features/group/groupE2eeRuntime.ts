import { create, fromBinary } from '@bufbuild/protobuf';
import {
  buildChatEncryptedMessagePayload,
  CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
  encryptedChatTransportMessageType,
} from '@peers-touch/client-chat-core';

import type { MobileAuthSession } from '../auth/authSession';
import { mobileAuthScope } from '../auth/mobileAuthIdentity';
import type { ChatAttachmentInput } from '../social/socialApi';
import { createSocialApiClient } from '../social/socialApi';
import { readableErrorMessage } from '../social/socialTypes';
import { ChatEncryptedMessagePayloadSchema, GroupMessageAttachmentSchema, type ChatEncryptedMessagePayload, type GroupMember, type GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { EncryptedMediaDescriptorSchema } from '../../gen/proto/domain/common/common_pb';
import { consumeGroupSkdm, decryptGroupPayloadBytes, emitGroupSkdm, encryptGroupMessagePayload, rotateGroupSenderKey } from './groupE2eeBridge';
import { createGroupSkdmLedger, type GroupSkdmLedger, type SkdmLedgerTarget } from './groupE2eeLedger';
import { ensureMobileKeyBundlePublished, fetchKeyBundles, openSkdmEnvelopeFromSender, sealSkdmEnvelopeForPeer } from './groupKeyExchange';
import type { GroupState } from './groupStore';

const GROUP_E2EE_REPAIR_INTERVAL_MS = 5000;

export interface GroupE2eeRuntimeController {
  consumeSkdmControlMessage: (senderPtid: string, skdmBytes: Uint8Array) => Promise<boolean>;
  canEncryptGroup: (groupUlid: string) => Promise<boolean>;
  repairEncryptedMessages: () => Promise<void>;
  rotateAfterMembershipChange: (groupUlid: string, affectedActorPtid: string) => Promise<boolean>;
  sendEncryptedMessage: (groupUlid: string, plaintext: string, attachments?: ChatAttachmentInput[], messageType?: number) => Promise<boolean>;
  editEncryptedMessage: (groupUlid: string, messageUlid: string, plaintext: string) => Promise<boolean>;
  teardown: () => void;
}

export function startGroupE2eeRuntime(
  session: MobileAuthSession,
  getStore: () => GroupState,
): GroupE2eeRuntimeController {
  let cancelled = false;
  let repairing = false;
  const ledger = createGroupSkdmLedger(session);
  const socialApi = createSocialApiClient(session);

  const canEncryptGroup = async (groupUlid: string): Promise<boolean> => {
    if (cancelled || !groupUlid) return false;
    try {
      const store = getStore();
      const members = await membersForDistribution(store, groupUlid);
      await distributeSenderKey(session, socialApi, ledger, groupUlid, members);
      store.setEncryptionReady(groupUlid, true);
      store.setE2eeError(sendErrorKey(groupUlid), null);
      return true;
    } catch (error) {
      getStore().setEncryptionReady(groupUlid, false);
      getStore().setE2eeError(sendErrorKey(groupUlid), errorMessage(error));
      return false;
    }
  };

  const repairEncryptedMessages = async () => {
    if (cancelled || repairing) return;
    repairing = true;
    try {
      await repairEncryptedGroupMessages(session, getStore);
    } finally {
      repairing = false;
    }
  };

  void ensureMobileKeyBundlePublished(session).catch((error) => {
    getStore().setE2eeError(identityErrorKey(session), errorMessage(error));
  });
  void repairEncryptedMessages();
  const repairTimer = window.setInterval(() => {
    void repairEncryptedMessages();
    const activeGroupUlid = getStore().activeGroupUlid;
    if (activeGroupUlid) void canEncryptGroup(activeGroupUlid);
  }, GROUP_E2EE_REPAIR_INTERVAL_MS);

  return {
    consumeSkdmControlMessage: async (senderPtid, skdmBytes) => {
      if (cancelled || !senderPtid || !skdmBytes.byteLength) return false;
      try {
        const skdmPlaintext = await openSkdmEnvelopeFromSender(session, senderPtid, skdmBytes);
        if (!skdmPlaintext?.byteLength) {
          throw new Error(`missing-authenticated-skdm-envelope:${senderPtid}`);
        }
        await consumeGroupSkdm(session, senderPtid, skdmPlaintext);
        getStore().setE2eeError(skdmErrorKey(senderPtid), null);
        await repairEncryptedMessages();
        return true;
      } catch (error) {
        getStore().setE2eeError(skdmErrorKey(senderPtid), errorMessage(error));
        return false;
      }
    },
    canEncryptGroup,
    repairEncryptedMessages,
    rotateAfterMembershipChange: async (groupUlid, affectedActorPtid) => {
      if (cancelled || !groupUlid || affectedActorPtid === actorPtidForSession(session)) return false;
      try {
        await rotateGroupSenderKey(session, groupUlid);
        await ledger.clearGroup(groupUlid);
        getStore().setEncryptionReady(groupUlid, false);
        getStore().setE2eeError(rotationErrorKey(groupUlid), null);
        return true;
      } catch (error) {
        getStore().setE2eeError(rotationErrorKey(groupUlid), errorMessage(error));
        return false;
      }
    },
    sendEncryptedMessage: async (groupUlid, plaintext, attachments, messageType) => {
      if (cancelled || !groupUlid || (!plaintext.trim() && !attachments?.length)) return false;
      try {
        const store = getStore();
        const ready = await canEncryptGroup(groupUlid);
        if (!ready) return false;
        const encryptedPlaintext = createEncryptedChatPayload({
          text: plaintext,
          attachments: attachments ?? [],
          messageType,
        });
        const encryptedPayload = await encryptGroupMessagePayload(session, groupUlid, encryptedPlaintext);
        const payload = await store.api?.sendMessage(groupUlid, encryptedPayload, [], encryptedChatTransportMessageType());
        if (payload?.message) {
          await store.ingestRealtimeMessage(groupUlid, payload.message);
          store.applyDecryptedMessage(groupUlid, payload.message.ulid, encryptedPlaintext);
        }
        getStore().setE2eeError(sendErrorKey(groupUlid), null);
        return true;
      } catch (error) {
        getStore().setE2eeError(sendErrorKey(groupUlid), errorMessage(error));
        return false;
      }
    },
    editEncryptedMessage: async (groupUlid, messageUlid, plaintext) => {
      if (cancelled || !groupUlid || !messageUlid || !plaintext.trim()) return false;
      try {
        const store = getStore();
        const ready = await canEncryptGroup(groupUlid);
        if (!ready) return false;
        const encryptedPayload = await encryptGroupMessagePayload(session, groupUlid, createEncryptedChatPayload({ text: plaintext }));
        await store.api?.editMessage(groupUlid, messageUlid, encryptedPayload);
        store.applyMessageMutation(groupUlid, messageUlid, 'EDIT', {
          newContent: plaintext,
          newCiphertext: encryptedPayload,
          mutatedTsUnixMs: Date.now(),
        });
        getStore().setE2eeError(editErrorKey(groupUlid), null);
        return true;
      } catch (error) {
        getStore().setE2eeError(editErrorKey(groupUlid), errorMessage(error));
        return false;
      }
    },
    teardown: () => {
      cancelled = true;
      window.clearInterval(repairTimer);
    },
  };
}

async function membersForDistribution(store: GroupState, groupUlid: string): Promise<GroupMember[]> {
  if (store.members[groupUlid]?.length) return store.members[groupUlid];
  await store.loadMembers(groupUlid);
  return store.members[groupUlid] ?? [];
}

async function distributeSenderKey(
  session: MobileAuthSession,
  socialApi: ReturnType<typeof createSocialApiClient>,
  ledger: GroupSkdmLedger,
  groupUlid: string,
  members: GroupMember[],
) {
  const selfPtid = actorPtidForSession(session);
  const peerPtids = members
    .map((member) => member.ptid)
    .filter((ptid): ptid is string => Boolean(ptid && ptid !== selfPtid));
  if (!peerPtids.length) return;

  const skdmBytes = await emitGroupSkdm(session, groupUlid);
  for (const peerPtid of peerPtids) {
    const bundles = await fetchKeyBundles(session, peerPtid).catch(() => []);
    const targets = bundles
      .map((bundle) => {
        const ikPub = String(bundle.ikPub || (bundle as Record<string, unknown>).ik_pub || '').trim();
        if (!ikPub) return null;
        const deviceKey = String(bundle.deviceId || (bundle as Record<string, unknown>).device_id || ikPub);
        return { ikPub, target: skdmLedgerTarget(groupUlid, peerPtid, deviceKey) };
      })
      .filter((target): target is { ikPub: string; target: SkdmLedgerTarget } => Boolean(target));
    if (!targets.length) throw new Error(`missing-key-bundle:${peerPtid}`);

    for (const { ikPub, target } of targets) {
      if (await ledger.isSent(target)) continue;

      await ledger.markPending(target);
      try {
        const sealedB64 = await sealSkdmEnvelopeForPeer(session, peerPtid, ikPub, skdmBytes);
        const carrier = base64ToBytes(sealedB64);
        const friendSession = await socialApi.createSession(peerPtid);
        const sessionUlid = friendSession.session?.ulid;
        if (!sessionUlid) throw new Error(`missing-friend-session:${peerPtid}`);
        await socialApi.sendSenderKeyDistribution(sessionUlid, peerPtid, carrier);
        await ledger.markSent(target);
      } catch (error) {
        await ledger.markFailed(target, errorMessage(error));
        throw error;
      }
    }
  }
}

async function repairEncryptedGroupMessages(
  session: MobileAuthSession,
  getStore: () => GroupState,
) {
  const candidates = encryptedMessageCandidates(getStore());
  for (const candidate of candidates) {
    try {
      const plaintext = await decryptGroupPlaintextProjection(session, candidate.groupUlid, candidate.encryptedPayload);
      getStore().applyDecryptedMessage(candidate.groupUlid, candidate.messageUlid, plaintext);
    } catch (error) {
      getStore().setE2eeError(candidate.messageUlid, errorMessage(error));
    }
  }
}

async function decryptGroupPlaintextProjection(
  session: MobileAuthSession,
  groupUlid: string,
  encryptedPayload: Uint8Array,
): Promise<string | ChatEncryptedMessagePayload> {
  const plaintextBytes = await decryptGroupPayloadBytes(session, groupUlid, encryptedPayload);
  try {
    return fromBinary(ChatEncryptedMessagePayloadSchema, plaintextBytes);
  } catch {
    return new TextDecoder().decode(plaintextBytes);
  }
}

function createEncryptedChatPayload(input: {
  text?: string;
  attachments?: ChatAttachmentInput[];
  messageType?: number;
}): ChatEncryptedMessagePayload {
  const payload = buildChatEncryptedMessagePayload(input);
  return create(ChatEncryptedMessagePayloadSchema, {
    version: CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
    text: payload.text,
    messageType: payload.messageType ?? encryptedChatTransportMessageType(),
    attachments: payload.attachments.map((attachment) => {
      const mediaEncryption = attachment.encryption_suite
        ? create(EncryptedMediaDescriptorSchema, {
          encrypted: true,
          version: CHAT_ENCRYPTED_MESSAGE_PAYLOAD_VERSION,
          suite: attachment.encryption_suite,
          keyB64: attachment.encryption_key_b64 ?? '',
          nonceB64: attachment.encryption_nonce_b64 ?? '',
          plaintextSha256B64: attachment.plaintext_sha256_b64 ?? '',
          ciphertextSha256B64: attachment.ciphertext_sha256_b64 ?? '',
          plaintextSize: BigInt(attachment.plaintext_size ?? attachment.size),
          ciphertextSize: BigInt(attachment.ciphertext_size ?? attachment.size),
          chunking: attachment.chunking ?? '',
          chunkSize: attachment.chunk_size ?? 0,
          chunkCount: attachment.chunk_count ?? 0,
          tagSize: attachment.tag_size ?? 0,
          nonceStrategy: attachment.nonce_strategy ?? '',
        })
        : undefined;
      return create(GroupMessageAttachmentSchema, {
        cid: attachment.cid,
        filename: attachment.filename,
        mimeType: attachment.mime_type,
        size: BigInt(attachment.size),
        thumbnailCid: attachment.thumbnail_cid ?? '',
        visibility: attachment.visibility ?? '',
        mediaEncryption,
        encryptionSuite: '',
        encryptionKeyB64: '',
        encryptionNonceB64: '',
        plaintextSha256B64: attachment.plaintext_sha256_b64 ?? '',
        ciphertextSha256B64: attachment.ciphertext_sha256_b64 ?? '',
        plaintextSize: BigInt(attachment.plaintext_size ?? attachment.size),
        ciphertextSize: BigInt(attachment.ciphertext_size ?? attachment.size),
      });
    }),
  });
}

function encryptedMessageCandidates(store: GroupState): Array<{
  groupUlid: string;
  messageUlid: string;
  encryptedPayload: Uint8Array;
}> {
  return Object.entries(store.messages).flatMap(([groupUlid, messages]) =>
    messages
      .filter(shouldRepairMessage)
      .map((message) => ({
        groupUlid,
        messageUlid: message.ulid,
        encryptedPayload: message.encryptedPayload,
      })),
  );
}

function shouldRepairMessage(message: GroupMessage): message is GroupMessage & {
  encryptedPayload: Uint8Array;
} {
  return Boolean(message.ulid && !message.recalled && !message.content && message.encryptedPayload?.byteLength);
}

function actorPtidForSession(session: MobileAuthSession): string {
  return mobileAuthScope(session).ptid;
}

function identityErrorKey(session: MobileAuthSession): string {
  return `identity:${session.stationPeerId}:${actorPtidForSession(session)}`;
}

function sendErrorKey(groupUlid: string): string {
  return `send:${groupUlid}`;
}

function editErrorKey(groupUlid: string): string {
  return `edit:${groupUlid}`;
}

function skdmLedgerTarget(groupUlid: string, peerPtid: string, deviceKey: string): SkdmLedgerTarget {
  return { groupUlid, peerPtid, deviceKey };
}

function skdmErrorKey(senderPtid: string): string {
  return `skdm:${senderPtid}`;
}

function rotationErrorKey(groupUlid: string): string {
  return `rotation:${groupUlid}`;
}

function errorMessage(error: unknown): string {
  return readableErrorMessage(error);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
