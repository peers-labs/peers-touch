import 'dart:typed_data';

import 'package:logging/logging.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/keys.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/pb/crypto.pb.dart'
    as crypto_pb;
import 'package:peers_touch_base/network/libp2p/core/crypto/pb/crypto.pbenum.dart';
import 'package:peers_touch_base/network/libp2p/core/network/transport_conn.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/peer_id.dart';
import 'package:peers_touch_base/network/libp2p/core/sec/insecure/pb/plaintext.pb.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/plaintext/plaintext_connection.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/security_protocol.dart';

final _log = Logger('PlaintextSecurity');

/// Exception for plaintext protocol errors
class PlaintextException implements Exception {
  PlaintextException(this.message, [this.cause]);
  final String message;
  final Object? cause;

  @override
  String toString() =>
      'PlaintextException: $message${cause != null ? ' ($cause)' : ''}';
}

/// Plaintext security protocol implementation.
///
/// This protocol provides NO encryption or authentication.
/// It is intended for testing and development purposes only.
///
/// Protocol ID: /plaintext/2.0.0
///
/// The protocol exchanges identity information using the Exchange message:
/// - Initiator sends Exchange first, then reads remote Exchange
/// - Responder reads Exchange first, then sends Exchange
class PlaintextSecurity implements SecurityProtocol {
  PlaintextSecurity(this._identityKey);

  static const String protocolIdValue = '/plaintext/2.0.0';

  final KeyPair _identityKey;

  @override
  String get protocolId => protocolIdValue;

  @override
  Future<TransportConn> secureOutbound(TransportConn connection) async {
    _log.fine('PlaintextSecurity: Starting outbound handshake');

    try {
      // Build and send our Exchange message
      final localExchange = _buildExchange();
      await _writeExchange(connection, localExchange);
      _log.fine('PlaintextSecurity: Sent local Exchange');

      // Read remote Exchange message
      final remoteExchange = await _readExchange(connection);
      _log.fine('PlaintextSecurity: Received remote Exchange');

      // Extract and verify remote identity
      final (remotePeer, remotePubKey) = await _processRemoteExchange(remoteExchange);
      _log.fine('PlaintextSecurity: Remote peer ID: $remotePeer');

      return PlaintextConnection(connection, remotePeer, remotePubKey);
    } catch (e) {
      _log.severe('PlaintextSecurity: Outbound handshake failed: $e');
      await connection.close();
      if (e is PlaintextException) rethrow;
      throw PlaintextException('Outbound handshake failed', e);
    }
  }

  @override
  Future<TransportConn> secureInbound(TransportConn connection) async {
    _log.fine('PlaintextSecurity: Starting inbound handshake');

    try {
      // Read remote Exchange message first (opposite of outbound)
      final remoteExchange = await _readExchange(connection);
      _log.fine('PlaintextSecurity: Received remote Exchange');

      // Build and send our Exchange message
      final localExchange = _buildExchange();
      await _writeExchange(connection, localExchange);
      _log.fine('PlaintextSecurity: Sent local Exchange');

      // Extract and verify remote identity
      final (remotePeer, remotePubKey) = await _processRemoteExchange(remoteExchange);
      _log.fine('PlaintextSecurity: Remote peer ID: $remotePeer');

      return PlaintextConnection(connection, remotePeer, remotePubKey);
    } catch (e) {
      _log.severe('PlaintextSecurity: Inbound handshake failed: $e');
      await connection.close();
      if (e is PlaintextException) rethrow;
      throw PlaintextException('Inbound handshake failed', e);
    }
  }

  /// Builds an Exchange message with our identity
  Exchange _buildExchange() {
    final localPeerId = PeerId.fromPublicKey(_identityKey.publicKey);

    // Create protobuf PublicKey
    final pubKeyProto = crypto_pb.PublicKey();
    pubKeyProto.type = _keyTypeToProto(_identityKey.publicKey.type);
    pubKeyProto.data = _identityKey.publicKey.raw;

    final exchange = Exchange();
    exchange.id = localPeerId.toBytes();
    exchange.pubkey = pubKeyProto;

    return exchange;
  }

  /// Writes an Exchange message with varint length prefix
  Future<void> _writeExchange(TransportConn conn, Exchange exchange) async {
    final data = exchange.writeToBuffer();
    final length = data.length;

    if (length > 65535) {
      throw PlaintextException('Exchange message too large: $length bytes');
    }

    // Write with varint length prefix (like Go's go-libp2p)
    final varintBytes = _encodeVarint(length);
    final frame = Uint8List(varintBytes.length + length);
    frame.setAll(0, varintBytes);
    frame.setAll(varintBytes.length, data);

    await conn.write(frame);
  }

  /// Reads an Exchange message with varint length prefix
  Future<Exchange> _readExchange(TransportConn conn) async {
    // Read varint length
    final length = await _readVarint(conn);

    if (length <= 0 || length > 65535) {
      throw PlaintextException('Invalid Exchange message length: $length');
    }

    // Read the Exchange message
    final data = await _readExactly(conn, length);
    return Exchange.fromBuffer(data);
  }

  /// Encodes a varint
  List<int> _encodeVarint(int value) {
    final bytes = <int>[];
    while (value >= 0x80) {
      bytes.add((value & 0x7F) | 0x80);
      value >>= 7;
    }
    bytes.add(value);
    return bytes;
  }

  /// Reads a varint from connection
  Future<int> _readVarint(TransportConn conn) async {
    int value = 0;
    int shift = 0;

    while (true) {
      final byte = await _readExactly(conn, 1);
      value |= (byte[0] & 0x7F) << shift;
      if ((byte[0] & 0x80) == 0) {
        break;
      }
      shift += 7;
      if (shift > 63) {
        throw PlaintextException('Varint too long');
      }
    }

    return value;
  }

  /// Reads exactly the specified number of bytes
  Future<Uint8List> _readExactly(TransportConn conn, int length) async {
    final buffer = <int>[];
    while (buffer.length < length) {
      final remaining = length - buffer.length;
      final chunk = await conn.read(remaining);
      if (chunk.isEmpty) {
        throw PlaintextException(
            'Connection closed while reading (got ${buffer.length}/$length bytes)');
      }
      buffer.addAll(chunk);
    }
    return Uint8List.fromList(buffer);
  }

  /// Processes the remote Exchange and extracts identity
  Future<(PeerId, PublicKey?)> _processRemoteExchange(Exchange exchange) async {
    if (!exchange.hasId()) {
      throw PlaintextException('Remote Exchange missing peer ID');
    }

    final remotePeerId = PeerId.fromBytes(Uint8List.fromList(exchange.id));

    PublicKey? remotePubKey;
    if (exchange.hasPubkey()) {
      remotePubKey = _unmarshalPublicKey(exchange.pubkey);

      // Verify that the public key matches the peer ID
      final derivedPeerId = PeerId.fromPublicKey(remotePubKey);
      if (derivedPeerId.toString() != remotePeerId.toString()) {
        throw PlaintextException(
            'Peer ID mismatch: Exchange ID=$remotePeerId, derived from pubkey=$derivedPeerId');
      }
    }

    return (remotePeerId, remotePubKey);
  }

  /// Converts our KeyType to protobuf KeyType
  KeyType _keyTypeToProto(crypto_pb.KeyType type) {
    return type;
  }

  /// Unmarshals a protobuf PublicKey to our PublicKey type
  PublicKey _unmarshalPublicKey(crypto_pb.PublicKey proto) {
    // Use the existing key unmarshalling infrastructure
    return publicKeyFromProto(proto);
  }
}
