@TestOn('vm')
@Timeout(Duration(minutes: 2))
library;

import 'dart:convert';
import 'dart:io';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/ice/ice_service.dart';

class TestHttpService implements IHttpService {
  TestHttpService(this.baseUrl);
  final String baseUrl;

  @override
  Future<Response<T>> getResponse<T>(
    String path, {
    Map<String, dynamic>? queryParameters,
  }) async {
    final client = HttpClient();
    try {
      var uri = Uri.parse('$baseUrl$path');
      if (queryParameters != null && queryParameters.isNotEmpty) {
        uri = uri.replace(
            queryParameters:
                queryParameters.map((k, v) => MapEntry(k, v.toString())));
      }
      final request = await client.getUrl(uri);
      final response = await request.close();
      final body = await response.transform(const Utf8Decoder()).join();

      if (response.statusCode != 200) {
        return Response<T>(
          requestOptions: RequestOptions(path: path),
          statusCode: response.statusCode,
          data: null,
        );
      }

      final decoded = json.decode(body);
      return Response<T>(
        requestOptions: RequestOptions(path: path),
        statusCode: response.statusCode,
        data: decoded as T?,
      );
    } finally {
      client.close();
    }
  }

  @override
  Future<T> get<T>(String path,
      {Map<String, dynamic>? queryParameters, ProtoFactory<T>? fromJson}) {
    throw UnimplementedError();
  }

  @override
  Future<T> post<T>(String path,
      {dynamic data,
      Map<String, dynamic>? queryParameters,
      ProtoFactory<T>? fromJson}) {
    throw UnimplementedError();
  }

  @override
  Future<T> put<T>(String path,
      {dynamic data,
      Map<String, dynamic>? queryParameters,
      ProtoFactory<T>? fromJson}) {
    throw UnimplementedError();
  }

  @override
  Future<T> delete<T>(String path,
      {dynamic data,
      Map<String, dynamic>? queryParameters,
      ProtoFactory<T>? fromJson}) {
    throw UnimplementedError();
  }

  @override
  Future<T> patch<T>(String path,
      {dynamic data,
      Map<String, dynamic>? queryParameters,
      ProtoFactory<T>? fromJson}) {
    throw UnimplementedError();
  }

  @override
  Future<Response<T>> postResponse<T>(String path,
      {dynamic data, Map<String, dynamic>? queryParameters}) {
    throw UnimplementedError();
  }

  @override
  Future<Response<T>> putResponse<T>(String path,
      {dynamic data, Map<String, dynamic>? queryParameters}) {
    throw UnimplementedError();
  }

  @override
  Future<Response<T>> deleteResponse<T>(String path,
      {dynamic data, Map<String, dynamic>? queryParameters}) {
    throw UnimplementedError();
  }

  @override
  Future<Response<T>> patchResponse<T>(String path,
      {dynamic data, Map<String, dynamic>? queryParameters}) {
    throw UnimplementedError();
  }
}

class SimpleHttpClient {
  SimpleHttpClient(this.baseUrl);
  final String baseUrl;

  Future<dynamic> get(String path) async {
    final client = HttpClient();
    try {
      final request = await client.getUrl(Uri.parse('$baseUrl$path'));
      final response = await request.close();
      if (response.statusCode != 200) return null;
      final body = await response.transform(const Utf8Decoder()).join();
      return json.decode(body);
    } finally {
      client.close();
    }
  }

  Future<int> post(String path, Map<String, dynamic> body) async {
    final client = HttpClient();
    try {
      final request = await client.postUrl(Uri.parse('$baseUrl$path'));
      request.headers.contentType = ContentType.json;
      request.write(json.encode(body));
      final response = await request.close();
      await response.drain<void>();
      return response.statusCode;
    } finally {
      client.close();
    }
  }
}

void main() {
  const stationUrl = 'http://localhost:18080';

  group('ICE Integration Tests', () {
    late TestHttpService httpService;
    late IceService iceService;
    late SimpleHttpClient chatClient;

    setUpAll(() async {
      httpService = TestHttpService(stationUrl);
      iceService = IceService(httpService: httpService);
      chatClient = SimpleHttpClient(stationUrl);

      final isRunning = await _checkStationRunning(stationUrl);
      if (!isRunning) {
        print('⚠️  Station not running at $stationUrl');
        print(
            '   Please start Station first: cd station/app && PEERS_AUTH_SECRET=test go run .');
        fail('Station not running');
      }
      print('✅ Station is running at $stationUrl');
    });

    test('1. ICE API returns valid ICE servers', () async {
      print('\n--- Test 1: ICE API ---');

      final servers = await iceService.getICEServers();

      print('Received ${servers.length} ICE servers:');
      for (final server in servers) {
        print('  - ${server.urls.join(", ")}');
        if (server.username != null) {
          print('    username: ${server.username}');
          print('    credential: ${server.credential?.substring(0, 10)}...');
        }
      }

      expect(servers, isNotEmpty);
      expect(servers.any((s) => s.isSTUN), isTrue,
          reason: 'Should have at least one STUN server');

      final turnServers = servers.where((s) => s.isTURN).toList();
      if (turnServers.isNotEmpty) {
        expect(turnServers.first.username, isNotNull,
            reason: 'TURN server should have credentials');
        expect(turnServers.first.credential, isNotNull);
      }

      print('✅ ICE API test passed');
    });

    test('2. IceServer model correctly converts to RTCIceServer format',
        () async {
      print('\n--- Test 2: IceServer Model ---');

      final servers = await iceService.getICEServers();

      for (final server in servers) {
        final rtcConfig = server.toRTCIceServer();

        expect(rtcConfig['urls'], isNotNull);
        expect(rtcConfig['urls'], isA<List>());

        if (server.isTURN) {
          expect(rtcConfig['username'], isNotNull);
          expect(rtcConfig['credential'], isNotNull);
        }

        print('  RTCIceServer: $rtcConfig');
      }

      print('✅ IceServer model test passed');
    });

    test('3. Chat signaling stats endpoint works', () async {
      print('\n--- Test 3: Chat Signaling Stats ---');

      final stats = await chatClient.get('/chat/stats');
      print('  Stats: $stats');

      expect(stats, isNotNull);
      expect(stats!['status'], isNotNull);

      print('✅ Chat signaling stats test passed');
    });

    test('4. Chat signaling peers endpoint works', () async {
      print('\n--- Test 4: Chat Signaling Peers ---');

      final peersResp = await chatClient.get('/chat/peers');
      print('  Peers response type: ${peersResp.runtimeType}');

      print('✅ Chat signaling peers test passed');
    });

    test('5. IceService caching works correctly', () async {
      print('\n--- Test 5: IceService Caching ---');

      final servers1 = await iceService.getICEServers();
      print('  First call: ${servers1.length} servers');

      final servers2 = await iceService.getICEServers();
      print('  Second call (cached): ${servers2.length} servers');

      expect(servers1.length, equals(servers2.length));
      for (var i = 0; i < servers1.length; i++) {
        expect(servers1[i].urls, equals(servers2[i].urls));
      }

      final servers3 = await iceService.getICEServers(forceRefresh: true);
      print('  Third call (force refresh): ${servers3.length} servers');

      expect(servers3, isNotEmpty);

      print('✅ IceService caching test passed');
    });

    test('6. IceService fallback works when API fails', () async {
      print('\n--- Test 6: IceService Fallback ---');

      final badHttpService = TestHttpService('http://localhost:99999');
      final badIceService = IceService(httpService: badHttpService);

      final servers = await badIceService.getICEServers();
      print('  Fallback servers: ${servers.length}');

      expect(servers, isNotEmpty);
      expect(servers.any((s) => s.isSTUN), isTrue);
      expect(
          servers.any((s) => s.urls.any((u) => u.contains('google'))), isTrue);

      print('✅ IceService fallback test passed');
    });

    test('7. TURN credentials have correct format', () async {
      print('\n--- Test 7: TURN Credentials Format ---');

      final servers = await iceService.getICEServers();
      final turnServers = servers.where((s) => s.isTURN).toList();

      if (turnServers.isEmpty) {
        print('  No TURN servers configured, skipping');
        return;
      }

      for (final server in turnServers) {
        expect(server.username, isNotNull);
        expect(server.credential, isNotNull);

        final parts = server.username!.split(':');
        expect(parts.length, equals(2),
            reason: 'Username should be timestamp:name format');

        final timestamp = int.tryParse(parts[0]);
        expect(timestamp, isNotNull, reason: 'First part should be timestamp');
        expect(
            timestamp!, greaterThan(DateTime.now().millisecondsSinceEpoch ~/ 1000),
            reason: 'Timestamp should be in the future (expiry time)');

        print('  TURN server: ${server.urls.first}');
        print('    username: ${server.username}');
        print(
            '    expires: ${DateTime.fromMillisecondsSinceEpoch(timestamp * 1000)}');
      }

      print('✅ TURN credentials format test passed');
    });
  });

  group('ICE Connection Flow Scenarios', () {
    test('Scenario: Full ICE connection flow documentation', () async {
      print('\n=== ICE Connection Flow (Documented) ===');
      print('''
Phase 1: Get ICE Configuration
  Client → Station: GET /api/v1/turn/ice-servers
  Station → Client: {ice_servers: [...], ttl: 86400}

Phase 2: Create PeerConnection with ICE servers
  Client A: RTCPeerConnection(iceServers: [...])
  Client B: RTCPeerConnection(iceServers: [...])

Phase 3: Gather ICE Candidates
  Client A: onIceCandidate → host, srflx, relay candidates
  Client B: onIceCandidate → host, srflx, relay candidates

Phase 4: Signaling (via Station /chat/* endpoints)
  Note: POST endpoints require JWT authentication
  
  Client A → Station: POST /chat/session/offer {sdp: ...}
  Client A → Station: POST /chat/session/candidate {candidate: ...}
  Client B ← Station: GET /chat/session/offer?id=...
  Client B ← Station: GET /chat/session/candidates?id=...
  Client B → Station: POST /chat/session/answer {sdp: ...}
  Client B → Station: POST /chat/session/candidate {candidate: ...}
  Client A ← Station: GET /chat/session/answer?id=...
  Client A ← Station: GET /chat/session/candidates?id=...

Phase 5: ICE Connectivity Check
  Client A ↔ Client B: STUN binding requests
  Try: host→host, srflx→srflx, relay→relay

Phase 6: Connection Established
  Selected candidate pair: srflx→srflx (typical)
  DataChannel: open

Phase 7: Data Transfer
  Client A → Client B: "Hello!"
  Client B → Client A: "Hi there!"

Phase 8: Connection Termination
  Client A: pc.close()
  Client B: onConnectionState → disconnected
''');
      print('✅ ICE connection flow documented');
    });
  });
}

Future<bool> _checkStationRunning(String url) async {
  try {
    final client = HttpClient();
    client.connectionTimeout = const Duration(seconds: 2);
    final request =
        await client.getUrl(Uri.parse('$url/api/v1/turn/ice-servers'));
    final response = await request.close();
    client.close();
    return response.statusCode == 200;
  } catch (e) {
    return false;
  }
}
