import type { MobileAuthSession } from '../auth/authSession';
import { createSocialApiClient } from '../social/socialApi';
import type { GroupMember, GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { consumeGroupSkdm, decryptGroupPayload, emitGroupSkdm, encryptGroupPlaintext, rotateGroupSenderKey } from './groupE2eeBridge';
import { ensureMobileKeyBundlePublished, fetchKeyBundles, openSkdmEnvelopeFromSender, sealSkdmEnvelopeForPeer } from './groupKeyExchange';
import type { GroupState } from './groupStore';

const GROUP_E2EE_REPAIR_INTERVAL_MS = 5000;

export interface GroupE2eeRuntimeController {
  consumeSkdmControlMessage: (senderDid: string, skdmBytes: Uint8Array) => Promise<boolean>;
  repairEncryptedMessages: () => Promise<void>;
  rotateAfterMembershipChange: (groupUlid: string, affectedActorDid: string) => Promise<boolean>;
  sendEncryptedMessage: (groupUlid: string, plaintext: string) => Promise<boolean>;
  teardown: () => void;
}

export function startGroupE2eeRuntime(
  session: MobileAuthSession,
  getStore: () => GroupState,
): GroupE2eeRuntimeController {
  let cancelled = false;
  let repairing = false;
  const sentSkdmRecipients = new Set<string>();
  const socialApi = createSocialApiClient(session);

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
  }, GROUP_E2EE_REPAIR_INTERVAL_MS);

  return {
    consumeSkdmControlMessage: async (senderDid, skdmBytes) => {
      if (cancelled || !senderDid || !skdmBytes.byteLength) return false;
      try {
        const skdmPlaintext = await openSkdmEnvelopeFromSender(session, senderDid, skdmBytes);
        if (!skdmPlaintext?.byteLength) {
          throw new Error(`missing-authenticated-skdm-envelope:${senderDid}`);
        }
        await consumeGroupSkdm(session, senderDid, skdmPlaintext);
        getStore().setE2eeError(skdmErrorKey(senderDid), null);
        await repairEncryptedMessages();
        return true;
      } catch (error) {
        getStore().setE2eeError(skdmErrorKey(senderDid), errorMessage(error));
        return false;
      }
    },
    repairEncryptedMessages,
    rotateAfterMembershipChange: async (groupUlid, affectedActorDid) => {
      if (cancelled || !groupUlid || affectedActorDid === actorDidForSession(session)) return false;
      try {
        await rotateGroupSenderKey(session, groupUlid);
        clearSentSkdmForGroup(sentSkdmRecipients, groupUlid);
        getStore().setE2eeError(rotationErrorKey(groupUlid), null);
        return true;
      } catch (error) {
        getStore().setE2eeError(rotationErrorKey(groupUlid), errorMessage(error));
        return false;
      }
    },
    sendEncryptedMessage: async (groupUlid, plaintext) => {
      if (cancelled || !groupUlid || !plaintext.trim()) return false;
      try {
        const store = getStore();
        const members = await membersForDistribution(store, groupUlid);
        await distributeSenderKey(session, socialApi, sentSkdmRecipients, groupUlid, members);
        const encryptedPayload = await encryptGroupPlaintext(session, groupUlid, plaintext);
        const payload = await store.api?.sendMessage(groupUlid, encryptedPayload);
        if (payload?.message) await store.ingestRealtimeMessage(groupUlid, payload.message);
        getStore().setE2eeError(sendErrorKey(groupUlid), null);
        return true;
      } catch (error) {
        getStore().setE2eeError(sendErrorKey(groupUlid), errorMessage(error));
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
  sentSkdmRecipients: Set<string>,
  groupUlid: string,
  members: GroupMember[],
) {
  const selfDid = actorDidForSession(session);
  const peerDids = members
    .map((member) => member.actorDid)
    .filter((did): did is string => Boolean(did && did !== selfDid));
  if (!peerDids.length) return;

  const skdmBytes = await emitGroupSkdm(session, groupUlid);
  for (const peerDid of peerDids) {
    const bundles = await fetchKeyBundles(session, peerDid).catch(() => []);
    for (const bundle of bundles) {
      const ikPub = String(bundle.ikPub || (bundle as Record<string, unknown>).ik_pub || '').trim();
      if (!ikPub) continue;
      const key = skdmRecipientKey(groupUlid, peerDid, String(bundle.deviceId || (bundle as Record<string, unknown>).device_id || ikPub));
      if (sentSkdmRecipients.has(key)) continue;

      const sealedB64 = await sealSkdmEnvelopeForPeer(session, peerDid, ikPub, skdmBytes);
      const carrier = base64ToBytes(sealedB64);
      const friendSession = await socialApi.createSession(peerDid);
      const sessionUlid = friendSession.session?.ulid;
      if (!sessionUlid) continue;
      await socialApi.sendSenderKeyDistribution(sessionUlid, peerDid, carrier);
      sentSkdmRecipients.add(key);
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
      const plaintext = await decryptGroupPayload(session, candidate.groupUlid, candidate.encryptedPayload);
      getStore().applyDecryptedMessage(candidate.groupUlid, candidate.messageUlid, plaintext);
    } catch (error) {
      getStore().setE2eeError(candidate.messageUlid, errorMessage(error));
    }
  }
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

function actorDidForSession(session: MobileAuthSession): string {
  return String(session.actor?.id || session.actor?.actorId || session.actor?.actor_id || '').trim();
}

function identityErrorKey(session: MobileAuthSession): string {
  return `identity:${actorDidForSession(session) || session.sessionId}`;
}

function sendErrorKey(groupUlid: string): string {
  return `send:${groupUlid}`;
}

function skdmRecipientKey(groupUlid: string, peerDid: string, deviceKey: string): string {
  return `${groupUlid}:${peerDid}:${deviceKey}`;
}

function clearSentSkdmForGroup(sentSkdmRecipients: Set<string>, groupUlid: string) {
  [...sentSkdmRecipients].forEach((key) => {
    if (key.startsWith(`${groupUlid}:`)) sentSkdmRecipients.delete(key);
  });
}

function skdmErrorKey(senderDid: string): string {
  return `skdm:${senderDid}`;
}

function rotationErrorKey(groupUlid: string): string {
  return `rotation:${groupUlid}`;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function base64ToBytes(value: string): Uint8Array {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
