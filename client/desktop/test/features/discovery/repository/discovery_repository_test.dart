import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:mockito/annotations.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_desktop/features/discovery/repository/discovery_repository.dart';

@GenerateMocks([IHttpService])
import 'discovery_repository_test.mocks.dart';

void main() {
  group('DiscoveryRepository - fetchObjectReplies', () {
    late DiscoveryRepository repository;
    late MockIHttpService mockHttpService;

    setUp(() {
      mockHttpService = MockIHttpService();
      repository = DiscoveryRepository();
    });

    test('should construct correct URL with query parameters', () async {
      const objectId = 'http://localhost:18080/activitypub/desktop-1/actor/objects/1767752347919249000';
      
      when(mockHttpService.get<Map<String, dynamic>>(
        any,
        queryParameters: anyNamed('queryParameters'),
      )).thenAnswer((_) async => {
        'orderedItems': [],
        'totalItems': 0,
      });

      try {
        await repository.fetchObjectReplies(objectId);
      } catch (_) {}

      final captured = verify(mockHttpService.get<Map<String, dynamic>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
      )).captured;

      expect(captured[0], '/activitypub/object/replies');
      expect(captured[1], {
        'objectId': objectId,
        'page': true,
      });
    });

    test('should handle objectId with special characters', () async {
      const objectId = 'http://localhost:18080/activitypub/user/objects/123?param=value&foo=bar';
      
      when(mockHttpService.get<Map<String, dynamic>>(
        any,
        queryParameters: anyNamed('queryParameters'),
      )).thenAnswer((_) async => {
        'orderedItems': [],
      });

      try {
        await repository.fetchObjectReplies(objectId);
      } catch (_) {}

      final captured = verify(mockHttpService.get<Map<String, dynamic>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
      )).captured;

      expect(captured[1]['objectId'], objectId);
    });

    test('should preserve URL encoding in objectId', () async {
      const objectId = 'http://localhost:18080/activitypub/user/objects/123#section';
      
      when(mockHttpService.get<Map<String, dynamic>>(
        any,
        queryParameters: anyNamed('queryParameters'),
      )).thenAnswer((_) async => {
        'orderedItems': [],
      });

      await repository.fetchObjectReplies(objectId);

      final captured = verify(mockHttpService.get<Map<String, dynamic>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
      )).captured;

      expect(captured[1]['objectId'], contains('://'));
      expect(captured[1]['objectId'], contains('http://'));
    });

    test('should return parsed response', () async {
      const objectId = 'http://localhost:18080/activitypub/desktop-1/actor/objects/123';
      final mockResponse = {
        'orderedItems': [
          {
            'id': 'http://localhost:18080/activitypub/desktop-1/actor/objects/456',
            'type': 'Note',
            'content': 'Test comment',
            'attributedTo': 'http://localhost:18080/activitypub/desktop-1/actor',
            'published': '2026-01-08T00:00:00Z',
          }
        ],
        'totalItems': 1,
      };

      when(mockHttpService.get<Map<String, dynamic>>(
        any,
        queryParameters: anyNamed('queryParameters'),
      )).thenAnswer((_) async => mockResponse);

      final result = await repository.fetchObjectReplies(objectId);

      expect(result, mockResponse);
      expect(result['orderedItems'], isA<List>());
      expect((result['orderedItems'] as List).length, 1);
    });
  });

  group('DiscoveryRepository - URL encoding edge cases', () {
    late DiscoveryRepository repository;
    late MockIHttpService mockHttpService;

    setUp(() {
      mockHttpService = MockIHttpService();
      repository = DiscoveryRepository();
    });

    test('should handle URLs with multiple slashes correctly', () async {
      const objectId = 'http://localhost:18080/activitypub/user/objects/123';
      
      when(mockHttpService.get<Map<String, dynamic>>(
        any,
        queryParameters: anyNamed('queryParameters'),
      )).thenAnswer((_) async => {'orderedItems': []});

      await repository.fetchObjectReplies(objectId);

      final captured = verify(mockHttpService.get<Map<String, dynamic>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
      )).captured;

      final capturedObjectId = captured[1]['objectId'] as String;
      expect(capturedObjectId.split('://').length, 2, reason: 'Should have exactly one ://');
      expect(capturedObjectId, startsWith('http://'));
    });

    test('should not double-encode already encoded URLs', () async {
      const objectId = 'http://localhost:18080/activitypub/user/objects/123';
      
      when(mockHttpService.get<Map<String, dynamic>>(
        any,
        queryParameters: anyNamed('queryParameters'),
      )).thenAnswer((_) async => {'orderedItems': []});

      await repository.fetchObjectReplies(objectId);

      final captured = verify(mockHttpService.get<Map<String, dynamic>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
      )).captured;

      final capturedObjectId = captured[1]['objectId'] as String;
      expect(capturedObjectId, isNot(contains('%3A%2F%2F')), 
        reason: 'Should not contain double-encoded slashes in query params');
    });
  });
}
