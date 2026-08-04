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
const featureFlagsSource = readFileSync(
  new URL('../modules/settings/featureFlags.ts', import.meta.url),
  'utf8',
);
const desktopApiSource = readFileSync(
  new URL('../services/desktop_api.ts', import.meta.url),
  'utf8',
);
const chatMessageAreaSource = readFileSync(
  new URL('../components/chat/ChatMessageArea.tsx', import.meta.url),
  'utf8',
);
const chatErrorMappingSource = readFileSync(
  new URL('../services/errorMappings/chatErrorMapping.ts', import.meta.url),
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

  it('does not render schema-invalid decrypted bytes as raw message content', () => {
    expect(socialChatSource).not.toContain('new TextDecoder().decode(plaintext)');
    expect(socialChatSource).not.toContain('content: plaintextB64');
  });

  it('advertises and accepts only Double Ratchet version 1', () => {
    expect(socialChatSource).toContain('supported_versions: [1]');
    expect(socialChatSource).not.toContain('cryptoDrEnabled');
    expect(imRuntimeSource).not.toContain('cryptoDrEnabled');
    expect(featureFlagsSource).not.toContain('cryptoDrEnabled');
    expect(rustCryptoSource).toContain('if negotiated_version != 1');
    expect(rustKeyExchangeSource).toContain('supported_versions: vec![1]');
    expect(rustGatewaySource).toContain('supported_versions: vec![1]');
  });

  it('routes federated X3DH bootstrap by PTID and peer Home Station', () => {
    expect(socialChatSource).toContain("const actorPtid = get().currentUserDid || ''");
    expect(socialChatSource).toContain('member.ptid !== actorPtid');
    expect(socialChatSource).toContain('peerMember?.actorHomeStationPeerId');
    expect(socialChatSource).toContain(
      'get().establishSession(sessionUlid, receiverDid, true)',
    );
    expect(socialChatSource).not.toContain(
      'const actorId = currentAuthenticatedActorId() ||',
    );
  });

  it('keeps failed direct sends as retryable message bubbles', () => {
    expect(socialChatSource).toContain('FriendMessageStatus.SENDING');
    expect(socialChatSource).toContain('FriendMessageStatus.FAILED');
    expect(socialChatSource).toContain('retryFriendMessage: async');
    expect(chatMessageAreaSource).toContain('retryFriendMessage(');
    expect(chatErrorMappingSource).toContain(
      'error.chat.secureChannelUnavailable',
    );
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
