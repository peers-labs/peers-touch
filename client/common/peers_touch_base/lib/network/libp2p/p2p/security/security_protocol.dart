import 'package:peers_touch_base/network/libp2p/core/network/transport_conn.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/secured_connection.dart';

/// Interface for security protocols in libp2p
abstract class SecurityProtocol {
  /// The protocol identifier string
  String get protocolId;

  /// Secures an outbound connection
  Future<SecuredConnection> secureOutbound(TransportConn connection);

  /// Secures an inbound connection
  Future<SecuredConnection> secureInbound(TransportConn connection);
}

