import 'package:flutter_test/flutter_test.dart';
import 'package:mockito/mockito.dart';
import 'package:mockito/annotations.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_desktop/features/social/service/social_api_service.dart';
import 'package:peers_touch_base/model/domain/social/relationship.pb.dart' as pb;

@GenerateMocks([IHttpService])
import 'social_api_service_test.mocks.dart';

void main() {
  group('SocialApiService - Follow Operations', () {
    late SocialApiService service;
    late MockIHttpService mockHttpService;

    setUp(() {
      mockHttpService = MockIHttpService();
      service = SocialApiService(mockHttpService);
    });

    test('follow() should send correct protobuf request', () async {
      const targetActorId = '123';
      final expectedResponse = pb.FollowResponse()
        ..success = true
        ..relationship = (pb.Relationship()
          ..targetActorId = targetActorId
          ..following = true
          ..followedBy = false);

      when(mockHttpService.post<List<int>>(
        any,
        data: anyNamed('data'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      final result = await service.follow(targetActorId);

      expect(result.success, true);
      expect(result.relationship.following, true);
      expect(result.relationship.followedBy, false);

      final captured = verify(mockHttpService.post<List<int>>(
        captureAny,
        data: captureAnyNamed('data'),
        options: anyNamed('options'),
      )).captured;

      expect(captured[0], '/api/v1/social/relationships/follow');
      
      final sentRequest = pb.FollowRequest.fromBuffer(captured[1] as List<int>);
      expect(sentRequest.targetActorId, targetActorId);
    });

    test('unfollow() should send correct protobuf request', () async {
      const targetActorId = '456';
      final expectedResponse = pb.UnfollowResponse()..success = true;

      when(mockHttpService.post<List<int>>(
        any,
        data: anyNamed('data'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      final result = await service.unfollow(targetActorId);

      expect(result.success, true);

      final captured = verify(mockHttpService.post<List<int>>(
        captureAny,
        data: captureAnyNamed('data'),
        options: anyNamed('options'),
      )).captured;

      expect(captured[0], '/api/v1/social/relationships/unfollow');
      
      final sentRequest = pb.UnfollowRequest.fromBuffer(captured[1] as List<int>);
      expect(sentRequest.targetActorId, targetActorId);
    });

    test('getRelationship() should query single relationship', () async {
      const targetActorId = '789';
      final expectedResponse = pb.GetRelationshipResponse()
        ..relationship = (pb.Relationship()
          ..targetActorId = targetActorId
          ..following = true
          ..followedBy = true);

      when(mockHttpService.get<List<int>>(
        any,
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      final result = await service.getRelationship(targetActorId);

      expect(result.relationship.following, true);
      expect(result.relationship.followedBy, true);

      final captured = verify(mockHttpService.get<List<int>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
        options: anyNamed('options'),
      )).captured;

      expect(captured[0], '/api/v1/social/relationships');
      expect(captured[1], {'target_actor_id': targetActorId});
    });

    test('getRelationships() should query multiple relationships', () async {
      const targetActorIds = ['111', '222', '333'];
      final expectedResponse = pb.GetRelationshipsResponse()
        ..relationships.addAll([
          pb.Relationship()
            ..targetActorId = '111'
            ..following = true
            ..followedBy = false,
          pb.Relationship()
            ..targetActorId = '222'
            ..following = false
            ..followedBy = true,
          pb.Relationship()
            ..targetActorId = '333'
            ..following = true
            ..followedBy = true,
        ]);

      when(mockHttpService.post<List<int>>(
        any,
        data: anyNamed('data'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      final result = await service.getRelationships(targetActorIds);

      expect(result.relationships.length, 3);
      expect(result.relationships[0].targetActorId, '111');
      expect(result.relationships[0].following, true);
      expect(result.relationships[1].targetActorId, '222');
      expect(result.relationships[1].followedBy, true);

      final captured = verify(mockHttpService.post<List<int>>(
        captureAny,
        data: captureAnyNamed('data'),
        options: anyNamed('options'),
      )).captured;

      expect(captured[0], '/api/v1/social/relationships');
      
      final sentRequest = pb.GetRelationshipsRequest.fromBuffer(captured[1] as List<int>);
      expect(sentRequest.targetActorIds, targetActorIds);
    });
  });

  group('SocialApiService - Followers and Following', () {
    late SocialApiService service;
    late MockIHttpService mockHttpService;

    setUp(() {
      mockHttpService = MockIHttpService();
      service = SocialApiService(mockHttpService);
    });

    test('getFollowers() should fetch followers list', () async {
      const actorId = '100';
      const limit = 20;
      final expectedResponse = pb.GetFollowersResponse()
        ..followers.addAll([
          pb.Follower()
            ..actorId = '201'
            ..username = 'user1'
            ..displayName = 'User One'
            ..followedAt = '2026-01-18T10:00:00Z',
          pb.Follower()
            ..actorId = '202'
            ..username = 'user2'
            ..displayName = 'User Two'
            ..followedAt = '2026-01-18T11:00:00Z',
        ])
        ..nextCursor = 'cursor_123'
        ..total = 50;

      when(mockHttpService.get<List<int>>(
        any,
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      final result = await service.getFollowers(actorId, limit: limit);

      expect(result.followers.length, 2);
      expect(result.followers[0].actorId, '201');
      expect(result.followers[0].username, 'user1');
      expect(result.nextCursor, 'cursor_123');
      expect(result.total, 50);

      final captured = verify(mockHttpService.get<List<int>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
        options: anyNamed('options'),
      )).captured;

      expect(captured[0], '/api/v1/social/relationships/followers');
      expect(captured[1], {
        'actor_id': actorId,
        'limit': limit.toString(),
      });
    });

    test('getFollowers() with cursor should include cursor in query', () async {
      const actorId = '100';
      const cursor = 'cursor_abc';
      const limit = 10;
      final expectedResponse = pb.GetFollowersResponse()
        ..followers.add(pb.Follower()..actorId = '301')
        ..total = 50;

      when(mockHttpService.get<List<int>>(
        any,
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      await service.getFollowers(actorId, cursor: cursor, limit: limit);

      final captured = verify(mockHttpService.get<List<int>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
        options: anyNamed('options'),
      )).captured;

      expect(captured[1], {
        'actor_id': actorId,
        'cursor': cursor,
        'limit': limit.toString(),
      });
    });

    test('getFollowing() should fetch following list', () async {
      const actorId = '100';
      const limit = 15;
      final expectedResponse = pb.GetFollowingResponse()
        ..following.addAll([
          pb.Following()
            ..actorId = '401'
            ..username = 'following1'
            ..displayName = 'Following One'
            ..followedAt = '2026-01-18T12:00:00Z',
        ])
        ..nextCursor = ''
        ..total = 1;

      when(mockHttpService.get<List<int>>(
        any,
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      final result = await service.getFollowing(actorId, limit: limit);

      expect(result.following.length, 1);
      expect(result.following[0].actorId, '401');
      expect(result.following[0].username, 'following1');
      expect(result.nextCursor, '');
      expect(result.total, 1);

      final captured = verify(mockHttpService.get<List<int>>(
        captureAny,
        queryParameters: captureAnyNamed('queryParameters'),
        options: anyNamed('options'),
      )).captured;

      expect(captured[0], '/api/v1/social/relationships/following');
      expect(captured[1], {
        'actor_id': actorId,
        'limit': limit.toString(),
      });
    });
  });

  group('SocialApiService - Error Handling', () {
    late SocialApiService service;
    late MockIHttpService mockHttpService;

    setUp(() {
      mockHttpService = MockIHttpService();
      service = SocialApiService(mockHttpService);
    });

    test('follow() should throw on network error', () async {
      when(mockHttpService.post<List<int>>(
        any,
        data: anyNamed('data'),
        options: anyNamed('options'),
      )).thenThrow(Exception('Network error'));

      expect(
        () => service.follow('123'),
        throwsException,
      );
    });

    test('getRelationship() should throw on invalid response', () async {
      when(mockHttpService.get<List<int>>(
        any,
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => [1, 2, 3]);

      expect(
        () => service.getRelationship('123'),
        throwsA(isA<Exception>()),
      );
    });

    test('getFollowers() should handle empty list', () async {
      final expectedResponse = pb.GetFollowersResponse()
        ..followers.clear()
        ..nextCursor = ''
        ..total = 0;

      when(mockHttpService.get<List<int>>(
        any,
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => expectedResponse.writeToBuffer());

      final result = await service.getFollowers('100');

      expect(result.followers.isEmpty, true);
      expect(result.total, 0);
      expect(result.nextCursor, '');
    });
  });

  group('SocialApiService - Integration Scenarios', () {
    late SocialApiService service;
    late MockIHttpService mockHttpService;

    setUp(() {
      mockHttpService = MockIHttpService();
      service = SocialApiService(mockHttpService);
    });

    test('follow and verify relationship workflow', () async {
      const targetActorId = '999';

      final followResponse = pb.FollowResponse()
        ..success = true
        ..relationship = (pb.Relationship()
          ..targetActorId = targetActorId
          ..following = true
          ..followedBy = false);

      final relationshipResponse = pb.GetRelationshipResponse()
        ..relationship = (pb.Relationship()
          ..targetActorId = targetActorId
          ..following = true
          ..followedBy = false);

      when(mockHttpService.post<List<int>>(
        '/api/v1/social/relationships/follow',
        data: anyNamed('data'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => followResponse.writeToBuffer());

      when(mockHttpService.get<List<int>>(
        '/api/v1/social/relationships',
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => relationshipResponse.writeToBuffer());

      final followResult = await service.follow(targetActorId);
      expect(followResult.success, true);

      final relationshipResult = await service.getRelationship(targetActorId);
      expect(relationshipResult.relationship.following, true);
    });

    test('mutual follow scenario', () async {
      const targetActorId = '888';

      final mutualRelationship = pb.Relationship()
        ..targetActorId = targetActorId
        ..following = true
        ..followedBy = true;

      final relationshipResponse = pb.GetRelationshipResponse()
        ..relationship = mutualRelationship;

      when(mockHttpService.get<List<int>>(
        any,
        queryParameters: anyNamed('queryParameters'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => relationshipResponse.writeToBuffer());

      final result = await service.getRelationship(targetActorId);

      expect(result.relationship.following, true);
      expect(result.relationship.followedBy, true);
    });

    test('batch relationship check for user list', () async {
      const userIds = ['101', '102', '103', '104', '105'];
      
      final relationships = userIds.map((id) => pb.Relationship()
        ..targetActorId = id
        ..following = (int.parse(id) % 2 == 0)
        ..followedBy = (int.parse(id) % 3 == 0)).toList();

      final response = pb.GetRelationshipsResponse()
        ..relationships.addAll(relationships);

      when(mockHttpService.post<List<int>>(
        '/api/v1/social/relationships',
        data: anyNamed('data'),
        options: anyNamed('options'),
      )).thenAnswer((_) async => response.writeToBuffer());

      final result = await service.getRelationships(userIds);

      expect(result.relationships.length, 5);
      expect(result.relationships[1].following, true);
      expect(result.relationships[2].followedBy, true);
    });
  });
}
