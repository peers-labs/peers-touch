# Peers-touch Dart Client

A Dart client library for connecting to Peers-touch network and joining as a node.

## Features

- 🔍 **Peer Discovery**: Discover other nodes in the network
- 🔗 **Connection Management**: Establish and maintain P2P connections
- 📡 **ActivityPub Protocol**: Support for ActivityPub standard
- 🔄 **Real-time Communication**: WebSocket-based messaging
- 🔒 **Security**: End-to-end encryption and authentication

## Installation

Add this to your `pubspec.yaml`:

```yaml
dependencies:
  peers_touch_client: ^0.1.0
```

## Quick Start

```dart
import 'package:peers_touch_client/peers_touch_client.dart';

void main() async {
  // Create a client instance
  final client = PeersTouchClient(
    config: PeersTouchConfig(
      nodeId: 'my-node-id',
      registryUrl: 'https://registry.peers-touch.net',
    ),
  );

  // Connect to the network
  await client.connect();

  // Discover peers
  final peers = await client.discoverPeers();
  print('Discovered ${peers.length} peers');

  // Connect to a specific peer
  final session = await client.peerManager.connectToPeer(peers.first.addresses.first);

  // Send a message
  await client.peerManager.sendMessage(session, 'Hello from Dart!');
}
```

## Architecture

This library follows a modular architecture:

- **Network Layer**: Peer discovery and connection management
- **Protocol Layer**: ActivityPub protocol implementation
- **Storage Layer**: Local data persistence
- **Security Layer**: Encryption and authentication

## Platform Support

- ✅ Flutter (Mobile & Desktop)
- ✅ Dart VM (Server-side)
- ⚠️ Web (Limited support due to browser restrictions)

## Development

### Prerequisites

- Dart SDK >= 3.0.0

### Building

```bash
# Generate code
flutter pub run build_runner build

# Watch for changes
flutter pub run build_runner watch
```

### Testing

```bash
# Run tests
flutter test

# Run tests with coverage
flutter test --coverage
```

## Contributing

Please read our [Contributing Guidelines](CONTRIBUTING.md) for details on our code of conduct and the process for submitting pull requests.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Related Projects

- [peers-touch/station](https://github.com/peers-touch/station) - Go implementation of Peers-touch network
- [peers-touch/desktop](https://github.com/peers-touch/desktop) - Desktop client application
- [peers-touch/mobile](https://github.com/peers-touch/mobile) - Mobile client application

## Support

- 📖 [Documentation](https://github.com/peers-touch/peers-touch-client/wiki)
- 🐛 [Issue Tracker](https://github.com/peers-touch/peers-touch-client/issues)
- 💬 [Discussions](https://github.com/peers-touch/peers-touch-client/discussions)