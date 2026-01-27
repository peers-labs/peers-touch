/// Dart-Go libp2p Noise 集成测试
///
/// 运行方式:
/// 1. 启动 Go 服务器:
///    cd station/frame/example/libp2p-dart-2-go-noise && go run main.go
///
/// 2. 运行测试:
///    flutter test test/network/libp2p/dart_to_go_noise_test.dart
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
import 'package:peers_touch_base/network/libp2p/p2p/security/noise/noise_protocol.dart';

class TcpTransportConn implements TransportConn {
  TcpTransportConn(this._socket, this._localAddr, this._remoteAddr) {
    _subscription = _socket.listen(
      (data) {
        _buffer.addAll(data);
        if (!_dataCompleter.isCompleted) _dataCompleter.complete();
      },
      onError: (e) {
        _error = e;
        if (!_dataCompleter.isCompleted) _dataCompleter.completeError(e);
      },
      onDone: () {
        _closed = true;
        if (!_dataCompleter.isCompleted) _dataCompleter.complete();
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
    while (_buffer.isEmpty && !_closed && _error == null) {
      _dataCompleter = Completer<void>();
      await _dataCompleter.future;
    }
    if (_error != null) throw _error!;
    if (_buffer.isEmpty) return Uint8List(0);

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

  @override bool get isClosed => _isClosed || _closed;
  @override MultiAddr get localMultiaddr => _localAddr;
  @override MultiAddr get remoteMultiaddr => _remoteAddr;
  @override MultiAddr get localAddr => _localAddr;
  @override MultiAddr get remoteAddr => _remoteAddr;
  @override Socket get socket => _socket;
  @override void setReadTimeout(Duration timeout) {}
  @override void setWriteTimeout(Duration timeout) {}
  @override String get id => 'tcp-${_socket.hashCode}';
  @override dynamic noSuchMethod(Invocation invocation) => null;
}

void main() {
  group('Dart-Go Noise', () {
    test('Noise 握手成功并建立加密通道', () async {
      const host = '127.0.0.1';
      const port = 5002;

      // 检查服务器是否运行
      try {
        final s = await Socket.connect(host, port, timeout: const Duration(seconds: 2));
        s.destroy();
      } catch (e) {
        print('Go 服务器未运行，跳过测试');
        print('启动命令: cd station/frame/example/libp2p-dart-2-go-noise && go run main.go');
        return;
      }

      final identity = await generateEd25519KeyPair();
      final localPeerId = PeerId.fromPublicKey(identity.publicKey);
      final conn = await TcpTransportConn.connect(host, port);

      try {
        // 1. Multistream 协商安全协议
        await _sendToken(conn, '/multistream/1.0.0');
        expect(await _readToken(conn), '/multistream/1.0.0');
        await _sendToken(conn, '/noise');
        expect(await _readToken(conn), '/noise');

        // 2. Noise 握手
        final noise = await NoiseSecurity.create(identity);
        final securedConn = await noise.secureOutbound(conn);
        
        // 3. 验证加密通道可用
        await _sendToken(securedConn, '/multistream/1.0.0');
        expect(await _readToken(securedConn), '/multistream/1.0.0');

        print('✓ Dart Peer: $localPeerId');
        print('✓ Go Peer: ${securedConn.remotePeer}');
        print('✓ Noise 握手成功，加密通道已建立');

        await securedConn.close();
      } finally {
        await conn.close();
      }
    });
  });
}

Future<void> _sendToken(TransportConn conn, String token) async {
  final bytes = '$token\n'.codeUnits;
  final varint = _encodeVarint(bytes.length);
  final frame = Uint8List(varint.length + bytes.length);
  frame.setAll(0, varint);
  frame.setAll(varint.length, bytes);
  await conn.write(frame);
}

Future<String> _readToken(TransportConn conn) async {
  final (len, _) = await _readVarint(conn);
  final data = await _readExact(conn, len);
  var s = String.fromCharCodes(data);
  return s.endsWith('\n') ? s.substring(0, s.length - 1) : s;
}

List<int> _encodeVarint(int v) {
  final r = <int>[];
  while (v >= 0x80) { r.add((v & 0x7F) | 0x80); v >>= 7; }
  r.add(v);
  return r;
}

Future<(int, int)> _readVarint(TransportConn conn) async {
  int v = 0, s = 0, n = 0;
  while (true) {
    final b = await _readExact(conn, 1);
    n++;
    v |= (b[0] & 0x7F) << s;
    if ((b[0] & 0x80) == 0) break;
    s += 7;
  }
  return (v, n);
}

Future<Uint8List> _readExact(TransportConn conn, int n) async {
  final buf = <int>[];
  while (buf.length < n) {
    final chunk = await conn.read(n - buf.length);
    if (chunk.isEmpty) throw StateError('连接关闭');
    buf.addAll(chunk);
  }
  return Uint8List.fromList(buf);
}
