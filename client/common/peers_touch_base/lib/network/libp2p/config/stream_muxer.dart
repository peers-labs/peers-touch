import 'package:peers_touch_base/network/libp2p/core/network/conn.dart'; // Added for Conn type
import 'package:peers_touch_base/network/libp2p/p2p/transport/multiplexing/multiplexer.dart';

/// Represents a stream multiplexer with its protocol ID and factory function
class StreamMuxer {

  /// Creates a new StreamMuxer
  const StreamMuxer({
    required this.id,
    required this.muxerFactory,
  });
  /// The protocol ID for this multiplexer (e.g., '/yamux/1.0.0')
  final String id;

  /// Factory function to create a new multiplexer instance.
  /// The 'secureConn' is the connection after security protocols have been applied.
  /// The 'isClient' flag indicates if this node is the client in the connection setup.
  final Multiplexer Function(Conn secureConn, bool isClient) muxerFactory;
}
