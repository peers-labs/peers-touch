import 'package:peers_touch_base/model/domain/social/post.pb.dart';
import 'package:peers_touch_base/model/domain/social/relationship.pb.dart';
import 'package:peers_touch_base/network/dio/http_service.dart';
import 'package:peers_touch_base/network/dio/http_service_locator.dart';

class SocialApiService {
  final IHttpService _httpService = HttpServiceLocator().httpService;

  Future<Post> createPost(CreatePostRequest request) async {
    return await _httpService.post<Post>(
      '/api/v1/social/posts',
      data: request,
      fromJson: (bytes) => Post.fromBuffer(bytes),
    );
  }

  Future<Post> getPost(String postId) async {
    return await _httpService.get<Post>(
      '/api/v1/social/posts/$postId',
      fromJson: (bytes) => Post.fromBuffer(bytes),
    );
  }

  Future<Post> updatePost(String postId, Map<String, dynamic> request) async {
    return await _httpService.put<Post>(
      '/api/v1/social/posts/$postId',
      data: request,
      fromJson: (bytes) => Post.fromBuffer(bytes),
    );
  }

  Future<void> deletePost(String postId) async {
    await _httpService.delete(
      '/api/v1/social/posts/$postId',
    );
  }

  Future<void> likePost(String postId) async {
    await _httpService.post(
      '/api/v1/social/posts/$postId/like',
    );
  }

  Future<void> unlikePost(String postId) async {
    await _httpService.post(
      '/api/v1/social/posts/$postId/unlike',
    );
  }

  Future<GetTimelineResponse> getTimeline({
    TimelineType type = TimelineType.TIMELINE_PUBLIC,
    String? cursor,
    int limit = 20,
  }) async {
    print('[SocialApiService] getTimeline called with type=${type.value} (${type.name}), limit=$limit');
    return await _httpService.get<GetTimelineResponse>(
      '/api/v1/social/timeline',
      queryParameters: {
        'type': type.value,
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
      fromJson: (bytes) => GetTimelineResponse.fromBuffer(bytes),
    );
  }

  Future<FollowResponse> follow(String targetActorId) async {
    final request = FollowRequest()..targetActorId = targetActorId;
    return await _httpService.post<FollowResponse>(
      '/api/v1/social/relationships/follow',
      data: request,
      fromJson: (bytes) => FollowResponse.fromBuffer(bytes),
    );
  }

  Future<UnfollowResponse> unfollow(String targetActorId) async {
    final request = UnfollowRequest()..targetActorId = targetActorId;
    return await _httpService.post<UnfollowResponse>(
      '/api/v1/social/relationships/unfollow',
      data: request,
      fromJson: (bytes) => UnfollowResponse.fromBuffer(bytes),
    );
  }

  Future<Relationship> getRelationship(String targetActorId) async {
    final response = await _httpService.get<GetRelationshipResponse>(
      '/api/v1/social/relationships',
      queryParameters: {'target_actor_id': targetActorId},
      fromJson: (bytes) => GetRelationshipResponse.fromBuffer(bytes),
    );
    return response.relationship;
  }

  Future<List<Relationship>> getRelationships(List<String> targetActorIds) async {
    final request = GetRelationshipsRequest()..targetActorIds.addAll(targetActorIds);
    final response = await _httpService.post<GetRelationshipsResponse>(
      '/api/v1/social/relationships',
      data: request,
      fromJson: (bytes) => GetRelationshipsResponse.fromBuffer(bytes),
    );
    return response.relationships;
  }

  Future<GetFollowersResponse> getFollowers({
    String? actorId,
    String? cursor,
    int limit = 20,
  }) async {
    return await _httpService.get<GetFollowersResponse>(
      '/api/v1/social/relationships/followers',
      queryParameters: {
        if (actorId != null) 'actor_id': actorId,
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
      fromJson: (bytes) => GetFollowersResponse.fromBuffer(bytes),
    );
  }

  Future<GetFollowingResponse> getFollowing({
    String? actorId,
    String? cursor,
    int limit = 20,
  }) async {
    return await _httpService.get<GetFollowingResponse>(
      '/api/v1/social/relationships/following',
      queryParameters: {
        if (actorId != null) 'actor_id': actorId,
        if (cursor != null) 'cursor': cursor,
        'limit': limit,
      },
      fromJson: (bytes) => GetFollowingResponse.fromBuffer(bytes),
    );
  }
}
