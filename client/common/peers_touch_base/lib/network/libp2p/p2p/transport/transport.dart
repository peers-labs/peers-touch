import 'dart:async';

import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/conn.dart';
import 'package:peers_touch_base/network/libp2p/p2p/transport/listener.dart';
import 'package:peers_touch_base/network/libp2p/p2p/transport/transport_config.dart';

/// Represents a libp2p transport protocol (e.g., TCP, QUIC)
abstract class Transport {
  /// The configuration for this transport
  TransportConfig get config;

  /// Dials a peer at the given multiaddress with optional timeout override
  /// Returns a connection to the peer if successful
  Future<Conn> dial(MultiAddr addr, {Duration? timeout});

  /// Starts listening on the given multiaddress
  /// Returns a listener that can accept incoming connections
  Future<Listener> listen(MultiAddr addr);

  /// Returns the list of protocols supported by this transport
  /// For example: ['/ip4/tcp', '/ip6/tcp']
  List<String> get protocols;

  /// Returns true if this transport can dial the given multiaddress
  bool canDial(MultiAddr addr);

  /// Returns true if this transport can listen on the given multiaddress
  bool canListen(MultiAddr addr);

  //Close this transport and dispose of it's resources
  Future<void> dispose();
}