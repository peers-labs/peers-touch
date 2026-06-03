import type { MobileAuthSession } from '../auth/authSession';
import type { GroupMessage } from '../../gen/proto/domain/chat/group_chat_pb';
import { decryptGroupPayload } from './groupE2eeBridge';
import type { GroupState } from './groupStore';

const GROUP_E2EE_REPAIR_INTERVAL_MS = 5000;

export interface GroupE2eeRuntimeController {
  repairEncryptedMessages: () => Promise<void>;
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

  void repairEncryptedMessages();
  const repairTimer = window.setInterval(() => {
    void repairEncryptedMessages();
  }, GROUP_E2EE_REPAIR_INTERVAL_MS);

  return {
    repairEncryptedMessages,
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

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
