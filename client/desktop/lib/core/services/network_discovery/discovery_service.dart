import 'package:peers_touch_desktop/core/services/network_discovery/node_scanner.dart';

class DiscoveryService {
  final NodeScanner scanner = NodeScanner();

  Future<void> startScan() => scanner.startScan();
}