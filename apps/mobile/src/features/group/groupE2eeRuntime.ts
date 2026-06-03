import type { MobileAuthSession } from '../auth/authSession';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { consumeGroupSkdm, decryptGroupPayload, rotateGroupSenderKey } from './groupE2eeBridge';
import { ensureMobileKeyBundlePublished, openSkdmEnvelopeFromSender } from './groupKeyExchange';
import type { GroupState } from './groupStore';

const GROUP_E2EE_REPAIR_INTERVAL_MS = 5000;

export interface GroupE2eeRuntimeController {
  consumeSkdmControlMessage: (senderDid: string, skdmBytes: Uint8Array) => Promise<boolean>;
  repairEncryptedMessages: () => Promise<void>;
  rotateAfterMembershipChange: (groupUlid: string, affectedActorDid: string) => Promise<boolean>;
  teardown: () => void;
}

export function startGroupE2eeRuntime(
  session: MobileAuthSession,
  getStore: () => GroupState,
): GroupE2eeRuntimeController {
  let cancelled = false;
  let repairing = false;

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
        getStore().setE2eeError(rotationErrorKey(groupUlid), null);
        return true;
      } catch (error) {
        getStore().setE2eeError(rotationErrorKey(groupUlid), errorMessage(error));
        return false;
      }
    },
    teardown: () => {
      cancelled = true;
      window.clearInterval(repairTimer);
    },
  };
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
