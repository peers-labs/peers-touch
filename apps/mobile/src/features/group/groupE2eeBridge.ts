import { create, fromBinary, toBinary } from '@bufbuild/protobuf';
import { invoke } from '@tauri-apps/api/core';

import type { MobileAuthSession } from '../auth/authSession';
import {
  ChatEncryptedMessagePayloadSchema,
  GroupCiphertextSchema,
  SenderKeyDistributionMessageSchema,
  type ChatEncryptedMessagePayload,
  type GroupCiphertext,
  type SenderKeyDistributionMessage,
} from '../../gen/proto/domain/chat/group_chat_pb';

export const GROUP_E2EE_ERROR_KEYS = {
  MISSING_ACTOR: 'mobile.group.e2eeMissingActor',
  MISSING_GROUP: 'mobile.group.e2eeMissingGroup',
} as const;

interface SenderKeyDistributionView {
  groupUlid: string;
  senderDid: string;
  senderKeyId: number;
  chainKey: number[];
  counter: number;
  senderSigPub: number[];
}

interface GroupCiphertextView {
  version: number;
  senderDid: string;
  senderKeyId: number;
  counter: number;
  ciphertext: number[];
  signature: number[];
}

interface EmitSkdmOutput {
  payload: SenderKeyDistributionView;
}

interface RotateOutput {
  senderKeyId: number;
}

interface EncryptOutput {
  wire: GroupCiphertextView;
}

interface DecryptOutput {
  plaintextBytes: number[];
}

export async function emitGroupSkdm(session: MobileAuthSession, groupUlid: string): Promise<Uint8Array> {
  const output = await invoke<EmitSkdmOutput>('crypto_group_sk_emit_skdm', {
    input: scopeInput(session, groupUlid),
  });
  return toBinary(SenderKeyDistributionMessageSchema, senderKeyDistributionFromView(output.payload));
}

export async function consumeGroupSkdm(
  session: MobileAuthSession,
  senderDid: string,
  skdmBytes: Uint8Array,
): Promise<void> {
  const payload = fromBinary(SenderKeyDistributionMessageSchema, skdmBytes);
  await invoke('crypto_group_sk_consume_skdm', {
    input: {
      userScope: userScopeForSession(session),
      senderDid,
      payload: senderKeyDistributionToView(payload),
    },
  });
}

export async function rotateGroupSenderKey(
  session: MobileAuthSession,
  groupUlid: string,
): Promise<{ senderKeyId: number }> {
  const output = await invoke<RotateOutput>('crypto_group_sk_rotate', {
    input: scopeInput(session, groupUlid),
  });
  return { senderKeyId: output.senderKeyId };
}

export async function encryptGroupPlaintext(
  session: MobileAuthSession,
  groupUlid: string,
  plaintext: string,
): Promise<Uint8Array> {
  return encryptGroupPlaintextBytes(session, groupUlid, new TextEncoder().encode(plaintext));
}

export async function encryptGroupMessagePayload(
  session: MobileAuthSession,
  groupUlid: string,
  payload: ChatEncryptedMessagePayload,
): Promise<Uint8Array> {
  return encryptGroupPlaintextBytes(session, groupUlid, toBinary(ChatEncryptedMessagePayloadSchema, payload));
}

async function encryptGroupPlaintextBytes(
  session: MobileAuthSession,
  groupUlid: string,
  plaintextBytes: Uint8Array,
): Promise<Uint8Array> {
  const output = await invoke<EncryptOutput>('crypto_group_encrypt', {
    input: {
      ...scopeInput(session, groupUlid),
      plaintextBytes: numbersFromBytes(plaintextBytes),
    },
  });
  return toBinary(GroupCiphertextSchema, groupCiphertextFromView(output.wire));
}

export async function decryptGroupPayload(
  session: MobileAuthSession,
  groupUlid: string,
  encryptedPayload: Uint8Array,
): Promise<string> {
  return new TextDecoder().decode(await decryptGroupPayloadBytes(session, groupUlid, encryptedPayload));
}

export async function decryptGroupMessagePayload(
  session: MobileAuthSession,
  groupUlid: string,
  encryptedPayload: Uint8Array,
): Promise<ChatEncryptedMessagePayload | null> {
  const plaintextBytes = await decryptGroupPayloadBytes(session, groupUlid, encryptedPayload);
  try {
    return fromBinary(ChatEncryptedMessagePayloadSchema, plaintextBytes);
  } catch {
    return null;
  }
}

export async function decryptGroupPayloadBytes(
  session: MobileAuthSession,
  groupUlid: string,
  encryptedPayload: Uint8Array,
): Promise<Uint8Array> {
  const wire = fromBinary(GroupCiphertextSchema, encryptedPayload);
  const output = await invoke<DecryptOutput>('crypto_group_decrypt', {
    input: {
      userScope: userScopeForSession(session),
      groupUlid: requireGroupUlid(groupUlid),
      wire: groupCiphertextToView(wire),
    },
  });
  return bytesFromNumbers(output.plaintextBytes);
}

export function userScopeForSession(session: MobileAuthSession): string {
  return `${session.stationUrl.replace(/\/+$/, '')}|${session.sessionId}`;
}

function scopeInput(session: MobileAuthSession, groupUlid: string) {
  return {
    userScope: userScopeForSession(session),
    actorDid: actorDidForSession(session),
    groupUlid: requireGroupUlid(groupUlid),
  };
}

function actorDidForSession(session: MobileAuthSession): string {
  const actorDid = String(session.actor?.id || session.actor?.actorId || session.actor?.actor_id || '').trim();
  if (!actorDid) throw new Error(GROUP_E2EE_ERROR_KEYS.MISSING_ACTOR);
  return actorDid;
}

function requireGroupUlid(groupUlid: string): string {
  const value = groupUlid.trim();
  if (!value) throw new Error(GROUP_E2EE_ERROR_KEYS.MISSING_GROUP);
  return value;
}

function senderKeyDistributionFromView(view: SenderKeyDistributionView): SenderKeyDistributionMessage {
  return create(SenderKeyDistributionMessageSchema, {
    groupUlid: view.groupUlid,
    senderDid: view.senderDid,
    senderKeyId: view.senderKeyId,
    chainKey: bytesFromNumbers(view.chainKey),
    counter: view.counter,
    senderSigPub: bytesFromNumbers(view.senderSigPub),
  });
}

function senderKeyDistributionToView(payload: SenderKeyDistributionMessage): SenderKeyDistributionView {
  return {
    groupUlid: payload.groupUlid,
    senderDid: payload.senderDid,
    senderKeyId: payload.senderKeyId,
    chainKey: numbersFromBytes(payload.chainKey),
    counter: payload.counter,
    senderSigPub: numbersFromBytes(payload.senderSigPub),
  };
}

function groupCiphertextFromView(view: GroupCiphertextView): GroupCiphertext {
  return create(GroupCiphertextSchema, {
    version: view.version,
    senderDid: view.senderDid,
    senderKeyId: view.senderKeyId,
    counter: view.counter,
    ciphertext: bytesFromNumbers(view.ciphertext),
    signature: bytesFromNumbers(view.signature),
  });
}

function groupCiphertextToView(wire: GroupCiphertext): GroupCiphertextView {
  return {
    version: wire.version,
    senderDid: wire.senderDid,
    senderKeyId: wire.senderKeyId,
    counter: wire.counter,
    ciphertext: numbersFromBytes(wire.ciphertext),
    signature: numbersFromBytes(wire.signature),
  };
}

function bytesFromNumbers(values: number[]): Uint8Array {
  return new Uint8Array(values.map((value) => value & 0xff));
}

function numbersFromBytes(bytes: Uint8Array): number[] {
  return Array.from(bytes);
}
