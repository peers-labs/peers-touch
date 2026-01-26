import 'dart:async';
import 'dart:typed_data'; // Added for Uint8List

import 'package:logging/logging.dart';
import 'package:peers_touch_base/network/libp2p/config/config.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/ed25519.dart'; // For generating a default KeyPair
import 'package:peers_touch_base/network/libp2p/core/crypto/keys.dart'; // For PublicKey
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/conn.dart';
import 'package:peers_touch_base/network/libp2p/core/network/context.dart'; // For Context
// Use a specific alias for core_mux.Multiplexer
import 'package:peers_touch_base/network/libp2p/core/network/mux.dart' as core_mux; // For MuxedConn, and potentially core Multiplexer if different
import 'package:peers_touch_base/network/libp2p/core/network/rcmgr.dart'; // For ResourceManager, PeerScope, ConnScope, StreamScope
import 'package:peers_touch_base/network/libp2p/core/network/stream.dart'; // For P2PStream, StreamStats
import 'package:peers_touch_base/network/libp2p/core/network/transport_conn.dart';
// core_peer_id.dart is usually aliased or PeerId is directly from core/peer_id.dart
// For now, assuming PeerId and PeerId are available from this import.
import 'package:peers_touch_base/network/libp2p/core/peer/peer_id.dart';
import 'package:peers_touch_base/network/libp2p/core/protocol/protocol.dart' show ProtocolID; // For ProtocolID type
// Corrected path for multiaddr protocol constants
import 'package:peers_touch_base/network/libp2p/p2p/multiaddr/protocol.dart' as multiaddr_protocol;
import 'package:peers_touch_base/network/libp2p/p2p/protocol/multistream/multistream.dart'; // For MultistreamMuxer
import 'package:peers_touch_base/network/libp2p/p2p/security/plaintext/plaintext_security.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/secured_connection.dart';
import 'package:peers_touch_base/network/libp2p/p2p/transport/multiplexing/multiplexer.dart' as p2p_mux; // For the Multiplexer type from the factory
import 'package:peers_touch_base/network/libp2p/p2p/transport/upgrader.dart'; // For Upgrader interface

final _log = Logger('BasicUpgrader');


// --- Helper: NegotiationStreamWrapper ---
class NegotiationStreamWrapper implements P2PStream<Uint8List> {

  NegotiationStreamWrapper(this._conn, [this._protocolId = 'negotiator']);
  final TransportConn _conn;
  final String _protocolId;

  @override
  Future<void> close() => _conn.close();

  @override
  bool get isClosed => _conn.isClosed;

  @override
  bool get isWritable => !_conn.isClosed;

  @override
  Future<Uint8List> read([int? maxLength]) async {
    if (maxLength == null || maxLength == 0) {
      return await _conn.read();
    }
    try {
      return await _conn.read(maxLength);
    } catch (e) {
      rethrow;
    }
  }

  @override
  Future<void> reset() => _conn.close();

  @override
  Future<void> write(Uint8List data) => _conn.write(data);

  @override
  String id() => _conn.id;

  @override
  String protocol() => _protocolId;

  @override
  Future<void> setProtocol(String id) async {}

  @override
  StreamStats stat() => throw UnimplementedError('stat not needed for negotiation wrapper');
  @override
  Conn get conn => throw UnimplementedError('conn not needed for negotiation wrapper');
  @override
  StreamManagementScope scope() => NullScope();
  @override
  Future<void> closeWrite() => throw UnimplementedError('closeWrite not needed for negotiation wrapper');
  @override
  Future<void> closeRead() => throw UnimplementedError('closeRead not needed for negotiation wrapper');

  @override
  Future<void> setDeadline(DateTime? time) async {
    if (time != null) {
      final now = DateTime.now();
      final duration = time.isAfter(now) ? time.difference(now) : Duration.zero;
      _conn.setReadTimeout(duration);
      _conn.setWriteTimeout(duration);
    }
  }

  @override
  Future<void> setReadDeadline(DateTime time) async {
    final now = DateTime.now();
    final duration = time.isAfter(now) ? time.difference(now) : Duration.zero;
    _conn.setReadTimeout(duration);
  }

  @override
  Future<void> setWriteDeadline(DateTime time) async {
    final now = DateTime.now();
    final duration = time.isAfter(now) ? time.difference(now) : Duration.zero;
    _conn.setWriteTimeout(duration);
  }

  @override
  P2PStream<Uint8List> get incoming => throw UnimplementedError('incoming not supported by negotiation wrapper');
}

// --- Helper: UpgradedConnectionImpl ---
class UpgradedConnectionImpl implements Conn, core_mux.MuxedConn {

  UpgradedConnectionImpl({
    required core_mux.MuxedConn muxedConn,
    required TransportConn transportConn,
    required ProtocolID negotiatedSecurityProto,
    required ProtocolID negotiatedMuxerProto,
    required PeerId localPeerId,
    required PeerId remotePeerId,
    this.remotePublicKeyValue,
  })  : _muxedConn = muxedConn,
        _transportConn = transportConn,
        _negotiatedSecurityProto = negotiatedSecurityProto,
        _negotiatedMuxerProto = negotiatedMuxerProto,
        _localPeerId = localPeerId,
        _remotePeerId = remotePeerId;
  final core_mux.MuxedConn _muxedConn;
  final TransportConn _transportConn;
  final ProtocolID _negotiatedSecurityProto;
  final ProtocolID _negotiatedMuxerProto;
  final PeerId _localPeerId;
  final PeerId _remotePeerId;
  final PublicKey? remotePublicKeyValue;

  @override
  Future<void> close() => _muxedConn.close();

  @override
  String get id => _transportConn.id;

  @override
  bool get isClosed => _muxedConn.isClosed;

  @override
  MultiAddr get localMultiaddr => _transportConn.localMultiaddr;

  @override
  PeerId get localPeer => _localPeerId;

  @override
  Future<P2PStream> newStream(Context context) async {
    // This is the client-side opening of a stream.
    // It maps to MuxedConn.openStream
    final core_mux.MuxedStream muxedStream = await _muxedConn.openStream(context);
    if (muxedStream is P2PStream) {
      return muxedStream as P2PStream;
    } else {
      // This path should ideally not be hit if YamuxStream correctly implements P2PStream
      throw Exception('MuxedStream from _muxedConn.openStream() is not a P2PStream. Type: ${muxedStream.runtimeType}');
    }
  }

  // Implementation for MuxedConn.openStream
  @override
  Future<core_mux.MuxedStream> openStream(Context context) async {
    return await _muxedConn.openStream(context);
  }

  // Implementation for MuxedConn.acceptStream
  @override
  Future<core_mux.MuxedStream> acceptStream() async {
    return await _muxedConn.acceptStream();
  }

  @override
  PeerId get remotePeer => _remotePeerId;

  @override
  Future<PublicKey?> get remotePublicKey async => remotePublicKeyValue ?? await _transportConn.remotePublicKey;

  @override
  MultiAddr get remoteMultiaddr => _transportConn.remoteMultiaddr;

  @override
  ConnScope get scope => _transportConn.scope;

  // Attempting to make the method static to see if it resolves the persistent linter error.
  static String _extractTransportProtocol(MultiAddr addr) {
    for (final p in addr.protocols) {
      final protocolName = p.name; // Use name for comparisons primarily

      // Check for specific Libp2p protocol names
      if (protocolName == multiaddr_protocol.Protocols.tcp.name) {
        return 'tcp';
      } else if (protocolName == multiaddr_protocol.Protocols.udp.name) {
        // Check for QUIC specifically using its defined name from the Protocols class
        // Multiaddr.hasProtocol expects a String (protocol name)
        if (addr.hasProtocol(multiaddr_protocol.Protocols.quicV1.name)) { 
          return 'quic';
        }
        return 'udp';
      } else if (protocolName == 'ws') { // ws and wss might not be in Protocols class, check by name
        return 'ws';
      } else if (protocolName == 'wss') {
        return 'wss';
      } else if (protocolName == multiaddr_protocol.Protocols.webtransport.name) { 
        return 'webtransport';
      } else if (protocolName == 'webrtc' || protocolName == 'webrtc-direct') { // webrtc related protocols
        return 'webrtc';
      }
    }
    return 'unknown'; // Default if no recognized transport is found
  }

  @override
  ConnState get state {
    final transportProtocol = _extractTransportProtocol(_transportConn.remoteMultiaddr);
    return ConnState(
      streamMultiplexer: _negotiatedMuxerProto,
      security: _negotiatedSecurityProto,
      transport: transportProtocol,
      usedEarlyMuxerNegotiation: false,
    );
  }

  @override
  ConnStats get stat => _transportConn.stat; 

  @override
  Future<List<P2PStream>> get streams async {
    if (_muxedConn is p2p_mux.Multiplexer) {
      return (_muxedConn as p2p_mux.Multiplexer).streams;
    } else {
      print('Warning: _muxedConn in UpgradedConnectionImpl is not a p2p_mux.Multiplexer. Cannot get streams directly.');
      return []; 
    }
  }
}

class BasicUpgrader implements Upgrader {

  BasicUpgrader({required this.resourceManager});
  final ResourceManager resourceManager;

  @override
  Future<Conn> upgradeOutbound({
    required TransportConn connection,
    required PeerId remotePeerId,
    required Config config,
    required MultiAddr remoteAddr,
  }) async {
    try {
      TransportConn securedConn;
      String chosenSecurityId;
      PeerId actualRemotePeerId;
      PublicKey? remotePubKey;

      if (config.insecure) {
        // Insecure mode: use Plaintext protocol
        _log.fine('BasicUpgrader: Using insecure (plaintext) mode');
        
        final plaintext = PlaintextSecurity(config.peerKey!);
        
        // Still need multistream negotiation for security protocol
        final mssForSecurity = MultistreamMuxer();
        final negotiationSecStream = NegotiationStreamWrapper(connection, '/sec-negotiator');
        
        final chosenSecurityIdStr = await mssForSecurity.selectOneOf(
          negotiationSecStream, 
          [PlaintextSecurity.protocolIdValue],
        );
        
        if (chosenSecurityIdStr == null) {
          await connection.close();
          throw Exception('Remote does not support plaintext protocol');
        }
        
        chosenSecurityId = chosenSecurityIdStr;
        securedConn = await plaintext.secureOutbound(connection);
        actualRemotePeerId = securedConn.remotePeer;
        remotePubKey = await securedConn.remotePublicKey;
      } else {
        // Normal security protocol negotiation
        final mssForSecurity = MultistreamMuxer();
        final securityProtoIDs = config.securityProtocols.map((s) => s.protocolId).toList();
        final negotiationSecStream = NegotiationStreamWrapper(connection, '/sec-negotiator');

        _log.fine('BasicUpgrader: Negotiating security protocols: $securityProtoIDs');
        final chosenSecurityIdStr = await mssForSecurity.selectOneOf(negotiationSecStream, securityProtoIDs);

        if (chosenSecurityIdStr == null) {
          await connection.close();
          throw Exception('Failed to negotiate security protocol with $remotePeerId at $remoteAddr');
        }
        chosenSecurityId = chosenSecurityIdStr; 

        final securityModule = config.securityProtocols.firstWhere(
          (s) => s.protocolId == chosenSecurityId,
          orElse: () => throw Exception('Selected security protocol $chosenSecurityId not found in config'),
        );
        securedConn = await securityModule.secureOutbound(connection);
        actualRemotePeerId = securedConn.remotePeer;
        remotePubKey = await securedConn.remotePublicKey;
      }

      // Muxer negotiation (same for both modes)
      final mssForMuxers = MultistreamMuxer();
      final muxerProtoIDs = config.muxers.map((m) => m.id).toList();
      final negotiationMuxStream = NegotiationStreamWrapper(securedConn, '/mux-negotiator');
      final chosenMuxerIdStr = await mssForMuxers.selectOneOf(negotiationMuxStream, muxerProtoIDs);

      if (chosenMuxerIdStr == null) {
        await securedConn.close();
        throw Exception('Failed to negotiate stream multiplexer with $actualRemotePeerId at $remoteAddr');
      }
      final chosenMuxerId = chosenMuxerIdStr; 

      final muxerEntry = config.muxers.firstWhere(
        (m) => m.id == chosenMuxerId,
        orElse: () => throw Exception('Selected muxer protocol $chosenMuxerId not found in config'),
      );

      final p2p_mux.Multiplexer p2pMultiplexerInstance = muxerEntry.muxerFactory(
        securedConn, 
        true, // isClient = true
      );
      
      final PeerScope peerScope = await resourceManager.viewPeer(
        actualRemotePeerId, 
        (ps) async => ps 
      );

      final core_mux.MuxedConn muxedConnection = await p2pMultiplexerInstance.newConnOnTransport(
        securedConn, 
        false, // isServer = false for outbound
        peerScope, 
      );

      final PublicKey localPublicKey;
      if (config.peerKey != null) {
        localPublicKey = config.peerKey!.publicKey;
      } else {
        final tempKeyPair = await generateEd25519KeyPair();
        localPublicKey = tempKeyPair.publicKey;
      }
      final PeerId localPId = PeerId.fromPublicKey(localPublicKey); 

      return UpgradedConnectionImpl(
        muxedConn: muxedConnection,
        transportConn: securedConn,
        negotiatedSecurityProto: chosenSecurityId,
        negotiatedMuxerProto: chosenMuxerId,
        localPeerId: localPId,
        remotePeerId: actualRemotePeerId,
        remotePublicKeyValue: remotePubKey,
      );

    } catch (e) {
      await connection.close();
      rethrow;
    }
  }

  @override
  Future<Conn> upgradeInbound({
    required TransportConn connection,
    required Config config,
  }) async {
    try {
      TransportConn securedConn;
      String chosenSecurityId;
      PeerId actualRemotePeerId;
      PublicKey? remotePubKey;

      if (config.insecure) {
        // Insecure mode: use Plaintext protocol
        _log.fine('BasicUpgrader: Using insecure (plaintext) mode for inbound');
        
        final plaintext = PlaintextSecurity(config.peerKey!);
        
        // Multistream negotiation for security protocol
        final mssForSecurity = MultistreamMuxer();
        final negotiationSecStream = NegotiationStreamWrapper(connection, '/sec-negotiator-in');
        
        final Completer<ProtocolID> securityProtoCompleter = Completer();
        mssForSecurity.addHandler(PlaintextSecurity.protocolIdValue, (ProtocolID p, P2PStream s) async {
          if (!securityProtoCompleter.isCompleted) {
            securityProtoCompleter.complete(p);
          }
        });
        
        await mssForSecurity.handle(negotiationSecStream);
        chosenSecurityId = await securityProtoCompleter.future;
        
        securedConn = await plaintext.secureInbound(connection);
        actualRemotePeerId = securedConn.remotePeer;
        remotePubKey = await securedConn.remotePublicKey;
      } else {
        // Normal security protocol negotiation
        final mssForSecurity = MultistreamMuxer();
        final negotiationSecStream = NegotiationStreamWrapper(connection, '/sec-negotiator-in');

        final Completer<ProtocolID> securityProtoCompleter = Completer();
        if (config.securityProtocols.isEmpty) {
          await connection.close();
          throw Exception('No security protocols configured for inbound connection');
        }
        for (final sp in config.securityProtocols) {
          mssForSecurity.addHandler(sp.protocolId, (ProtocolID p, P2PStream s) async {
            if (!securityProtoCompleter.isCompleted) {
              securityProtoCompleter.complete(p);
            }
          });
        }
        await mssForSecurity.handle(negotiationSecStream); 
        chosenSecurityId = await securityProtoCompleter.future;

        final securityModule = config.securityProtocols.firstWhere(
          (s) => s.protocolId == chosenSecurityId,
          orElse: () => throw Exception('Client proposed security protocol $chosenSecurityId not found/supported'),
        );
        securedConn = await securityModule.secureInbound(connection);
        actualRemotePeerId = securedConn.remotePeer;
        remotePubKey = await securedConn.remotePublicKey;
      }

      // Muxer negotiation (same for both modes)
      final mssForMuxers = MultistreamMuxer();
      final negotiationMuxStream = NegotiationStreamWrapper(securedConn, '/mux-negotiator-in');
      final Completer<ProtocolID> muxerProtoCompleter = Completer();
      if (config.muxers.isEmpty) {
        await securedConn.close();
        throw Exception('No muxers configured for inbound connection');
      }
      for (final m in config.muxers) {
        mssForMuxers.addHandler(m.id, (ProtocolID p, P2PStream s) async {
          if (!muxerProtoCompleter.isCompleted) {
            muxerProtoCompleter.complete(p);
          }
        });
      }

      await mssForMuxers.handle(negotiationMuxStream);
      final chosenMuxerId = await muxerProtoCompleter.future;

      final muxerEntry = config.muxers.firstWhere(
        (m) => m.id == chosenMuxerId,
        orElse: () => throw Exception('Client proposed muxer $chosenMuxerId not found/supported'),
      );
      
      final p2p_mux.Multiplexer p2pMultiplexerInstance = muxerEntry.muxerFactory(
        securedConn, 
        false, // isClient = false
      );

      final PeerScope peerScope = await resourceManager.viewPeer(
        actualRemotePeerId, 
        (ps) async => ps 
      );
      
      final core_mux.MuxedConn muxedConnection = await p2pMultiplexerInstance.newConnOnTransport(
        securedConn, 
        true,  // isServer = true for inbound
        peerScope,
      );

      final PublicKey localPublicKey;
      if (config.peerKey != null) {
        localPublicKey = config.peerKey!.publicKey;
      } else {
        final tempKeyPair = await generateEd25519KeyPair();
        localPublicKey = tempKeyPair.publicKey;
      }
      final PeerId localPId = PeerId.fromPublicKey(localPublicKey); 

      return UpgradedConnectionImpl(
        muxedConn: muxedConnection,
        transportConn: securedConn,
        negotiatedSecurityProto: chosenSecurityId,
        negotiatedMuxerProto: chosenMuxerId,
        localPeerId: localPId,
        remotePeerId: actualRemotePeerId,
        remotePublicKeyValue: remotePubKey,
      );

    } catch (e) {
      await connection.close();
      rethrow;
    }
  }
}
