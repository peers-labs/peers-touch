/// Integration test for Dart-Go libp2p interoperability
///
/// This test connects to a Go libp2p server running at localhost:5001
/// with NoSecurity (plaintext) mode.
///
/// To run this test:
/// 1. Start the Go server:
///    cd station/frame/example/libp2p-dart-2-go
///    go run main.go
///
/// 2. Run this test:
///    flutter test test/network/libp2p/dart_to_go_integration_test.dart
///
/// The Go server uses:
/// - NoSecurity (libp2p.NoSecurity) -> /plaintext/2.0.0
/// - Yamux muxer -> /yamux/1.0.0
/// - Protocol: /my-protocol/1.0.0
@TestOn('vm')
@Timeout(Duration(minutes: 1))
library;

import 'dart:async';
import 'dart:io';
import 'dart:typed_data';

import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/ed25519.dart';
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/transport_conn.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/peer_id.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/plaintext/plaintext_security.dart';

/// A simple TCP transport connection for testing
class TcpTransportConn implements TransportConn {
  TcpTransportConn(this._socket, this._localAddr, this._remoteAddr) {
    // Listen to socket and buffer data
    _subscription = _socket.listen(
      (data) {
        _buffer.addAll(data);
        if (!_dataCompleter.isCompleted) {
          _dataCompleter.complete();
        }
      },
      onError: (e) {
        _error = e;
        if (!_dataCompleter.isCompleted) {
          _dataCompleter.completeError(e);
        }
      },
      onDone: () {
        _closed = true;
        if (!_dataCompleter.isCompleted) {
          _dataCompleter.complete();
        }
      },
    );
  }

  final Socket _socket;
  final MultiAddr _localAddr;
  final MultiAddr _remoteAddr;
  bool _isClosed = false;
  bool _closed = false;
  Object? _error;
  final List<int> _buffer = [];
  StreamSubscription<List<int>>? _subscription;
  Completer<void> _dataCompleter = Completer<void>()..complete();

  static Future<TcpTransportConn> connect(String host, int port) async {
    final socket = await Socket.connect(host, port);
    final localAddr = MultiAddr('/ip4/${socket.address.address}/tcp/${socket.port}');
    final remoteAddr = MultiAddr('/ip4/$host/tcp/$port');
    return TcpTransportConn(socket, localAddr, remoteAddr);
  }

  @override
  Future<void> close() async {
    _isClosed = true;
    await _subscription?.cancel();
    await _socket.close();
  }

  @override
  Future<Uint8List> read([int? length]) async {
    // Wait for data if buffer is empty
    while (_buffer.isEmpty && !_closed && _error == null) {
      _dataCompleter = Completer<void>();
      await _dataCompleter.future;
    }

    if (_error != null) {
      throw _error!;
    }

    if (_buffer.isEmpty) {
      return Uint8List(0);
    }

    if (length == null || length >= _buffer.length) {
      final result = Uint8List.fromList(_buffer);
      _buffer.clear();
      return result;
    } else {
      final result = Uint8List.fromList(_buffer.sublist(0, length));
      _buffer.removeRange(0, length);
      return result;
    }
  }

  @override
  Future<void> write(Uint8List data) async {
    if (_isClosed) throw StateError('Connection is closed');
    _socket.add(data);
    await _socket.flush();
  }

  @override
  bool get isClosed => _isClosed || _closed;

  @override
  MultiAddr get localMultiaddr => _localAddr;

  @override
  MultiAddr get remoteMultiaddr => _remoteAddr;

  @override
  MultiAddr get localAddr => _localAddr;

  @override
  MultiAddr get remoteAddr => _remoteAddr;

  @override
  Socket get socket => _socket;

  @override
  void setReadTimeout(Duration timeout) {}

  @override
  void setWriteTimeout(Duration timeout) {}

  @override
  String get id => 'tcp-${_socket.hashCode}';

  @override
  dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  group('Dart to Go Integration Tests', () {
    test('Can establish plaintext connection to Go server', () async {
      const host = '127.0.0.1';
      const port = 5001;

      // Check if server is running
      Socket? testSocket;
      try {
        testSocket = await Socket.connect(host, port, timeout: const Duration(seconds: 2));
        testSocket.destroy();
      } catch (e) {
        print('Go server not running at $host:$port, skipping test');
        print('To run this test, start the Go server:');
        print('  cd station/frame/example/libp2p-dart-2-go');
        print('  go run main.go');
        return;
      }

      // Generate identity key
      final identity = await generateEd25519KeyPair();
      final localPeerId = PeerId.fromPublicKey(identity.publicKey);
      print('Dart Peer ID: $localPeerId');

      // Connect
      final conn = await TcpTransportConn.connect(host, port);
      print('Connected to Go server at $host:$port');

      try {
        // Multistream-select for security protocol
        await _sendMultistreamToken(conn, '/multistream/1.0.0');
        final msHeader = await _readMultistreamToken(conn);
        print('Multistream header: $msHeader');
        expect(msHeader, equals('/multistream/1.0.0'));

        // Request plaintext protocol
        await _sendMultistreamToken(conn, '/plaintext/2.0.0');
        final secProto = await _readMultistreamToken(conn);
        print('Security protocol response: $secProto');
        expect(secProto, equals('/plaintext/2.0.0'));

        // Perform plaintext handshake
        final plaintext = PlaintextSecurity(identity);
        final securedConn = await plaintext.secureOutbound(conn);
        print('Plaintext handshake complete');
        print('Remote Peer ID: ${securedConn.remotePeer}');

        // Negotiate muxer
        await _sendMultistreamToken(securedConn, '/multistream/1.0.0');
        final msHeader2 = await _readMultistreamToken(securedConn);
        print('Muxer multistream header: $msHeader2');
        expect(msHeader2, equals('/multistream/1.0.0'));

        await _sendMultistreamToken(securedConn, '/yamux/1.0.0');
        final muxProto = await _readMultistreamToken(securedConn);
        print('Muxer protocol: $muxProto');
        expect(muxProto, equals('/yamux/1.0.0'));

        print('SUCCESS: Connection fully upgraded!');
        
        await securedConn.close();
      } finally {
        await conn.close();
      }
    });
  });
}

Future<void> _sendMultistreamToken(TransportConn conn, String token) async {
  final tokenBytes = '$token\n'.codeUnits;
  final length = tokenBytes.length;
  final varintBytes = _encodeVarint(length);
  
  final frame = Uint8List(varintBytes.length + length);
  frame.setAll(0, varintBytes);
  frame.setAll(varintBytes.length, tokenBytes);
  
  await conn.write(frame);
}

Future<String> _readMultistreamToken(TransportConn conn) async {
  final (length, _) = await _readVarint(conn);
  final tokenBytes = await _readExactly(conn, length);
  var token = String.fromCharCodes(tokenBytes);
  if (token.endsWith('\n')) {
    token = token.substring(0, token.length - 1);
  }
  return token;
}

List<int> _encodeVarint(int value) {
  final bytes = <int>[];
  while (value >= 0x80) {
    bytes.add((value & 0x7F) | 0x80);
    value >>= 7;
  }
  bytes.add(value);
  return bytes;
}

Future<(int, int)> _readVarint(TransportConn conn) async {
  int value = 0;
  int shift = 0;
  int bytesRead = 0;
  
  while (true) {
    final byte = await _readExactly(conn, 1);
    bytesRead++;
    value |= (byte[0] & 0x7F) << shift;
    if ((byte[0] & 0x80) == 0) break;
    shift += 7;
    if (shift > 63) throw FormatException('Varint too long');
  }
  
  return (value, bytesRead);
}

Future<Uint8List> _readExactly(TransportConn conn, int n) async {
  final buffer = <int>[];
  while (buffer.length < n) {
    final chunk = await conn.read(n - buffer.length);
    if (chunk.isEmpty) throw StateError('Connection closed');
    buffer.addAll(chunk);
  }
  return Uint8List.fromList(buffer);
}
