import 'dart:convert';
import 'dart:typed_data';

import 'package:peers_touch_base/network/libp2p/config/config.dart';
import 'package:peers_touch_base/network/libp2p/config/defaults.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/ed25519.dart' as crypto_ed25519;
import 'package:peers_touch_base/network/libp2p/core/host/host.dart';
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/p2p/security/noise/noise_protocol.dart';
import 'package:peers_touch_base/network/libp2p/p2p/transport/tcp_transport.dart';
import 'package:peers_touch_base/network/libp2p/core/peer/addr_info.dart';

import 'package:peers_touch_base/network/libp2p/core/network/context.dart';
import 'package:peers_touch_base/network/libp2p/p2p/host/resource_manager/resource_manager_impl.dart';
import 'package:peers_touch_base/network/libp2p/p2p/host/resource_manager/limiter.dart';

void main() async {
  // 1. Create a Config object
      final config = Config();

  // 2. Generate a key pair for the node's identity
  final keyPair = await crypto_ed25519.generateEd25519KeyPair();

  // 3. Apply options to the config
  await config.apply([
    Libp2p.resourceManager(ResourceManagerImpl()),
    Libp2p.identity(keyPair),
    Libp2p.listenAddrs([MultiAddr('/ip4/0.0.0.0/tcp/0')]),
    Libp2p.transport(TCPTransport()),
    Libp2p.security(await NoiseSecurity.create(keyPair)),
    defaultMuxers, // Use the default Yamux muxer
  ]);

  // 4. Create the libp2p host
  final Host host = await config.newNode();

  print("My peer ID is: \${host.id().toString()}");
  print("Listen addresses: \${host.listenAddrs().map((a) => a.toString()).join(', ')}");

  // The bootstrap node from the go-libp2p example
  var bootstrapNodeAddr = MultiAddr(
      '/ip4/104.131.131.82/tcp/4001/p2p/QmaCpDMGvV2BGHeYERUEnRQAwe3N8SzbUtfsmvsqQLuvuJ');

  try {
    // 5. Connect to the bootstrap node
    print("Connecting to bootstrap node...");
    final addrInfo = AddrInfo.fromMultiaddr(bootstrapNodeAddr);
    await host.connect(addrInfo);
    print("Connected to \${addrInfo.id.toString()}");

    // 6. Create a stream to the bootstrap node with a custom protocol
    final stream = await host.newStream(addrInfo.id, ['/my-protocol/1.0.0'], Context());

    // 7. Send a message
    var message = 'Hello from dart-libp2p!';
    print("Sending message: '\$message'");
    await stream.write(Uint8List.fromList(utf8.encode(message)));

    // 8. Read the response
    print("Waiting for response...");
    final data = await stream.read();
    var response = utf8.decode(data);
    print("Received response: '\$response'");
  } catch (e, s) {
    print("An error occurred: \$e");
    print(s);
  } finally {
    // 9. Close the node
    print("Closing node...");
    await host.close();
    print("Node closed.");
  }
}