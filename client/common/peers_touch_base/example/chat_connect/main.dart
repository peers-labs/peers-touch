import 'dart:convert';
import 'dart:io';

import 'package:peers_touch_base/chat/services/p2p_chat_protocol.dart';
import 'package:peers_touch_base/network/libp2p/config/config.dart';
import 'package:peers_touch_base/network/libp2p/config/defaults.dart';
import 'package:peers_touch_base/network/libp2p/core/crypto/ed25519.dart' as ed;
import 'package:peers_touch_base/network/libp2p/core/host/host.dart';
import 'package:peers_touch_base/network/libp2p/core/multiaddr.dart';
import 'package:peers_touch_base/network/libp2p/core/network/context.dart';

void main() async {
  final serverUrl = Platform.environment['CHAT_SIGNAL_URL'] ?? 'http://127.0.0.1:8080';
  final targetPeer = Platform.environment['TARGET_PEER'];

  final cfg = Config();
  final kp = await ed.generateEd25519KeyPair();
  await cfg.apply([
    Libp2p.identity(kp),
    Libp2p.listenAddrs([MultiAddr('/ip4/127.0.0.1/tcp/0')]),
    defaultMuxers,
    defaultTransports,
    defaultSecurity(kp),
  ]);
  final host = await cfg.newNode();
  await host.start();

  final me = host.id.toString();
  final addrs = host.addrs.map((e) => e.toString()).toList();
  final body = json.encode({'id': me, 'role': Platform.environment['ROLE'] ?? 'mobile', 'addrs': addrs});
  await HttpClient().postUrl(Uri.parse('$serverUrl/chat/peer/register')).then((req){
    req.headers.contentType = ContentType.json; req.write(body); return req.close();
  });

  final chat = P2PChatProtocol(host);
  chat.registerMessageHandler((peer, msg){
    stdout.writeln('recv from ${peer.toString()}: ${json.encode(msg)}');
  });

  if (targetPeer != null && targetPeer.isNotEmpty) {
    final stream = await host.newStream(MultiAddr('/p2p/$targetPeer').peerId(), P2PChatProtocol.protocolId, Context());
    final data = json.encode({'text':'Hello from ${Platform.environment['ROLE'] ?? 'mobile'}'});
    final bytes = utf8.encode(data);
    await stream.write(bytes);
    await stream.close();
  }
}

