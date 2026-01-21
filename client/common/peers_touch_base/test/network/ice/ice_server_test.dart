import 'package:flutter_test/flutter_test.dart';
import 'package:peers_touch_base/network/ice/ice_server.dart';

void main() {
  group('IceServer', () {
    test('fromJson parses STUN server correctly', () {
      final json = {
        'urls': ['stun:stun.l.google.com:19302'],
      };

      final server = IceServer.fromJson(json);

      expect(server.urls, ['stun:stun.l.google.com:19302']);
      expect(server.username, isNull);
      expect(server.credential, isNull);
      expect(server.isSTUN, isTrue);
      expect(server.isTURN, isFalse);
    });

    test('fromJson parses TURN server with credentials correctly', () {
      final json = {
        'urls': ['turn:127.0.0.1:3478'],
        'username': '1769054136:webrtc-user',
        'credential': 'wdq1tNUSyxSL5bhCgDTKjBKP9yE=',
      };

      final server = IceServer.fromJson(json);

      expect(server.urls, ['turn:127.0.0.1:3478']);
      expect(server.username, '1769054136:webrtc-user');
      expect(server.credential, 'wdq1tNUSyxSL5bhCgDTKjBKP9yE=');
      expect(server.isSTUN, isFalse);
      expect(server.isTURN, isTrue);
    });

    test('toRTCIceServer generates correct format', () {
      final server = IceServer(
        urls: ['turn:127.0.0.1:3478'],
        username: 'user',
        credential: 'pass',
      );

      final rtcConfig = server.toRTCIceServer();

      expect(rtcConfig['urls'], ['turn:127.0.0.1:3478']);
      expect(rtcConfig['username'], 'user');
      expect(rtcConfig['credential'], 'pass');
    });

    test('parses full API response correctly', () {
      final apiResponse = {
        'ice_servers': [
          {'urls': ['stun:stun.l.google.com:19302']},
          {
            'urls': ['turn:127.0.0.1:3478'],
            'username': '1769054136:webrtc-user',
            'credential': 'wdq1tNUSyxSL5bhCgDTKjBKP9yE=',
          },
          {
            'urls': ['turn:127.0.0.1:3478?transport=tcp'],
            'username': '1769054136:webrtc-user',
            'credential': 'wdq1tNUSyxSL5bhCgDTKjBKP9yE=',
          },
        ],
        'ttl': 86400,
      };

      final serverList = apiResponse['ice_servers'] as List;
      final servers = serverList
          .whereType<Map<String, dynamic>>()
          .map((json) => IceServer.fromJson(json))
          .toList();

      expect(servers.length, 3);
      expect(servers[0].isSTUN, isTrue);
      expect(servers[1].isTURN, isTrue);
      expect(servers[2].isTURN, isTrue);
      expect(servers[1].username, contains('webrtc-user'));
    });
  });
}
