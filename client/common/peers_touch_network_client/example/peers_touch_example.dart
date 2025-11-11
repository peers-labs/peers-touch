import 'package:peers_touch_network_client/peers_touch_client.dart';

void main() async {
  print('Peers-touch Client Example');
  print('==========================');

  // Create configuration
  final config = PeersTouchConfig(
    registryUrl: 'https://peers-touch.example.com',
    nodeId: 'example-node-001',
    debug: true,
  );

  // Create client instance
  final client = PeersTouchClient(config: config);

  try {
    // Connect to the network
    print('Connecting to Peers-touch network...');
    await client.connect();
    print('✓ Connected successfully');

    // Discover peers
    print('Discovering peers...');
    final peers = await client.discoverPeers();
    print('✓ Found ${peers.length} peers');

    // Display peer information
    for (final peer in peers) {
      print('  - ${peer.peerId} at ${peer.primaryAddress}');
    }

    // Keep the connection alive for a while
    print('\nKeeping connection alive for 10 seconds...');
    await Future.delayed(Duration(seconds: 10));

    // Disconnect
    print('Disconnecting...');
    await client.disconnect();
    print('✓ Disconnected successfully');

  } catch (e) {
    print('✗ Error: $e');
  } finally {
    // Cleanup
    await client.dispose();
  }

  print('\nExample completed.');
}