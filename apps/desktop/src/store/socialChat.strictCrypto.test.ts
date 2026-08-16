import { readFileSync } from 'node:fs';

import { create, toBinary } from '@bufbuild/protobuf';
import { describe, expect, it } from 'vitest';

import { EncryptedMessageSchema } from '../gen/proto/domain/chat/friend_chat_pb';
import {
  createEncryptedChatPayloadBytes,
  decodeEncryptedChatPayloadBytes,
  decodeFriendEncryptedEnvelope,
} from './socialChat';

const socialChatSource = readFileSync(new URL('./socialChat.ts', import.meta.url), 'utf8');
const imRuntimeSource = readFileSync(new URL('../runtimes/imRuntime.ts', import.meta.url), 'utf8');
const imServiceSource = readFileSync(new URL('../services/im-service.ts', import.meta.url), 'utf8');
const appRuntimeSource = readFileSync(new URL('../services/appRuntime.ts', import.meta.url), 'utf8');
const featureFlagsSource = readFileSync(
  new URL('../modules/settings/featureFlags.ts', import.meta.url),
  'utf8',
);
const desktopApiSource = readFileSync(
  new URL('../services/desktop_api.ts', import.meta.url),
  'utf8',
);
const rustCryptoSource = readFileSync(
  new URL('../../src-tauri/src/interface/tauri_commands/crypto.rs', import.meta.url),
  'utf8',
);
const rustKeyExchangeSource = readFileSync(
  new URL('../../src-tauri/src/interface/tauri_commands/key_exchange.rs', import.meta.url),
  'utf8',
);
const rustGatewaySource = readFileSync(
  new URL('../../src-tauri/src/interface/http_gateway/mod.rs', import.meta.url),
  'utf8',
);
const rustMainSource = readFileSync(
  new URL('../../src-tauri/src/main.rs', import.meta.url),
  'utf8',
);
const rustFriendChatSource = readFileSync(
  new URL('../../src-tauri/src/interface/tauri_commands/friend_chat.rs', import.meta.url),
  'utf8',
);
const rustPresenceSource = readFileSync(
  new URL('../../src-tauri/src/application/presence/mod.rs', import.meta.url),
  'utf8',
);
const localChatStoreSource = readFileSync(
  new URL('../../src-tauri/src/infrastructure/local_chat_store.rs', import.meta.url),
  'utf8',
);
const desktopClientStorageSource = readFileSync(
  new URL('../storage/desktopClientStorage.ts', import.meta.url),
  'utf8',
);
const identityHandlersSource = readFileSync(
  new URL('../services/identityHandlers.ts', import.meta.url),
  'utf8',
);

describe('strict chat encryption source contract', () => {
  it('does not probe encrypted transport bytes as plaintext payloads', () => {
    expect(socialChatSource).not.toContain(
      'const directPayload = decodeEncryptedChatPayloadBytes',
    );
  });

  it('does not retain Double Ratchet v0 send or decrypt paths', () => {
    expect(socialChatSource).not.toContain('api.cryptoEncryptMessage');
    expect(socialChatSource).not.toContain('api.cryptoDecryptMessage');
    expect(socialChatSource).not.toContain('return { version: 0');
    expect(socialChatSource).not.toContain('version: 0,');
  });

  it('keeps the frontend crypto and inbox runtimes out of the composition root', () => {
    expect(appRuntimeSource).not.toContain('registerRuntime(cryptoRuntime)');
    expect(appRuntimeSource).not.toContain('registerRuntime(imRuntime)');
    expect(appRuntimeSource).not.toContain('teardownRuntime(cryptoRuntime.id)');
    expect(appRuntimeSource).not.toContain('teardownRuntime(imRuntime.id)');
    expect(imServiceSource).toContain('recipient_device_id: recipientDeviceId');
    expect(socialChatSource).not.toContain('establishSession:');
    expect(socialChatSource).not.toContain('api.drEncrypt');
    expect(socialChatSource).not.toContain('api.drDecrypt');
    expect(socialChatSource).not.toContain('api.cryptoInitSession');
  });

  it('does not let dormant frontend runtimes enroll another active device', () => {
    expect(appRuntimeSource).not.toContain("from '../runtimes/cryptoRuntime'");
    expect(appRuntimeSource).not.toContain("from '../runtimes/imRuntime'");
  });

  it('reads Direct plaintext and attachments only from Engine projections', () => {
    expect(socialChatSource).toContain('messaging.listMessages');
    expect(socialChatSource).toContain('projection.attachments.map');
    expect(socialChatSource).not.toContain('payload.recipientDeviceId === localAddress.deviceId');
    expect(socialChatSource).not.toContain('decryptDirectPayload');
  });

  it('does not render schema-invalid decrypted bytes as raw message content', () => {
    expect(socialChatSource).not.toContain('new TextDecoder().decode(plaintext)');
    expect(socialChatSource).not.toContain('content: plaintextB64');
  });

  it('advertises and accepts only Double Ratchet version 1', () => {
    const cryptoServiceSource = readFileSync(new URL('../services/crypto-service.ts', import.meta.url), 'utf8');
    expect(cryptoServiceSource).toContain('supported_versions');
    expect(socialChatSource).not.toContain('cryptoDrEnabled');
    expect(imRuntimeSource).not.toContain('cryptoDrEnabled');
    expect(featureFlagsSource).not.toContain('cryptoDrEnabled');
    expect(rustCryptoSource).toContain('if negotiated_version != 1');
    expect(rustKeyExchangeSource).toContain('supported_versions: vec![1]');
    expect(rustGatewaySource).toContain('supported_versions: vec![1]');
  });

  it('does not expose legacy crypto commands or delete history during startup', () => {
    for (const source of [rustCryptoSource, rustMainSource]) {
      expect(source).not.toContain('crypto_encrypt_message');
      expect(source).not.toContain('crypto_decrypt_message');
    }
    expect(rustMainSource).not.toContain('conversation_send_encrypted');
    expect(rustMainSource).not.toContain('conversation_decrypt_message');
    expect(localChatStoreSource).not.toContain('wipe_legacy_group_plaintext');
    expect(localChatStoreSource).not.toContain('legacy_group_plaintext_wipe');
  });

  it('exposes one Messaging send and actor-read path with no friend-chat fallback', () => {
    for (const source of [
      desktopApiSource,
      rustFriendChatSource,
      rustGatewaySource,
      rustMainSource,
      rustPresenceSource,
    ]) {
      expect(source).not.toContain('friend_chat_send_message');
      expect(source).not.toContain('friend_chat_ack_messages');
      expect(source).not.toContain('/friend-chat/message/send');
      expect(source).not.toContain('/friend-chat/message/ack');
    }
    expect(socialChatSource).toContain('messaging.sendMessage');
    expect(socialChatSource).toContain('messagingReadCursor');
    expect(socialChatSource).not.toContain('conversation.submitReceipt');
  });

  it('retires every Desktop Sender Keys command surface', () => {
    expect(desktopApiSource).not.toContain('cryptoGroupSkEmitSkdm');
    expect(desktopApiSource).not.toContain('cryptoGroupSkConsumeSkdm');
    expect(desktopApiSource).not.toContain('cryptoGroupSkRotate');
    expect(desktopApiSource).not.toContain('cryptoGroupEncrypt');
    expect(desktopApiSource).not.toContain('cryptoGroupDecrypt');
    expect(rustMainSource).not.toContain('crypto::crypto_group_');
    expect(rustGatewaySource).not.toContain('crypto_group_sk_');
    expect(rustGatewaySource).not.toContain('"crypto_group_encrypt"');
    expect(rustGatewaySource).not.toContain('"crypto_group_decrypt"');
    expect(desktopClientStorageSource).not.toContain('crypto.sender-key-ledger');
    expect(identityHandlersSource).not.toContain('crypto.sender-key-ledger');
  });

  it('delegates send and every durable message mutation to the Engine', () => {
    const section = (start: string, end: string) => {
      const offset = socialChatSource.indexOf(start);
      return socialChatSource.slice(offset, socialChatSource.indexOf(end, offset));
    };
    const sendPath = section('sendGroupMessage: async', 'loadGroupMembers: async');
    const recallPath = section('recallGroupMessage: async', 'editGroupMessage: async');
    const editPath = section('editGroupMessage: async', 'applyMessageMutation:');
    expect(sendPath).toContain("messaging.sendMessage(groupUlid, 'group', content, attachments, {");
    expect(sendPath).not.toContain('mlsGroup.encrypt');
    expect(sendPath).not.toContain('conversation.submitCommand');
    expect(sendPath).not.toContain('getLocalCryptoAddress()');
    expect(recallPath).toContain("messagingMetadataInteraction(groupUlid, messageUlid, 'retract')");
    expect(recallPath).not.toContain('conversation.submitCommand');
    expect(editPath).toContain(
      'messagingEditMessage(groupUlid, messageUlid, newContent.trim())',
    );
    expect(editPath).not.toContain('mlsGroup.encrypt');
    expect(editPath).not.toContain('conversation.submitCommand');
    expect(editPath).not.toContain('getLocalCryptoAddress()');
    expect(editPath).not.toContain('applyMessageMutation(');
    expect(imServiceSource).not.toContain("'mls_group_status'");
  });
});

describe('strict chat encryption decoder', () => {
  function directEnvelope(version: number): Uint8Array {
    return toBinary(EncryptedMessageSchema, create(EncryptedMessageSchema, {
      version,
      ciphertext: new Uint8Array([1, 2, 3]),
      ratchetPub: new Uint8Array(32).fill(4),
      nonce: new Uint8Array(12).fill(5),
    }));
  }

  it('accepts a structurally valid Double Ratchet v1 envelope', () => {
    expect(decodeFriendEncryptedEnvelope(directEnvelope(1))).toMatchObject({
      version: 1,
      ciphertext: 'AQID',
    });
  });

  it('rejects plaintext payloads, v0, unknown versions, and malformed envelopes', () => {
    expect(decodeFriendEncryptedEnvelope(createEncryptedChatPayloadBytes('legacy plaintext')))
      .toBeNull();
    expect(decodeFriendEncryptedEnvelope(directEnvelope(0))).toBeNull();
    expect(decodeFriendEncryptedEnvelope(directEnvelope(2))).toBeNull();
    expect(decodeFriendEncryptedEnvelope(new Uint8Array([0xff, 0x00]))).toBeNull();
  });

  it('rejects decrypted bytes that do not match the encrypted chat payload schema', () => {
    expect(decodeEncryptedChatPayloadBytes(new TextEncoder().encode('raw plaintext')))
      .toBeNull();
  });
});
