@TestOn('vm')
@Timeout(Duration(minutes: 2))
library;

import 'dart:typed_data';

import 'package:cryptography/cryptography.dart' as crypto;
import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/ed25519.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/noise/noise_protocol.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/noise/xx_pattern.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/plaintext/plaintext_security.dart';

void main() {
  group('NoiseXXPattern Tests', () {
    test('XX pattern basic handshake state transitions', () async {
      // Create static keys for both parties
      final initiatorStaticKey = await crypto.X25519().newKeyPair();
      final responderStaticKey = await crypto.X25519().newKeyPair();

      // Create patterns
      final initiator = await NoiseXXPattern.create(true, initiatorStaticKey);
      final responder = await NoiseXXPattern.create(false, responderStaticKey);

      // Message 1: initiator -> responder (e)
      final msg1 = await initiator.writeMessage(Uint8List(0));
      expect(msg1.length, equals(32)); // Just ephemeral key (32 bytes for X25519)

      // Responder reads message 1
      final payload1 = await responder.readMessage(msg1);
      expect(payload1.length, equals(0)); // No payload in msg1

      // Message 2: responder -> initiator (e, ee, s, es)
      // With empty payload for simplicity
      final msg2 = await responder.writeMessage(Uint8List(0));
      // e (32) + encrypted s (32 + 16 MAC) = 80 bytes minimum
      expect(msg2.length, greaterThanOrEqualTo(80));

      // Initiator reads message 2
      final payload2 = await initiator.readMessage(msg2);
      expect(payload2.length, equals(0)); // No payload

      // Verify initiator now has responder's static key
      expect(initiator.remoteStaticKey, isNotNull);
      expect(initiator.remoteStaticKey.length, equals(32));

      // Message 3: initiator -> responder (s, se)
      final msg3 = await initiator.writeMessage(Uint8List(0));
      // encrypted s (32 + 16 MAC) = 48 bytes minimum
      expect(msg3.length, greaterThanOrEqualTo(48));

      // Responder reads message 3
      final payload3 = await responder.readMessage(msg3);
      expect(payload3.length, equals(0));

      // Verify responder now has initiator's static key
      expect(responder.remoteStaticKey, isNotNull);
      expect(responder.remoteStaticKey.length, equals(32));

      // Verify both parties derived transport keys
      expect(initiator.sendKey, isNotNull);
      expect(initiator.recvKey, isNotNull);
      expect(responder.sendKey, isNotNull);
      expect(responder.recvKey, isNotNull);
    });

    test('XX pattern can create and initialize', () async {
      final staticKey = await crypto.X25519().newKeyPair();
      
      final initiator = await NoiseXXPattern.create(true, staticKey);
      expect(initiator, isNotNull);
      
      final responder = await NoiseXXPattern.create(false, staticKey);
      expect(responder, isNotNull);
    });
  });

  group('NoiseSecurity Tests', () {
    test('NoiseSecurity can be created with Ed25519 key', () async {
      final identity = await generateEd25519KeyPair();
      final noise = await NoiseSecurity.create(identity);
      expect(noise, isNotNull);
      expect(noise.protocolId, equals('/noise'));
    });

    test('Noise signature format is correct', () async {
      final identity = await generateEd25519KeyPair();
      
      // The signature prefix per libp2p-noise spec
      const signaturePrefix = 'noise-libp2p-static-key:';
      final staticKey = Uint8List.fromList(List.generate(32, (i) => i));

      // Create message to sign
      final signMessage = Uint8List.fromList([
        ...signaturePrefix.codeUnits,
        ...staticKey,
      ]);

      // Sign and verify
      final signature = await identity.privateKey.sign(signMessage);
      expect(signature.length, equals(64)); // Ed25519 signature is 64 bytes

      final verified = await identity.publicKey.verify(signMessage, signature);
      expect(verified, isTrue);
    });

    test('Noise signature with wrong prefix fails verification', () async {
      final identity = await generateEd25519KeyPair();
      
      const correctPrefix = 'noise-libp2p-static-key:';
      const wrongPrefix = 'wrong-prefix:';
      final staticKey = Uint8List.fromList(List.generate(32, (i) => i));

      // Sign with correct prefix
      final correctMessage = Uint8List.fromList([
        ...correctPrefix.codeUnits,
        ...staticKey,
      ]);
      final signature = await identity.privateKey.sign(correctMessage);

      // Verify with wrong prefix should fail
      final wrongMessage = Uint8List.fromList([
        ...wrongPrefix.codeUnits,
        ...staticKey,
      ]);
      final verified = await identity.publicKey.verify(wrongMessage, signature);
      expect(verified, isFalse);
    });
  });

  group('PlaintextSecurity Tests', () {
    test('PlaintextSecurity can be created', () async {
      final identity = await generateEd25519KeyPair();
      final plaintext = PlaintextSecurity(identity);
      expect(plaintext, isNotNull);
      expect(plaintext.protocolId, equals('/plaintext/2.0.0'));
    });

    test('Plaintext protocol ID is correct', () {
      expect(PlaintextSecurity.protocolIdValue, equals('/plaintext/2.0.0'));
    });
  });

  group('Protocol ID Tests', () {
    test('Noise protocol ID is correct', () async {
      final identity = await generateEd25519KeyPair();
      final noise = await NoiseSecurity.create(identity);
      expect(noise.protocolId, equals('/noise'));
    });

    test('Plaintext protocol ID is correct', () async {
      final identity = await generateEd25519KeyPair();
      final plaintext = PlaintextSecurity(identity);
      expect(plaintext.protocolId, equals('/plaintext/2.0.0'));
    });
  });

  group('Key Derivation Tests', () {
    test('Both parties derive symmetric keys after handshake', () async {
      final initiatorStaticKey = await crypto.X25519().newKeyPair();
      final responderStaticKey = await crypto.X25519().newKeyPair();

      final initiator = await NoiseXXPattern.create(true, initiatorStaticKey);
      final responder = await NoiseXXPattern.create(false, responderStaticKey);

      // Complete handshake
      final msg1 = await initiator.writeMessage(Uint8List(0));
      await responder.readMessage(msg1);

      final msg2 = await responder.writeMessage(Uint8List(0));
      await initiator.readMessage(msg2);

      final msg3 = await initiator.writeMessage(Uint8List(0));
      await responder.readMessage(msg3);

      // Verify keys are derived
      expect(initiator.sendKey, isNotNull);
      expect(initiator.recvKey, isNotNull);
      expect(responder.sendKey, isNotNull);
      expect(responder.recvKey, isNotNull);

      // Verify initiator's send key matches responder's recv key
      final initiatorSendBytes = await initiator.sendKey!.extractBytes();
      final responderRecvBytes = await responder.recvKey!.extractBytes();
      expect(initiatorSendBytes, equals(responderRecvBytes));

      // Verify initiator's recv key matches responder's send key
      final initiatorRecvBytes = await initiator.recvKey!.extractBytes();
      final responderSendBytes = await responder.sendKey!.extractBytes();
      expect(initiatorRecvBytes, equals(responderSendBytes));
    });
  });
}
