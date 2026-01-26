import 'dart:typed_data';

import 'package:peers_touch_base/network/libp2p/core/crypto/keys.dart';
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/conn.dart';
import 'package:peers_touch_base/network/libp2p/core/network/context.dart';
import 'package:peers_touch_base/network/libp2p/core/network/rcmgr.dart'
    show ConnScope;
import 'package:peers_touch_base/network/libp2p/core/network/stream.dart';
import 'package:peers_touch_base/network/libp2p/core/network/transport_conn.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/peer_id.dart';

/// A plaintext connection that wraps a TransportConn without encryption.
/// Used for testing and development purposes only.
class PlaintextConnection implements TransportConn {
  PlaintextConnection(
    this._connection,
    this._remotePeer,
    this._remotePublicKey,
  );

  final TransportConn _connection;
  final PeerId _remotePeer;
  final PublicKey? _remotePublicKey;

  static const String securityProtocolId = '/plaintext/2.0.0';

  @override
  Future<void> close() => _connection.close();

  @override
  Future<Uint8List> read([int? length]) => _connection.read(length);

  @override
  Future<void> write(Uint8List data) => _connection.write(data);

  @override
  bool get isClosed => _connection.isClosed;

  @override
  MultiAddr get localMultiaddr => _connection.localMultiaddr;

  @override
  MultiAddr get remoteMultiaddr => _connection.remoteMultiaddr;

  @override
  MultiAddr get localAddr => localMultiaddr;

  @override
  MultiAddr get remoteAddr => remoteMultiaddr;

  @override
  get socket => _connection.socket;

  @override
  void setReadTimeout(Duration timeout) => _connection.setReadTimeout(timeout);

  @override
  void setWriteTimeout(Duration timeout) =>
      _connection.setWriteTimeout(timeout);

  @override
  String get id => _connection.id;

  @override
  Future<P2PStream> newStream(Context context) => _connection.newStream(context);

  @override
  Future<List<P2PStream>> get streams => _connection.streams;

  @override
  PeerId get localPeer => _connection.localPeer;

  @override
  PeerId get remotePeer => _remotePeer;

  @override
  Future<PublicKey?> get remotePublicKey async => _remotePublicKey;

  @override
  ConnState get state {
    final originalState = _connection.state;
    return ConnState(
      streamMultiplexer: originalState.streamMultiplexer,
      security: securityProtocolId,
      transport: originalState.transport,
      usedEarlyMuxerNegotiation: originalState.usedEarlyMuxerNegotiation,
    );
  }

  @override
  ConnStats get stat => _connection.stat;

  @override
  ConnScope get scope => _connection.scope;

  @override
  void notifyActivity() {
    _connection.notifyActivity();
  }
}
