import 'dart:async';
import 'dart:io';

import 'package:multicast_dns/multicast_dns.dart';

class DiscoveredService {
  final String name;
  final String host;
  final int port;
  final String? peerId;
  final List<String> addresses;

  DiscoveredService({
    required this.name,
    required this.host,
    required this.port,
    this.peerId,
    this.addresses = const [],
  });

  String get baseUrl => 'http://$host:$port';
}

class MDNSService {
  static const String serviceType = '_peers-touch._tcp';

  Future<List<DiscoveredService>> discoverPeersTouchServices({
    Duration timeout = const Duration(seconds: 2),
  }) async {
    final client = MDnsClient();
    final List<DiscoveredService> services = [];
    try {
      await client.start();
      final ptrRecords = client.lookup<PtrResourceRecord>(
        ResourceRecordQuery.service(serviceType),
      );

      final completer = Completer<void>();
      final timer = Timer(timeout, () {
        if (!completer.isCompleted) completer.complete();
      });

      ptrRecords.listen((ptr) async {
        final instance = ptr.domainName;
        String host = '';
        int port = 0;
        String? peerId;
        final addrs = <String>[];

        await for (final srv in client.lookup<SrvResourceRecord>(
            ResourceRecordQuery.instance(instance))) {
          host = srv.target;
          port = srv.port;
        }

        await for (final txt in client.lookup<TxtResourceRecord>(
            ResourceRecordQuery.instance(instance))) {
          for (final e in txt.text.split('\n')) {
            final parts = e.split('=');
            if (parts.length == 2) {
              final k = parts[0];
              final v = parts[1];
              if (k == 'peer_id') peerId = v;
              if (k == 'addresses') addrs.add(v);
            }
          }
        }

        await for (final ip in client.lookup<IPAddressResourceRecord>(
            ResourceRecordQuery.address(host))) {
          final addr = ip.address.address;
          if (!addrs.contains(addr)) addrs.add(addr);
        }

        final selectedHost = addrs.isNotEmpty ? addrs.first : host;
        services.add(DiscoveredService(
          name: instance,
          host: selectedHost,
          port: port,
          peerId: peerId,
          addresses: addrs,
        ));
      }, onDone: () {
        if (!completer.isCompleted) completer.complete();
      });

      await completer.future;
      timer.cancel();
    } catch (_) {
      return [];
    } finally {
      try {
        await client.stop();
      } catch (_) {}
    }

    return services;
  }
}