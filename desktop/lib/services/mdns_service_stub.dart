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
    // Web or unsupported platforms: return empty list.
    return [];
  }
}