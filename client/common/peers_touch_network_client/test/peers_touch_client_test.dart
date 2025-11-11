import 'package:test/test.dart';
import 'package:peers_touch_network_client/peers_touch_client.dart';

void main() {
  group('PeersTouchConfig', () {
    test('should create config with valid parameters', () {
      final config = PeersTouchConfig(
        nodeId: 'test-node',
        registryUrl: 'https://registry.example.com',
      );

      expect(config.nodeId, equals('test-node'));
      expect(config.registryUrl, equals('https://registry.example.com'));
      expect(config.debug, isFalse);
    });

    test('should serialize and deserialize config', () {
      final original = PeersTouchConfig(
        nodeId: 'test-node',
        registryUrl: 'https://registry.example.com',
        debug: true,
      );

      final json = original.toJson();
      final restored = PeersTouchConfig.fromJson(json);

      expect(restored.nodeId, equals(original.nodeId));
      expect(restored.registryUrl, equals(original.registryUrl));
      expect(restored.debug, equals(original.debug));
    });
  });

  group('PeerInfo', () {
    test('should create peer info with valid parameters', () {
      final peer = PeerInfo(
        peerId: 'peer-001',
        addresses: ['https://peer.example.com'],
        lastSeen: DateTime.now(),
      );

      expect(peer.peerId, equals('peer-001'));
      expect(peer.addresses, contains('https://peer.example.com'));
      expect(peer.isOnline, isTrue);
    });

    test('should detect inactive peer', () {
      final peer = PeerInfo(
        peerId: 'peer-001',
        addresses: ['https://peer.example.com'],
        lastSeen: DateTime.now().subtract(Duration(hours: 2)),
      );

      expect(peer.isOnline, isFalse);
    });
  });

  group('PeersTouchClient', () {
    late PeersTouchConfig config;

    setUp(() {
      config = PeersTouchConfig(
        nodeId: 'test-client',
        registryUrl: 'https://registry.example.com',
      );
    });

    test('should create client instance', () {
      final client = PeersTouchClient(config: config);

      expect(client.config, equals(config));
      expect(client.isConnected, isFalse);
      expect(client.activeSessions, isEmpty);
    });

    test('should throw when connecting while already connected', () async {
      final client = PeersTouchClient(config: config);
      
      // First connect should succeed
      await client.connect();
      
      // Second connect should throw exception
      expect(() => client.connect(), throwsA(isA<ConnectionException>()));
    });
  });

  group('ConnectionConfig', () {
    test('should create connection config with default values', () {
      final config = ConnectionConfig();

      expect(config.timeout, equals(30));
      expect(config.maxRetries, equals(3));
      expect(config.retryDelay, equals(1000));
    });

    test('should create connection config with custom values', () {
      final config = ConnectionConfig(
        timeout: 60,
        maxRetries: 5,
        retryDelay: 2000,
      );

      expect(config.timeout, equals(60));
      expect(config.maxRetries, equals(5));
      expect(config.retryDelay, equals(2000));
    });
  });

  group('SecurityConfig', () {
    test('should create security config with default values', () {
      final config = SecurityConfig();

      expect(config.enableTls, isTrue);
      expect(config.enableE2ee, isTrue);
    });

    test('should create security config with custom values', () {
      final config = SecurityConfig(
        enableTls: false,
        enableE2ee: false,
      );

      expect(config.enableTls, isFalse);
      expect(config.enableE2ee, isFalse);
    });
  });
}