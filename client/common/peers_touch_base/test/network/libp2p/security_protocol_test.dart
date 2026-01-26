@TestOn('vm')
@Timeout(Duration(minutes: 2))
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:cryptography/cryptography.dart' as crypto;
import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/ed25519.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/keys.dart';
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/conn.dart';
import 'package:peers_touch_base/network/libp2p/core/network/context.dart';
import 'package:peers_touch_base/network/libp2p/core/network/rcmgr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/stream.dart';
import 'package:peers_touch_base/network/libp2p/core/network/transport_conn.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/peer_id.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/noise/noise_protocol.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/noise/xx_pattern.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/plaintext/plaintext_security.dart';

/// A mock transport connection that uses in-memory streams for testing
class MockTransportConn implements TransportConn {
  MockTransportConn(this._sendController, this._receiveStream, this._peerId);

  final StreamController<Uint8List> _sendController;
  final Stream<Uint8List> _receiveStream;
  final PeerId _peerId;
  bool _isClosed = false;
  final List<int> _readBuffer = [];

  @override
  Future<void> close() async {
    _isClosed = true;
    await _sendController.close();
  }

  @override
  Future<Uint8List> read([int? length]) async {
    // If we have buffered data, return from buffer first
    if (_readBuffer.isNotEmpty) {
      if (length == null || length >= _readBuffer.length) {
        final result = Uint8List.fromList(_readBuffer);
        _readBuffer.clear();
        return result;
      } else {
        final result = Uint8List.fromList(_readBuffer.sublist(0, length));
        _readBuffer.removeRange(0, length);
        return result;
      }
    }

    // Wait for data from stream
    await for (final data in _receiveStream) {
      if (length == null || length >= data.length) {
        return data;
      } else {
        _readBuffer.addAll(data.sublist(length));
        return data.sublist(0, length);
      }
    }
    return Uint8List(0);
  }

  @override
  Future<void> write(Uint8List data) async {
    if (_isClosed) throw StateError('Connection is closed');
    _sendController.add(data);
  }

  @override
  bool get isClosed => _isClosed;

  @override
  MultiAddr get localMultiaddr => MultiAddr('/ip4/127.0.0.1/tcp/0');

  @override
  MultiAddr get remoteMultiaddr => MultiAddr('/ip4/127.0.0.1/tcp/1');

  @override
  MultiAddr get localAddr => localMultiaddr;

  @override
  MultiAddr get remoteAddr => remoteMultiaddr;

  @override
  Socket? get socket => null;

  @override
  void setReadTimeout(Duration timeout) {}

  @override
  void setWriteTimeout(Duration timeout) {}

  @override
  String get id => 'mock-conn-${_peerId.toString().substring(0, 8)}';

  @override
  Future<P2PStream> newStream(Context context) =>
      throw UnimplementedError('Not needed for security tests');

  @override
  Future<List<P2PStream>> get streams => Future.value([]);

  @override
  PeerId get localPeer => _peerId;

  @override
  PeerId get remotePeer => _peerId;

  @override
  Future<PublicKey?> get remotePublicKey async => null;

  @override
  ConnState get state => ConnState(
        streamMultiplexer: 'none',
        security: 'none',
        transport: 'mock',
        usedEarlyMuxerNegotiation: false,
      );

  @override
  ConnStats get stat => _MockConnStats();

  @override
  ConnScope get scope => MockConnScope();

  @override
  void notifyActivity() {}
}

class _MockConnStats implements ConnStats {
  @override
  DateTime get opened => DateTime.now();
  
  @override
  ConnDirection get direction => ConnDirection.outbound;
  
  @override
  Map<String, dynamic> get extra => {};
  
  @override
  DateTime? get closed => null;
  
  @override
  int get numStreams => 0;
  
  @override
  Duration? get latency => null;
  
  @override
  void setClosed() {}
  
  @override
  void updateLatency(Duration d) {}
}

class MockConnScope implements ConnScope {
  @override
  void done() {}

  @override
  Future<void> reserveMemory(int size, int priority) async {}

  @override
  void releaseMemory(int size) {}

  @override
  PeerScope get peer => MockPeerScope();

  @override
  Future<ResourceScopeSpan> beginSpan() async => MockResourceScopeSpan();
  
  @override
  ScopeStat get stat => MockScopeStat();
}

class MockPeerScope implements PeerScope {
  @override
  PeerId get peer => PeerId.fromBytes(Uint8List(32));

  @override
  void done() {}

  @override
  Future<void> reserveMemory(int size, int priority) async {}

  @override
  void releaseMemory(int size) {}

  @override
  Future<ResourceScopeSpan> beginSpan() async => MockResourceScopeSpan();
  
  @override
  ScopeStat get stat => MockScopeStat();
}

class MockResourceScopeSpan implements ResourceScopeSpan {
  @override
  void done() {}

  @override
  Future<void> reserveMemory(int size, int priority) async {}

  @override
  void releaseMemory(int size) {}

  @override
  Future<ResourceScopeSpan> beginSpan() async => MockResourceScopeSpan();
  
  @override
  ScopeStat get stat => MockScopeStat();
}

class MockScopeStat implements ScopeStat {
  @override
  int get numConnsInbound => 0;
  
  @override
  int get numConnsOutbound => 0;
  
  @override
  int get numFD => 0;
  
  @override
  int get numStreamsInbound => 0;
  
  @override
  int get numStreamsOutbound => 0;
  
  @override
  int get memory => 0;
}

/// Creates a pair of connected mock transport connections
(MockTransportConn, MockTransportConn) createConnectedPair(
    PeerId peer1, PeerId peer2) {
  final controller1to2 = StreamController<Uint8List>.broadcast();
  final controller2to1 = StreamController<Uint8List>.broadcast();

  final conn1 = MockTransportConn(controller1to2, controller2to1.stream, peer1);
  final conn2 = MockTransportConn(controller2to1, controller1to2.stream, peer2);

  return (conn1, conn2);
}

void main() {
  group('NoiseXXPattern Tests', () {
    test('XX pattern handshake between initiator and responder', () async {
      // Create static keys for both parties
      final initiatorStaticKey = await crypto.X25519().newKeyPair();
      final responderStaticKey = await crypto.X25519().newKeyPair();

      // Create patterns
      final initiator = await NoiseXXPattern.create(true, initiatorStaticKey);
      final responder = await NoiseXXPattern.create(false, responderStaticKey);

      // Message 1: initiator -> responder (e)
      final msg1 = await initiator.writeMessage(Uint8List(0));
      expect(msg1.length, equals(32)); // Just ephemeral key

      final payload1 = await responder.readMessage(msg1);
      expect(payload1.length, equals(0)); // No payload in msg1

      // Message 2: responder -> initiator (e, ee, s, es + payload)
      final responderPayload = Uint8List.fromList([1, 2, 3, 4, 5]);
      final msg2 = await responder.writeMessage(responderPayload);
      expect(msg2.length, greaterThan(32 + 32 + 16)); // e + encrypted s + MAC + payload

      final payload2 = await initiator.readMessage(msg2);
      expect(payload2, equals(responderPayload));

      // Verify initiator has responder's static key
      expect(initiator.remoteStaticKey, isNotNull);
      expect(initiator.remoteStaticKey.length, equals(32));

      // Message 3: initiator -> responder (s, se + payload)
      final initiatorPayload = Uint8List.fromList([6, 7, 8, 9, 10]);
      final msg3 = await initiator.writeMessage(initiatorPayload);
      expect(msg3.length, greaterThan(32 + 16)); // encrypted s + MAC + payload

      final payload3 = await responder.readMessage(msg3);
      expect(payload3, equals(initiatorPayload));

      // Verify responder has initiator's static key
      expect(responder.remoteStaticKey, isNotNull);
      expect(responder.remoteStaticKey.length, equals(32));

      // Verify both parties derived transport keys
      expect(initiator.sendKey, isNotNull);
      expect(initiator.recvKey, isNotNull);
      expect(responder.sendKey, isNotNull);
      expect(responder.recvKey, isNotNull);
    });

    test('XX pattern with empty payloads', () async {
      final initiatorStaticKey = await crypto.X25519().newKeyPair();
      final responderStaticKey = await crypto.X25519().newKeyPair();

      final initiator = await NoiseXXPattern.create(true, initiatorStaticKey);
      final responder = await NoiseXXPattern.create(false, responderStaticKey);

      // Complete handshake with empty payloads
      final msg1 = await initiator.writeMessage(Uint8List(0));
      await responder.readMessage(msg1);

      final msg2 = await responder.writeMessage(Uint8List(0));
      await initiator.readMessage(msg2);

      final msg3 = await initiator.writeMessage(Uint8List(0));
      await responder.readMessage(msg3);

      // Verify handshake completed
      expect(initiator.sendKey, isNotNull);
      expect(responder.sendKey, isNotNull);
    });
  });

  group('NoiseSecurity Tests', () {
    test('Noise handshake between two peers', () async {
      // Generate identity keys
      final initiatorIdentity = await generateEd25519KeyPair();
      final responderIdentity = await generateEd25519KeyPair();

      final initiatorPeerId = PeerId.fromPublicKey(initiatorIdentity.publicKey);
      final responderPeerId = PeerId.fromPublicKey(responderIdentity.publicKey);

      // Create security protocols
      final initiatorSecurity = await NoiseSecurity.create(initiatorIdentity);
      final responderSecurity = await NoiseSecurity.create(responderIdentity);

      // Create connected transport pair
      final (conn1, conn2) = createConnectedPair(initiatorPeerId, responderPeerId);

      // Run handshake in parallel
      final results = await Future.wait([
        initiatorSecurity.secureOutbound(conn1),
        responderSecurity.secureInbound(conn2),
      ]);

      final securedConn1 = results[0];
      final securedConn2 = results[1];

      // Verify peer IDs match
      expect(securedConn1.remotePeer.toString(), equals(responderPeerId.toString()));
      expect(securedConn2.remotePeer.toString(), equals(initiatorPeerId.toString()));

      // Cleanup
      await securedConn1.close();
      await securedConn2.close();
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
  });

  group('PlaintextSecurity Tests', () {
    test('Plaintext handshake between two peers', () async {
      // Generate identity keys
      final initiatorIdentity = await generateEd25519KeyPair();
      final responderIdentity = await generateEd25519KeyPair();

      final initiatorPeerId = PeerId.fromPublicKey(initiatorIdentity.publicKey);
      final responderPeerId = PeerId.fromPublicKey(responderIdentity.publicKey);

      // Create security protocols
      final initiatorSecurity = PlaintextSecurity(initiatorIdentity);
      final responderSecurity = PlaintextSecurity(responderIdentity);

      // Create connected transport pair
      final (conn1, conn2) = createConnectedPair(initiatorPeerId, responderPeerId);

      // Run handshake in parallel
      final results = await Future.wait([
        initiatorSecurity.secureOutbound(conn1),
        responderSecurity.secureInbound(conn2),
      ]);

      final securedConn1 = results[0];
      final securedConn2 = results[1];

      // Verify peer IDs match
      expect(securedConn1.remotePeer.toString(), equals(responderPeerId.toString()));
      expect(securedConn2.remotePeer.toString(), equals(initiatorPeerId.toString()));

      // Verify public keys are available
      final remoteKey1 = await securedConn1.remotePublicKey;
      final remoteKey2 = await securedConn2.remotePublicKey;
      expect(remoteKey1, isNotNull);
      expect(remoteKey2, isNotNull);

      // Cleanup
      await securedConn1.close();
      await securedConn2.close();
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
}
