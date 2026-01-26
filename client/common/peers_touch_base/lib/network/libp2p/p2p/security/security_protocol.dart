import 'package:peers_touch_base/network/libp2p/core/network/transport_conn.dart';

/// Interface for security protocols in libp2p
///
/// Security protocols take a raw transport connection and return a secured
/// connection. The returned connection may be encrypted (like Noise) or
/// unencrypted (like Plaintext for testing).
abstract class SecurityProtocol {
  /// The protocol identifier string (e.g., "/noise", "/plaintext/2.0.0")
  String get protocolId;

  /// Secures an outbound connection
  ///
  /// Takes a raw transport connection and returns a secured connection
  /// with the remote peer's identity verified.
  Future<TransportConn> secureOutbound(TransportConn connection);

  /// Secures an inbound connection
  ///
  /// Takes a raw transport connection and returns a secured connection
  /// with the remote peer's identity verified.
  Future<TransportConn> secureInbound(TransportConn connection);
}

