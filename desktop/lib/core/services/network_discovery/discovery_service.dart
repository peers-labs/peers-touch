import 'node_scanner.dart';

class DiscoveryService {
  final NodeScanner scanner = NodeScanner();

  Future<void> startScan() => scanner.startScan();
}